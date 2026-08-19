import rateLimit, { type Options } from 'express-rate-limit';
import type { Request, Response } from 'express';
import { rateLimitKey } from '../lib/net';
import { flagOffence } from './abuse';
import { audit } from '../lib/audit';
import { PrismaRateStore } from '../lib/rateStore';

/**
 * Tiered rate limiting.
 *
 * Every tier keys on `rateLimitKey`, which resolves the *real* peer address
 * (and collapses IPv6 to a /64). Keying on a forgeable header would make all
 * of this decorative.
 *
 * Exceeding a limit is itself an offence: sustained limit-breaking feeds the
 * suspicion score in lib/abuse, so a script that grinds against a limit for
 * long enough gets blocked outright rather than being allowed to retry forever.
 */

/**
 * `shared: true` counts in the database so the limit holds across every
 * instance. Reserved for the credential endpoints, where correctness is worth
 * a round trip; the high-volume limiters stay in memory as flood control.
 */
function makeLimiter(
  name: string,
  options: Partial<Options> & { windowMs: number; limit: number; shared?: boolean },
) {
  const { shared, ...rest } = options;
  return rateLimit({
    ...(shared ? { store: new PrismaRateStore(name) } : {}),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: rateLimitKey,
    // We resolve the client ourselves, so express-rate-limit's own trust-proxy
    // heuristics have nothing to validate.
    validate: { trustProxy: false, xForwardedForHeader: false },
    handler: (req: Request, res: Response) => {
      flagOffence(req, 'rate_limited', `${name} ${req.method} ${req.path.slice(0, 80)}`);
      audit(req, 'abuse.rate_limited', { detail: `${name}: ${req.method} ${req.path.slice(0, 100)}`, ok: false });
      const retryAfter = Math.ceil(options.windowMs / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests. Please slow down and try again shortly.',
          retryAfterSeconds: retryAfter,
        },
      });
    },
    ...rest,
  });
}

/**
 * Credential endpoints. Deliberately tight — combined with the persisted
 * account lockout, an online password guess is limited to a few attempts per
 * quarter hour, which makes brute force infeasible against a strong password.
 *
 * Successful sign-ins are not counted, so normal use never trips it.
 */
export const loginLimiter = makeLimiter('login', {
  windowMs: 15 * 60_000,
  limit: 10,
  skipSuccessfulRequests: true,
  shared: true,
});

/** Short unlock codes deserve an even smaller budget than passwords. */
export const unlockLimiter = makeLimiter('unlock', {
  windowMs: 10 * 60_000,
  limit: 12,
  skipSuccessfulRequests: true,
  shared: true,
});

/**
 * Account creation. TarangOS allows exactly one account and the endpoint 403s
 * once it exists, so this exists to stop a race at first boot and to make
 * hammering the endpoint pointless.
 */
export const signupLimiter = makeLimiter('signup', {
  windowMs: 60 * 60_000,
  limit: 5,
  shared: true,
});

/** Everything else under /api. Generous enough to be invisible in real use. */
export const apiLimiter = makeLimiter('api', {
  windowMs: 60_000,
  limit: 300,
});

/**
 * Mutations. A person cannot meaningfully create more than a couple of hundred
 * records a minute by hand; a script trying to fill the database can.
 */
export const writeLimiter = makeLimiter('write', {
  windowMs: 60_000,
  limit: 120,
});

/**
 * Expensive analytical reads — a year of history, heatmaps, calendar spans.
 * These fan out across the whole dataset, so they are the natural target for
 * anyone trying to scrape it or to exhaust the machine.
 */
export const analyticsLimiter = makeLimiter('analytics', {
  windowMs: 60_000,
  limit: 40,
});

/**
 * Search and list endpoints, which are what a scraper actually walks to pull
 * data out in bulk.
 */
export const searchLimiter = makeLimiter('search', {
  windowMs: 60_000,
  limit: 60,
});

/**
 * Generation-style endpoints: natural-language parsing and planning.
 *
 * These are the closest thing TarangOS has to "AI generation" today — they run
 * a parser rather than a model — but they are the endpoints that would be
 * swapped for a language model later, so they get their own strict budget now.
 * If a real model is ever wired in, its cost lands behind this limiter and
 * nothing else needs to change.
 */
export const generationLimiter = makeLimiter('generation', {
  windowMs: 60_000,
  limit: 30,
});

/** Bulk data movement: restore, import, export. Rare by nature, costly by size. */
export const heavyLimiter = makeLimiter('bulk-data', {
  windowMs: 60 * 60_000,
  limit: 20,
  shared: true,
});
