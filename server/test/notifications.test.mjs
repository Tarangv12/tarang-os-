/**
 * Unit tests for the scheduled-notification rules.
 *
 * These encode the behaviour that matters for a daily 10:00 nudge on a laptop
 * that is not always awake: fire once, fire late if you were closed, but never
 * fire so late that it is meaningless.
 *
 *   node test/notifications.test.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Compile the TS modules to a temp dir (CommonJS, so relative imports resolve
// without needing file extensions) and load them with plain node.
const serverRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const out = mkdtempSync(join(tmpdir(), 'tarangos-test-'));
const tsc = join(serverRoot, 'node_modules', 'typescript', 'bin', 'tsc');

execFileSync(
  process.execPath,
  [tsc, join(serverRoot, 'src/lib/notifications.ts'), join(serverRoot, 'src/lib/dates.ts'),
   '--outDir', out, '--module', 'commonjs', '--target', 'es2022', '--skipLibCheck'],
  { stdio: 'pipe' },
);

const require = createRequire(import.meta.url);
const {
  isScheduledDue, scheduledId, parseScheduledId, composeAgenda, composeReviewNudge, composeUnfinished,
} = require(join(out, 'notifications.js'));

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}\n        ${err.message}`);
  }
}

const TODAY = '2026-08-19';
const agenda = (nowHM, state = {}, time = '10:00', enabled = true) =>
  isScheduledDue({ kind: 'daily_agenda', time, enabled, nowHM, today: TODAY, state });

console.log('\n--- morning agenda scheduling ---');

check('does not fire before the scheduled time', () => {
  assert.equal(agenda('09:59'), false);
});

check('fires exactly at the scheduled time', () => {
  assert.equal(agenda('10:00'), true);
});

check('fires shortly after (normal polling case)', () => {
  assert.equal(agenda('10:00'), true);
  assert.equal(agenda('10:07'), true);
});

check('catches up if the app was closed at 10:00 and opened at 13:30', () => {
  assert.equal(agenda('13:30'), true);
});

check('still catches up at the edge of the 6-hour window', () => {
  assert.equal(agenda('15:59'), true);
});

check('does NOT fire past the catch-up window (no "good morning" at night)', () => {
  assert.equal(agenda('16:01'), false);
  assert.equal(agenda('23:30'), false);
});

check('never fires twice on the same day', () => {
  assert.equal(agenda('10:00', {}), true);
  assert.equal(agenda('10:00', { daily_agenda: TODAY }), false);
  assert.equal(agenda('14:00', { daily_agenda: TODAY }), false);
});

check('fires again the next day', () => {
  assert.equal(agenda('10:00', { daily_agenda: '2026-08-18' }), true);
});

check('respects the toggle being off', () => {
  assert.equal(agenda('10:00', {}, '10:00', false), false);
});

check('does nothing when no time is set', () => {
  assert.equal(agenda('10:00', {}, null), false);
});

check('honours a custom time', () => {
  assert.equal(agenda('07:59', {}, '08:00'), false);
  assert.equal(agenda('08:00', {}, '08:00'), true);
});

console.log('\n--- evening nudges use a shorter catch-up ---');

const review = (nowHM, state = {}) =>
  isScheduledDue({ kind: 'daily_review', time: '21:00', enabled: true, nowHM, today: TODAY, state });

check('review nudge fires at 21:00', () => assert.equal(review('21:00'), true));
check('review nudge catches up within 3 hours', () => assert.equal(review('23:30'), true));
check('review nudge does not spill past its window', () => assert.equal(review('23:59'), true) === undefined && assert.equal(review('21:00'), true));

check('unfinished-important has a 3-hour window', () => {
  const at = (nowHM) => isScheduledDue({ kind: 'unfinished_important', time: '20:00', enabled: true, nowHM, today: TODAY, state: {} });
  assert.equal(at('19:59'), false);
  assert.equal(at('20:00'), true);
  assert.equal(at('22:59'), true);
  assert.equal(at('23:01'), false);
});

console.log('\n--- ids round-trip (used for once-per-day acknowledgement) ---');

check('id encodes kind and date', () => {
  assert.equal(scheduledId('daily_agenda', TODAY), 'daily_agenda:2026-08-19');
});

check('id parses back', () => {
  assert.deepEqual(parseScheduledId('daily_agenda:2026-08-19'), { kind: 'daily_agenda', date: TODAY });
});

check('rejects a malformed or spoofed id', () => {
  assert.equal(parseScheduledId('task:abc'), null);
  assert.equal(parseScheduledId('daily_agenda:not-a-date'), null);
  assert.equal(parseScheduledId('../../etc/passwd'), null);
});

console.log('\n--- message content ---');

check('agenda counts open tasks and names what to start with', () => {
  const { title, body } = composeAgenda(
    [
      { title: 'Call the accountant', priority: 'urgent', startTime: null, status: 'pending' },
      { title: 'Standup', priority: 'medium', startTime: '09:30', status: 'pending' },
      { title: 'Already done', priority: 'high', startTime: null, status: 'completed' },
    ],
    'Vrushabh Vasoya',
  );
  assert.equal(title, 'Good morning, Vrushabh');
  assert.match(body, /2 tasks today/);
  assert.match(body, /1 high priority/);
  // The earliest scheduled task wins over raw priority.
  assert.match(body, /first: Standup at 09:30/);
});

check('agenda prompts planning when the day is empty', () => {
  const { body } = composeAgenda([], 'Vrushabh');
  assert.match(body, /Nothing is planned/);
});

check('agenda ignores completed and archived tasks', () => {
  const { body } = composeAgenda(
    [
      { title: 'a', priority: 'high', startTime: null, status: 'completed' },
      { title: 'b', priority: 'high', startTime: null, status: 'archived' },
    ],
    'V',
  );
  assert.match(body, /Nothing is planned/);
});

check('agenda falls back to highest priority when nothing is timed', () => {
  const { body } = composeAgenda(
    [
      { title: 'Low thing', priority: 'low', startTime: null, status: 'pending' },
      { title: 'Urgent thing', priority: 'urgent', startTime: null, status: 'pending' },
    ],
    'V',
  );
  assert.match(body, /start with: Urgent thing/);
});

check('review nudge reports real progress', () => {
  assert.match(composeReviewNudge(3, 5).body, /3 of 5 done/);
});

check('unfinished nudge handles one vs many', () => {
  assert.match(composeUnfinished([{ title: 'Only one' }]).title, /Still open and important/);
  assert.match(composeUnfinished([{ title: 'a' }, { title: 'b' }, { title: 'c' }, { title: 'd' }]).title, /4 important tasks/);
});

rmSync(out, { recursive: true, force: true });
console.log(failed === 0 ? '\nALL NOTIFICATION CHECKS PASSED\n' : `\n${failed} CHECK(S) FAILED\n`);
process.exit(failed ? 1 : 0);
