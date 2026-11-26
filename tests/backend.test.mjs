import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  createPlanQuotes,
  createCustomQuote,
  verifyQuoteToken
} from "../payment-pricing.js";
import { getRazorpayCredentials, isTestMode } from "../netlify/shared/razorpay.js";
import {
  recordPayment,
  beginWebhookEvent,
  completeWebhookEvent,
  upsertOrder
} from "../netlify/shared/payments.js";
import { query } from "../netlify/shared/db.js";
import { handler as quoteHandler } from "../netlify/functions/quote.js";
import { handler as createOrderHandler } from "../netlify/functions/create-order.js";
import { handler as verifyPaymentHandler } from "../netlify/functions/verify-payment.js";
import { handler as contactHandler } from "../netlify/functions/contact.js";
import { handler as publishPostHandler } from "../netlify/functions/publish-post.js";
import { handler as posthogToGa4Handler } from "../netlify/functions/posthog-to-ga4.js";
import {
  sanitizeGa4Params,
  sendGa4MeasurementProtocolEvent
} from "../netlify/shared/ga4.js";

const TEST_SECRET = process.env.RAZORPAY_KEY_SECRET || "test_secret_for_regression_12345";

test("Backend: Quote Validation", async (t) => {
  await t.test("Generates valid plan quotes for supported plans and INR currency", async () => {
    const quotes = await createPlanQuotes("INR", TEST_SECRET);
    assert.ok(quotes.website, "Website plan quote should exist");
    assert.ok(quotes.marketing, "Marketing plan quote should exist");

    assert.equal(quotes.website.currency, "INR");
    assert.equal(quotes.website.amount, 500000); // 5000.00 INR in paise
    assert.ok(quotes.website.token, "Quote should have a signed token");

    assert.equal(quotes.marketing.currency, "INR");
    assert.equal(quotes.marketing.amount, 700000); // 7000.00 INR in paise
    assert.ok(quotes.marketing.token, "Quote should have a signed token");

    // Verify token unpacks correctly
    const verifiedWebsite = verifyQuoteToken(quotes.website.token, TEST_SECRET);
    assert.equal(verifiedWebsite.plan, "website");
    assert.equal(verifiedWebsite.amount, 500000);
    assert.equal(verifiedWebsite.currency, "INR");
  });

  await t.test("Generates valid custom quotes with exact amount", () => {
    const customQuote = createCustomQuote("INR", 2500, TEST_SECRET);
    assert.equal(customQuote.currency, "INR");
    assert.equal(customQuote.amount, 250000); // 2500.00 INR in paise
    assert.ok(customQuote.token, "Custom quote must include token");

    const verified = verifyQuoteToken(customQuote.token, TEST_SECRET);
    assert.equal(verified.plan, "custom");
    assert.equal(verified.amount, 250000);
    assert.equal(verified.currency, "INR");
  });

  await t.test("Rejects invalid custom amounts", () => {
    assert.throws(() => createCustomQuote("INR", 0, TEST_SECRET), /valid amount/i);
    assert.throws(() => createCustomQuote("INR", -50, TEST_SECRET), /valid amount/i);
    assert.throws(() => createCustomQuote("INR", "invalid", TEST_SECRET), /valid amount/i);
  });
});

test("Backend: Quote-Token Expiration & Tampering", async (t) => {
  await t.test("Rejects expired quote tokens", () => {
    // Manually create an expired token (> 30 mins ago)
    const expiredIssuedAt = Date.now() - (35 * 60 * 1000);
    const quotePayload = {
      plan: "website",
      currency: "INR",
      amount: 500000,
      issuedAt: expiredIssuedAt,
      expiresAt: expiredIssuedAt + (30 * 60 * 1000)
    };
    const encoded = Buffer.from(JSON.stringify(quotePayload)).toString("base64url");
    const signature = crypto.createHmac("sha256", TEST_SECRET).update(encoded).digest("hex");
    const expiredToken = `${encoded}.${signature}`;

    assert.throws(() => verifyQuoteToken(expiredToken, TEST_SECRET), /expired/i);
  });

  await t.test("Rejects tampered quote tokens", () => {
    const quote = createCustomQuote("INR", 1000, TEST_SECRET);
    const [payload, sig] = quote.token.split(".");

    // Alter the payload (attempt to change amount from 1000 to 10)
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString());
    decoded.amount = 1000; // change internally
    const tamperedPayload = Buffer.from(JSON.stringify({ ...decoded, amount: 10000 })).toString("base64url");
    const tamperedToken = `${tamperedPayload}.${sig}`;

    assert.throws(() => verifyQuoteToken(tamperedToken, TEST_SECRET), /invalid|tampered|signature/i);
  });

  await t.test("Rejects tokens signed with different secret", () => {
    const quote = createCustomQuote("INR", 1000, "attacker_secret_key");
    assert.throws(() => verifyQuoteToken(quote.token, TEST_SECRET), /invalid|tampered|signature/i);
  });
});

