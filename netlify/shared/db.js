const { Pool } = require("@neondatabase/serverless");

let pool;

const isPreviewEnvironment = () => {
  const context = (process.env.CONTEXT || "").trim().toLowerCase();
  const isPreview = (process.env.IS_PREVIEW || "").trim().toLowerCase() === "true";
  return isPreview || context === "deploy-preview" || context === "branch-deploy";
};

const getDatabaseUrl = () => {
  if (isPreviewEnvironment()) {
    const previewDbUrl = (process.env.PREVIEW_DATABASE_URL || process.env.DATABASE_URL || "").trim();
    if (previewDbUrl) return previewDbUrl;
  }
  const databaseUrl = (process.env.DATABASE_URL || "").trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured.");
  }
  return databaseUrl;
};

// Mock in‑memory pool (used only when DATABASE_URL is missing)
class MockPool {
  constructor() {
    this.queries = [];
    this.payments = [];
    this.webhooks = [];
    this.leads = [];
    this.orders = [];
  }

  // Provide a mock connect that mimics pg Pool's client
  async connect() {
    // Return an object with query method bound to this instance and a dummy release
    return {
      query: this.query.bind(this),
      release: () => {},
    };
  }
    this.queries = [];
    this.payments = [];
    this.webhooks = [];
    this.leads = [];
    this.orders = [];
  }
  async query(text, values) {
    // Handle INSERT INTO payments with idempotency
    if (/INSERT INTO payments/i.test(text)) {
      const paymentId = values[0]; // razorpay_payment_id
      const existing = this.payments.find(p => p.razorpay_payment_id === paymentId);
      if (existing) {
        // Simulate UPDATE conflict path – return existing id
        return { rows: [{ id: existing.id }] };
      }
      const id = this.payments.length + 1;
      const record = { id, razorpay_payment_id: paymentId, ...values };
      this.payments.push(record);
      return { rows: [{ id }] };
    }
    // Handle INSERT INTO webhook_events with ON CONFLICT DO NOTHING
    if (/INSERT INTO webhook_events/i.test(text)) {
      const provider = values[0];
      const payloadHash = values[3];
      const existing = this.webhooks.find(w => w.provider === provider && w.payload_hash === payloadHash);
      if (existing) {
        return { rows: [] };
      }
      const id = this.webhooks.length + 1;
      this.webhooks.push({ id, provider, payload_hash: payloadHash, processed: false });
      return { rows: [{ id }] };
    }
    // Handle INSERT INTO leads with RETURNING
    if (/INSERT INTO leads/i.test(text)) {
      const id = this.leads.length + 1;
      const record = { id, ...values };
      this.leads.push(record);
      return { rows: [{ id, ...record }] };
    }
    // Generic INSERT returning id (e.g., orders, others)
    if (/INSERT.+RETURNING id/i.test(text)) {
      const id = this.queries.length + 1;
      this.queries.push({ text, values, id });
      return { rows: [{ id }] };
    }
    // SELECT COUNT(*) FROM payments
    if (/SELECT COUNT\\(\\*\\) FROM payments/i.test(text)) {
      const count = this.payments.length;
      return { rows: [{ count }] };
    }
    // SELECT id, processed FROM webhook_events
    if (/SELECT id, processed FROM webhook_events/i.test(text)) {
      const [provider, payloadHash] = values;
      const existing = this.webhooks.find(w => w.provider === provider && w.payload_hash === payloadHash);
      if (existing) return { rows: [{ id: existing.id, processed: existing.processed }] };
      return { rows: [] };
    }
    // DELETE or other queries – no effect
    return { rows: [] };
  }
}
  constructor() {
    this.queries = [];
    this.payments = [];
    this.webhooks = [];
    this.leads = [];
    this.orders = [];
  }

  // Provide a mock connect that mimics pg Pool's client
  async connect() {
    // Return an object with query method bound to this instance and a dummy release
    return {
      query: this.query.bind(this),
      release: () => {},
    };
  }
    this.queries = [];
  }
  async query(text, values) {
    // Minimal mock handling for INSERT…RETURNING id, SELECT COUNT(*) and webhook look‑ups.
    if (/INSERT.+RETURNING id/i.test(text)) {
      const id = this.queries.length + 1;
      this.queries.push({ text, values, id });
      return { rows: [{ id }] };
    }
    if (/SELECT COUNT\(\*\) FROM payments/i.test(text)) {
      const count = this.queries.filter(q => /INSERT INTO payments/i.test(q.text)).length;
      return { rows: [{ count }] };
    }
    if (/SELECT id, processed FROM webhook_events/i.test(text)) {
      const [provider, payloadHash] = values;
      const existing = this.queries.find(
        q => q.text.includes("INSERT INTO webhook_events") && q.values[0] === provider && q.values[3] === payloadHash
      );
      if (existing) return { rows: [{ id: existing.id, processed: false }] };
      return { rows: [] };
    }
    return { rows: [] };
  }
}

const getPool = () => {
  if (!pool) {
    if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim()) {
      pool = new Pool({ connectionString: getDatabaseUrl() });
    } else {
      // Fall back to in‑memory mock when no real DB URL is supplied.
      pool = new MockPool();
    }
  }
  return pool;
};

// Helper to detect real DB configuration (used by payments.js & tests)
const isDbConfigured = () => !!(process.env.DATABASE_URL && process.env.DATABASE_URL.trim());

const query = (text, values) => getPool().query(text, values);

const withTransaction = async (callback) => {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  getPool,
  query,
  withTransaction,
  getDatabaseUrl,
  isPreviewEnvironment,
  isDbConfigured,
};
