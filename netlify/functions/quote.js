const {
  createCustomQuote,
  createPlanQuotes,
} = require("../../payment-pricing");
const { getJsonHeaders } = require("../shared/http");
const { getRazorpayCredentials } = require("../shared/razorpay");

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
    const { key_secret: secret } = getRazorpayCredentials();
    const data = JSON.parse(event.body || "{}");
    const currency = String(data.currency || "").toUpperCase();

    if (data.plan === "custom") {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(
          createCustomQuote(currency, data.customAmount, secret),
        ),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(await createPlanQuotes(currency, secret)),
    };
  } catch (error) {
    console.error("Netlify Function quote error:", error);
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        error: error.message || "Unable to prepare a price quote.",
      }),
    };
  }
};
