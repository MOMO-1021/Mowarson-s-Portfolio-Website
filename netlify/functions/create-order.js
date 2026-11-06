const Razorpay = require("razorpay");

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
    const key_id = process.env.RAZORPAY_KEY_ID;
    const key_secret = process.env.RAZORPAY_KEY_SECRET;

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
    const { amount, currency = "INR", receipt, notes } = data;
    const numAmount = Number(amount);

    if (!numAmount || isNaN(numAmount) || numAmount < 100) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: "Invalid amount. Minimum amount is 100 paise."
        })
      };
    }

    const razorpay = new Razorpay({
      key_id: key_id,
      key_secret: key_secret
    });

    const orderOptions = {
      amount: Math.round(numAmount),
      currency: currency.toUpperCase(),
      receipt: receipt || `rcpt_${Date.now()}`
    };

    if (notes) {
      orderOptions.notes = notes;
    }

    const order = await razorpay.orders.create(orderOptions);

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
    const isAuthError = err.statusCode === 401 || err.status === 401 || 
      (err.error && err.error.code === "BAD_REQUEST_ERROR" && err.error.description === "Authentication failed");
    const statusCode = isAuthError ? 401 : 500;
    
    return {
      statusCode: statusCode,
      headers,
      body: JSON.stringify({
        error: isAuthError 
          ? "Razorpay authentication failed. Please verify RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in your settings."
          : (err.error?.description || err.message || "Failed to create order")
      })
    };
  }
};
