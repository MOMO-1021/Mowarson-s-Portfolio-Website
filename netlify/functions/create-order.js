const Razorpay = require("razorpay");
const { verifyQuoteToken } = require("../../payment-pricing");
const { flushPostHogLogs, posthogLogger } = require("../../posthog-logs");
const { getJsonHeaders } = require("../shared/http");
const { getRazorpayCredentials } = require("../shared/razorpay");
const { upsertOrder } = require("../shared/payments");

exports.handler = async (event) => {
  const headers = getJsonHeaders("POST, OPTIONS");

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
    const { useTestKeys, key_id, key_secret } = getRazorpayCredentials();

    if (!key_id || !key_secret) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({
          error: "Razorpay credentials are not configured in Netlify environment variables."
        })
      };
    }

    if (useTestKeys && (!key_id.startsWith("rzp_test_"))) {
      return {
        statusCode: 409,
        headers,
        body: JSON.stringify({
          error: "Test mode is enabled but a live Razorpay Key ID is configured. Set RAZORPAY_TEST_KEY_ID and RAZORPAY_TEST_KEY_SECRET.",
        }),
      };
    }

    const data = JSON.parse(event.body || "{}");
    const notes =
      data.notes && typeof data.notes === "object" && !Array.isArray(data.notes)
        ? data.notes
        : {};
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

    if (Object.keys(notes).length > 0) {
      orderOptions.notes = notes;
    }

    const order = await razorpay.orders.create(orderOptions);
    if (order.amount !== quote.amount || order.currency !== quote.currency) {
      throw new Error("Razorpay order amount or currency did not match the approved quote.");
    }

    try {
      await upsertOrder({
        razorpayOrderId: order.id,
        plan: notes.plan,
        amountMinor: order.amount,
        currency: order.currency,
        customerEmail: notes.client_email,
        customerPhone: notes.client_phone,
        distinctId: notes.posthog_distinct_id,
      });
    } catch (error) {
      console.error("Neon order persistence failed:", error);
      return {
        statusCode: 503,
        headers,
        body: JSON.stringify({
          error: "The payment service is temporarily unavailable. Please try again.",
        }),
      };
    }

    posthogLogger.info("payment_order_created", {
      razorpay_order_id: order.id,
      amount_minor: order.amount,
      currency: order.currency,
      plan: notes.plan || "(unknown)"
    });
    await flushPostHogLogs();

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
