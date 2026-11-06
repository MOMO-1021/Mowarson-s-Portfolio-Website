require("dotenv").config();
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const Razorpay = require("razorpay");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static assets from project root
app.use(express.static(path.join(__dirname)));

// Initialize Razorpay instance
const getRazorpayInstance = () => {
  const key_id = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;

  if (!key_id || !key_secret) {
    return null;
  }

  return new Razorpay({
    key_id: key_id,
    key_secret: key_secret
  });
};

/**
 * STEP 1: BACKEND - Create Order
 * POST /api/create-order
 * Request body: { amount (paise), currency, receipt, notes }
 * Returns: { order_id, amount, currency, key_id }
 */
app.post("/api/create-order", async (req, res) => {
  try {
    const razorpay = getRazorpayInstance();
    if (!razorpay) {
      return res.status(401).json({
        error: "Razorpay credentials are not configured in environment variables."
      });
    }

    const { amount, currency = "INR", receipt, notes } = req.body;
    const numAmount = Number(amount);

    // Validate minimum amount (100 paise = 1 INR)
    if (!numAmount || isNaN(numAmount) || numAmount < 100) {
      return res.status(400).json({
        error: "Invalid amount. Minimum amount is 100 paise."
      });
    }

    const orderOptions = {
      amount: Math.round(numAmount),
      currency: (currency || "INR").toUpperCase(),
      receipt: receipt || `rcpt_${Date.now()}`
    };

    if (notes) {
      orderOptions.notes = notes;
    }

    const order = await razorpay.orders.create(orderOptions);

    return res.status(200).json({
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      key_id: process.env.RAZORPAY_KEY_ID
    });
  } catch (err) {
    console.error("Error creating Razorpay order:", err);
    const isAuthError = err.statusCode === 401 || err.status === 401 ||
      (err.error && err.error.code === "BAD_REQUEST_ERROR" && err.error.description === "Authentication failed");
    const statusCode = isAuthError ? 401 : 500;

    return res.status(statusCode).json({
      error: isAuthError
        ? "Razorpay authentication failed. Please verify your RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env."
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
app.post("/api/verify-payment", (req, res) => {
  try {
    const key_secret = process.env.RAZORPAY_KEY_SECRET;
    if (!key_secret) {
      return res.status(500).json({
        error: "Razorpay secret key is not configured in environment variables."
      });
    }

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    // Validate missing fields
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({
        error: "Missing required fields: razorpay_order_id, razorpay_payment_id, and razorpay_signature are mandatory."
      });
    }

    const payload = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expectedSignature = crypto
      .createHmac("sha256", key_secret)
      .update(payload)
      .digest("hex");

    if (expectedSignature === razorpay_signature) {
      return res.status(200).json({
        success: true,
        message: "Payment verified successfully"
      });
    } else {
      return res.status(400).json({
        success: false,
        error: "Signature mismatch. Payment verification failed."
      });
    }
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
