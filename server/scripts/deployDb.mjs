/**
 * Applies pending migrations during a deployment.
 *
 * Wraps `prisma migrate deploy` so the connection strings are resolved (and
 * sanity-checked) first. The Prisma CLI reads the environment directly, so the
 * resolution has to happen in this process before the CLI is spawned.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resolveDatabaseEnv } from './dbEnv.mjs';

const serverRoot = dirname(dirname(fileURLToPath(import.meta.url)));

let resolved;
try {
  resolved = resolveDatabaseEnv();
} catch (err) {
  console.error(`\n[tarangos] Cannot run migrations.\n\n${err.message}\n`);
  process.exit(1);
}

console.log(
  `[tarangos] migrating ${resolved.host} (pooled from ${resolved.pooledFrom}, direct from ${resolved.directFrom})`,
);

const prisma = join(serverRoot, 'node_modules', 'prisma', 'build', 'index.js');
const result = spawnSync(process.execPath, [prisma, 'migrate', 'deploy'], {
  cwd: serverRoot,
  stdio: 'inherit',
  env: process.env,
});

process.exit(result.status ?? 1);
