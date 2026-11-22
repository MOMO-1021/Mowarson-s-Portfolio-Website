const { query, withTransaction } = require("./db");

const upsertOrder = async ({
  razorpayOrderId,
  plan,
  amountMinor,
  currency,
  customerEmail,
  customerPhone,
  distinctId,
  status = "created",
}) =>
  query(
    `INSERT INTO orders
      (razorpay_order_id, plan, amount_minor, currency, customer_email,
       customer_phone, distinct_id, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (razorpay_order_id) DO UPDATE SET
       plan = COALESCE(EXCLUDED.plan, orders.plan),
       amount_minor = EXCLUDED.amount_minor,
       currency = EXCLUDED.currency,
       customer_email = COALESCE(EXCLUDED.customer_email, orders.customer_email),
       customer_phone = COALESCE(EXCLUDED.customer_phone, orders.customer_phone),
       distinct_id = COALESCE(EXCLUDED.distinct_id, orders.distinct_id),
       status = EXCLUDED.status,
       updated_at = NOW()
     RETURNING id`,
    [
      razorpayOrderId,
      plan || null,
      amountMinor,
      currency,
      customerEmail || null,
      customerPhone || null,
      distinctId || null,
      status,
    ],
  );

const recordPayment = async ({
  razorpayOrderId,
  razorpayPaymentId,
  plan,
  amountMinor,
  currency,
  status,
  paymentMethod,
  signatureVerified = false,
  customerEmail,
  customerPhone,
  distinctId,
}) =>
  withTransaction(async (client) => {
    await client.query(
      `INSERT INTO orders
        (razorpay_order_id, plan, amount_minor, currency, customer_email,
         customer_phone, distinct_id, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (razorpay_order_id) DO UPDATE SET
         plan = COALESCE(EXCLUDED.plan, orders.plan),
         amount_minor = EXCLUDED.amount_minor,
         currency = EXCLUDED.currency,
         customer_email = COALESCE(EXCLUDED.customer_email, orders.customer_email),
         customer_phone = COALESCE(EXCLUDED.customer_phone, orders.customer_phone),
         distinct_id = COALESCE(EXCLUDED.distinct_id, orders.distinct_id),
         status = EXCLUDED.status,
         updated_at = NOW()`,
      [
        razorpayOrderId,
        plan || null,
        amountMinor,
        currency,
        customerEmail || null,
        customerPhone || null,
        distinctId || null,
        status === "captured" ? "paid" : status,
      ],
    );

    return client.query(
      `INSERT INTO payments
        (razorpay_payment_id, razorpay_order_id, amount_minor, currency,
         status, payment_method, signature_verified)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (razorpay_payment_id) DO UPDATE SET
         razorpay_order_id = EXCLUDED.razorpay_order_id,
         amount_minor = EXCLUDED.amount_minor,
         currency = EXCLUDED.currency,
         status = EXCLUDED.status,
         payment_method = COALESCE(EXCLUDED.payment_method, payments.payment_method),
         signature_verified = payments.signature_verified OR EXCLUDED.signature_verified,
         updated_at = NOW()
       RETURNING id`,
      [
        razorpayPaymentId,
        razorpayOrderId,
        amountMinor,
        currency,
        status,
        paymentMethod || null,
        signatureVerified,
      ],
    );
  });

const beginWebhookEvent = async ({
  provider,
  externalEventId,
  eventName,
  payloadHash,
}) => {
  const result = await query(
    `INSERT INTO webhook_events
      (provider, external_event_id, event_name, payload_hash)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [provider, externalEventId || null, eventName, payloadHash],
  );
  if (result.rows[0]) return result.rows[0];

  const existing = await query(
    `SELECT id, processed
     FROM webhook_events
     WHERE provider = $1
      AND (payload_hash = $2 OR ($3::text IS NOT NULL AND external_event_id = $3::text))
     ORDER BY id
     LIMIT 1`,
    [provider, payloadHash, externalEventId || null],
  );
  if (!existing.rows[0] || existing.rows[0].processed) return null;
  return existing.rows[0];
};

const completeWebhookEvent = (id) =>
  query(
    `UPDATE webhook_events
     SET processed = TRUE, processed_at = NOW(), processing_error = NULL
     WHERE id = $1`,
    [id],
  );

const failWebhookEvent = (id, error) =>
  query(
    `UPDATE webhook_events
     SET processing_error = $2
     WHERE id = $1`,
    [id, String(error).slice(0, 1000)],
  );

module.exports = {
  beginWebhookEvent,
  completeWebhookEvent,
  failWebhookEvent,
  recordPayment,
  upsertOrder,
};
