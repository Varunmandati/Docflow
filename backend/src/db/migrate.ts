import dotenv from 'dotenv';
dotenv.config();

import pg from 'pg';
import { readdir, readFile } from 'fs/promises';
import fs from 'fs';
import { join, resolve } from 'path';

const { Pool } = pg;

/**
 * TLS for the migration connection.
 *
 * Neon terminates TLS with a certificate issued by a public CA and its console
 * hands out `sslmode=require`, i.e. "encrypt, do not verify the chain". Setting
 * `rejectUnauthorized: true` here would silently override that and fail every
 * migration for operators whose Node image lacks the relevant root, which is a
 * far more common failure than a hostile proxy sitting between the instance and
 * Neon. Encryption is still enforced; full verification is opt-in via
 * PGSSLROOTCERT/PGSSLMODE=verify-full.
 */
function migrationSsl(): object {
  if (process.env.PGSSLMODE === 'verify-full' || process.env.PGSSLMODE === 'verify-ca') {
    return { rejectUnauthorized: true };
  }
  return { rejectUnauthorized: false };
}

/**
 * Locate the compiled migration files.
 *
 * Throws rather than returning a non-existent path. The old version fell back
 * to a directory that may not exist, and the resulting ENOENT from readdir was
 * an unhelpful "no such file or directory" pointing at a path the operator
 * never configured. Worse, because the search list preferred the *source*
 * tree, a dist-only deployment that happened to have an empty-but-present
 * migrations directory would report "All migrations complete" without having
 * applied a single statement - a schema that silently disagrees with the code.
 */
function getMigrationsDir(): string {
  const candidates = [
    // The build copies the .sql files next to the compiled migrator
    // (see scripts/copy-migrations.mjs). This is the path that matters in a
    // deployed image, so it is checked first.
    resolve(__dirname, 'migrations'),
    join(process.cwd(), 'src', 'db', 'migrations'),
    join(process.cwd(), 'backend', 'src', 'db', 'migrations'),
    resolve(__dirname, '../../src/db/migrations'),
    resolve(__dirname, '../../../src/db/migrations'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  throw new Error(
    'Could not locate the migrations directory. Looked in:\n' +
      candidates.map(c => `  - ${c}`).join('\n') +
      '\nIf this is a compiled build, `npm run build` should have copied the .sql files ' +
      'into dist/db/migrations. Refusing to report success with nothing applied.'
  );
}

/** Names of the .sql migrations in the resolved directory, in apply order. */
async function listMigrationFiles(): Promise<string[]> {
  const dir = getMigrationsDir();
  const files = (await readdir(dir)).filter(f => f.endsWith('.sql')).sort();
  if (files.length === 0) {
    throw new Error(
      `No .sql migrations found in ${dir}. An empty migrations directory means ` +
      'nothing was ever applied; refusing to report success.'
    );
  }
  return files;
}


/**
 * Report applied vs pending migrations without changing anything.
 *
 * Used by deploy/oci/update.sh as a preflight so an upgrade can print the
 * starting schema state, and so a "migration failed" outcome is diagnosable
 * after the fact.
 */
export async function showMigrationStatus() {
  const migrationUrl = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL || process.env.POSTGRES_ADMIN_URL;
  if (!migrationUrl) {
    throw new Error('DATABASE_URL_DIRECT, POSTGRES_ADMIN_URL, or DATABASE_URL is required for migrations');
  }

  const pool = new Pool({ connectionString: migrationUrl, ssl: migrationSsl() });
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const files = await listMigrationFiles();
    const { rows } = await client.query<{ version: string }>('SELECT version FROM schema_migrations');
    const applied = new Set(rows.map(r => r.version));

    let pending = 0;
    for (const file of files) {
      const version = file.replace('.sql', '');
      if (applied.has(version)) {
        console.log(`  applied  ${file}`);
      } else {
        console.log(`  PENDING  ${file}`);
        pending++;
      }
    }
    if (pending === 0) {
      console.log(`  ${files.length} migration(s), all applied.`);
    } else {
      console.log(`  ${pending} pending migration(s).`);
    }
    return pending;
  } finally {
    client.release();
    await pool.end();
  }
}

export async function runMigrations() {
  const migrationUrl = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL || process.env.POSTGRES_ADMIN_URL;
  if (!migrationUrl) {
    throw new Error('DATABASE_URL_DIRECT, POSTGRES_ADMIN_URL, or DATABASE_URL is required for migrations');
  }

  const pool = new Pool({
    connectionString: migrationUrl,
    ssl: migrationSsl(),
  });

  const migrationsDir = getMigrationsDir();
  const client = await pool.connect();
  try {
    // Create migration tracking table
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // alphabetical = chronological (001_, 002_, etc.)
    const files = await listMigrationFiles();

    for (const file of files) {
      const version = file.replace('.sql', '');
      const existing = await client.query(
        'SELECT version FROM schema_migrations WHERE version = $1',
        [version]
      );

      if (existing.rows.length === 0) {
        console.log(`Applying migration: ${file}`);
        const sql = await readFile(join(migrationsDir, file), 'utf-8');
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

// Only auto-run if executed directly from CLI (e.g. `npm run migrate` or `tsx src/db/migrate.ts`)
const isDirectCliExecution =
  process.argv[1] &&
  (process.argv[1].endsWith('migrate.ts') || process.argv[1].endsWith('migrate.js'));

if (isDirectCliExecution) {
  // `--status` is read-only: it reports applied vs pending and exits 0 either
  // way, so a preflight script can call it without triggering a failure.
  if (process.argv.includes('--status')) {
    showMigrationStatus().catch(err => {
      console.error('Migration status check failed:', err);
      process.exit(1);
    });
  } else {
    runMigrations().catch(err => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
  }
}
