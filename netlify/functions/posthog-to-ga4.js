exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const measurementId = process.env.GA4_MEASUREMENT_ID;
  const apiSecret = process.env.GA4_API_SECRET;

  if (!measurementId || !apiSecret) {
    return {
      statusCode: 500,
      body: "Missing GA4_MEASUREMENT_ID or GA4_API_SECRET environment variables",
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: "Invalid JSON payload" };
  }

  // Support both PostHog webhook shape ({ event: { event, properties, distinct_id }, person })
  // and flat/direct payloads if ever called directly
  const eventObj =
    body.event && typeof body.event === "object" ? body.event : body;
  const eventName =
    typeof eventObj.event === "string" ? eventObj.event : body.event;

  if (!eventName) {
    return { statusCode: 400, body: "Missing event name" };
  }

  // GA4 disallows event names starting with reserved prefixes like "firebase_", "google_", or "ga_"
  const safeEventName = eventName.replace(/^\$/, "").slice(0, 40);

  const props =
    eventObj.properties && typeof eventObj.properties === "object"
      ? eventObj.properties
      : {};

  const transactionId =
    props.transaction_id || props.razorpay_payment_id || undefined;

  const clientId = String(
    props.$device_id ||
      eventObj.distinct_id ||
      body.person?.id ||
      "555.123456789",
  );

  // Clean parameters so GA4 doesn't reject nested objects or undefined values
  const params = {};
  for (const [key, value] of Object.entries(props)) {
    if (
      value !== undefined &&
      value !== null &&
      typeof value !== "object" &&
      key.length <= 40
    ) {
      params[key] = value;
    }
  }

  if (transactionId) {
    params.transaction_id = String(transactionId);
  }

  // Ensure currency is present whenever value/revenue is sent on purchase/payment events
  if (params.value !== undefined && !params.currency) {
    params.currency = "INR";
  }

  // Mark example events from PostHog's "Test function" button as debug_mode so they stand out in GA4
  if (props.this_is_an_example_event === true) {
    params.debug_mode = 1;
  }

  const ga4Url = `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(
    measurementId,
  )}&api_secret=${encodeURIComponent(apiSecret)}`;

  try {
    const ga4Response = await fetch(ga4Url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        events: [
          {
            name: safeEventName,
            params,
          },
        ],
      }),
    });

    if (!ga4Response.ok) {
      const errorText = await ga4Response.text();
      return {
        statusCode: 502,
        body: JSON.stringify({
          ok: false,
          ga4Status: ga4Response.status,
          error: errorText,
        }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        event: safeEventName,
        transaction_id: transactionId || null,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};
