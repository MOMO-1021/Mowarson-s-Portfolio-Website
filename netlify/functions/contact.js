/**
 * Netlify Function: /api/contact
 * Validates inquiries, creates a signed thank-you token, and sends Meta CAPI.
 */

const crypto = require("crypto");
const { flushPostHogLogs, posthogLogger } = require("../../posthog-logs");
const { jsonResponse } = require("../shared/http");
const { query } = require("../shared/db");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BREVO_API_URL = "https://api.brevo.com/v3";

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);

const sha256 = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");

const base64Url = (value) =>
  Buffer.from(value).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const sign = (value, secret) =>
  crypto.createHmac("sha256", secret).update(value).digest("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const parseBody = (event) => {
  if (typeof event.body !== "string") return null;
  const contentType = event.headers["content-type"] || event.headers["Content-Type"] || "";
  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(event.body);
    } catch {
      return null;
    }
  }
  return Object.fromEntries(new URLSearchParams(event.body));
};

const looksLikeSpam = (name, message) => {
  if (name.length < 2 || /https?:\/\/|www\./i.test(name)) return true;
  if (message.length < 10) return true;
  if (/(.)\1{7,}/i.test(message)) return true;
  const links = message.match(/https?:\/\/|www\./gi) || [];
  return links.length > 3;
};

