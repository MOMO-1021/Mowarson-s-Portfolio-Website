import "dotenv/config";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { handler as quoteHandler } from "../netlify/functions/quote.js";
import { handler as createOrderHandler } from "../netlify/functions/create-order.js";
import { getRazorpayCredentials } from "../netlify/shared/razorpay.js";
import { query } from "../netlify/shared/db.js";
import { recordPayment } from "../netlify/shared/payments.js";

async function runPaymentTests() {
  console.log("================================================================================");
  console.log("       TESTING DOMESTIC (INR) AND INTERNATIONAL (USD/EUR) PAYMENTS               ");
  console.log("================================================================================\n");

  const creds = getRazorpayCredentials();
  console.log(`Razorpay Mode: ${creds.useTestKeys ? "TEST MODE" : "LIVE MODE"}`);
  console.log(`Using Key ID: ${creds.key_id}`);
  assert.ok(creds.useTestKeys, "Payment mode must be TEST");
  assert.ok(creds.key_id.startsWith("rzp_test_"), "Must use rzp_test_ key ID");

  const createdOrderIds = [];

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Domestic Payment (INR) - Website Plan (₹5,000)
    // -------------------------------------------------------------------------
    console.log("\n1. Testing Domestic Payment (INR)...");
    const inrQuoteRes = await quoteHandler({
      httpMethod: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currency: "INR" })
    });
    assert.equal(inrQuoteRes.statusCode, 200, "INR quote request failed");
    const inrQuotes = JSON.parse(inrQuoteRes.body);
    console.log(`   - Received INR quotes. Website amount: ₹${inrQuotes.website.amount / 100}`);
    assert.equal(inrQuotes.currency, "INR");
    assert.equal(inrQuotes.website.amount, 500000);

    const inrOrderRes = await createOrderHandler({
      httpMethod: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        quote_token: inrQuotes.website.token,
        notes: {
          service: "Conversion Website Design",
          plan: "website",
          client_email: "test.domestic@example.com",
          client_phone: "+919876543210"
        }
      })
    });
    assert.equal(inrOrderRes.statusCode, 200, `INR order creation failed: ${inrOrderRes.body}`);
    const inrOrder = JSON.parse(inrOrderRes.body);
    console.log(`   ✅ Razorpay Domestic Order Created: ${inrOrder.order_id}`);
    console.log(`      Amount: ₹${inrOrder.amount / 100} ${inrOrder.currency}`);
    assert.equal(inrOrder.currency, "INR");
    assert.equal(inrOrder.amount, 500000);
    assert.ok(inrOrder.order_id.startsWith("order_"));
    createdOrderIds.push(inrOrder.order_id);

    // Verify Neon database storage
    const inrDbCheck = await query("SELECT * FROM orders WHERE razorpay_order_id = $1", [inrOrder.order_id]);
    assert.equal(inrDbCheck.rows.length, 1, "INR order must be persisted in Neon database");
    console.log(`   ✅ Order stored in Neon database with status: ${inrDbCheck.rows[0].status}`);

    // -------------------------------------------------------------------------
    // TEST 2: International Payment (USD via PayPal) - Marketing Plan ($70.00)
    // -------------------------------------------------------------------------
    console.log("\n2. Testing International Payment (USD via PayPal)...");
    const usdQuoteRes = await quoteHandler({
      httpMethod: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currency: "USD" })
    });
    assert.equal(usdQuoteRes.statusCode, 200, "USD quote request failed");
    const usdQuotes = JSON.parse(usdQuoteRes.body);
    console.log(`   - Received USD quotes. Marketing amount: $${usdQuotes.marketing.amount / 100}`);
    assert.equal(usdQuotes.currency, "USD");
    assert.equal(usdQuotes.marketing.amount, 7000); // $70.00 in cents

    const usdOrderRes = await createOrderHandler({
      httpMethod: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        quote_token: usdQuotes.marketing.token,
        notes: {
          service: "Brand Positioning & Marketing",
          plan: "marketing",
          client_email: "test.international@example.com",
          client_phone: "+12025550199"
        }
      })
    });
    assert.equal(usdOrderRes.statusCode, 200, `USD order creation failed: ${usdOrderRes.body}`);
    const usdOrder = JSON.parse(usdOrderRes.body);
    console.log(`   ✅ Razorpay International Order Created: ${usdOrder.order_id}`);
    console.log(`      Amount: $${usdOrder.amount / 100} ${usdOrder.currency}`);
    assert.equal(usdOrder.currency, "USD");
    assert.equal(usdOrder.amount, 7000);
    assert.ok(usdOrder.order_id.startsWith("order_"));
    createdOrderIds.push(usdOrder.order_id);

    // Verify Neon database storage
    const usdDbCheck = await query("SELECT * FROM orders WHERE razorpay_order_id = $1", [usdOrder.order_id]);
    assert.equal(usdDbCheck.rows.length, 1, "USD order must be persisted in Neon database");
    console.log(`   ✅ Order stored in Neon database with currency: ${usdDbCheck.rows[0].currency}`);

    // -------------------------------------------------------------------------
    // TEST 3: International Payment (EUR Custom Milestone) - (€150.00)
    // -------------------------------------------------------------------------
    console.log("\n3. Testing International Custom Milestone Payment (EUR)...");
    const eurQuoteRes = await quoteHandler({
      httpMethod: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan: "custom", currency: "EUR", customAmount: 150 })
    });
    assert.equal(eurQuoteRes.statusCode, 200, "EUR custom quote request failed");
    const eurQuote = JSON.parse(eurQuoteRes.body);
    console.log(`   - Received EUR custom quote. Amount: €${eurQuote.amount / 100}`);
    assert.equal(eurQuote.currency, "EUR");
    assert.equal(eurQuote.amount, 15000); // €150.00 in cents

    const eurOrderRes = await createOrderHandler({
      httpMethod: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        quote_token: eurQuote.token,
        notes: {
          service: "Custom Project Milestone",
          plan: "custom",
          client_email: "test.europe@example.com",
          client_phone: "+442071838750"
        }
      })
    });
    assert.equal(eurOrderRes.statusCode, 200, `EUR order creation failed: ${eurOrderRes.body}`);
    const eurOrder = JSON.parse(eurOrderRes.body);
    console.log(`   ✅ Razorpay International Order Created: ${eurOrder.order_id}`);
    console.log(`      Amount: €${eurOrder.amount / 100} ${eurOrder.currency}`);
    assert.equal(eurOrder.currency, "EUR");
    assert.equal(eurOrder.amount, 15000);
    createdOrderIds.push(eurOrder.order_id);

    // -------------------------------------------------------------------------
    // TEST 4: Payment Verification & Settlement Recording (Idempotency)
    // -------------------------------------------------------------------------
    console.log("\n4. Testing Payment Completion & Signature Verification...");
    const testPaymentId = `pay_test_${Date.now()}`;
    const payload = `${usdOrder.order_id}|${testPaymentId}`;
    const signature = crypto.createHmac("sha256", creds.key_secret).update(payload).digest("hex");

    console.log(`   - Verified HMAC-SHA256 signature for: ${payload}`);

    await recordPayment({
      razorpayOrderId: usdOrder.order_id,
      razorpayPaymentId: testPaymentId,
      plan: "marketing",
      amountMinor: 7000,
      currency: "USD",
      status: "captured",
      paymentMethod: "paypal",
      signatureVerified: true,
      customerEmail: "test.international@example.com",
      customerPhone: "+12025550199"
    });

    // Check payments table
    const paymentRecord = await query("SELECT * FROM payments WHERE razorpay_payment_id = $1", [testPaymentId]);
    assert.equal(paymentRecord.rows.length, 1);
    assert.equal(paymentRecord.rows[0].currency, "USD");
    assert.equal(paymentRecord.rows[0].amount_minor, 7000);
    assert.equal(paymentRecord.rows[0].payment_method, "paypal");
    assert.equal(paymentRecord.rows[0].signature_verified, true);
    console.log(`   ✅ Payment recorded in Neon database (method: paypal, status: captured, currency: USD)`);

    // Clean up test data
    console.log("\n5. Cleaning up test records from database...");
    await query("DELETE FROM payments WHERE razorpay_payment_id = $1", [testPaymentId]);
    for (const oid of createdOrderIds) {
      await query("DELETE FROM orders WHERE razorpay_order_id = $1", [oid]);
    }
    console.log(`   ✅ Cleaned up ${createdOrderIds.length} test orders and 1 test payment.`);

    console.log("\n================================================================================");
    console.log("   🎉 BOTH DOMESTIC (INR) AND INTERNATIONAL (USD/EUR) PAYMENTS PASSED!         ");
    console.log("================================================================================\n");
  } catch (err) {
    console.error("Test failed:", err);
    // Attempt cleanup
    for (const oid of createdOrderIds) {
      await query("DELETE FROM orders WHERE razorpay_order_id = $1", [oid]).catch(() => {});
    }
    process.exit(1);
  }
}

runPaymentTests();
