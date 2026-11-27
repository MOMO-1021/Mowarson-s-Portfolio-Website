// list_tables.js
require("dotenv").config();
const { query } = require("./netlify/shared/db");

(async () => {
  try {
    const res = await query(
      `SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public'`,
    );
    console.log(
      "🗂️  Tables in DB:",
      res.rows.map((r) => r.tablename),
    );
  } catch (e) {
    console.error("❌ DB error →", e.message);
  } finally {
    // close the pool (the db module exports a pool that stays alive)
    const { pool } = require("./netlify/shared/db");
    await pool.end();
  }
})();