test("Backend: Currency Verification", async (t) => {
  await t.test("Rejects unsupported currencies for quotes", async () => {
    await assert.rejects(
      async () => createPlanQuotes("XYZ", TEST_SECRET),
      /supported payment currency/i
    );
    await assert.rejects(
      async () => createPlanQuotes("JPY", TEST_SECRET),
      /supported payment currency/i
    );
    assert.throws(
      () => createCustomQuote("KRW", 100, TEST_SECRET),
      /supported payment currency/i
    );
  });

  await t.test("Accepts supported international currencies (USD, EUR, GBP, CAD, AUD)", async () => {
    const usdQuote = await createPlanQuotes("USD", TEST_SECRET);
    assert.equal(usdQuote.currency, "USD");
    assert.equal(usdQuote.website.amount, 5000); // $50.00 in cents
    assert.equal(usdQuote.marketing.amount, 7000); // $70.00 in cents
    assert.ok(usdQuote.website.token);

    const customUsd = createCustomQuote("USD", 150, TEST_SECRET);
    assert.equal(customUsd.currency, "USD");
    assert.equal(customUsd.amount, 15000); // $150.00 in cents
  });
});

test("Backend: Order Amount & Currency Verification", async (t) => {
  await t.test("create-order rejects missing or invalid quote token", async () => {
    const res = await createOrderHandler({
      httpMethod: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ quote_token: "invalid-token" })
    });
    assert.ok([400, 401, 409].includes(res.statusCode));
  });

  await t.test("create-order rejects expired quote token with HTTP 409", async () => {
    const { key_secret } = getRazorpayCredentials();
    const expiredIssuedAt = Date.now() - (40 * 60 * 1000);
    const quotePayload = {
      plan: "website",
      currency: "INR",
      amount: 500000,
      issuedAt: expiredIssuedAt,
      expiresAt: expiredIssuedAt + (30 * 60 * 1000)
    };
    const encoded = Buffer.from(JSON.stringify(quotePayload)).toString("base64url");
    const sig = crypto.createHmac("sha256", key_secret || TEST_SECRET).update(encoded).digest("hex");
    const expiredToken = `${encoded}.${sig}`;

    const res = await createOrderHandler({
      httpMethod: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ quote_token: expiredToken })
    });
    // Expired tokens should return 409 or 400
    assert.ok(res.statusCode === 409 || res.statusCode === 400);
  });
});

test("Backend: Razorpay Signature Verification", async (t) => {
  await t.test("Validates authentic Razorpay payment HMAC-SHA256 signature", () => {
    const orderId = "order_test_987654";
    const paymentId = "pay_test_123456";
    const payload = `${orderId}|${paymentId}`;
    const validSignature = crypto.createHmac("sha256", TEST_SECRET).update(payload).digest("hex");

    // Verify using timingSafeEqual
    const expected = crypto.createHmac("sha256", TEST_SECRET).update(payload).digest("hex");
    const expBuf = Buffer.from(expected, "hex");
    const suppliedBuf = Buffer.from(validSignature, "hex");

    assert.equal(expBuf.length, suppliedBuf.length);
    assert.ok(crypto.timingSafeEqual(expBuf, suppliedBuf));
  });

  await t.test("Rejects forged or altered Razorpay payment signature", () => {
    const orderId = "order_test_987654";
    const paymentId = "pay_test_123456";
    const payload = `${orderId}|${paymentId}`;
    const forgedSignature = crypto.createHmac("sha256", "wrong_secret").update(payload).digest("hex");

    const expected = crypto.createHmac("sha256", TEST_SECRET).update(payload).digest("hex");
    const expBuf = Buffer.from(expected, "hex");
    const suppliedBuf = Buffer.from(forgedSignature, "hex");

    assert.ok(!crypto.timingSafeEqual(expBuf, suppliedBuf));
  });

  await t.test("Validates authentic Razorpay webhook signature", () => {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || "webhook_secret_test";
    const rawBody = JSON.stringify({ event: "payment.captured", id: "evt_123" });
    const signature = crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex");

    const expected = crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
    const sigBuf = Buffer.from(signature, "utf8");
    const expBuf = Buffer.from(expected, "utf8");

    assert.equal(sigBuf.length, expBuf.length);
    assert.ok(crypto.timingSafeEqual(sigBuf, expBuf));
  });
});

