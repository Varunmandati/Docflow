import pg from 'pg';
import { env } from '../config/env.js';

const { Pool } = pg;

// API pool — uses docflow_api role (limited privileges)
export const apiPool = new Pool({
  connectionString: env.DATABASE_URL,
  min: parseInt(env.DB_POOL_MIN ?? '2'),
  max: parseInt(env.DB_POOL_MAX ?? '10'),
  idleTimeoutMillis: parseInt(env.DB_IDLE_TIMEOUT_MS ?? '30000'),
  connectionTimeoutMillis: 5000,
  ssl: env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false,
});

// Worker pool — uses docflow_worker role (separate credentials)
export const workerPool = new Pool({
  connectionString: env.DATABASE_URL_WORKER,
  min: 1,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false,
});

// CRITICAL: Set RLS context for every API query inside a transaction block
// Call this wrapper for all user-scoped queries
export async function withUserContext<T>(
  userId: string,
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await apiPool.connect();
  try {
    await client.query('BEGIN');
    // Set the current user context for Row Level Security policies
    await client.query(`SET LOCAL app.current_user_id = $1`, [userId]);
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
