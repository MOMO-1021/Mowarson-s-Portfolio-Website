export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const payload = JSON.parse(event.body);
    const phEvent = payload.event; // PostHog webhook event object
    if (!phEvent) return { statusCode: 400, body: "Invalid payload" };

    const allowedEvents = [
      "generate_lead",
      "contact_inquiry_submitted",
      "begin_checkout",
      "purchase",
      "payment_completed",
      "whatsapp_click",
      "service_interest",
      "scroll_depth",
      "outbound_click",
    ];

    if (!allowedEvents.includes(phEvent.event)) {
      return { statusCode: 200, body: "Event ignored" };
    }

    const props = phEvent.properties || {};

    // Use GA4 client_id if captured & consented; fallback to PostHog distinct_id
    const clientId = props.ga_client_id || phEvent.distinct_id;

    // Strip PII; forward only allowed campaign & event parameters
    const ga4Payload = {
      client_id: String(clientId),
      events: [
        {
          name: phEvent.event,
          params: {
            source: props.utm_source || props.source || "(direct)",
            medium: props.utm_medium || "(none)",
            campaign: props.utm_campaign || "(not set)",
            channel: props.channel || "web",
            // Include transaction details only for verified purchases
            ...(phEvent.event === "purchase" ||
            phEvent.event === "payment_completed"
              ? {
                  transaction_id:
                    props.transaction_id || props.razorpay_payment_id,
                  value: Number(props.value || 0),
                  currency: props.currency || "INR",
                }
              : {}),
          },
        },
      ],
    };

    const measurementId = process.env.GA4_MEASUREMENT_ID;
    const apiSecret = process.env.GA4_API_SECRET;

    const response = await fetch(
      `https://www.google-analytics.com/mp/collect?measurement_id=${measurementId}&api_secret=${apiSecret}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ga4Payload),
      },
    );

    return { statusCode: response.status, body: "Forwarded to GA4" };
  } catch (err) {
    return { statusCode: 500, body: err.message };
  }
};
