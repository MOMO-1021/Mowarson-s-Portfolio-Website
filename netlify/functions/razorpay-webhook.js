const crypto = require("crypto");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const posthogKey =
    process.env.POSTHOG_PROJECT_TOKEN || process.env.POSTHOG_PROJECT_API_KEY;
  const posthogHost = process.env.POSTHOG_HOST || "https://eu.posthog.com";

  if (!webhookSecret || !posthogKey) {
    return { statusCode: 500, body: "Missing server environment variables" };
  }

  // 1. Get raw body & Razorpay signature header
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64").toString("utf8")
    : event.body || "";

  const receivedSignature =
    event.headers["x-razorpay-signature"] ||
    event.headers["X-Razorpay-Signature"] ||
    "";

  // 2. Verify HMAC SHA256 signature
  const expectedSignature = crypto
    .createHmac("sha256", webhookSecret)
    .update(rawBody)
    .digest("hex");

  const sigBuf = Buffer.from(receivedSignature, "utf8");
  const expBuf = Buffer.from(expectedSignature, "utf8");

  if (
    sigBuf.length !== expBuf.length ||
    !crypto.timingSafeEqual(sigBuf, expBuf)
  ) {
    return { statusCode: 401, body: "Invalid signature" };
  }

  // 3. Parse payload & check for payment success events
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { statusCode: 400, body: "Invalid JSON" };
  }

  const razorpayEvent = payload.event;
  if (razorpayEvent !== "payment.captured" && razorpayEvent !== "order.paid") {
    return { statusCode: 200, body: "Ignored non-purchase event" };
  }

  const payment =
    payload.payload?.payment?.entity ||
    (payload.payload?.order?.entity
      ? {
          id: payload.payload.order.entity.id,
          order_id: payload.payload.order.entity.id,
          amount:
            payload.payload.order.entity.amount_paid ??
            payload.payload.order.entity.amount,
          currency: payload.payload.order.entity.currency || "INR",
          notes: payload.payload.order.entity.notes || {},
        }
      : null);

  if (!payment || !payment.id) {
    return { statusCode: 400, body: "Missing payment or order entity" };
  }

  const distinctId =
    payment.notes?.posthog_distinct_id ||
    payment.email ||
    payment.contact ||
    payment.id;

  const amountInMajorUnits =
    typeof payment.amount === "number"
      ? Number((payment.amount / 100).toFixed(2))
      : 0;

  const baseProperties = {
    transaction_id: payment.id,
    razorpay_payment_id: payment.id,
    razorpay_order_id: payment.order_id || "",
    value: amountInMajorUnits,
    currency: payment.currency || "INR",
    payment_method: payment.method || "",
    source: "razorpay_webhook",
  };

  // 4. Send `purchase` and `payment_completed` to PostHog
  const eventsToSend = [
    {
      event: "purchase",
      distinct_id: distinctId,
      properties: baseProperties,
    },
    {
      event: "payment_completed",
      distinct_id: distinctId,
      properties: baseProperties,
    },
  ];

  for (const item of eventsToSend) {
    await fetch(`${posthogHost}/capture/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: posthogKey,
        event: item.event,
        distinct_id: item.distinct_id,
        properties: item.properties,
      }),
    });
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, transaction_id: payment.id }),
  };
};
