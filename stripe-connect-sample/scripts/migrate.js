import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "../lib/db.js";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");
await db().query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
for (const name of (await fs.readdir(root)).filter(n => n.endsWith(".sql")).sort()) {
  const exists = await db().query("SELECT 1 FROM schema_migrations WHERE name=$1", [name]);
  if (exists.rowCount) continue;
  const sql = await fs.readFile(path.join(root, name), "utf8");
  const client = await db().connect();
  try { await client.query("BEGIN"); await client.query(sql); await client.query("INSERT INTO schema_migrations(name) VALUES($1)", [name]); await client.query("COMMIT"); console.log(`Applied ${name}`); }
  catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
}
await db().end();
