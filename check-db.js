require("dotenv").config({ override: true });
const { query, pool } = require("./netlify/shared/db");

async function showColumns(table) {
  const res = await query(
    `
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = $1
    ORDER BY ordinal_position;
  `,
    [table],
  );
  console.log(`\n=== ${table} ===`);
  res.rows.forEach((r) => {
    console.log(
      `${r.column_name} | ${r.data_type} | nullable=${r.is_nullable} | default=${r.column_default}`,
    );
  });
}

(async () => {
  try {
    await Promise.all(
      ["orders", "payments", "webhook_events", "leads"].map(showColumns),
    );
  } catch (e) {
    console.error("❌ DB error →", e.message);
  } finally {
    if (pool && typeof pool.end === "function") await pool.end();
  }
})();
