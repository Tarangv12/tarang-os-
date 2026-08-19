import { prisma } from './db';
import { isLoopback } from './net';

/**
 * Abuse tracking and temporary blocking.
 *
 * Rate limiting alone only slows an attacker down — they simply pace
 * themselves. This layer watches the *shape* of traffic (failed logins,
 * scanner probes, sustained limit-breaking) and takes a source out entirely
 * for a while, with the block escalating each time it is re-earned.
 *
 * Design notes:
 *  - Blocks live in the database so a restart does not reset an attacker's
 *    progress, and so the escalation level is remembered across sessions.
 *  - A small in-memory mirror keeps the hot path free of database reads.
 *  - Loopback is never auto-blocked. It is the machine's owner, and locking
 *    yourself out of your own productivity system is a worse outcome than the
 *    attack this would prevent (an attacker on your own machine already has
 *    the database file).
 */

export type OffenceKind =
  | 'failed_login'
  | 'failed_unlock'
  | 'rate_limited'
  | 'scanner_probe'
  | 'bad_origin'
  | 'csrf_failure';

/** How much each offence counts toward a block. */
const OFFENCE_WEIGHT: Record<OffenceKind, number> = {
  scanner_probe: 12, // probing /.env or /wp-login.php is never legitimate
  failed_login: 4,
  failed_unlock: 3,
  bad_origin: 6,
  csrf_failure: 6,
  rate_limited: 2,
};

/** Score at which a source is blocked. */
const BLOCK_THRESHOLD = 24;

/** Offences age out over this window, so a bad day does not haunt you. */
const SCORE_WINDOW_MS = 15 * 60_000;

/** Escalating block durations, indexed by strike count. */
const BLOCK_MINUTES = [15, 60, 6 * 60, 24 * 60];

type Offence = { at: number; weight: number };

const recent = new Map<string, Offence[]>();
/** ip -> epoch ms the block expires. This is the enforcement path. */
const blocked = new Map<string, number>();
/** ip -> how many blocks it has earned, so escalation survives a restart. */
const strikeCount = new Map<string, number>();
let loaded = false;

// ---------------------------------------------------------------------------

/** Warms the in-memory state from the database at startup. */
export async function loadBlocks(): Promise<number> {
  const now = new Date();
  await prisma.blockedIp.deleteMany({ where: { expiresAt: { lte: now } } });

  // Strike history is kept for longer than the block itself, so a source that
  // waits out a 15-minute block still starts at the next tier if it returns.
  const known = await prisma.blockedIp.findMany();
  blocked.clear();
  strikeCount.clear();
  let active = 0;
  for (const row of known) {
    strikeCount.set(row.ip, row.strikes);
    if (row.expiresAt.getTime() > now.getTime()) {
      blocked.set(row.ip, row.expiresAt.getTime());
      active += 1;
    }
  }
  loaded = true;
  return active;
}

/** Milliseconds remaining on a block, or 0 if the source is free to proceed. */
export function blockedFor(ip: string): number {
  const until = blocked.get(ip);
  if (!until) return 0;
  if (until <= Date.now()) {
    blocked.delete(ip);
    return 0;
  }
  return until - Date.now();
}

export function isBlocked(ip: string): boolean {
  return blockedFor(ip) > 0;
}

/**
 * Records an offence and blocks the source once it has done enough of them.
 * Returns the block duration in ms when this offence triggered one.
 *
 * The decision is **synchronous**: an attacker firing a tight burst must not be
 * able to slip requests through the gap between earning a block and the
 * database write completing. Persistence happens afterwards, in the background.
 */
export function recordOffence(ip: string, kind: OffenceKind, detail = '', userAgent = ''): number {
  if (!ip || isLoopback(ip)) return 0;
  if (isBlocked(ip)) return blockedFor(ip);

  const now = Date.now();
  const history = (recent.get(ip) ?? []).filter((o) => now - o.at < SCORE_WINDOW_MS);
  history.push({ at: now, weight: OFFENCE_WEIGHT[kind] });
  recent.set(ip, history);

  const score = history.reduce((sum, o) => sum + o.weight, 0);
  if (score < BLOCK_THRESHOLD) return 0;

  recent.delete(ip);
  return blockIp(ip, kind, detail, userAgent);
}

/**
 * Blocks a source, escalating if it has been blocked before.
 *
 * Takes effect the instant it is called; the database row is written
 * asynchronously purely so the block survives a restart.
 */