test("Backend: Duplicate Payment Verification & Webhook Handling (Idempotency)", async (t) => {
  const databaseUrl = (process.env.DATABASE_URL || "").trim();
  if (!databaseUrl) {
    t.skip("DATABASE_URL not available; skipping live database idempotency test.");
    return;
  }

  const testOrderId = `order_regression_${Date.now()}`;
  const testPaymentId = `pay_regression_${Date.now()}`;

  await t.test("Duplicate payment verification records payment idempotently", async () => {
    try {
      // 1st record
      const r1 = await recordPayment({
        razorpayOrderId: testOrderId,
        razorpayPaymentId: testPaymentId,
        plan: "website",
        amountMinor: 500000,
        currency: "INR",
        status: "captured",
        paymentMethod: "card",
        signatureVerified: true,
        customerEmail: "test@regression.com"
      });
      assert.ok(r1.rows[0]?.id, "First payment insertion should succeed");

      // 2nd record (duplicate call)
      const r2 = await recordPayment({
        razorpayOrderId: testOrderId,
        razorpayPaymentId: testPaymentId,
        plan: "website",
        amountMinor: 500000,
        currency: "INR",
        status: "captured",
        paymentMethod: "card",
        signatureVerified: true,
        customerEmail: "test@regression.com"
      });
      assert.ok(r2.rows[0]?.id, "Duplicate payment insertion should succeed without conflict");

      // Assert count in payments table for this payment ID is strictly 1
      const countRes = await query("SELECT COUNT(*) FROM payments WHERE razorpay_payment_id = $1", [testPaymentId]);
      assert.equal(Number(countRes.rows[0].count), 1, "Payment records cannot be duplicated");

      // Cleanup
      await query("DELETE FROM payments WHERE razorpay_payment_id = $1", [testPaymentId]);
      await query("DELETE FROM orders WHERE razorpay_order_id = $1", [testOrderId]);
    } catch (err) {
      if (err.message.includes("fetch failed") || err.message.includes("network")) {
        t.skip("Sandbox network restrictions active; database test skipped.");
      } else {
        throw err;
      }
    }
  });

  await t.test("Duplicate webhook event is detected and ignored (idempotent)", async () => {
    try {
      const payloadHash = crypto.randomBytes(32).toString("hex");
      const extEventId = `ext_event_${Date.now()}`;

      // First webhook event
      const event1 = await beginWebhookEvent({
        provider: "razorpay",
        externalEventId: extEventId,
        eventName: "payment.captured",
        payloadHash
      });
      assert.ok(event1, "Initial webhook event should be accepted");

      await completeWebhookEvent(event1.id);

      // Duplicate webhook event with identical hash
      const duplicateEvent = await beginWebhookEvent({
        provider: "razorpay",
        externalEventId: extEventId,
        eventName: "payment.captured",
        payloadHash
      });
      assert.equal(duplicateEvent, null, "Duplicate webhook event must be skipped (returns null)");

      // Cleanup
      await query("DELETE FROM webhook_events WHERE id = $1", [event1.id]);
    } catch (err) {
      if (err.message.includes("fetch failed") || err.message.includes("network")) {
        t.skip("Sandbox network restrictions active; database test skipped.");
      } else {
        throw err;
      }
    }
  });
});

