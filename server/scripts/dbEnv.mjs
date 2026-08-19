/**
 * Resolves the Postgres connection strings before anything tries to use them.
 *
 * Two problems this solves:
 *
 *  1. **Naming.** Vercel's database integrations (Neon, Supabase, Vercel
 *     Postgres) inject their own variable names. Rather than making you copy
 *     values into DATABASE_URL by hand, we accept the ones they actually set.
 *
 *  2. **Placeholders.** Pasting the example connection string leads to
 *     `Can't reach database server at host:5432`, which reads like a network
 *     fault rather than "you have not set this yet". We detect that and say so.
 */

/** Pooled connection, used by the running app. */
const POOLED_KEYS = ['DATABASE_URL', 'POSTGRES_PRISMA_URL', 'POSTGRES_URL'];

/** Direct connection, required for migrations — a pooler cannot run them. */
const DIRECT_KEYS = ['DIRECT_URL', 'DATABASE_URL_UNPOOLED', 'POSTGRES_URL_NON_POOLING'];

const PLACEHOLDER_HOSTS = new Set(['host', 'hostname', 'your-host', 'your-db-host', 'example.com', 'db.example.com']);

function firstSet(keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (value && value.trim()) return { key, value: value.trim() };
  }
  return null;
}

/** Is this obviously the example string rather than a real database? */
export function describePlaceholder(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return 'it is not a valid connection URL';
  }
  if (PLACEHOLDER_HOSTS.has(parsed.hostname)) {
    return `its host is literally "${parsed.hostname}" — the placeholder from .env.example`;
  }
  if (parsed.username === 'user' && parsed.password === 'password') {
    return 'it still has the example credentials (user:password)';
  }
  return null;
}

const IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY);

/**
 * Puts DATABASE_URL and DIRECT_URL into the environment, resolved from whichever
 * variables are actually present. Returns a short description for logging.
 */
export function resolveDatabaseEnv() {
  const pooled = firstSet(POOLED_KEYS);

  if (!pooled) {
    throw new Error(
      'No database connection string found.\n\n' +
        `  Looked for: ${POOLED_KEYS.join(', ')}\n\n` +
        '  TarangOS stores your data in Postgres. Create one first — on Vercel the\n' +
        '  quickest route is Storage -> Create Database -> Neon, which sets these\n' +
        '  variables for you automatically.',
    );
  }

  const problem = describePlaceholder(pooled.value);
  if (problem) {
    throw new Error(
      `${pooled.key} is not a real database connection: ${problem}.\n\n` +
        '  Replace it with the connection string from your Postgres provider.\n' +
        '  On Vercel: Storage -> Create Database -> Neon (free) wires this up for you,\n' +
        '  or paste a string from neon.tech / supabase.com into\n' +
        '  Settings -> Environment Variables.\n\n' +
        '  It should look like:\n' +
        '    postgresql://USER:PASSWORD@ep-something.aws.neon.tech/dbname?sslmode=require',
    );
  }

  const direct = firstSet(DIRECT_KEYS);
  process.env.DATABASE_URL = pooled.value;
  process.env.DIRECT_URL = direct?.value ?? pooled.value;

  if (IS_SERVERLESS && !direct) {
    // Not fatal: many providers issue a single URL that handles both.
    console.warn(
      '[tarangos] No direct (unpooled) connection set. Migrations run through the ' +
        'pooled URL, which some providers reject. If migrations fail, set DIRECT_URL.',
    );
  }

  return {
    pooledFrom: pooled.key,
    directFrom: direct?.key ?? `${pooled.key} (reused)`,
    host: new URL(pooled.value).hostname,
  };
}
