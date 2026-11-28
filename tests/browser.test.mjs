import dotenv from "dotenv";
dotenv.config({ override: true });
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const contactHtml = fs.readFileSync(path.join(root, "contact.html"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const payHtml = fs.readFileSync(path.join(root, "pay.html"), "utf8");
const scriptJs = fs.readFileSync(path.join(root, "script.js"), "utf8");

test("Browser: Contact Form Structure & Interaction Flow", async (t) => {
  await t.test("Contact form has required inputs, honeypot, and submit action", () => {
    assert.ok(contactHtml.includes('id="contact-form"'), "Form #contact-form should exist");
    assert.ok(contactHtml.includes('id="contact-form-status"'), "Status element #contact-form-status should exist");
    assert.ok(/<input[^>]*name=["']name["'][^>]*required/i.test(contactHtml), "Name input should be required");
    assert.ok(/<input[^>]*name=["']email["'][^>]*required/i.test(contactHtml), "Email input should be required");
    assert.ok(/<textarea[^>]*name=["']message["'][^>]*required/i.test(contactHtml), "Message textarea should be required");
    assert.ok(/<input[^>]*name=["']website["']/i.test(contactHtml), "Honeypot 'website' field should exist");
  });

  await t.test("Homepage has quick inquiry form and 1-click WhatsApp conversion triggers", () => {
    assert.ok(indexHtml.includes('id="home-contact-form"'), "Homepage quick inquiry form should exist");
    assert.ok(indexHtml.includes('data-whatsapp-prefill'), "Homepage 1-click WhatsApp trigger should exist");
    assert.ok(scriptJs.includes('data-whatsapp-prefill'), "script.js handles dynamic WhatsApp prefill");
  });

  await t.test("Contact submission handler manages loading state, error display, and redirect", () => {
    assert.ok(scriptJs.includes("Sending your inquiry"), "Sets user feedback during submission");
    assert.ok(scriptJs.includes("status.classList.remove('is-error')"), "Clears error class upon new submission");
    assert.ok(scriptJs.includes("submitButton.disabled = true"), "Disables submit button while in-flight");
    assert.ok(scriptJs.includes("fetch('/api/contact'"), "Submits payload to /api/contact");
    assert.ok(scriptJs.includes("window.location.assign(result.redirectTo)"), "Redirects to thank-you upon success");
    assert.ok(scriptJs.includes("status.classList.add('is-error')"), "Adds is-error class on failure");
  });
});

test("Browser: Payment Form & Plan Selection", async (t) => {
  await t.test("Payment form contains plan options (seo, custom)", () => {
    assert.ok(payHtml.includes('value="seo"'), "SEO plan radio exists");
    assert.ok(!payHtml.includes('value="marketing"'), "Obsolete marketing plan radio removed");
    assert.ok(payHtml.includes('value="custom"'), "Custom plan radio exists");
    assert.ok(payHtml.includes('id="custom-amount-box"'), "Custom amount box container exists");
    assert.ok(payHtml.includes('id="custom-amount-input"'), "Custom amount input field exists");
  });

  await t.test("Payment form script supports currency selection and dynamic pricing formatting", () => {
    assert.ok(payHtml.includes("function formatAmount("), "formatAmount helper exists");
    assert.ok(payHtml.includes("function updateSummary("), "updateSummary helper exists");
    assert.ok(payHtml.includes("summary-total-amount"), "Updates total amount display");
    assert.ok(payHtml.includes("btn-amount-preview"), "Updates pay button amount preview");
  });
});

test("Browser: Razorpay Checkout Opening & Options", async (t) => {
  await t.test("Razorpay Checkout initialization configures all required options", () => {
    assert.ok(payHtml.includes("new Razorpay(options)"), "Instantiates Razorpay SDK with options");
    assert.ok(payHtml.includes("key: checkoutKey"), "Configures checkout key ID");
    assert.ok(payHtml.includes("order_id: orderId"), "Configures order ID");
    assert.ok(payHtml.includes("amount: orderData.amount"), "Configures order amount");
    assert.ok(payHtml.includes("currency: orderData.currency"), "Configures order currency");
    assert.ok(payHtml.includes("prefill:"), "Includes customer prefill information");
    assert.ok(payHtml.includes("modal:"), "Includes modal handlers");
  });
});

test("Browser: Successful Test Payment Flow", async (t) => {
  await t.test("Handles successful payment confirmation and dispatches purchase events", () => {
    assert.ok(payHtml.includes("fetch(\"/api/verify-payment\""), "Calls /api/verify-payment to verify signature");
    assert.ok(payHtml.includes('capturePaymentEvent("payment_completed"'), "Dispatches payment_completed event");
    assert.ok(payHtml.includes('capturePaymentEvent("purchase"'), "Dispatches purchase event");
    assert.ok(payHtml.includes('window.fbq("track", "Purchase"'), "Dispatches Meta browser Purchase event");
    assert.ok(payHtml.includes('showSuccessConfirmation('), "Renders success confirmation UI");
  });
});

test("Browser: Payment Failure & Checkout Dismissal Handling", async (t) => {
  await t.test("Handles payment failure event and alerts user", () => {
    assert.ok(payHtml.includes('rzp.on("payment.failed"'), "Listens for payment.failed event");
    assert.ok(payHtml.includes('capturePaymentEvent("payment_failed"'), "Dispatches payment_failed analytics event");
    assert.ok(payHtml.includes("resetSubmitBtn()"), "Resets submit button state on completion or error");
  });

  await t.test("Handles checkout dismissal when user closes the popup modal", () => {
    assert.ok(payHtml.includes("ondismiss: function ()"), "Defines ondismiss modal handler");
    assert.ok(payHtml.includes('capturePaymentEvent("payment_checkout_dismissed"'), "Captures payment_checkout_dismissed event");
    assert.ok(payHtml.includes("resetSubmitBtn();"), "Resets button state upon modal dismissal");
  });
});

test("Browser: Analytics Event Dispatching", async (t) => {
  await t.test("Dispatches GA4, PostHog, and Meta events safely without errors", () => {
    // Check script.js capture function
    assert.ok(scriptJs.includes("if (typeof window.gtag === 'function')"), "Guards window.gtag call");
    assert.ok(scriptJs.includes("if (window.posthog && typeof window.posthog.capture === 'function')"), "Guards PostHog capture call");
    assert.ok(scriptJs.includes("window.dataLayer = window.dataLayer || []"), "Initializes dataLayer safely");
    assert.ok(payHtml.includes("function capturePaymentEvent(eventName, properties)"), "Defines unified capturePaymentEvent in pay.html");
    assert.ok(payHtml.includes("if (currentPaymentIsTest)"), "Guards capturePaymentEvent against test payments");
    assert.ok(payHtml.includes('startsWith("rzp_test_")'), "Detects Razorpay test key prefix");
  });
});
