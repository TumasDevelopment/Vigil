import "server-only";
import { Pool, type PoolClient } from "pg";

const globalForPool = globalThis as unknown as { dashboardPool?: Pool };

export function db(): Pool {
  if (!globalForPool.dashboardPool) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 6 });
    pool.on("error", (error) => console.error("Errore connessione database:", error.message));
    globalForPool.dashboardPool = pool;
  }
  return globalForPool.dashboardPool;
}

export async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
