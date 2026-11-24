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

const getPool = () => {
  if (!pool) {
    pool = new Pool({ connectionString: getDatabaseUrl() });
  }
  return pool;
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
