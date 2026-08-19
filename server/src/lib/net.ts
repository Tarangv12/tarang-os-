import type { Request } from 'express';
import { config } from '../config';

/**
 * Trustworthy client identity.
 *
 * `X-Forwarded-For` is attacker-controlled unless a proxy we trust set it. If
 * rate limiting keys on a spoofable header, it is not rate limiting at all —
 * an attacker just sends a new value per request and gets a fresh budget every
 * time. So the header is honoured *only* when TRUST_PROXY is explicitly on;
 * otherwise we use the TCP peer address, which cannot be forged over a
 * completed handshake.
 */

function normalize(raw: string): string {
  let ip = (raw || '').trim();
  // IPv4-mapped IPv6, e.g. "::ffff:192.168.1.9"
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  // Strip an IPv6 zone index, e.g. "fe80::1%eth0"
  const zone = ip.indexOf('%');
  if (zone !== -1) ip = ip.slice(0, zone);
  return ip.toLowerCase().slice(0, 64);
}

/** The real peer address, ignoring any header we have no reason to trust. */
export function clientIp(req: Request): string {
  if (config.trustProxy) {
    // Express parses X-Forwarded-For itself once `trust proxy` is set, applying
    // the configured hop count rather than blindly taking the first entry.
    const viaProxy = req.ip;
    if (viaProxy) return normalize(viaProxy);
  }
  return normalize(req.socket?.remoteAddress || '');
}

/**
 * The key abuse controls are counted against.
 *
 * A single attacker is routinely handed a whole IPv6 /64, so counting per
 * address would let them rotate through billions of buckets. Collapsing to the
 * /64 makes the limit mean something. IPv4 is counted per address.
 */
export function rateLimitKey(req: Request): string {
  const ip = clientIp(req);
  if (!ip) return 'unknown';
  if (!ip.includes(':')) return ip; // IPv4

  const expanded = expandIpv6(ip);
  if (!expanded) return ip;
  return `${expanded.slice(0, 4).join(':')}::/64`;
}

function expandIpv6(ip: string): string[] | null {
  const halves = ip.split('::');
  if (halves.length > 2) return null;

  const head = halves[0] ? halves[0].split(':').filter(Boolean) : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':').filter(Boolean) : [];
  if (head.length + tail.length > 8) return null;

  const groups =
    halves.length === 2
      ? [...head, ...Array(8 - head.length - tail.length).fill('0'), ...tail]
      : head;

  return groups.length === 8 ? groups.map((g) => g.padStart(4, '0')) : null;
}

export function userAgent(req: Request): string {
  return String(req.headers['user-agent'] || '').slice(0, 256);
}

/** Loopback is the machine owner — never auto-banned, so you cannot lock yourself out. */
export function isLoopback(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip.startsWith('127.');
}
