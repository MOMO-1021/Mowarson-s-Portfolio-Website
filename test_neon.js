// test_neon.js – minimal Neon connection sanity check
require("dotenv").config(); // loads .env automatically
const { Pool } = require("@neondatabase/serverless");

// Use the DATABASE_URL env‑var that you placed in .env
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  try {
    const res = await pool.query("SELECT now()");
    console.log("🟢 DB OK →", res.rows[0]);
  } catch (err) {
    console.error("🔴 DB connection error →", err.message);
  } finally {
    await pool.end();
  }
})();
