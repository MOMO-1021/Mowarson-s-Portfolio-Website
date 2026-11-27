// list_tables.js – quick sanity‑check that the required tables exist
require("dotenv").config({ override: true }); // loads .env → DATABASE_URL

// The DB helper used throughout the project
const { query, pool } = require("./netlify/shared/db");

// Helper to safely close the pool if the module exports it
async function safeClosePool() {
  if (pool && typeof pool.end === "function") {
    try {
      await pool.end();
    } catch (e) {
      // ignore – the pool may already be closed or not needed
    }
  }
}

(async () => {
  try {
    const res = await query(`
      SELECT tablename
      FROM pg_catalog.pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename;
    `);

    const tables = res.rows.map((r) => r.tablename);
    console.log("🗂️  Tables in DB:", tables);
  } catch (err) {
    console.error("❌ DB error →", err.message);
  } finally {
    await safeClosePool(); // only runs if pool is defined
  }
})();
