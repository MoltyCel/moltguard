import { Pool, QueryResult } from "pg";

const pool = new Pool({
  connectionString: process.env.MOLTGUARD_DB_URL || "postgresql://moltstack@localhost/moltstack",
  max: 5,
  idleTimeoutMillis: 30000,
});

export async function query(text: string, params?: any[]): Promise<QueryResult> {
  return pool.query(text, params);
}

export default pool;
