import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * TarangOS configuration.
 *
 * Secrets are read from the environment when provided. If they are absent we
 * generate them once and persist them to `<data>/.secrets.json` with 0600
 * permissions so a `docker compose up -d` first run is still cryptographically
 * sound instead of falling back to a hardcoded default.
 */

const SERVER_ROOT = path.resolve(__dirname, '..');
const PROJECT_ROOT = path.resolve(SERVER_ROOT, '..');

/**
 * Minimal .env loader (no dependency). Real environment variables always win,
 * so Docker/systemd/PowerShell values are never clobbered by a stale file.
 */
function loadEnvFile(file: string): void {
  if (!fs.existsSync(file)) return;
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile(path.join(SERVER_ROOT, '.env'));
loadEnvFile(path.join(PROJECT_ROOT, '.env'));

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'file:../../data/tarangos.db';
}

export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(PROJECT_ROOT, 'data');

export const BACKUP_DIR = path.resolve(DATA_DIR, 'backups');
export const WEB_DIST = process.env.WEB_DIST
  ? path.resolve(process.env.WEB_DIST)
  : path.resolve(PROJECT_ROOT, 'web', 'dist');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(BACKUP_DIR, { recursive: true });

type Secrets = { encryptionKey: string; sessionPepper: string };

function loadSecrets(): Secrets {
  const fromEnv: Partial<Secrets> = {
    encryptionKey: process.env.ENCRYPTION_KEY,
    sessionPepper: process.env.SESSION_PEPPER,
  };
  if (fromEnv.encryptionKey && fromEnv.sessionPepper) {
    return fromEnv as Secrets;
  }

  const file = path.join(DATA_DIR, '.secrets.json');
  let stored: Partial<Secrets> = {};
  if (fs.existsSync(file)) {
    try {
      stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      stored = {};
    }
  }

  const merged: Secrets = {
    encryptionKey:
      fromEnv.encryptionKey || stored.encryptionKey || crypto.randomBytes(32).toString('hex'),
    sessionPepper:
      fromEnv.sessionPepper || stored.sessionPepper || crypto.randomBytes(32).toString('hex'),
  };

  if (merged.encryptionKey !== stored.encryptionKey || merged.sessionPepper !== stored.sessionPepper) {
    fs.writeFileSync(file, JSON.stringify(merged, null, 2), { mode: 0o600 });
    try {
      fs.chmodSync(file, 0o600);
    } catch {
      /* windows */
    }
  }
  return merged;
}

const secrets = loadSecrets();

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function int(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  env: process.env.NODE_ENV || 'development',
  isProd: (process.env.NODE_ENV || 'development') === 'production',
  port: int(process.env.PORT, 4517),
  host: process.env.HOST || '0.0.0.0',

  dataDir: DATA_DIR,
  backupDir: BACKUP_DIR,
  webDist: WEB_DIST,

  encryptionKey: Buffer.from(secrets.encryptionKey, 'hex').subarray(0, 32),
  sessionPepper: secrets.sessionPepper,

  /** Optional TLS for encrypted access from your phone over the LAN. */
  tls: {
    keyFile: process.env.TLS_KEY_FILE || '',
    certFile: process.env.TLS_CERT_FILE || '',
  },

  cookie: {
    name: process.env.COOKIE_NAME || 'tarang_sid',
    /** Set ALLOW_INSECURE_COOKIE=true only for plain-HTTP access on a trusted LAN. */
    secure: !bool(process.env.ALLOW_INSECURE_COOKIE, false),
    sameSite: (process.env.COOKIE_SAMESITE as 'strict' | 'lax') || 'strict',
  },

  session: {
    /** Sliding window: a session stays alive while you keep using it. */
    idleMinutes: int(process.env.SESSION_IDLE_MINUTES, 60 * 12),
    /** Hard ceiling regardless of activity. */
    absoluteDays: int(process.env.SESSION_ABSOLUTE_DAYS, 30),
    /** After this much inactivity the session locks and needs PIN/password. */
    autoLockMinutes: int(process.env.AUTO_LOCK_MINUTES, 20),
  },

  auth: {
    maxFailedLogins: int(process.env.MAX_FAILED_LOGINS, 7),
    lockoutMinutes: int(process.env.LOCKOUT_MINUTES, 15),
    minPasswordLength: int(process.env.MIN_PASSWORD_LENGTH, 12),
    /** Bootstrap credentials for the very first run (optional). */
    bootstrapUsername: process.env.ADMIN_USERNAME || '',
    bootstrapPassword: process.env.ADMIN_PASSWORD || '',
  },

  backup: {
    autoDaily: bool(process.env.AUTO_BACKUP, true),
    keep: int(process.env.BACKUP_KEEP, 30),
  },

  trustProxy: bool(process.env.TRUST_PROXY, false),
  /** Extra origins allowed to call the API (the SPA is same-origin in prod). */
  extraOrigins: (process.env.EXTRA_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};

export type Config = typeof config;
