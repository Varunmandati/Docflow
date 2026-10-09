/**
 * Copy the SQL migration files into the compiled output.
 *
 * `tsc` only emits JavaScript, so the .sql files under src/db/migrations are
 * absent from dist/. The migrator looks for them relative to its own module
 * (dist/db/migrations), so without this step a dist-only deployment finds no
 * migrations at all.
 *
 * That failure used to be masked: the migrator's search list also contained
 * `backend/src/db/migrations`, which exists in the OCI image only because the
 * Docker build copies the entire backend directory - sources and all - into the
 * runtime stage. So the image worked, but only by accident, and only for as
 * long as src/ stayed in the image. Pruning sources, or running the compiled
 * output on its own, would have produced a migration runner that silently
 * believed it had nothing to apply.
 *
 * Kept as a separate script rather than a tsc flag because there is no
 * first-class "copy non-TS files" option in tsc, and rather than a shell `cp`
 * so the build behaves identically on the Windows dev machine and in Linux CI.
 */
import { cp, mkdir, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const from = join(here, '..', 'src', 'db', 'migrations');
const to = join(here, '..', 'dist', 'db', 'migrations');

const entries = await readdir(from);
const sqlFiles = entries.filter((f) => f.endsWith('.sql')).sort();

if (sqlFiles.length === 0) {
    // Loudly. An empty migrations directory is never correct, and the migrator
    // would otherwise report "All migrations complete" having applied nothing.
    console.error(`[copy-migrations] no .sql files found in ${from}`);
    process.exit(1);
}

await mkdir(to, { recursive: true });
for (const file of sqlFiles) {
    await cp(join(from, file), join(to, file));
}

console.log(`[copy-migrations] copied ${sqlFiles.length} migration(s) to dist/db/migrations`);