export function blockIp(ip: string, reason: string, detail = '', userAgent = ''): number {
  if (!ip || isLoopback(ip)) return 0;

  const strikes = Math.min((strikeCount.get(ip) ?? 0) + 1, BLOCK_MINUTES.length);
  const minutes = BLOCK_MINUTES[strikes - 1];
  const expiresAt = new Date(Date.now() + minutes * 60_000);

  // Enforce first.
  blocked.set(ip, expiresAt.getTime());
  strikeCount.set(ip, strikes);

  // Then persist, without holding up the response.
  void prisma.blockedIp
    .upsert({
      where: { ip },
      update: {
        reason,
        detail: detail.slice(0, 200),
        strikes,
        hits: { increment: 1 },
        userAgent: userAgent.slice(0, 200),
        blockedAt: new Date(),
        expiresAt,
        lastSeenAt: new Date(),
      },
      create: {
        ip,
        reason,
        detail: detail.slice(0, 200),
        strikes,
        userAgent: userAgent.slice(0, 200),
        expiresAt,
      },
    })
    .catch(() => {
      /* a block that is only held in memory is still a block */
    });

  // eslint-disable-next-line no-console
  console.warn(`[tarangos] blocked ${ip} for ${minutes}m (${reason}${detail ? `: ${detail}` : ''})`);
  return minutes * 60_000;
}

/** Counts a hit against an already-blocked source, for visibility. */
export async function noteBlockedHit(ip: string): Promise<void> {
  await prisma.blockedIp
    .updateMany({ where: { ip }, data: { hits: { increment: 1 }, lastSeenAt: new Date() } })
    .catch(() => undefined);
}

export async function unblockIp(ip: string): Promise<boolean> {
  blocked.delete(ip);
  recent.delete(ip);
  strikeCount.delete(ip);
  const result = await prisma.blockedIp.deleteMany({ where: { ip } });
  return result.count > 0;
}

export async function unblockAll(): Promise<number> {
  blocked.clear();
  recent.clear();
  strikeCount.clear();
  const result = await prisma.blockedIp.deleteMany({});
  return result.count;
}

export async function listBlocks() {
  await purgeExpiredBlocks();
  return prisma.blockedIp.findMany({ orderBy: { blockedAt: 'desc' }, take: 100 });
}

export async function purgeExpiredBlocks(): Promise<void> {
  const now = new Date();
  await prisma.blockedIp.deleteMany({ where: { expiresAt: { lte: now } } });
  for (const [ip, until] of blocked) if (until <= now.getTime()) blocked.delete(ip);
}

export function isLoaded(): boolean {
  return loaded;
}

/** Current suspicion score, exposed for diagnostics and tests. */
export function suspicionScore(ip: string): number {
  const now = Date.now();
  const history = (recent.get(ip) ?? []).filter((o) => now - o.at < SCORE_WINDOW_MS);
  return history.reduce((sum, o) => sum + o.weight, 0);
}

/** Test seam — clears all in-process state. */
export function resetAbuseState(): void {
  recent.clear();
  blocked.clear();
  strikeCount.clear();
}

// ---------------------------------------------------------------------------
// Scanner fingerprints
// ---------------------------------------------------------------------------

/**
 * Paths that only ever come from automated vulnerability scanners. TarangOS is
 * a React SPA with a single /api surface, so nothing here can be a real user
 * mistyping a URL.
 */
const SCANNER_PATHS = [
  /^\/wp-(login|admin|content|includes)/i,
  /^\/wordpress/i,
  /^\/(phpmyadmin|pma|myadmin|adminer)/i,
  /^\/\.(env|git|svn|aws|ssh|htaccess|DS_Store)/i,
  /^\/(config|configuration|settings)\.(php|json|yml|yaml|ini|bak)$/i,
  /^\/(admin|administrator|manager)\/?(login|html)?$/i,
  /^\/(cgi-bin|vendor|node_modules|\.well-known\/security)/i,
  /^\/(shell|cmd|eval|backdoor|webshell)/i,
  /\.(php|asp|aspx|jsp|cgi|pl|sh|exe|dll)$/i,
  /^\/(actuator|solr|jenkins|struts|druid|hudson)/i,
  /^\/(owa|autodiscover|ecp|exchange)/i,
  /^\/api\/(v[0-9]+\/)?(users|accounts|admin|graphql|swagger|openapi)/i,
  /\/\.\.(\/|%2f)/i, // traversal attempts
];

export function isScannerProbe(path: string): boolean {
  return SCANNER_PATHS.some((pattern) => pattern.test(path));
}

/**
 * User agents belonging to crawlers and scraping frameworks.
 *
 * These are *not* blocked outright — a header is trivially forged, so treating
 * it as an authorisation decision would be theatre. It is used to deny
 * indexing and to weight suspicion, nothing more.
 */
const BOT_AGENTS =
  /(bot|crawler|spider|scrape|curl|wget|python-requests|python-urllib|go-http-client|java\/|libwww|httpclient|okhttp|axios\/|node-fetch|postman|insomnia|headless|phantomjs|puppeteer|playwright|selenium|nikto|sqlmap|nmap|masscan|zgrab|semrush|ahrefs|mj12|dotbot)/i;

export function looksAutomated(userAgent: string): boolean {
  if (!userAgent.trim()) return true; // real browsers always send one
  return BOT_AGENTS.test(userAgent);
}