const getClientIp = (event) =>
  event.headers["x-nf-client-connection-ip"] ||
  event.headers["x-forwarded-for"] ||
  event.headers["client-ip"] ||
  undefined;

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Headers": "Content-Type, Accept",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Method Not Allowed. Use POST." });
  }
  if (typeof event.body !== "string" || event.body.length > 10000) {
    return jsonResponse(400, { error: "The submitted form is invalid or too large." });
  }

  const data = parseBody(event);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return jsonResponse(400, { error: "Please submit a valid form." });
  }

  const text = (value) => (typeof value === "string" ? value.trim() : "");
  const name = text(data.name);
  const email = text(data.email).toLowerCase();
  const phone = text(data.phone);
  const service = text(data.service);
  const message = text(data.message);
  const consent = data.consent === true || data.consent === "true";

  if (text(data.website)) {
    return jsonResponse(400, { error: "The submitted form could not be accepted." });
  }
  if (!name || name.length > 120 || looksLikeSpam(name, message)) {
    return jsonResponse(400, { error: "Please provide a valid name and project details." });
  }
  if (!email || email.length > 254 || !EMAIL_REGEX.test(email)) {
    return jsonResponse(400, { error: "Please provide a valid email address." });
  }
  if (!message || message.length > 3000) {
    return jsonResponse(400, { error: "Please provide project details (up to 3,000 characters)." });
  }
  if (phone.length > 30 || service.length > 100) {
    return jsonResponse(400, { error: "Please check the phone number and service fields." });
  }

  const isPreview =
    (process.env.IS_PREVIEW || "").trim().toLowerCase() === "true" ||
    ["deploy-preview", "branch-deploy"].includes((process.env.CONTEXT || "").trim().toLowerCase());

  const brevoApiKey = (process.env.BREVO_API_KEY || "").trim().replace(/^["']|["']$/g, "");
  // In preview mode, do not send test leads to the production Brevo list
  const rawListId = isPreview
    ? (process.env.BREVO_TEST_LIST_ID || process.env.TEST_BREVO_LIST_ID || "").trim()
    : (process.env.BREVO_LIST_ID || "").trim();
  const listId = /^\d+$/.test(rawListId) ? Number(rawListId) : null;
  const pixelId = (process.env.PIXEL_ID || "").trim();
  const accessToken = (process.env.ACCESS_TOKEN || "").trim();
  const tokenSecret = (process.env.THANK_YOU_TOKEN_SECRET || "").trim();

  if (!brevoApiKey) {
    return jsonResponse(503, { error: "The contact form is temporarily unavailable. Please contact us on WhatsApp." });
  }
  if (!isPreview && consent && (!Number.isSafeInteger(listId) || listId < 1)) {
    return jsonResponse(503, { error: "Email updates are temporarily unavailable. Please uncheck the optional marketing box or try again." });
  }
  if (!pixelId || !accessToken || !tokenSecret) {
    console.error("Missing PIXEL_ID, ACCESS_TOKEN, or THANK_YOU_TOKEN_SECRET.");
    return jsonResponse(503, { error: "The form service is not configured. Please try again later." });
  }

  try {
    await query(
      `INSERT INTO leads
        (name, email, phone, service, message, source, marketing_consent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        name,
        email,
        phone || null,
        service || null,
        message,
        isPreview ? "preview_contact_form" : "website_contact_form",
        consent,
      ],
    );
  } catch (error) {
    console.error("Neon lead persistence failed:", error);
    return jsonResponse(503, {
      error: "The inquiry service is temporarily unavailable. Please try again later.",
    });
  }

  try {
    const nameParts = name.split(/\s+/);
    const sanitizedPhone = phone.replace(/[^0-9+]/g, "");
    const contactResponse = await fetch(`${BREVO_API_URL}/contacts`, {
      method: "POST",
      headers: { "api-key": brevoApiKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        email,
        attributes: {
          FIRSTNAME: nameParts[0],
          ...(nameParts.length > 1 ? { LASTNAME: nameParts.slice(1).join(" ") } : {}),
          ...(/^\+?\d{5,20}$/.test(sanitizedPhone) ? { SMS: sanitizedPhone } : {}),
        },
        updateEnabled: true,
        ...(consent && listId ? { listIds: [listId] } : {}),
      }),
    });
    if (!contactResponse.ok) {
      console.error("Brevo contact API failed:", contactResponse.status, await contactResponse.text());
      return jsonResponse(502, { error: "We couldn't save your inquiry. Please try again." });
    }

    const notifyEmail = (process.env.LEAD_NOTIFICATION_EMAIL || "mowarsondeveloper@gmail.com").trim();
    const selectedServiceLabel = service || "SEO-Optimized Website & Monthly SEO Packages (₹8,000)";
    const whatsappQuickLink = `https://api.whatsapp.com/send/?phone=916009825938&text=${encodeURIComponent(
      `Hi Mowarson, I'm ${name}. I just submitted an inquiry for ${selectedServiceLabel}.`
    )}`;

    await Promise.all([
      fetch(`${BREVO_API_URL}/smtp/email`, {
        method: "POST",
        headers: { "api-key": brevoApiKey, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          sender: { name: "Mowarson Portfolio Lead", email: "mowarsondeveloper@gmail.com" },
          to: [{ email: notifyEmail, name: "Mowarson" }],
          replyTo: { email, name },
          subject: isPreview ? "[TEST PREVIEW] New website inquiry" : "New website inquiry",
          htmlContent: `
            <div style="font-family:Arial,sans-serif;line-height:1.6;color:#1e293b;max-width:600px;margin:0 auto;padding:24px;">
              <h2>New Website Inquiry</h2>
              <p><strong>Name:</strong> ${escapeHtml(name)}</p>
              <p><strong>Email:</strong> ${escapeHtml(email)}</p>
              <p><strong>Phone / WhatsApp:</strong> ${escapeHtml(phone || "Not provided")}</p>
              <p><strong>Service:</strong> ${escapeHtml(selectedServiceLabel)}</p>
              <p><strong>Marketing opt-in:</strong> ${consent ? "Yes" : "No"}</p>
              <h3>Project details</h3>
              <p style="white-space:pre-wrap;">${escapeHtml(message)}</p>
            </div>`,
        }),
      }).catch((error) => console.error("Brevo lead notification failed:", error)),
      fetch(`${BREVO_API_URL}/smtp/email`, {
        method: "POST",
        headers: { "api-key": brevoApiKey, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          sender: { name: "Mowarson Developer", email: "mowarsondeveloper@gmail.com" },
          to: [{ email, name }],
          replyTo: { email: notifyEmail, name: "Mowarson" },
          subject: isPreview
            ? "[TEST PREVIEW] We received your inquiry – Mowarson Developer"
            : "Thanks for reaching out – Mowarson Developer",
          htmlContent: `
            <div style="font-family:Arial,sans-serif;line-height:1.6;color:#1e293b;max-width:600px;margin:0 auto;padding:24px;">
              <h2 style="color:#0f172a;margin-top:0;">Hi ${escapeHtml(name)}, thanks for reaching out!</h2>
              <p>I have received your inquiry for <strong>${escapeHtml(selectedServiceLabel)}</strong> and will review your details shortly.</p>
              <p>Everything in our all-inclusive <strong>₹8,000</strong> package is built to boost your online visibility and turn prospective customers into clients—including your SEO-Optimized Website, Monthly SEO Packages, Local Business SEO, Technical SEO, and SEO Blog.</p>
              <p style="margin:24px 0;">
                <a href="${whatsappQuickLink}" style="display:inline-block;background:#25d366;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:8px;margin-right:10px;">Chat Instantly on WhatsApp</a>
                <a href="https://mowarsondeveloper.netlify.app/pay.html?service=seo" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:8px;">Get Started (₹8,000)</a>
              </p>
              <p style="font-size:14px;color:#475569;">Talk soon,<br/><strong>Mowarson</strong><br/>Mowarson Developer</p>
            </div>`,
        }),
      }).catch((error) => console.error("Brevo automated lead confirmation failed:", error)),
    ]);

    const eventId = crypto.randomUUID();
    const expiresAt = Date.now() + 10 * 60 * 1000;
    const payload = base64Url(JSON.stringify({ eventId, expiresAt }));
    const token = `${payload}.${sign(payload, tokenSecret)}`;
    const secure = event.headers["x-forwarded-proto"] === "https";

    const cookies = event.headers.cookie || event.headers.Cookie || "";
    const fbpMatch = cookies.match(/(?:^|;\s*)_fbp=([^;]+)/);
    const fbcMatch = cookies.match(/(?:^|;\s*)_fbc=([^;]+)/);
    const fbclid = text(new URLSearchParams(event.rawQuery || "").get("fbclid"));
    const fbc = fbcMatch
      ? decodeURIComponent(fbcMatch[1])
      : fbclid ? `fb.1.${Date.now()}.${fbclid}` : undefined;

    const metaPayload = {
      data: [{
        event_name: "Contact",
        event_time: Math.floor(Date.now() / 1000),
        event_id: eventId,
        action_source: "website",
        event_source_url: event.headers.origin || event.headers.referer || "https://mowarsondeveloper.netlify.app/contact.html",
        user_data: {
          em: [sha256(email.trim().toLowerCase())],
          ...(getClientIp(event) ? { client_ip_address: getClientIp(event) } : {}),
          ...(event.headers["user-agent"] ? { client_user_agent: event.headers["user-agent"] } : {}),
          ...(fbc ? { fbc } : {}),
          ...(fbpMatch ? { fbp: decodeURIComponent(fbpMatch[1]) } : {}),
        },
      }],
      ...(process.env.META_TEST_EVENT_CODE
        ? { test_event_code: process.env.META_TEST_EVENT_CODE.trim() }
        : {}),
    };

    const metaResponse = await fetch(
      `https://graph.facebook.com/v21.0/${encodeURIComponent(pixelId)}/events?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(metaPayload),
      }
    );
    if (!metaResponse.ok) {
      console.error("Meta CAPI failed:", metaResponse.status, await metaResponse.text());
      return jsonResponse(502, { error: "The inquiry was not fully processed. Please try again." });
    }

    posthogLogger.info("contact_inquiry_accepted", { marketing_consent: consent });
    await flushPostHogLogs();

    const redirectTo = `/thank-you.html?token=${encodeURIComponent(token)}`;
    const cookie = `thank_you_token=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600${secure ? "; Secure" : ""}`;
    const acceptsJson = (event.headers.accept || event.headers.Accept || "").includes("application/json");
    if (acceptsJson) {
      return jsonResponse(200, { success: true, redirectTo, eventId }, { "Set-Cookie": cookie });
    }
    return {
      statusCode: 302,
      headers: { Location: redirectTo, "Set-Cookie": cookie },
      body: "",
    };
  } catch (error) {
    console.error("Error processing contact submission:", error);
    return jsonResponse(500, { error: "Unable to submit your inquiry right now. Please try again." });
  }
};
