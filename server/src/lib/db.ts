import { PrismaClient } from '@prisma/client';
import { config } from '../config';

/**
 * Database client.
 *
 * On a long-running server this is a plain singleton. On serverless it matters
 * more than it looks: every cold start would otherwise open a new pool, and a
 * Postgres instance will refuse connections long before traffic becomes
 * interesting. Caching the client on `globalThis` means warm invocations reuse
 * the same one, and the pooled connection string keeps the count bounded.
 */

const globalForPrisma = globalThis as unknown as { tarangosPrisma?: PrismaClient };

export const prisma =
  globalForPrisma.tarangosPrisma ??
  new PrismaClient({
    log: config.isProd ? ['warn', 'error'] : ['warn', 'error'],
  });

if (!config.isProd || config.isServerless) {
  globalForPrisma.tarangosPrisma = prisma;
}

/**
 * Confirms the database is reachable before the server announces itself.
 *
 * Postgres needs no per-connection setup, unlike the SQLite pragmas this
 * replaced — pooling, durability and foreign keys are all server-side concerns
 * there. On serverless this is skipped: paying a round trip on every cold start
 * to learn something the first real query would tell us is not worth it.
 */
export async function initDatabase(): Promise<void> {
  if (config.isServerless) return;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    throw new Error(
      `Could not reach the database.\n` +
        `  DATABASE_URL must point at a Postgres instance.\n` +
        `  Underlying error: ${message}`,
    );
  }
}

export async function closeDatabase(): Promise<void> {
  await prisma.$disconnect();
}
