import pg from "pg";
const { Pool } = pg;
let pool;
export function db() {
  if (!process.env.DATABASE_URL) throw Object.assign(new Error("DATABASE_URL is required for marketplace operations."), { status: 503 });
  pool ||= new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined });
  return pool;
}
export async function transaction(fn) {
  const client = await db().connect();
  try { await client.query("BEGIN"); const result = await fn(client); await client.query("COMMIT"); return result; }
  catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
