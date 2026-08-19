import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db';
import { config } from '../config';
import { ApiError, ah } from '../lib/errors';
import { audit } from '../lib/audit';
import {
  createSession,
  destroySession,
  lockSession,
  revokeAllSessions,
  rotateSession,
  unlockSession,
} from '../lib/session';
import {
  decryptString,
  encryptString,
  generateRecoveryCodes,
  generateTotpSecret,
  hashSecret,
  otpauthUrl,
  verifySecret,
  verifyTotp,
} from '../lib/crypto';
import { adminExists, getAdmin, passwordProblems, publicUser } from '../lib/user';
import { listBlocks, unblockAll, unblockIp } from '../lib/abuse';
import { loginLimiter, signupLimiter, unlockLimiter } from '../middleware/rateLimit';
import { csrfProtect, requireAuth, requireSession } from '../middleware/auth';

export const authRouter = Router();

const usernameSchema = z
  .string()
  .trim()
  .min(3, 'Username needs at least 3 characters')
  .max(40)
  .regex(/^[a-zA-Z0-9._-]+$/, 'Use letters, numbers, dot, underscore or hyphen only');

/** Deliberately slow-ish comparison target so a missing account and a wrong
 *  password take a similar amount of time. */
const DUMMY_HASH =
  'scrypt$32768$8$2$00000000000000000000000000000000$' + '0'.repeat(128);

// ---------------------------------------------------------------------------
// Status + first-run bootstrap
// ---------------------------------------------------------------------------

authRouter.get(
  '/status',
  ah(async (_req, res) => {
    const exists = await adminExists();
    res.json({
      initialized: exists,
      minPasswordLength: config.auth.minPasswordLength,
      autoLockMinutes: config.session.autoLockMinutes,
    });
  }),
);

/** Creates the one and only account. Refuses once an account exists. */
authRouter.post(
  '/bootstrap',
  signupLimiter,
  ah(async (req, res) => {
    if (await adminExists()) {
      audit(req, 'auth.bootstrap.blocked', { ok: false });
      throw ApiError.forbidden('This TarangOS instance is already set up', 'ALREADY_INITIALIZED');
    }

    const body = z
      .object({
        username: usernameSchema,
        password: z.string(),
        displayName: z.string().trim().max(60).optional(),
        timezone: z.string().trim().max(64).optional(),
      })
      .parse(req.body);

    const problems = passwordProblems(body.password, body.username);
    if (problems.length) throw ApiError.badRequest('Password is not strong enough', problems);

    const user = await prisma.user.create({
      data: {
        username: body.username,
        displayName: body.displayName || body.username,
        passwordHash: await hashSecret(body.password),
        timezone: body.timezone || 'Asia/Kolkata',
        lastLoginAt: new Date(),
      },
    });

    const { csrfToken } = await createSession(req, res, user, 'first sign-in');
    audit(req, 'auth.bootstrap', { userId: user.id });
    res.status(201).json({ user: publicUser(user), csrfToken });
  }),
);

// ---------------------------------------------------------------------------
// Login / logout
// ---------------------------------------------------------------------------

