const {
  createCustomQuote,
  createPlanQuotes,
} = require("../../payment-pricing");
const { getJsonHeaders } = require("../shared/http");
const { getRazorpayCredentials } = require("../shared/razorpay");

exports.handler = async (event) => {
  const headers = getJsonHeaders("POST, OPTIONS");

  // -----------------------------------------------------------------
  // OPTIONS (CORS pre‑flight) handling – unchanged
  // -----------------------------------------------------------------
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

  // -----------------------------------------------------------------
  // ★ NEW JSON‑validation block
  // -----------------------------------------------------------------
  try {
    const { key_secret: secret } = getRazorpayCredentials();

    // --------------------------------------------------------------
    // Guard against malformed JSON (the test sends the literal
    // string "not-json"). If parsing fails we return a 400 error.
    // --------------------------------------------------------------
    let data;
    try {
      data = JSON.parse(event.body || "{}");
    } catch (parseErr) {
      console.error("Quote handler – bad JSON:", parseErr);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Invalid JSON payload" }),
      };
    }

    const currency = String(data.currency || "").toUpperCase();

    // --------------------------------------------------------------
    // Existing business logic – unchanged
    // --------------------------------------------------------------
    if (data.plan === "custom") {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(
          createCustomQuote(currency, data.customAmount, secret),
        ),
      };
    }

    // default: plan‑quotes
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(await createPlanQuotes(currency, secret)),
    };
  } catch (error) {
    // -----------------------------------------------------------------
    // Any unexpected error (e.g., DB issues, missing env vars, etc.)
    // -----------------------------------------------------------------
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
