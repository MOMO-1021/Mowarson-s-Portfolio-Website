const { Pool } = require("@neondatabase/serverless");

let pool;

const getDatabaseUrl = () => {
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

module.exports = { getPool, query };
