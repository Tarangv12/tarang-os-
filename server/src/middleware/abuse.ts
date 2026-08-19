import type { NextFunction, Request, Response } from 'express';
import { clientIp, userAgent } from '../lib/net';
import {
  blockedFor,
  blockedForShared,
  isScannerProbe,
  looksAutomated,
  noteBlockedHit,
  recordOffence,
  blockIp,
} from '../lib/abuse';
import { audit } from '../lib/audit';

/**
 * Abuse middleware.
 *
 * Ordering matters: the block check runs before anything expensive, so a
 * blocked source costs us a map lookup rather than a database query.
 */

function retryAfterSeconds(ms: number): number {
  return Math.max(1, Math.ceil(ms / 1000));
}

/**
 * Rejects sources that are currently blocked.
 *
 * Checks this instance's memory first and only consults the shared record when
 * that comes up empty, so the common path stays a map lookup.
 */
export async function blockGuard(req: Request, res: Response, next: NextFunction) {
  const ip = clientIp(req);
  let remaining = blockedFor(ip);
  if (remaining <= 0) {
    remaining = await blockedForShared(ip).catch(() => 0);
  }
  if (remaining <= 0) return next();

  void noteBlockedHit(ip);
  res.setHeader('Retry-After', String(retryAfterSeconds(remaining)));
  res.status(429).json({
    error: {
      code: 'BLOCKED',
      message: 'Too many suspicious requests from this device. Try again later.',
      retryAfterSeconds: retryAfterSeconds(remaining),
    },
  });
}

/**
 * Traps vulnerability scanners.
 *
 * A request for /.env or /wp-login.php is never a person using TarangOS, so it
 * is treated as strong evidence of an automated attack rather than a 404.
 */
export function scannerTrap(req: Request, res: Response, next: NextFunction) {
  if (!isScannerProbe(req.path)) return next();

  const ip = clientIp(req);
  const ua = userAgent(req);

  // Scanners fire dozens of these; the weight means a couple earns a block,
  // and the block takes effect before the next request is served.
  recordOffence(ip, 'scanner_probe', req.path, ua);
  audit(req, 'abuse.scanner_probe', { detail: `${req.method} ${req.path.slice(0, 120)}`, ok: false });

  // Deliberately terse and slow to parse: give a scanner nothing to fingerprint.
  res.status(404).type('text/plain').send('Not found');
}

/**
 * Marks obviously-automated clients so they are never served indexable content
 * and are counted more harshly when they misbehave.
 *
 * This is a hint, not a gate: a User-Agent is attacker-controlled, so blocking
 * on it alone would stop honest tools while doing nothing to a real attacker.
 */
export function botHint(req: Request, _res: Response, next: NextFunction) {
  (req as Request & { automated?: boolean }).automated = looksAutomated(userAgent(req));
  next();
}

/** Records an offence and, if it tips the threshold, blocks the source at once. */
export function flagOffence(req: Request, kind: Parameters<typeof recordOffence>[1], detail = ''): void {
  const ip = clientIp(req);
  const blockedMs = recordOffence(ip, kind, detail, userAgent(req));
  if (blockedMs > 0) {
    audit(req, 'abuse.blocked', {
      detail: `${ip} blocked for ${Math.round(blockedMs / 60_000)}m after ${kind}`,
      ok: false,
    });
  }
}

/**
 * Watches responses for authentication and authorisation failures and feeds
 * them into the suspicion score. Attached once, it covers every route without
 * each handler having to remember.
 */
export function offenceWatcher(req: Request, res: Response, next: NextFunction) {
  res.on('finish', () => {
    const status = res.statusCode;
    if (status < 400) return;

    const path = req.path;
    // Only credential and permission surfaces feed the score; ordinary 404s
    // and validation errors are just people using the app.
    if (status === 401 && path.startsWith('/api/auth/login')) {
      flagOffence(req,'failed_login', path);
    } else if (status === 401 && path.startsWith('/api/auth/unlock')) {
      flagOffence(req,'failed_unlock', path);
    } else if (status === 403) {
      const code = (res as Response & { locals: { errorCode?: string } }).locals?.errorCode;
      if (code === 'BAD_ORIGIN') flagOffence(req, 'bad_origin', path);
      else if (code === 'CSRF_FAILED') flagOffence(req, 'csrf_failure', path);
    }
  });
  next();
}

/** Immediate block, used for unambiguous attacks. */
export function blockNow(req: Request, reason: string, detail = ''): void {
  const ip = clientIp(req);
  const ms = blockIp(ip, reason, detail, userAgent(req));
  if (ms > 0) {
    audit(req, 'abuse.blocked', { detail: `${ip} blocked for ${Math.round(ms / 60_000)}m (${reason})`, ok: false });
  }
}
