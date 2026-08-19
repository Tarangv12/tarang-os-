import type { NextFunction, Request, Response } from 'express';
import type { Session, User } from '@prisma/client';
import { ApiError } from '../lib/errors';
import { readSession, touchSession } from '../lib/session';
import { safeEqual } from '../lib/crypto';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      session?: Session;
      user?: User;
    }
  }
}

/** Attaches `req.session` / `req.user` when a valid cookie is present. */
export async function loadSession(req: Request, _res: Response, next: NextFunction) {
  try {
    const found = await readSession(req);
    if (found) {
      const touched = await touchSession(found);
      req.session = touched;
      req.user = found.user;
    }
    next();
  } catch (err) {
    next(err);
  }
}

/** Requires a valid session. Locked sessions are rejected with 423. */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.session || !req.user) return next(ApiError.unauthorized());
  if (req.session.lockedAt) return next(ApiError.locked('Locked after inactivity — unlock to continue'));
  next();
}

/** Requires a session but tolerates the locked state (used by /unlock, /me, /logout). */
export function requireSession(req: Request, _res: Response, next: NextFunction) {
  if (!req.session || !req.user) return next(ApiError.unauthorized());
  next();
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence-in-depth. SameSite=strict cookies already block cross-site
 * submission; this adds a per-session token that must be echoed in a header,
 * which a cross-origin page cannot read.
 */
export function csrfProtect(req: Request, _res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (!req.session) return next(ApiError.unauthorized());
  const header = req.get('x-csrf-token') || '';
  if (!header || !safeEqual(header, req.session.csrfToken)) {
    return next(ApiError.forbidden('CSRF token missing or invalid', 'CSRF_FAILED'));
  }
  next();
}

/** Blocks requests whose Origin is neither same-origin nor explicitly allowed. */
export function originGuard(allowed: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = req.get('origin');
    if (!origin) return next(); // same-origin form/fetch or native client
    const host = req.get('host');
    let originHost = '';
    try {
      originHost = new URL(origin).host;
    } catch {
      return next(ApiError.forbidden('Bad origin', 'BAD_ORIGIN'));
    }
    if (originHost === host) return next();
    if (allowed.some((a) => a === origin || a === originHost)) return next();
    next(ApiError.forbidden('Cross-origin request blocked', 'BAD_ORIGIN'));
  };
}
