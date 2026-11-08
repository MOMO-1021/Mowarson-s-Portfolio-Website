const crypto = require("crypto");
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
    const rawKeyId = process.env.RAZORPAY_KEY_ID || "";
    const rawKeySecret = process.env.RAZORPAY_KEY_SECRET || "";
    const key_id = rawKeyId.trim().replace(/^["']|["']$/g, "");
    const key_secret = rawKeySecret.trim().replace(/^["']|["']$/g, "");

    if (!key_id || !key_secret) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          error: "Razorpay secret key is not configured in environment variables."
        })
      };
    }

    const data = JSON.parse(event.body || "{}");
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = data;

    if (
      typeof razorpay_order_id !== "string" ||
      typeof razorpay_payment_id !== "string" ||
      typeof razorpay_signature !== "string" ||
      !razorpay_order_id ||
      !razorpay_payment_id ||
      !razorpay_signature
    ) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: "Missing required fields: razorpay_order_id, razorpay_payment_id, and razorpay_signature are mandatory."
        })
      };
    }

    const payload = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expectedSignature = crypto
      .createHmac("sha256", key_secret)
      .update(payload)
      .digest("hex");

    const expectedBuffer = Buffer.from(expectedSignature, "hex");
    const suppliedBuffer = Buffer.from(razorpay_signature, "hex");
    if (
      !/^[a-f0-9]{64}$/i.test(razorpay_signature) ||
      expectedBuffer.length !== suppliedBuffer.length ||
      !crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)
    ) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: "Signature mismatch. Payment verification failed."
        })
      };
    }

    const razorpay = new Razorpay({ key_id, key_secret });
    const [order, payment] = await Promise.all([
      razorpay.orders.fetch(razorpay_order_id),
      razorpay.payments.fetch(razorpay_payment_id),
    ]);

    if (
      payment.order_id !== order.id ||
      payment.amount !== order.amount ||
      payment.currency !== order.currency
    ) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: "The payment details do not match the Razorpay order."
        })
      };
    }

    if (payment.status !== "captured" || order.status !== "paid") {
      return {
        statusCode: 409,
        headers,
        body: JSON.stringify({
          success: false,
          pending: true,
          error: "Payment is not confirmed as captured yet. Please contact support before trying again."
        })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: "Payment verified successfully",
        amount: order.amount,
        currency: order.currency
      })
    };
  } catch (err) {
    console.error("Netlify Function verify-payment error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: err.message || "Internal server error during verification"
      })
    };
  }
};
