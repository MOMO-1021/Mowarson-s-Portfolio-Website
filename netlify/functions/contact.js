/**
 * Netlify Function: /api/contact
 * Collects website inquiries and optionally subscribes opted-in contacts to Brevo.
 */

const { flushPostHogLogs, posthogLogger } = require("../../posthog-logs");
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BREVO_API_URL = "https://api.brevo.com/v3";

const jsonResponse = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Method Not Allowed. Use POST." });
  }

  try {
    if (typeof event.body !== "string" || event.body.length > 10000) {
      return jsonResponse(400, { error: "The submitted form is invalid or too large." });
    }

    let data;
    try {
      data = JSON.parse(event.body);
    } catch {
      return jsonResponse(400, { error: "Please submit a valid form." });
    }

    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return jsonResponse(400, { error: "Please submit a valid form." });
    }

    const text = (value) => (typeof value === "string" ? value.trim() : "");
    const name = text(data.name);
    const email = text(data.email).toLowerCase();
    const phone = text(data.phone);
    const service = text(data.service);
    const message = text(data.message);
    const consent = data.consent === true;

    if (!name || name.length > 120) {
      return jsonResponse(400, { error: "Please provide your name (up to 120 characters)." });
    }

    if (!email || email.length > 254 || !EMAIL_REGEX.test(email)) {
      return jsonResponse(400, { error: "Please provide a valid email address." });
    }

    if (phone.length > 30 || service.length > 100) {
      return jsonResponse(400, { error: "Please check the phone number and service fields." });
    }

    if (!message || message.length > 3000) {
      return jsonResponse(400, { error: "Please provide project details (up to 3,000 characters)." });
    }

    const rawBrevoApiKey = process.env.BREVO_API_KEY || "";
    const brevoApiKey = rawBrevoApiKey.trim().replace(/^["']|["']$/g, "");
    const rawListId = (process.env.BREVO_LIST_ID || "").trim();
    const listId = /^\d+$/.test(rawListId) ? Number(rawListId) : null;

    if (!brevoApiKey) {
      console.error("Contact submission unavailable: BREVO_API_KEY is not configured.");
      return jsonResponse(503, {
        error: "The contact form is temporarily unavailable. Please contact me on WhatsApp.",
      });
    }

    if (consent && (!Number.isSafeInteger(listId) || listId < 1)) {
      console.error("Marketing opt-in unavailable: BREVO_LIST_ID is not configured.");
      return jsonResponse(503, {
        error: "Email updates are temporarily unavailable. Please uncheck the optional marketing box or try again later.",
      });
    }

    const nameParts = name.split(/\s+/);
    const sanitizedPhone = phone.replace(/[^0-9+]/g, "");
    const attributes = {
      FIRSTNAME: nameParts[0],
      ...(nameParts.length > 1 ? { LASTNAME: nameParts.slice(1).join(" ") } : {}),
      ...(/^\+?\d{5,20}$/.test(sanitizedPhone) ? { SMS: sanitizedPhone } : {}),
    };
    const contactPayload = {
      email,
      attributes,
      updateEnabled: true,
      ...(consent ? { listIds: [listId] } : {}),
    };

    const contactResponse = await fetch(`${BREVO_API_URL}/contacts`, {
      method: "POST",
      headers: {
        "api-key": brevoApiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(contactPayload),
    });

    if (!contactResponse.ok) {
      const errorDetails = await contactResponse.text();
      console.error("Brevo contact API request failed:", contactResponse.status, errorDetails);
      return jsonResponse(502, {
        error: "We couldn't save your inquiry right now. Please try again or reach out on WhatsApp.",
      });
    }

    const notifyEmail = (process.env.LEAD_NOTIFICATION_EMAIL || "mowarsondeveloper@gmail.com").trim();
    const safeName = escapeHtml(name);
    const safeEmail = escapeHtml(email);
    const safePhone = escapeHtml(phone || "Not provided");
    const safeService = escapeHtml(service || "Not specified");
    const safeMessage = escapeHtml(message);

    try {
      const notificationResponse = await fetch(`${BREVO_API_URL}/smtp/email`, {
        method: "POST",
        headers: {
          "api-key": brevoApiKey,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          sender: {
            name: "Mowarson Portfolio Lead",
            email: "mowarsondeveloper@gmail.com",
          },
          to: [{ email: notifyEmail, name: "Mowarson" }],
          replyTo: { email, name },
          subject: "New website inquiry",
          htmlContent: `
            <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1e293b; max-width: 600px; margin: 0 auto; padding: 24px;">
              <h2>New Website Inquiry</h2>
              <p><strong>Name:</strong> ${safeName}</p>
              <p><strong>Email:</strong> <a href="mailto:${safeEmail}">${safeEmail}</a></p>
              <p><strong>Phone / WhatsApp:</strong> ${safePhone}</p>
              <p><strong>Service:</strong> ${safeService}</p>
              <p><strong>Marketing opt-in:</strong> ${consent ? "Yes" : "No"}</p>
              <h3>Project details</h3>
              <p style="white-space: pre-wrap;">${safeMessage}</p>
            </div>
          `,
        }),
      });

      if (!notificationResponse.ok) {
        console.error(
          "Brevo lead notification failed:",
          notificationResponse.status,
          await notificationResponse.text()
        );
      }
    } catch (notificationError) {
      console.error("Could not send lead email notification via Brevo SMTP:", notificationError);
    }

    posthogLogger.info("contact_inquiry_accepted", { marketing_consent: consent });
    await flushPostHogLogs();

    return jsonResponse(200, {
      success: true,
      message: "Thank you! Your inquiry has been received. I will get back to you within 24 hours.",
    });
  } catch (error) {
    console.error("Error processing lead contact submission:", error);
    return jsonResponse(500, {
      error: "Unable to submit your inquiry right now. Please try again or reach out on WhatsApp.",
    });
  }
};
