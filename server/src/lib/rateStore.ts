import type { Store, Options, ClientRateLimitInfo } from 'express-rate-limit';
import { prisma } from './db';

/**
 * A rate-limit store backed by Postgres.
 *
 * The default store counts in memory, which is correct on one long-running
 * server and useless across serverless functions: every instance keeps its own
 * tally, so "10 attempts per 15 minutes" quietly becomes "10 per instance", and
 * an attacker only has to trigger cold starts to reset it.
 *
 * Counting in the database makes the limit mean one thing everywhere. It costs
 * a round trip per request, which is why only the security-critical limiters
 * (sign-in, unlock, account creation) use it — the high-volume limiters stay in
 * memory, where their job is flood control rather than credential protection.
 */
export class PrismaRateStore implements Store {
  /** Keys are shared between instances, so express-rate-limit must not assume otherwise. */
  localKeys = false;

  private windowMs = 60_000;
  /** Part of the Store contract, so it cannot be private. */
  prefix: string;

  constructor(prefix: string) {
    this.prefix = prefix;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  private id(key: string): string {
    return `${this.prefix}:${key}`;
  }

  /**
   * Increments atomically.
   *
   * The whole read-modify-write happens inside one statement, so two functions
   * hitting it at the same moment cannot both read "9" and both write "10".
   * An expired window resets in the same statement rather than needing a
   * separate cleanup pass.
   */
  async increment(key: string): Promise<ClientRateLimitInfo> {
    const expires = new Date(Date.now() + this.windowMs);

    try {
      const rows = await prisma.$queryRaw<{ count: number; expiresAt: Date }[]>`
        INSERT INTO "RateBucket" ("key", "count", "expiresAt")
        VALUES (${this.id(key)}, 1, ${expires})
        ON CONFLICT ("key") DO UPDATE SET
          "count" = CASE
            WHEN "RateBucket"."expiresAt" <= NOW() THEN 1
            ELSE "RateBucket"."count" + 1
          END,
          "expiresAt" = CASE
            WHEN "RateBucket"."expiresAt" <= NOW() THEN EXCLUDED."expiresAt"
            ELSE "RateBucket"."expiresAt"
          END
        RETURNING "count", "expiresAt"
      `;

      const row = rows[0];
      return { totalHits: row?.count ?? 1, resetTime: row?.expiresAt ?? expires };
    } catch {
      // If the database is unreachable, fail open rather than locking the owner
      // out of their own app. The account lockout and the block list are both
      // separate defences and neither depends on this path.
      return { totalHits: 1, resetTime: expires };
    }
  }

  async decrement(key: string): Promise<void> {
    await prisma.rateBucket
      .updateMany({ where: { key: this.id(key), count: { gt: 0 } }, data: { count: { decrement: 1 } } })
      .catch(() => undefined);
  }

  async resetKey(key: string): Promise<void> {
    await prisma.rateBucket.deleteMany({ where: { key: this.id(key) } }).catch(() => undefined);
  }

  async resetAll(): Promise<void> {
    await prisma.rateBucket.deleteMany({ where: { key: { startsWith: `${this.prefix}:` } } }).catch(() => undefined);
  }
}

/** Housekeeping: drop counters whose window has closed. */
export async function purgeExpiredRateBuckets(): Promise<number> {
  const result = await prisma.rateBucket
    .deleteMany({ where: { expiresAt: { lte: new Date() } } })
    .catch(() => ({ count: 0 }));
  return result.count;
}
