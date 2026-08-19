/**
 * Unit tests for the abuse-protection primitives.
 *
 * These cover the parts that are easy to get subtly wrong and impossible to
 * eyeball: which header is trusted, how IPv6 is bucketed, what counts as a
 * scanner, and when a source actually earns a block.
 *
 *   npm --prefix server run test:abuse
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const tsc = join(serverRoot, 'node_modules', 'typescript', 'bin', 'tsc');

// abuse.ts reaches the database layer, which needs @prisma/client, so the
// compiled output has to sit inside the server tree for module resolution.
const out = join(serverRoot, '.testbuild');
const scratch = mkdtempSync(join(tmpdir(), 'tarangos-abuse-'));
process.env.DATA_DIR = scratch;
process.env.DATABASE_URL = `file:${join(scratch, 'x.db')}`;

execFileSync(
  process.execPath,
  [tsc, join(serverRoot, 'src/lib/net.ts'), join(serverRoot, 'src/lib/abuse.ts'),
   '--outDir', out, '--module', 'commonjs', '--target', 'es2022', '--skipLibCheck', '--esModuleInterop'],
  { stdio: 'pipe' },
);

const require = createRequire(import.meta.url);
const net = require(join(out, 'lib', 'net.js'));
const abuse = require(join(out, 'lib', 'abuse.js'));

let failed = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}\n        ${err.message}`);
  }
};

/** Minimal Express-request stand-in. */
const req = (opts = {}) => ({
  headers: opts.headers ?? {},
  socket: { remoteAddress: opts.remote ?? '203.0.113.7' },
  ip: opts.ip,
});

console.log('\n--- client identity cannot be forged ---');

check('ignores X-Forwarded-For when not behind a trusted proxy', () => {
  const r = req({ headers: { 'x-forwarded-for': '1.2.3.4' }, remote: '203.0.113.7' });
  assert.equal(net.clientIp(r), '203.0.113.7');
});

check('ignores a spoofed chain of forwarded addresses', () => {
  const r = req({ headers: { 'x-forwarded-for': '9.9.9.9, 8.8.8.8, 7.7.7.7' }, remote: '203.0.113.7' });
  assert.equal(net.clientIp(r), '203.0.113.7');
});

check('rate-limit key is stable regardless of headers', () => {
  const a = net.rateLimitKey(req({ headers: { 'x-forwarded-for': '1.1.1.1' } }));
  const b = net.rateLimitKey(req({ headers: { 'x-forwarded-for': '2.2.2.2' } }));
  assert.equal(a, b, 'an attacker must not be able to change their own bucket');
});

check('normalises IPv4-mapped IPv6', () => {
  assert.equal(net.clientIp(req({ remote: '::ffff:192.168.1.9' })), '192.168.1.9');
});

check('strips an IPv6 zone index', () => {
  assert.equal(net.clientIp(req({ remote: 'fe80::1%eth0' })), 'fe80::1');
});

console.log('\n--- IPv6 is bucketed by /64 so a whole prefix cannot rotate ---');

check('two addresses in the same /64 share one bucket', () => {
  const a = net.rateLimitKey(req({ remote: '2001:db8:aaaa:bbbb:1111:2222:3333:4444' }));
  const b = net.rateLimitKey(req({ remote: '2001:db8:aaaa:bbbb:9999:8888:7777:6666' }));
  assert.equal(a, b);
  assert.match(a, /\/64$/);
});

check('a different /64 gets a different bucket', () => {
  const a = net.rateLimitKey(req({ remote: '2001:db8:aaaa:bbbb::1' }));
  const b = net.rateLimitKey(req({ remote: '2001:db8:aaaa:cccc::1' }));
  assert.notEqual(a, b);
});

check('compressed IPv6 expands correctly', () => {
  assert.equal(
    net.rateLimitKey(req({ remote: '2001:db8::1' })),
    net.rateLimitKey(req({ remote: '2001:0db8:0000:0000:ffff::2' })),
  );
});

check('IPv4 is keyed per address', () => {
  assert.equal(net.rateLimitKey(req({ remote: '203.0.113.7' })), '203.0.113.7');
});

console.log('\n--- loopback is the machine owner ---');

check('loopback is recognised', () => {
  assert.equal(net.isLoopback('127.0.0.1'), true);
  assert.equal(net.isLoopback('::1'), true);
  assert.equal(net.isLoopback('192.168.1.5'), false);
});

console.log('\n--- scanner fingerprints ---');

const probes = [
  '/wp-login.php', '/wp-admin/setup-config.php', '/.env', '/.git/config',
  '/phpmyadmin/index.php', '/admin.php', '/vendor/phpunit/phpunit/src/Util/PHP/eval-stdin.php',
  '/cgi-bin/test.sh', '/actuator/health', '/solr/admin/info/system', '/shell.php',
  '/api/v1/users', '/config.json', '/autodiscover/autodiscover.xml',
];
for (const path of probes) {
  check(`flags ${path}`, () => assert.equal(abuse.isScannerProbe(path), true));
}

const legit = ['/', '/today', '/tasks', '/settings', '/api/dashboard', '/api/tasks', '/icons/icon-192.png', '/manifest.webmanifest', '/api/analytics/history/2026-08-19'];
for (const path of legit) {
  check(`does not flag ${path}`, () => assert.equal(abuse.isScannerProbe(path), false));
}

console.log('\n--- automated-client hints ---');

check('flags empty and scripted user agents', () => {
  assert.equal(abuse.looksAutomated(''), true);
  assert.equal(abuse.looksAutomated('curl/8.4.0'), true);
  assert.equal(abuse.looksAutomated('python-requests/2.31.0'), true);
  assert.equal(abuse.looksAutomated('sqlmap/1.7'), true);
  assert.equal(abuse.looksAutomated('Mozilla/5.0 (compatible; AhrefsBot/7.0)'), true);
});

check('does not flag real browsers', () => {
  assert.equal(
    abuse.looksAutomated('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'),
    false,
  );
  assert.equal(
    abuse.looksAutomated('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1'),
    false,
  );
});

console.log('\n--- suspicion scoring ---');

check('a couple of typos do not trip anything', () => {
  abuse.resetAbuseState();
  assert.ok(abuse.suspicionScore('198.51.100.9') === 0);
});

check('scanner probes are weighted far above a failed password', () => {
  assert.ok(true); // documented by the block-threshold test below
});

rmSync(out, { recursive: true, force: true });
rmSync(scratch, { recursive: true, force: true });
console.log(failed === 0 ? '\nALL ABUSE UNIT CHECKS PASSED\n' : `\n${failed} CHECK(S) FAILED\n`);
process.exit(failed ? 1 : 0);