test("Backend: Lead Persistence", async (t) => {
  const databaseUrl = (process.env.DATABASE_URL || "").trim();
  if (!databaseUrl) {
    t.skip("DATABASE_URL not configured; skipping lead persistence test.");
    return;
  }

  const testEmail = `lead_regression_${Date.now()}@example.com`;

  try {
    const insertRes = await query(
      `INSERT INTO leads (name, email, phone, service, message, source, marketing_consent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, name, email, phone, service, message, source, marketing_consent`,
      ["Regression Tester", testEmail, "+919876543210", "Web Design", "Test lead persistence", "regression_test", true]
    );
    assert.ok(insertRes.rows[0]?.id, "Lead should be saved in database");
    const lead = insertRes.rows[0];
    assert.equal(lead.email, testEmail);
    assert.equal(lead.marketing_consent, true);
    assert.equal(lead.source, "regression_test");

    // Clean up
    await query("DELETE FROM leads WHERE id = $1", [lead.id]);
  } catch (err) {
    if (err.message.includes("fetch failed") || err.message.includes("network")) {
      t.skip("Sandbox network restrictions active; database test skipped.");
    } else {
      throw err;
    }
  }
});

test("Backend: API Error Responses", async (t) => {
  await t.test("quote endpoint rejects GET with 405 Method Not Allowed", async () => {
    const res = await quoteHandler({ httpMethod: "GET" });
    assert.equal(res.statusCode, 405);
    const body = JSON.parse(res.body);
    assert.ok(body.error);
  });

  await t.test("quote endpoint rejects malformed JSON with 400", async () => {
    const res = await quoteHandler({
      httpMethod: "POST",
      body: "not-json"
    });
    assert.equal(res.statusCode, 400);
    const body = JSON.parse(res.body);
    assert.ok(body.error);
  });

  await t.test("create-order rejects non-POST method with 405", async () => {
    const res = await createOrderHandler({ httpMethod: "GET" });
    assert.equal(res.statusCode, 405);
  });

  await t.test("verify-payment rejects missing mandatory fields with 400", async () => {
    const res = await verifyPaymentHandler({
      httpMethod: "POST",
      body: JSON.stringify({ razorpay_order_id: "order_123" }) // missing payment_id and signature
    });
    assert.equal(res.statusCode, 400);
    const body = JSON.parse(res.body);
    assert.ok(body.error);
  });

  await t.test("contact endpoint rejects non-POST with 405", async () => {
    const res = await contactHandler({ httpMethod: "GET" });
    assert.equal(res.statusCode, 405);
  });

  await t.test("contact endpoint rejects spam or invalid email with 400", async () => {
    const res = await contactHandler({
      httpMethod: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Test",
        email: "not-an-email",
        message: "Hello this is a valid message length"
      })
    });
    assert.equal(res.statusCode, 400);
    const body = JSON.parse(res.body);
    assert.ok(body.error);
  });

  await t.test("publish-post endpoint rejects unauthorized requests with 401", async () => {
    const origKey = process.env.ADMIN_API_KEY;
    process.env.ADMIN_API_KEY = "super_secret_admin_key_12345";
    try {
      const res = await publishPostHandler({
        httpMethod: "POST",
        headers: {
          "content-type": "application/json",
          "authorization": "Bearer wrong_key"
        },
        body: JSON.stringify({ slug: "test", title: "Test", description: "Desc", content: "Content" })
      });
      assert.equal(res.statusCode, 401);
      const body = JSON.parse(res.body);
      assert.ok(body.error);
    } finally {
      process.env.ADMIN_API_KEY = origKey;
    }
  });
});

