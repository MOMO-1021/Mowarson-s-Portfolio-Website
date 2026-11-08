require("dotenv").config();
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const Razorpay = require("razorpay");
const { createCustomQuote, createPlanQuotes, verifyQuoteToken } = require("./payment-pricing");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static assets from project root
app.use(express.static(path.join(__dirname)));

const getRazorpayCredentials = () => {
  const rawKeyId = process.env.RAZORPAY_KEY_ID || "";
  const rawKeySecret = process.env.RAZORPAY_KEY_SECRET || "";
  return {
    key_id: rawKeyId.trim().replace(/^["']|["']$/g, ""),
    key_secret: rawKeySecret.trim().replace(/^["']|["']$/g, ""),
  };
};

// Initialize Razorpay instance with sanitized keys
const getRazorpayInstance = () => {
  const { key_id, key_secret } = getRazorpayCredentials();

  if (!key_id || !key_secret) {
    return null;
  }

  return new Razorpay({
    key_id: key_id,
    key_secret: key_secret
  });
};

app.post("/api/quote", async (req, res) => {
  try {
    const { key_secret } = getRazorpayCredentials();
    const currency = String(req.body.currency || "").toUpperCase();

    if (req.body.plan === "custom") {
      return res.status(200).json(
        createCustomQuote(currency, req.body.customAmount, key_secret)
      );
    }

    return res.status(200).json(await createPlanQuotes(currency, key_secret));
  } catch (err) {
    console.error("Error preparing payment quote:", err);
    return res.status(400).json({
      error: err.message || "Unable to prepare a price quote.",
    });
  }
});

/**
 * STEP 1: BACKEND - Create Order
 * POST /api/create-order
 * Request body: { quote_token, notes }
 * Returns: { order_id, amount, currency, key_id }
 */
app.post("/api/create-order", async (req, res) => {
  try {
    const { key_secret } = getRazorpayCredentials();
    let quote;
    try {
      quote = verifyQuoteToken(req.body.quote_token, key_secret);
    } catch (err) {
      return res.status(err.message.includes("expired") ? 409 : 400).json({
        error: err.message,
      });
    }

    const razorpay = getRazorpayInstance();
    if (!razorpay) {
      return res.status(401).json({
        error: "Razorpay credentials are not configured in environment variables."
      });
    }

    const orderOptions = {
      amount: quote.amount,
      currency: quote.currency,
      receipt: `rcpt_${Date.now()}`
    };

    if (req.body.notes && typeof req.body.notes === "object") {
      orderOptions.notes = req.body.notes;
    }

    const order = await razorpay.orders.create(orderOptions);
    if (order.amount !== quote.amount || order.currency !== quote.currency) {
      throw new Error("Razorpay order amount or currency did not match the approved quote.");
    }

    const { key_id } = getRazorpayCredentials();

    return res.status(200).json({
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      key_id: key_id
    });
  } catch (err) {
    console.error("Error creating Razorpay order:", err);
    const isAuthError = err.statusCode === 401 || err.status === 401 ||
      (err.error && err.error.code === "BAD_REQUEST_ERROR" && err.error.description === "Authentication failed");
    const statusCode = isAuthError ? 401 : err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;

    return res.status(statusCode).json({
      error: isAuthError
        ? "Razorpay authentication failed. Check the Key ID and Secret configured on the server."
        : (err.error?.description || err.message || "Failed to create order")
    });
  }
});

/**
 * STEP 3: BACKEND - Verify Payment Signature
 * POST /api/verify-payment
 * Request body: { razorpay_order_id, razorpay_payment_id, razorpay_signature }
 * Algorithm: HMAC-SHA256(order_id + "|" + payment_id, KEY_SECRET)
 */
app.post("/api/verify-payment", async (req, res) => {
  try {
    const { key_id, key_secret } = getRazorpayCredentials();

    if (!key_id || !key_secret) {
      return res.status(500).json({
        error: "Razorpay secret key is not configured in environment variables."
      });
    }

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    // Validate missing fields
    if (
      typeof razorpay_order_id !== "string" ||
      typeof razorpay_payment_id !== "string" ||
      typeof razorpay_signature !== "string" ||
      !razorpay_order_id ||
      !razorpay_payment_id ||
      !razorpay_signature
    ) {
      return res.status(400).json({
        error: "Missing required fields: razorpay_order_id, razorpay_payment_id, and razorpay_signature are mandatory."
      });
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
      return res.status(400).json({
        success: false,
        error: "Signature mismatch. Payment verification failed."
      });
    }

    const razorpay = new Razorpay({ key_id, key_secret });
    const [order, payment] = await Promise.all([
      razorpay.orders.fetch(razorpay_order_id),
      razorpay.payments.fetch(razorpay_payment_id)
    ]);

    if (
      payment.order_id !== order.id ||
      payment.amount !== order.amount ||
      payment.currency !== order.currency
    ) {
      return res.status(400).json({
        success: false,
        error: "The payment details do not match the Razorpay order."
      });
    }

    if (payment.status !== "captured" || order.status !== "paid") {
      return res.status(409).json({
        success: false,
        pending: true,
        error: "Payment is not confirmed as captured yet. Please contact support before trying again."
      });
    }

    return res.status(200).json({
      success: true,
      message: "Payment verified successfully",
      amount: order.amount,
      currency: order.currency
    });
  } catch (err) {
    console.error("Error verifying payment signature:", err);
    return res.status(500).json({
      error: err.message || "Internal server error during verification"
    });
  }
});

app.listen(PORT, () => {
  console.log(`Mowarson Portfolio & Payment Server running at http://localhost:${PORT}`);
});
