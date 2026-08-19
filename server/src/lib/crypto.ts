import crypto from 'node:crypto';
import { config } from '../config';

/**
 * All primitives here come from Node's built-in crypto module — no native
 * add-ons, so `npm install` never needs a compiler and the security surface
 * stays auditable.
 */

const SCRYPT_N = 1 << 15; // 32768
const SCRYPT_r = 8;
const SCRYPT_p = 2;
const KEY_LEN = 64;
const MAX_MEM = 128 * SCRYPT_N * SCRYPT_r * 2;

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      password.normalize('NFKC'),
      salt,
      KEY_LEN,
      { N: SCRYPT_N, r: SCRYPT_r, p: SCRYPT_p, maxmem: MAX_MEM },
      (err, derived) => (err ? reject(err) : resolve(derived as Buffer)),
    );
  });
}

/** Format: scrypt$N$r$p$saltHex$hashHex */
export async function hashSecret(plain: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const derived = await scryptAsync(plain + config.sessionPepper, salt);
  return `scrypt$${SCRYPT_N}$${SCRYPT_r}$${SCRYPT_p}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export async function verifySecret(plain: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4], 'hex');
  const expected = Buffer.from(parts[5], 'hex');
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

  const derived: Buffer = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(
      (plain + config.sessionPepper).normalize('NFKC'),
      salt,
      expected.length,
      { N, r, p, maxmem: 128 * N * r * 2 },
      (err, out) => (err ? reject(err) : resolve(out as Buffer)),
    );
  }).catch(() => Buffer.alloc(0));

  if (derived.length !== expected.length || derived.length === 0) return false;
  return crypto.timingSafeEqual(derived, expected);
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// --------------------------------------------------------------------------
// AES-256-GCM — used for secrets we must be able to read back (TOTP seed).
// --------------------------------------------------------------------------

export function encryptString(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', config.encryptionKey, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${enc.toString('base64url')}`;
}

export function decryptString(payload: string | null | undefined): string | null {
  if (!payload) return null;
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return null;
  try {
    const iv = Buffer.from(parts[1], 'base64url');
    const tag = Buffer.from(parts[2], 'base64url');
    const data = Buffer.from(parts[3], 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', config.encryptionKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

// --------------------------------------------------------------------------
// TOTP (RFC 6238) — compatible with Google Authenticator / Aegis / 1Password.
// --------------------------------------------------------------------------

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

export function totpCode(secretBase32: string, counter: number, digits = 6): string {
  const key = base32Decode(secretBase32);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (binary % 10 ** digits).toString().padStart(digits, '0');
}

/** Accepts the current step plus one step either side (±30s clock drift). */
export function verifyTotp(secretBase32: string, token: string, window = 1): boolean {
  const cleaned = (token || '').replace(/\D/g, '');
  if (cleaned.length !== 6) return false;
  const counter = Math.floor(Date.now() / 1000 / 30);
  for (let i = -window; i <= window; i++) {
    if (safeEqual(totpCode(secretBase32, counter + i), cleaned)) return true;
  }
  return false;
}

export function otpauthUrl(secretBase32: string, account: string, issuer = 'TarangOS'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const raw = crypto.randomBytes(5).toString('hex').toUpperCase();
    return `${raw.slice(0, 5)}-${raw.slice(5, 10)}`;
  });
}
