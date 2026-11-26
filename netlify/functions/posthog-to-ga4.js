const { sendGa4MeasurementProtocolEvent } = require("../shared/ga4");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const measurementId = (process.env.GA4_MEASUREMENT_ID || "").trim();
  const apiSecret = (process.env.GA4_API_SECRET || "").trim();

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

  const props =
    eventObj.properties && typeof eventObj.properties === "object"
      ? eventObj.properties
      : {};

  const transactionId =
    props.transaction_id || props.razorpay_payment_id || undefined;

  const clientId = String(
    props.ga_client_id ||
      props.$device_id ||
      eventObj.distinct_id ||
      body.person?.id ||
      "555.123456789",
  );

  const rawParams = { ...props };
  if (transactionId) {
    rawParams.transaction_id = String(transactionId);
  }
  if (props.this_is_an_example_event === true) {
    rawParams.debug_mode = 1;
  }

  try {
    const result = await sendGa4MeasurementProtocolEvent({
      eventName,
      clientId,
      params: rawParams,
      measurementId,
      apiSecret,
    });

    if (!result.ok) {
      return {
        statusCode: 502,
        body: JSON.stringify({
          ok: false,
          ga4Status: result.status,
          error: result.error,
        }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        event: result.event,
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
