/**
 * End-to-end abuse-protection tests against a running server.
 *
 * Run against a THROWAWAY instance, never your real one:
 *
 *   DATA_DIR=/tmp/x DATABASE_URL="file:/tmp/x/t.db" TRUST_PROXY=true \
 *     PORT=4518 node dist/index.js
 *   BASE=http://127.0.0.1:4518 node test/abuse-e2e.mjs
 *
 * TRUST_PROXY=true is required so the test can present itself as a non-loopback
 * client — loopback is deliberately exempt from automatic blocking so you can
 * never lock yourself out of your own machine.
 */
const BASE = process.env.BASE || 'http://127.0.0.1:4518';
let failed = 0;

const ok = (name, cond, extra = '') => {
  if (cond) console.log(`  PASS  ${name}`);
  else {
    failed++;
    console.log(`  FAIL  ${name} ${extra}`);
  }
};

/** Presents as `ip` — honoured because the instance runs with TRUST_PROXY=true. */
async function call(method, path, { ip, body, headers = {}, origin = BASE } = {}) {
  const h = { 'content-type': 'application/json', ...headers };
  if (origin) h.origin = origin;
  if (ip) h['x-forwarded-for'] = ip;
  const res = await fetch(BASE + path, {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 120) }; }
  return { status: res.status, json, headers: res.headers };
}

const login = (ip, password = 'wrong-guess') =>
  call('POST', '/api/auth/login', { ip, body: { username: 'someone', password } });

// ---------------------------------------------------------------------------
console.log('\n--- login brute force ---');

const A = '203.0.113.10';
let allowed = 0, limited = 0;
for (let i = 0; i < 14; i++) {
  const r = await login(A);
  if (r.status === 429) limited++; else allowed++;
}
ok('login limiter caps attempts', allowed <= 10 && limited > 0, `${allowed} allowed / ${limited} limited`);

const first = await login(A);
ok('limit response carries Retry-After', Boolean(first.headers.get('retry-after')), String(first.headers.get('retry-after')));
ok('limit response is a clean JSON error', ['RATE_LIMITED', 'BLOCKED'].includes(first.json.error?.code), JSON.stringify(first.json).slice(0, 120));

console.log('\n--- a different source is unaffected ---');
const B = '203.0.113.20';
const other = await login(B);
ok('one attacker does not lock out everyone else', other.status !== 429, String(other.status));

console.log('\n--- sustained abuse escalates to a block ---');
// Keep pushing from A: repeated failures plus repeated limit-breaking should
// tip the suspicion score and take the source out entirely.
for (let i = 0; i < 20; i++) await login(A);
const blockedResp = await login(A);
ok('source is blocked outright', blockedResp.json.error?.code === 'BLOCKED', JSON.stringify(blockedResp.json).slice(0, 140));

const blockedElsewhere = await call('GET', '/api/health', { ip: A });
ok('a block applies to the whole surface, not just login', blockedElsewhere.status === 429, String(blockedElsewhere.status));

const stillFine = await call('GET', '/api/health', { ip: '203.0.113.99' });
ok('unrelated sources still served', stillFine.status === 200, String(stillFine.status));

console.log('\n--- vulnerability scanners ---');
const C = '203.0.113.30';
const probePaths = ['/.env', '/wp-login.php', '/.git/config'];
const probeStatuses = [];
for (const p of probePaths) probeStatuses.push((await call('GET', p, { ip: C })).status);
ok('scanner probes return a bare 404', probeStatuses.every((s) => s === 404 || s === 429), probeStatuses.join(','));

const afterProbes = await call('GET', '/api/health', { ip: C });
ok('a handful of probes is enough to block a scanner', afterProbes.status === 429, String(afterProbes.status));

console.log('\n--- normal navigation is never mistaken for an attack ---');
const D = '203.0.113.40';
for (const p of ['/', '/today', '/tasks', '/settings', '/calendar', '/analytics']) {
  await call('GET', p, { ip: D });
}
const stillOk = await call('GET', '/api/health', { ip: D });
ok('browsing the app does not get you blocked', stillOk.status === 200, String(stillOk.status));

console.log('\n--- account creation ---');
const E = '203.0.113.50';
let signupAllowed = 0, signupLimited = 0;
for (let i = 0; i < 9; i++) {
  const r = await call('POST', '/api/auth/bootstrap', { ip: E, body: { username: `u${i}`, password: 'Str0ng!Passphrase#2026' } });
  if (r.status === 429) signupLimited++; else signupAllowed++;
}
ok('account creation is rate limited', signupLimited > 0, `${signupAllowed} allowed / ${signupLimited} limited`);
ok('account creation cap is tight', signupAllowed <= 5, String(signupAllowed));

console.log('\n--- cross-origin and CSRF abuse counts against you ---');
const F = '203.0.113.60';
const evil = await call('POST', '/api/tasks', { ip: F, origin: 'http://evil.example', body: { title: 'x', date: '2026-01-01' } });
ok('cross-origin write is rejected', evil.status === 403 || evil.status === 401, String(evil.status));

console.log('\n--- unauthenticated scraping is refused ---');
const G = '203.0.113.70';
const scrape = await call('GET', '/api/tasks?view=all&limit=1000', { ip: G });
ok('bulk read requires authentication', scrape.status === 401, String(scrape.status));

console.log('\n--- crawlers are told to go away ---');
const robots = await fetch(BASE + '/robots.txt');
const robotsBody = await robots.text();
ok('robots.txt disallows everything', robots.status === 200 && /Disallow: \//.test(robotsBody), robotsBody.slice(0, 40));

const headers = (await fetch(BASE + '/')).headers;
ok('pages carry a noindex header', /noindex/.test(headers.get('x-robots-tag') || ''), String(headers.get('x-robots-tag')));

console.log('\n--- oversized payloads are rejected at the parser ---');
const H = '203.0.113.80';
const big = await fetch(BASE + '/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: BASE, 'x-forwarded-for': H },
  body: JSON.stringify({ username: 'a', password: 'x'.repeat(3_000_000) }),
}).then((r) => r.status).catch(() => 'connection-reset');
ok('a 3 MB body is refused', big === 413 || big === 400 || big === 'connection-reset' || big === 429, String(big));

console.log(failed === 0 ? '\nALL ABUSE E2E CHECKS PASSED\n' : `\n${failed} CHECK(S) FAILED\n`);
process.exit(failed ? 1 : 0);