authRouter.post(
  '/login',
  loginLimiter,
  ah(async (req, res) => {
    const body = z
      .object({
        username: z.string().trim().min(1).max(64),
        password: z.string().min(1).max(200),
        totp: z.string().trim().max(12).optional(),
        recoveryCode: z.string().trim().max(32).optional(),
      })
      .parse(req.body);

    const user = await getAdmin();

    if (!user || user.username.toLowerCase() !== body.username.toLowerCase()) {
      await verifySecret(body.password, DUMMY_HASH);
      audit(req, 'auth.login.failed', { detail: 'unknown account', ok: false });
      throw ApiError.unauthorized('Incorrect username or password', 'BAD_CREDENTIALS');
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const mins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
      audit(req, 'auth.login.locked', { userId: user.id, ok: false });
      throw new ApiError(423, 'ACCOUNT_LOCKED', `Too many failed attempts. Try again in ${mins} min.`);
    }

    const passwordOk = await verifySecret(body.password, user.passwordHash);
    if (!passwordOk) {
      const failed = user.failedLogins + 1;
      const lock = failed >= config.auth.maxFailedLogins;
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLogins: lock ? 0 : failed,
          lockedUntil: lock ? new Date(Date.now() + config.auth.lockoutMinutes * 60_000) : null,
        },
      });
      audit(req, 'auth.login.failed', { userId: user.id, detail: `attempt ${failed}`, ok: false });
      if (lock) {
        throw new ApiError(
          423,
          'ACCOUNT_LOCKED',
          `Too many failed attempts. Locked for ${config.auth.lockoutMinutes} minutes.`,
        );
      }
      throw ApiError.unauthorized('Incorrect username or password', 'BAD_CREDENTIALS');
    }

    // Second factor
    if (user.totpEnabled) {
      const secret = decryptString(user.totpSecret);
      const codeOk = body.totp && secret ? verifyTotp(secret, body.totp) : false;
      let recoveryOk = false;

      if (!codeOk && body.recoveryCode) {
        const stored: string[] = JSON.parse(user.recoveryCodes || '[]');
        const normalized = body.recoveryCode.trim().toUpperCase();
        for (let i = 0; i < stored.length; i++) {
          // eslint-disable-next-line no-await-in-loop
          if (await verifySecret(normalized, stored[i])) {
            stored.splice(i, 1);
            await prisma.user.update({
              where: { id: user.id },
              data: { recoveryCodes: JSON.stringify(stored) },
            });
            recoveryOk = true;
            audit(req, 'auth.recovery_code.used', {
              userId: user.id,
              detail: `${stored.length} remaining`,
            });
            break;
          }
        }
      }

      if (!codeOk && !recoveryOk) {
        if (!body.totp && !body.recoveryCode) {
          res.status(401).json({
            error: { code: 'TOTP_REQUIRED', message: 'Enter your authenticator code' },
          });
          return;
        }
        audit(req, 'auth.login.failed', { userId: user.id, detail: 'bad 2fa', ok: false });
        throw ApiError.unauthorized('That code is not valid', 'BAD_TOTP');
      }
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    const { csrfToken } = await createSession(req, res, updated);
    audit(req, 'auth.login', { userId: user.id });
    res.json({ user: publicUser(updated), csrfToken });
  }),
);

authRouter.post(
  '/logout',
  requireSession,
  csrfProtect,
  ah(async (req, res) => {
    await destroySession(res, req.session!.id);
    audit(req, 'auth.logout', { userId: req.user!.id });
    res.json({ ok: true });
  }),
);

authRouter.get(
  '/me',
  requireSession,
  ah(async (req, res) => {
    res.json({
      user: publicUser(req.user!),
      csrfToken: req.session!.csrfToken,
      locked: Boolean(req.session!.lockedAt),
      autoLockMinutes: config.session.autoLockMinutes,
      session: {
        id: req.session!.id,
        createdAt: req.session!.createdAt,
        expiresAt: req.session!.expiresAt,
      },
    });
  }),
);

// ---------------------------------------------------------------------------
// Lock / unlock
// ---------------------------------------------------------------------------

authRouter.post(
  '/lock',
  requireSession,
  csrfProtect,
  ah(async (req, res) => {
    await lockSession(req.session!.id);
    audit(req, 'auth.lock', { userId: req.user!.id });
    res.json({ ok: true, locked: true });
  }),
);

authRouter.post(
  '/unlock',
  unlockLimiter,
  requireSession,
  csrfProtect,
  ah(async (req, res) => {
    const body = z.object({ pin: z.string().max(24).optional(), password: z.string().max(200).optional() }).parse(req.body);
    const user = req.user!;

    let ok = false;
    if (body.pin && user.pinHash) ok = await verifySecret(body.pin, user.pinHash);
    if (!ok && body.password) ok = await verifySecret(body.password, user.passwordHash);

    if (!ok) {
      audit(req, 'auth.unlock.failed', { userId: user.id, ok: false });
      throw ApiError.unauthorized('Incorrect PIN or password', 'BAD_CREDENTIALS');
    }

    await unlockSession(req.session!.id);
    await rotateSession(res, req.session!);
    audit(req, 'auth.unlock', { userId: user.id });
    res.json({ ok: true, locked: false, csrfToken: req.session!.csrfToken });
  }),
);

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

