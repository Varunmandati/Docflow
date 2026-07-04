import dotenv from 'dotenv';
dotenv.config();

import pg from 'pg';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;

const ADMIN_URL = process.env.POSTGRES_ADMIN_URL;
if (!ADMIN_URL) throw new Error('POSTGRES_ADMIN_URL is required for migrations');

const pool = new Pool({ connectionString: ADMIN_URL });
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'migrations');

async function runMigrations() {
  const client = await pool.connect();
  try {
    // Create migration tracking table
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const files = (await readdir(MIGRATIONS_DIR))
      .filter(f => f.endsWith('.sql'))
      .sort(); // alphabetical = chronological (001_, 002_, etc.)

    for (const file of files) {
      const version = file.replace('.sql', '');
      const existing = await client.query(
        'SELECT version FROM schema_migrations WHERE version = $1',
        [version]
      );

      if (existing.rows.length === 0) {
        console.log(`Applying migration: ${file}`);
        const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf-8');
        await client.query('BEGIN');
        try {
          await client.query(sql);
          await client.query(
            'INSERT INTO schema_migrations (version) VALUES ($1)',
            [version]
          );
          await client.query('COMMIT');
          console.log(`✓ Applied: ${file}`);
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        }
      } else {
        console.log(`Skipping (already applied): ${file}`);
      }
    }
    console.log('All migrations complete.');
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
