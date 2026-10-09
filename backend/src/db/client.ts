import pg from 'pg';
import { env } from '../config/env.js';

const { Pool } = pg;

// API pool — uses docflow_api role (limited privileges)
export const apiPool = new Pool({
  connectionString: env.DATABASE_URL,
  min: env.DB_POOL_MIN,
  max: env.DB_POOL_MAX,
  idleTimeoutMillis: env.DB_IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: 5000,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false,
});

// Worker pool — uses docflow_worker role (separate credentials, BYPASSRLS).
// Sized from the same knobs as the API pool so a single-VM deployment can be
// tuned in one place; the worker is the only long-lived consumer of this pool
// and a single replica only ever needs a couple of connections.
export const workerPool = new Pool({
  connectionString: env.DATABASE_URL_WORKER,
  min: 0,
  max: Math.max(2, Math.min(env.DB_POOL_MAX, 4)),
  idleTimeoutMillis: env.DB_IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: 5000,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false,
});

// An idle client whose backend connection dies (Postgres restart, network
// blip) emits 'error' on the pool. Without a listener Node treats it as an
// unhandled 'error' event and crashes the whole process.
const logPoolError = (source: string) => (err: Error) => {
  // eslint-disable-next-line no-console
  console.error(`[pg:${source}] pool error:`, err);
};
apiPool.on('error', logPoolError('api'));
workerPool.on('error', logPoolError('worker'));

// CRITICAL: Set RLS context for every API query inside a transaction block
// Call this wrapper for all user-scoped queries
export async function withUserContext<T>(
  userId: string,
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await apiPool.connect();
  try {
    await client.query('BEGIN');
    // Set the current user context for Row Level Security policies.
    // set_config with is_local=true is transaction-scoped and supports
    // bind parameters (SET LOCAL does not).
    await client.query(`SELECT set_config('app.current_user_id', $1, true)`, [userId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// For queries that don't need user context (auth routes, anonymous jobs)
export async function withApiClient<T>(
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await apiPool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

// Graceful shutdown
export async function closeDatabaseConnections(): Promise<void> {
  await Promise.all([apiPool.end(), workerPool.end()]);
}

// Health check
export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    await apiPool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
