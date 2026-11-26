const RESERVED_PREFIXES = ["firebase_", "google_", "ga_"];
const VALID_PARAM_KEY = /^[a-zA-Z][a-zA-Z0-9_]*$/;

/**
 * Sanitizes event parameters for GA4 Measurement Protocol requirements.
 * Drops $-prefixed internal keys, reserved prefixes, and non-primitive values except ecommerce `items`.
 */
function sanitizeGa4Params(rawParams = {}) {
  const params = {};

  for (const [key, value] of Object.entries(rawParams)) {
    if (value === undefined || value === null) continue;

    if (key === "items" && Array.isArray(value)) {
      const sanitizedItems = value
        .filter((item) => item && typeof item === "object")
        .map((item) => {
          const cleanItem = {};
          if (item.item_id !== undefined) cleanItem.item_id = String(item.item_id).slice(0, 100);
          if (item.item_name !== undefined) cleanItem.item_name = String(item.item_name).slice(0, 100);
          if (item.quantity !== undefined && Number.isFinite(Number(item.quantity))) {
            cleanItem.quantity = Number(item.quantity);
          }
          if (item.price !== undefined && Number.isFinite(Number(item.price))) {
            cleanItem.price = Number(item.price);
          }
          return cleanItem;
        })
        .filter((item) => Object.keys(item).length > 0);

      if (sanitizedItems.length > 0) {
        params.items = sanitizedItems;
      }
      continue;
    }

    if (typeof value === "object") continue;
    if (key.length > 40 || !VALID_PARAM_KEY.test(key)) continue;
    if (RESERVED_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;

    params[key] = typeof value === "string" ? value.slice(0, 100) : value;
  }

  if (params.engagement_time_msec === undefined) {
    params.engagement_time_msec = 100;
  }

  if (params.value !== undefined && !params.currency) {
    params.currency = "INR";
  }

  return params;
}

/**
 * Sends a single event to Google Analytics 4 via Measurement Protocol.
 */
async function sendGa4MeasurementProtocolEvent({
  eventName,
  clientId,
  params = {},
  measurementId = (process.env.GA4_MEASUREMENT_ID || "").trim(),
  apiSecret = (process.env.GA4_API_SECRET || "").trim(),
}) {
  if (!measurementId || !apiSecret) {
    return { skipped: true, reason: "Missing GA4_MEASUREMENT_ID or GA4_API_SECRET" };
  }

  const safeEventName = String(eventName || "")
    .replace(/^\$/, "")
    .slice(0, 40);

  if (!safeEventName) {
    throw new Error("Missing GA4 event name");
  }

  const sanitizedParams = sanitizeGa4Params(params);
  const ga4Url = `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(
    measurementId,
  )}&api_secret=${encodeURIComponent(apiSecret)}`;

  const response = await fetch(ga4Url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: String(clientId || "555.123456789"),
      events: [
        {
          name: safeEventName,
          params: sanitizedParams,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    return {
      ok: false,
      status: response.status,
      error: errorText,
      event: safeEventName,
    };
  }

  return {
    ok: true,
    status: response.status,
    event: safeEventName,
  };
}

module.exports = {
  sanitizeGa4Params,
  sendGa4MeasurementProtocolEvent,
};
