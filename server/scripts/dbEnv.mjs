/**
 * Resolves the Postgres connection strings before anything tries to use them.
 *
 * Three problems this solves:
 *
 *  1. **Naming.** Vercel's database integrations (Neon, Supabase, Vercel
 *     Postgres) inject their own variable names. Rather than making you copy
 *     values into DATABASE_URL by hand, we accept the ones they actually set.
 *
 *  2. **Placeholders.** Pasting the example connection string leads to
 *     `Can't reach database server at host:5432`, which reads like a network
 *     fault rather than "you have not set this yet". We detect that and say so.
 *
 *  3. **Shadowing.** A leftover placeholder in DATABASE_URL must not hide a
 *     real connection that an integration just injected under another name, so
 *     unusable values are skipped rather than treated as the answer.
 */

/** Pooled connection, used by the running app. Checked in order. */
const POOLED_KEYS = ['DATABASE_URL', 'POSTGRES_PRISMA_URL', 'POSTGRES_URL'];

/** Direct connection, required for migrations — a pooler cannot run them. */
const DIRECT_KEYS = ['DIRECT_URL', 'DATABASE_URL_UNPOOLED', 'POSTGRES_URL_NON_POOLING'];

const PLACEHOLDER_HOSTS = new Set([
  'host',
  'hostname',
  'your-host',
  'your-db-host',
  'example.com',
  'db.example.com',
]);

const IS_SERVERLESS = Boolean(
  process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY,
);

/** Why this string cannot be a real database, or null if it looks usable. */
export function describePlaceholder(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return 'it is not a valid connection URL';
  }
  if (PLACEHOLDER_HOSTS.has(parsed.hostname)) {
    return `its host is literally "${parsed.hostname}", the placeholder from .env.example`;
  }
  if (parsed.username === 'user' && parsed.password === 'password') {
    return 'it still has the example credentials (user:password)';
  }
  if (IS_SERVERLESS && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')) {
    return 'it points at localhost, which on a serverless deployment is the function itself';
  }
  return null;
}

/** First variable holding a usable connection string; unusable ones are skipped. */
function firstUsable(keys) {
  const rejected = [];
  for (const key of keys) {
    const raw = process.env[key];
    if (!raw || !raw.trim()) continue;
    const problem = describePlaceholder(raw.trim());
    if (problem) {
      rejected.push({ key, problem });
      continue;
    }
    return { key, value: raw.trim(), rejected };
  }
  return { key: null, value: null, rejected };
}

function noDatabaseError(rejected) {
  const detail = rejected.length
    ? rejected.map((r) => `    ${r.key} - ${r.problem}`).join('\n')
    : `    none of: ${POOLED_KEYS.join(', ')} are set`;

  return new Error(
    [
      'No usable database connection string.',
      '',
      detail,
      '',
      '  TarangOS stores your data in Postgres. Vercel does not provide a database',
      '  on its own, so you need to create one:',
      '',
      '    1. In your Vercel project, open the Storage tab',
      '    2. Create Database -> Neon -> Connect   (free tier)',
      '    3. Delete any DATABASE_URL / DIRECT_URL you added by hand, so a',
      '       placeholder cannot shadow the real values',
      '    4. Redeploy',
      '',
      '  A real connection string looks like:',
      '    postgresql://USER:PASSWORD@ep-something.aws.neon.tech/dbname?sslmode=require',
    ].join('\n'),
  );
}

/**
 * Puts DATABASE_URL and DIRECT_URL into the environment, resolved from whichever
 * variables are actually present and usable. Returns a summary for logging.
 */
export function resolveDatabaseEnv() {
  const pooled = firstUsable(POOLED_KEYS);
  if (!pooled.value) throw noDatabaseError(pooled.rejected);

  for (const r of pooled.rejected) {
    console.warn(`[tarangos] ignoring ${r.key}: ${r.problem}. Using ${pooled.key} instead.`);
  }

  const direct = firstUsable(DIRECT_KEYS);

  process.env.DATABASE_URL = pooled.value;
  process.env.DIRECT_URL = direct.value ?? pooled.value;

  if (IS_SERVERLESS && !direct.value) {
    // Not fatal: many providers issue a single URL that handles both.
    console.warn(
      '[tarangos] No direct (unpooled) connection set. Migrations will run through ' +
        'the pooled URL, which some providers reject. If they fail, set DIRECT_URL.',
    );
  }

  return {
    pooledFrom: pooled.key,
    directFrom: direct.key ?? `${pooled.key} (reused)`,
    host: new URL(pooled.value).hostname,
  };
}
