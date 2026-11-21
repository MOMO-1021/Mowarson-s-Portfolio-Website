const crypto = require("crypto");

// Meta requires PII (email, phone) to be trimmed, lowercased, and SHA-256 hashed
const hashValue = (value) => {
  if (!value) return undefined;
  return crypto
    .createHash("sha256")
    .update(value.trim().toLowerCase())
    .digest("hex");
};

exports.handler = async (event, context) => {
  // 1. Only allow POST requests
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    // 2. Parse the incoming data from your frontend/backend
    const body = JSON.parse(event.body);
    const { eventName, eventId, userData, customData } = body;

    // 3. Grab credentials from environment variables
    const pixelId = process.env.META_PIXEL_ID || process.env.PIXEL_ID;
    const accessToken =
      process.env.META_CAPI_ACCESS_TOKEN || process.env.ACCESS_TOKEN;
    const testEventCode =
      process.env.META_TEST_EVENT_CODE ||
      process.env.TEST_EVENT_CODE ||
      process.env.test_event_code;

    if (!pixelId || !accessToken) {
      throw new Error(
        "Missing META_PIXEL_ID or META_CAPI_ACCESS_TOKEN in environment variables",
      );
    }

    // 4. Construct the exact payload Meta expects
    const payload = {
      data: [
        {
          event_name: eventName, // e.g., 'PageView', 'Lead', 'Purchase'
          event_time: Math.floor(Date.now() / 1000), // Unix timestamp in seconds
          action_source: "website", // Required by Meta
          event_id: eventId, // CRITICAL: The unique ID (e.g., Razorpay order_id) for deduplication
          event_source_url:
            event.headers.referer ||
            event.headers.origin ||
            "https://mowarsondeveloper.netlify.app/pay.html", // CRITICAL: The unique ID (e.g., Razorpay order_id) for deduplication
          user_data: {
            em: userData.email ? [hashValue(userData.email)] : undefined,
            ph: userData.phone ? [hashValue(userData.phone)] : undefined,
            client_ip_address: userData.client_ip_address,
            client_user_agent: userData.client_user_agent,
            fbp: userData.fbp,
            fbc: userData.fbc,
          },
          custom_data: customData || {}, // e.g., { value: 999, currency: 'INR' }
        },
      ],
      access_token: accessToken,
      ...(testEventCode ? { test_event_code: testEventCode } : {}),
    };

    // 5. Clean up undefined fields so Meta doesn't reject the payload
    payload.data[0].user_data = Object.fromEntries(
      Object.entries(payload.data[0].user_data).filter(([_, v]) => v != null),
    );

    // 6. Send to Meta's Conversions API (using v21.0)
    const metaApiUrl = `https://graph.facebook.com/v21.0/${pixelId}/events`;

    const response = await fetch(metaApiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error("Meta CAPI Error:", result);
      return {
        statusCode: response.status,
        body: JSON.stringify({
          error: "Failed to send event to Meta",
          details: result,
        }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: "Event sent to Meta",
        metaResponse: result,
      }),
    };
  } catch (error) {
    console.error("Netlify Function Error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Internal Server Error",
        details: error.message,
      }),
    };
  }
};