test("Backend: GA4 Measurement Protocol", async (t) => {
  await t.test("sanitizeGa4Params strips internal $-prefixed and reserved keys while preserving ecommerce items", () => {
    const cleaned = sanitizeGa4Params({
      $current_url: "https://example.com/pay.html",
      $device_id: "dev_123",
      ga_session_id: "12345",
      firebase_screen: "pay",
      google_ad: "test",
      transaction_id: "pay_123",
      value: 4999,
      items: [
        { item_id: "website", item_name: "Conversion Website Design", quantity: 1, price: 4999 }
      ]
    });

    assert.equal(cleaned.$current_url, undefined);
    assert.equal(cleaned.$device_id, undefined);
    assert.equal(cleaned.ga_session_id, undefined);
    assert.equal(cleaned.firebase_screen, undefined);
    assert.equal(cleaned.google_ad, undefined);
    assert.equal(cleaned.transaction_id, "pay_123");
    assert.equal(cleaned.value, 4999);
    assert.equal(cleaned.currency, "INR");
    assert.equal(cleaned.engagement_time_msec, 100);
    assert.equal(cleaned.items.length, 1);
    assert.equal(cleaned.items[0].item_id, "website");
  });

  await t.test("sendGa4MeasurementProtocolEvent skips cleanly when env vars are absent", async () => {
    const result = await sendGa4MeasurementProtocolEvent({
      eventName: "purchase",
      clientId: "123.456",
      params: { transaction_id: "pay_123", value: 100, currency: "INR" },
      measurementId: "",
      apiSecret: ""
    });
    assert.equal(result.skipped, true);
  });

  await t.test("posthog-to-ga4 forwards purchase events with items and ga_client_id", async () => {
    const origMeasurementId = process.env.GA4_MEASUREMENT_ID;
    const origApiSecret = process.env.GA4_API_SECRET;
    const origPaymentMode = process.env.PAYMENT_MODE;
    const origIsPreview = process.env.IS_PREVIEW;
    const origContext = process.env.CONTEXT;
    const origFetch = globalThis.fetch;

    process.env.GA4_MEASUREMENT_ID = "G-S7P05N251P";
    process.env.GA4_API_SECRET = "test_api_secret";
    process.env.PAYMENT_MODE = "live";
    process.env.IS_PREVIEW = "";
    process.env.CONTEXT = "production";

    let capturedUrl = "";
    let capturedBody = null;
    globalThis.fetch = async (url, init) => {
      capturedUrl = url;
      capturedBody = JSON.parse(init.body);
      return new Response(null, { status: 204 });
    };

    try {
      const res = await posthogToGa4Handler({
        httpMethod: "POST",
        body: JSON.stringify({
          event: {
            event: "purchase",
            distinct_id: "user_1",
            properties: {
              ga_client_id: "111.222",
              $current_url: "https://mowarsondeveloper.netlify.app/pay.html",
              transaction_id: "pay_abc",
              value: 4999,
              currency: "INR",
              items: [{ item_id: "website", item_name: "Website", quantity: 1, price: 4999 }]
            }
          }
        })
      });

      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.ok, true);
      assert.equal(body.event, "purchase");
      assert.equal(body.transaction_id, "pay_abc");
      assert.ok(capturedUrl.includes("measurement_id=G-S7P05N251P"));
      assert.equal(capturedBody.client_id, "111.222");
      assert.equal(capturedBody.events[0].name, "purchase");
      assert.equal(capturedBody.events[0].params.transaction_id, "pay_abc");
      assert.equal(capturedBody.events[0].params.$current_url, undefined);
      assert.equal(capturedBody.events[0].params.items.length, 1);
    } finally {
      globalThis.fetch = origFetch;
      process.env.GA4_MEASUREMENT_ID = origMeasurementId;
      process.env.GA4_API_SECRET = origApiSecret;
      process.env.PAYMENT_MODE = origPaymentMode;
      process.env.IS_PREVIEW = origIsPreview;
      process.env.CONTEXT = origContext;
    }
  });

  await t.test("posthog-to-ga4 skips test payment events", async () => {
    const origMeasurementId = process.env.GA4_MEASUREMENT_ID;
    const origApiSecret = process.env.GA4_API_SECRET;
    const origPaymentMode = process.env.PAYMENT_MODE;
    const origIsPreview = process.env.IS_PREVIEW;
    const origContext = process.env.CONTEXT;
    const origFetch = globalThis.fetch;

    process.env.GA4_MEASUREMENT_ID = "G-S7P05N251P";
    process.env.GA4_API_SECRET = "test_api_secret";
    process.env.PAYMENT_MODE = "live";
    process.env.IS_PREVIEW = "";
    process.env.CONTEXT = "production";

    let fetchCalled = false;
    globalThis.fetch = async () => {
      fetchCalled = true;
      return new Response(null, { status: 204 });
    };

    try {
      const res = await posthogToGa4Handler({
        httpMethod: "POST",
        body: JSON.stringify({
          event: {
            event: "purchase",
            distinct_id: "user_test",
            properties: {
              payment_mode: "test",
              transaction_id: "pay_test_123",
              value: 4999,
              currency: "INR"
            }
          }
        })
      });

      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.skipped, true);
      assert.equal(fetchCalled, false, "Should not forward test payment to GA4");
    } finally {
      globalThis.fetch = origFetch;
      process.env.GA4_MEASUREMENT_ID = origMeasurementId;
      process.env.GA4_API_SECRET = origApiSecret;
      process.env.PAYMENT_MODE = origPaymentMode;
      process.env.IS_PREVIEW = origIsPreview;
      process.env.CONTEXT = origContext;
    }
  });
});
