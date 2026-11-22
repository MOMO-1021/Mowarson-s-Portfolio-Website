const crypto = require("crypto");
const {
  beginWebhookEvent,
  completeWebhookEvent,
  failWebhookEvent,
  recordPayment,
} = require("../shared/payments");

const hashValue = (value) =>
  value
    ? crypto
        .createHash("sha256")
        .update(String(value).trim().toLowerCase())
        .digest("hex")
    : undefined;

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

  const headers = event.headers || {};
  const receivedSignature =
    headers["x-razorpay-signature"] ||
    headers["X-Razorpay-Signature"] ||
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

  const payloadHash = crypto
    .createHash("sha256")
    .update(rawBody)
    .digest("hex");
  const externalEventId =
    headers["x-razorpay-event-id"] ||
    headers["X-Razorpay-Event-Id"] ||
    null;
  let webhookRecord;
  try {
    webhookRecord = await beginWebhookEvent({
      provider: "razorpay",
      externalEventId,
      eventName: razorpayEvent,
      payloadHash,
    });
  } catch (error) {
    console.error("Neon webhook event persistence failed:", error);
    return { statusCode: 500, body: "Webhook persistence failed" };
  }

  if (!webhookRecord) {
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, duplicate: true }),
    };
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

  try {
    await recordPayment({
      razorpayOrderId: payment.order_id || payment.id,
      razorpayPaymentId: payment.id,
      plan: payment.notes?.plan,
      amountMinor: payment.amount,
      currency: payment.currency || "INR",
      status: "captured",
      paymentMethod: payment.method,
      customerEmail: payment.email || payment.notes?.client_email,
      customerPhone: payment.contact || payment.notes?.client_phone,
      distinctId,
    });
    await completeWebhookEvent(webhookRecord.id);
  } catch (error) {
    await failWebhookEvent(webhookRecord.id, error.message);
    console.error("Neon webhook persistence failed:", error);
    return { statusCode: 500, body: "Webhook persistence failed" };
  }

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

  const pixelId =
    (process.env.META_PIXEL_ID || process.env.PIXEL_ID || "").trim();
  const accessToken =
    (
      process.env.META_CAPI_ACCESS_TOKEN ||
      process.env.ACCESS_TOKEN ||
      ""
    ).trim();
  const testEventCode =
    process.env.META_TEST_EVENT_CODE ||
    process.env.TEST_EVENT_CODE ||
    process.env.test_event_code;
  const metaEventId =
    payment.order_id || payload.payload?.order?.entity?.id || payment.id;

  if (pixelId && accessToken) {
    const email = payment.email || payment.notes?.client_email;
    const phone = payment.contact || payment.notes?.client_phone;
    const metaPayload = {
      data: [{
        event_name: "Purchase",
        event_time: Math.floor(Date.now() / 1000),
        event_id: metaEventId,
        action_source: "website",
        event_source_url: "https://mowarsondeveloper.netlify.app/pay.html",
        user_data: Object.fromEntries(
          Object.entries({
            em: email ? [hashValue(email)] : undefined,
            ph: phone ? [hashValue(phone)] : undefined,
          }).filter(([, value]) => value != null),
        ),
        custom_data: {
          value: amountInMajorUnits,
          currency: payment.currency || "INR",
          transaction_id: payment.id,
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
          body: JSON.stringify(metaPayload),
        },
      );
      if (!metaResponse.ok) {
        console.error(
          "Meta webhook Purchase CAPI failed:",
          metaResponse.status,
          await metaResponse.text(),
        );
      }
    } catch (metaError) {
      console.error("Meta webhook Purchase CAPI request failed:", metaError);
    }
  } else {
    console.error(
      "Meta webhook CAPI skipped: Meta environment variables are missing",
    );
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, transaction_id: payment.id }),
  };
};