authRouter.post(
  '/change-password',
  requireAuth,
  csrfProtect,
  ah(async (req, res) => {
    const body = z
      .object({
        currentPassword: z.string().min(1).max(200),
        newPassword: z.string().max(200),
        signOutOthers: z.boolean().optional().default(true),
      })
      .parse(req.body);

    const user = req.user!;
    if (!(await verifySecret(body.currentPassword, user.passwordHash))) {
      audit(req, 'auth.password.failed', { userId: user.id, ok: false });
      throw ApiError.unauthorized('Current password is incorrect', 'BAD_CREDENTIALS');
    }
    const problems = passwordProblems(body.newPassword, user.username);
    if (problems.length) throw ApiError.badRequest('Password is not strong enough', problems);
    if (await verifySecret(body.newPassword, user.passwordHash)) {
      throw ApiError.badRequest('Choose a password you have not used here before');
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashSecret(body.newPassword), passwordChangedAt: new Date() },
    });
    if (body.signOutOthers) await revokeAllSessions(user.id, req.session!.id);
    await rotateSession(res, req.session!);

    audit(req, 'auth.password.changed', { userId: user.id });
    res.json({ ok: true, csrfToken: req.session!.csrfToken });
  }),
);

authRouter.post(
  '/pin',
  requireAuth,
  csrfProtect,
  ah(async (req, res) => {
    const body = z
      .object({
        password: z.string().min(1).max(200),
        pin: z.string().regex(/^\d{4,12}$/, 'PIN must be 4–12 digits').nullable(),
      })
      .parse(req.body);

    const user = req.user!;
    if (!(await verifySecret(body.password, user.passwordHash))) {
      throw ApiError.unauthorized('Password is incorrect', 'BAD_CREDENTIALS');
    }
    if (body.pin && /^(\d)\1+$/.test(body.pin)) {
      throw ApiError.badRequest('Choose a less predictable PIN');
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { pinHash: body.pin ? await hashSecret(body.pin) : null },
    });
    audit(req, body.pin ? 'auth.pin.set' : 'auth.pin.removed', { userId: user.id });
    res.json({ ok: true, hasPin: Boolean(body.pin) });
  }),
);

// ---------------------------------------------------------------------------
// Two-factor authentication
// ---------------------------------------------------------------------------

authRouter.post(
  '/2fa/setup',
  requireAuth,
  csrfProtect,
  ah(async (req, res) => {
    const body = z.object({ password: z.string().min(1).max(200) }).parse(req.body);
    const user = req.user!;
    if (!(await verifySecret(body.password, user.passwordHash))) {
      throw ApiError.unauthorized('Password is incorrect', 'BAD_CREDENTIALS');
    }
    const secret = generateTotpSecret();
    await prisma.user.update({
      where: { id: user.id },
      data: { totpSecret: encryptString(secret), totpEnabled: false },
    });
    audit(req, 'auth.2fa.setup_started', { userId: user.id });
    res.json({ secret, otpauthUrl: otpauthUrl(secret, user.username) });
  }),
);

authRouter.post(
  '/2fa/enable',
  requireAuth,
  csrfProtect,
  ah(async (req, res) => {
    const body = z.object({ code: z.string().min(6).max(8) }).parse(req.body);
    const user = req.user!;
    const secret = decryptString(user.totpSecret);
    if (!secret) throw ApiError.badRequest('Start the setup first');
    if (!verifyTotp(secret, body.code)) throw ApiError.badRequest('That code is not valid — check your clock and try again');

    const codes = generateRecoveryCodes(10);
    const hashed = await Promise.all(codes.map((c) => hashSecret(c)));
    await prisma.user.update({
      where: { id: user.id },
      data: { totpEnabled: true, recoveryCodes: JSON.stringify(hashed) },
    });
    audit(req, 'auth.2fa.enabled', { userId: user.id });
    res.json({ ok: true, recoveryCodes: codes });
  }),
);

authRouter.post(
  '/2fa/disable',
  requireAuth,
  csrfProtect,
  ah(async (req, res) => {
    const body = z.object({ password: z.string().min(1).max(200), code: z.string().max(8).optional() }).parse(req.body);
    const user = req.user!;
    if (!(await verifySecret(body.password, user.passwordHash))) {
      throw ApiError.unauthorized('Password is incorrect', 'BAD_CREDENTIALS');
    }
    const secret = decryptString(user.totpSecret);
    if (user.totpEnabled && secret && !(body.code && verifyTotp(secret, body.code))) {
      throw ApiError.badRequest('Enter a current authenticator code to turn 2FA off');
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { totpEnabled: false, totpSecret: null, recoveryCodes: null },
    });
    audit(req, 'auth.2fa.disabled', { userId: user.id });
    res.json({ ok: true });
  }),
);

