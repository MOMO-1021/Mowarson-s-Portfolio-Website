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

module.exports = {
  getPool,
  query,
  withTransaction,
  getDatabaseUrl,
  isPreviewEnvironment,
  isDbConfigured,
};

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

module.exports = { getPool, query, withTransaction, getDatabaseUrl, isPreviewEnvironment };
