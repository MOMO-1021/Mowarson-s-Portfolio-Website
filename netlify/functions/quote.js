const { createCustomQuote, createPlanQuotes } = require("../../payment-pricing");

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

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
    const secret = (process.env.RAZORPAY_KEY_SECRET || "")
      .trim()
      .replace(/^["']|["']$/g, "");
    const data = JSON.parse(event.body || "{}");
    const currency = String(data.currency || "").toUpperCase();

    if (data.plan === "custom") {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(createCustomQuote(currency, data.customAmount, secret)),
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
      body: JSON.stringify({ error: error.message || "Unable to prepare a price quote." }),
    };
  }
};