authRouter.post(
  '/2fa/recovery-codes',
  requireAuth,
  csrfProtect,
  ah(async (req, res) => {
    const body = z.object({ password: z.string().min(1).max(200) }).parse(req.body);
    const user = req.user!;
    if (!(await verifySecret(body.password, user.passwordHash))) {
      throw ApiError.unauthorized('Password is incorrect', 'BAD_CREDENTIALS');
    }
    if (!user.totpEnabled) throw ApiError.badRequest('Enable two-factor authentication first');
    const codes = generateRecoveryCodes(10);
    const hashed = await Promise.all(codes.map((c) => hashSecret(c)));
    await prisma.user.update({ where: { id: user.id }, data: { recoveryCodes: JSON.stringify(hashed) } });
    audit(req, 'auth.2fa.recovery_regenerated', { userId: user.id });
    res.json({ recoveryCodes: codes });
  }),
);

// ---------------------------------------------------------------------------
// Devices & activity
// ---------------------------------------------------------------------------

authRouter.get(
  '/sessions',
  requireAuth,
  ah(async (req, res) => {
    const sessions = await prisma.session.findMany({
      where: { userId: req.user!.id },
      orderBy: { lastSeenAt: 'desc' },
    });
    res.json({
      sessions: sessions.map((s) => ({
        id: s.id,
        current: s.id === req.session!.id,
        ip: s.ip,
        userAgent: s.userAgent,
        label: s.label,
        createdAt: s.createdAt,
        lastSeenAt: s.lastSeenAt,
        expiresAt: s.expiresAt,
        locked: Boolean(s.lockedAt),
      })),
    });
  }),
);

authRouter.delete(
  '/sessions/:id',
  requireAuth,
  csrfProtect,
  ah(async (req, res) => {
    if (req.params.id === req.session!.id) throw ApiError.badRequest('Use sign out for this device');
    await prisma.session.deleteMany({ where: { id: req.params.id, userId: req.user!.id } });
    audit(req, 'auth.session.revoked', { userId: req.user!.id, detail: req.params.id });
    res.json({ ok: true });
  }),
);

authRouter.post(
  '/sessions/revoke-others',
  requireAuth,
  csrfProtect,
  ah(async (req, res) => {
    const count = await revokeAllSessions(req.user!.id, req.session!.id);
    audit(req, 'auth.sessions.revoked_all', { userId: req.user!.id, detail: `${count} revoked` });
    res.json({ ok: true, revoked: count });
  }),
);

/** Sources currently blocked for abusive traffic. */
authRouter.get(
  '/blocks',
  requireAuth,
  ah(async (_req, res) => {
    const blocks = await listBlocks();
    res.json({
      blocks: blocks.map((b) => ({
        ip: b.ip,
        reason: b.reason,
        detail: b.detail,
        strikes: b.strikes,
        hits: b.hits,
        userAgent: b.userAgent,
        blockedAt: b.blockedAt,
        expiresAt: b.expiresAt,
        lastSeenAt: b.lastSeenAt,
      })),
    });
  }),
);

authRouter.delete(
  '/blocks/:ip',
  requireAuth,
  csrfProtect,
  ah(async (req, res) => {
    const removed = await unblockIp(req.params.ip);
    audit(req, 'abuse.unblocked', { userId: req.user!.id, detail: req.params.ip });
    res.json({ ok: true, removed });
  }),
);

authRouter.post(
  '/blocks/clear',
  requireAuth,
  csrfProtect,
  ah(async (req, res) => {
    const removed = await unblockAll();
    audit(req, 'abuse.unblocked_all', { userId: req.user!.id, detail: `${removed} released` });
    res.json({ ok: true, removed });
  }),
);

authRouter.get(
  '/activity',
  requireAuth,
  ah(async (req, res) => {
    const take = Math.min(Number(req.query.limit) || 100, 500);
    const logs = await prisma.auditLog.findMany({
      where: { userId: req.user!.id },
      orderBy: { at: 'desc' },
      take,
    });
    res.json({ activity: logs });
  }),
);
