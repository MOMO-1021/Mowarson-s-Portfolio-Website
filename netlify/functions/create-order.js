const Razorpay = require("razorpay");
const { verifyQuoteToken } = require("../../payment-pricing");

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method Not Allowed" })
    };
  }

  try {
    const rawKeyId = process.env.RAZORPAY_KEY_ID || "";
    const rawKeySecret = process.env.RAZORPAY_KEY_SECRET || "";

    const key_id = rawKeyId.trim().replace(/^["']|["']$/g, "");
    const key_secret = rawKeySecret.trim().replace(/^["']|["']$/g, "");

    if (!key_id || !key_secret) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({
          error: "Razorpay credentials are not configured in Netlify environment variables."
        })
      };
    }

    const data = JSON.parse(event.body || "{}");
    let quote;
    try {
      quote = verifyQuoteToken(data.quote_token, key_secret);
    } catch (error) {
      return {
        statusCode: error.message.includes("expired") ? 409 : 400,
        headers,
        body: JSON.stringify({ error: error.message }),
      };
    }

    const razorpay = new Razorpay({
      key_id: key_id,
      key_secret: key_secret
    });

    const orderOptions = {
      amount: quote.amount,
      currency: quote.currency,
      receipt: `rcpt_${Date.now()}`,
    };

    if (data.notes && typeof data.notes === "object") {
      orderOptions.notes = data.notes;
    }

    const order = await razorpay.orders.create(orderOptions);
    if (order.amount !== quote.amount || order.currency !== quote.currency) {
      throw new Error("Razorpay order amount or currency did not match the approved quote.");
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        order_id: order.id,
        amount: order.amount,
        currency: order.currency,
        key_id: key_id
      })
    };
  } catch (err) {
    console.error("Netlify Function create-order error:", err);
    const isAuthError =
      err.statusCode === 401 ||
      err.status === 401 ||
      (err.error &&
        err.error.code === "BAD_REQUEST_ERROR" &&
        err.error.description === "Authentication failed");
    const statusCode = isAuthError ? 401 : err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;

    return {
      statusCode: statusCode,
      headers,
      body: JSON.stringify({
        error: isAuthError
          ? "Razorpay authentication failed. Check the Key ID and Secret configured in Netlify."
          : err.error?.description || err.message || "Failed to create order",
      })
    };
  }
};
