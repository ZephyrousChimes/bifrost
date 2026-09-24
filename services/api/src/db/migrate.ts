import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { env } from "../config/env";

const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "db", "migrations");

async function migrate() {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename    TEXT PRIMARY KEY,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const applied = new Set(
      (await pool.query<{ filename: string }>("SELECT filename FROM schema_migrations")).rows.map(
        (r) => r.filename,
      ),
    );

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      if (applied.has(file)) continue;

      const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      console.log(`applying ${file}`);

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    }
  } finally {
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
