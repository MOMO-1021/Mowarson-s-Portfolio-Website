const crypto = require("crypto");
const Razorpay = require("razorpay");
const { flushPostHogLogs, posthogLogger } = require("../../posthog-logs");
const { getJsonHeaders } = require("../shared/http");
const { getRazorpayCredentials } = require("../shared/razorpay");
const { recordPayment } = require("../shared/payments");

exports.handler = async (event) => {
  const headers = getJsonHeaders("POST, OPTIONS");

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method Not Allowed" }),
    };
  }

  try {
    const { useTestKeys, key_id, key_secret } = getRazorpayCredentials();

    if (!key_id || !key_secret) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          error:
            "Razorpay secret key is not configured in environment variables.",
        }),
      };
    }

    if (useTestKeys && !key_id.startsWith("rzp_test_")) {
      return {
        statusCode: 409,
        headers,
        body: JSON.stringify({
          success: false,
          error: "Test mode is enabled but a live Razorpay Key ID is configured.",
        }),
      };
    }

    const data = JSON.parse(event.body || "{}");
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = data;

    if (
      typeof razorpay_order_id !== "string" ||
      typeof razorpay_payment_id !== "string" ||
      typeof razorpay_signature !== "string" ||
      !razorpay_order_id ||
      !razorpay_payment_id ||
      !razorpay_signature
    ) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error:
            "Missing required fields: razorpay_order_id, razorpay_payment_id, and razorpay_signature are mandatory.",
        }),
      };
    }

    const payload = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expectedSignature = crypto
      .createHmac("sha256", key_secret)
      .update(payload)
      .digest("hex");

    const expectedBuffer = Buffer.from(expectedSignature, "hex");
    const suppliedBuffer = Buffer.from(razorpay_signature, "hex");
    if (
      !/^[a-f0-9]{64}$/i.test(razorpay_signature) ||
      expectedBuffer.length !== suppliedBuffer.length ||
      !crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)
    ) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: "Signature mismatch. Payment verification failed.",
        }),
      };
    }

    const razorpay = new Razorpay({ key_id, key_secret });
    const [order, payment] = await Promise.all([
      razorpay.orders.fetch(razorpay_order_id),
      razorpay.payments.fetch(razorpay_payment_id),
    ]);

    if (
      payment.order_id !== order.id ||
      payment.amount !== order.amount ||
      payment.currency !== order.currency
    ) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: "The payment details do not match the Razorpay order.",
        }),
      };
    }

    if (payment.status !== "captured" || order.status !== "paid") {
      return {
        statusCode: 409,
        headers,
        body: JSON.stringify({
          success: false,
          pending: true,
          error:
            "Payment is not confirmed as captured yet. Please contact support before trying again.",
        }),
      };
    }

    const userData =
      data.userData && typeof data.userData === "object" ? data.userData : {};
    try {
      await recordPayment({
        razorpayOrderId: razorpay_order_id,
        razorpayPaymentId: razorpay_payment_id,
        plan: data.plan,
        amountMinor: order.amount,
        currency: order.currency,
        status: payment.status,
        paymentMethod: payment.method,
        signatureVerified: true,
        customerEmail: userData.email,
        customerPhone: userData.phone,
        distinctId: userData.distinct_id,
      });
    } catch (error) {
      console.error("Neon payment persistence failed:", error);
      return {
        statusCode: 503,
        headers,
        body: JSON.stringify({
          success: false,
          error: "The payment record could not be saved. Please contact support.",
        }),
      };
    }

    posthogLogger.info("payment_verified", {
      razorpay_order_id: razorpay_order_id,
      razorpay_payment_id: razorpay_payment_id,
      amount_minor: order.amount,
      currency: order.currency,
    });
    await flushPostHogLogs();

    const pixelId =
      (process.env.META_PIXEL_ID || process.env.PIXEL_ID || "").trim();
    const accessToken =
      (process.env.META_CAPI_ACCESS_TOKEN || process.env.ACCESS_TOKEN || "").trim();
    const testEventCode =
      process.env.META_TEST_EVENT_CODE ||
      process.env.TEST_EVENT_CODE ||
      process.env.test_event_code;

    if (pixelId && accessToken) {
      const hashValue = (value) =>
        value
          ? crypto
              .createHash("sha256")
              .update(String(value).trim().toLowerCase())
              .digest("hex")
          : undefined;
      const cookieHeader =
        event.headers?.cookie || event.headers?.Cookie || "";
      const getCookie = (name) => {
        const match = cookieHeader
          .split(";")
          .map((part) => part.trim())
          .find((part) => part.startsWith(`${name}=`));
        return match
          ? decodeURIComponent(match.slice(name.length + 1))
          : undefined;
      };
      const clientIp =
        event.headers["x-nf-client-connection-ip"] ||
        event.headers["x-forwarded-for"] ||
        event.headers["client-ip"];

      const capiPayload = {
        data: [{
          event_name: "Purchase",
          event_time: Math.floor(Date.now() / 1000),
          event_id: razorpay_order_id,
          action_source: "website",
          event_source_url:
            event.headers.referer ||
            event.headers.origin ||
            "https://mowarsondeveloper.netlify.app/pay.html",
          user_data: Object.fromEntries(
            Object.entries({
              em: userData.email ? [hashValue(userData.email)] : undefined,
              ph: userData.phone ? [hashValue(userData.phone)] : undefined,
              client_ip_address: clientIp,
              client_user_agent:
                event.headers["user-agent"] || userData.client_user_agent,
              fbp: getCookie("_fbp") || userData.fbp,
              fbc: getCookie("_fbc") || userData.fbc,
            }).filter(([, value]) => value != null),
          ),
          custom_data: {
            value: order.amount / 100,
            currency: order.currency,
            content_ids: [data.plan || "payment"],
            content_type: "product",
            transaction_id: razorpay_payment_id,
          },
        }],
        ...(testEventCode ? { test_event_code: testEventCode } : {}),
      };

      try {
        const metaResponse = await fetch(
          `https://graph.facebook.com/v21.0/${encodeURIComponent(pixelId)}/events?access_token=${encodeURIComponent(accessToken)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(capiPayload),
          },
        );
        if (!metaResponse.ok) {
          console.error(
            "Meta Purchase CAPI failed:",
            metaResponse.status,
            await metaResponse.text(),
          );
        }
      } catch (capiError) {
        console.error("Meta Purchase CAPI request failed:", capiError);
      }
    } else {
      console.error(
        "Meta Purchase CAPI skipped: Meta Pixel or access token is missing",
      );
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: "Payment verified successfully",
        amount: order.amount,
        currency: order.currency,
      }),
    };
  } catch (err) {
    console.error("Netlify Function verify-payment error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: err.message || "Internal server error during verification",
      }),
    };
  }
};
