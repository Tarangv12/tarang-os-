import type { Request, Response } from 'express';
import type { Session, User } from '@prisma/client';
import { prisma } from './db';
import { config } from '../config';
import { randomToken, sha256 } from './crypto';
import { clientIp, userAgent } from './audit';

export const COOKIE = config.cookie.name;

function cookieOptions(maxAgeMs: number) {
  return {
    httpOnly: true as const,
    secure: config.cookie.secure,
    sameSite: config.cookie.sameSite,
    path: '/',
    maxAge: maxAgeMs,
  };
}

export type IssuedSession = { session: Session; token: string; csrfToken: string };

export async function createSession(req: Request, res: Response, user: User, label = ''): Promise<IssuedSession> {
  const token = randomToken(48);
  const csrfToken = randomToken(24);
  const now = Date.now();
  const idleMs = config.session.idleMinutes * 60_000;
  const absoluteMs = config.session.absoluteDays * 86_400_000;

  const session = await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: sha256(token),
      csrfToken,
      expiresAt: new Date(now + idleMs),
      absoluteExpiresAt: new Date(now + absoluteMs),
      ip: clientIp(req),
      userAgent: userAgent(req),
      label: label.slice(0, 80),
    },
  });

  res.cookie(COOKIE, token, cookieOptions(Math.min(idleMs, absoluteMs)));
  return { session, token, csrfToken };
}

export async function readSession(req: Request): Promise<(Session & { user: User }) | null> {
  const raw = req.cookies?.[COOKIE];
  if (!raw || typeof raw !== 'string') return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(raw) },
    include: { user: true },
  });
  if (!session) return null;

  const now = new Date();
  if (session.revokedAt || session.expiresAt <= now || session.absoluteExpiresAt <= now) {
    await prisma.session.deleteMany({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  return session;
}

/**
 * Slides the idle window forward and applies the inactivity auto-lock.
 * Writes are throttled to once a minute to avoid a DB round-trip per request.
 */
export async function touchSession(session: Session): Promise<Session> {
  const now = new Date();
  const idleForMinutes = (now.getTime() - session.lastSeenAt.getTime()) / 60_000;

  if (!session.lockedAt && config.session.autoLockMinutes > 0 && idleForMinutes >= config.session.autoLockMinutes) {
    return prisma.session.update({
      where: { id: session.id },
      data: { lockedAt: now, lastSeenAt: now },
    });
  }

  if (idleForMinutes < 1) return session;

  const nextExpiry = new Date(
    Math.min(
      now.getTime() + config.session.idleMinutes * 60_000,
      session.absoluteExpiresAt.getTime(),
    ),
  );
  return prisma.session.update({
    where: { id: session.id },
    data: { lastSeenAt: now, expiresAt: nextExpiry },
  });
}

/** Rotates the cookie token — called after privilege changes (login, unlock, password change). */
export async function rotateSession(res: Response, session: Session): Promise<string> {
  const token = randomToken(48);
  const now = Date.now();
  const idleMs = config.session.idleMinutes * 60_000;
  await prisma.session.update({
    where: { id: session.id },
    data: {
      tokenHash: sha256(token),
      lastSeenAt: new Date(now),
      expiresAt: new Date(Math.min(now + idleMs, session.absoluteExpiresAt.getTime())),
    },
  });
  res.cookie(COOKIE, token, cookieOptions(idleMs));
  return token;
}

export async function lockSession(sessionId: string): Promise<void> {
  await prisma.session.update({ where: { id: sessionId }, data: { lockedAt: new Date() } });
}

export async function unlockSession(sessionId: string): Promise<void> {
  await prisma.session.update({
    where: { id: sessionId },
    data: { lockedAt: null, lastSeenAt: new Date() },
  });
}

export async function destroySession(res: Response, sessionId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { id: sessionId } });
  res.clearCookie(COOKIE, { path: '/' });
}

export async function revokeAllSessions(userId: string, exceptId?: string): Promise<number> {
  const result = await prisma.session.deleteMany({
    where: { userId, ...(exceptId ? { id: { not: exceptId } } : {}) },
  });
  return result.count;
}

export async function purgeExpiredSessions(): Promise<void> {
  const now = new Date();
  await prisma.session.deleteMany({
    where: { OR: [{ expiresAt: { lte: now } }, { absoluteExpiresAt: { lte: now } }] },
  });
}
