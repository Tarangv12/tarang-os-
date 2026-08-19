// End-to-end smoke test against a running TarangOS server.
const BASE = process.env.BASE || 'http://127.0.0.1:4517';
let cookie = '';
let csrf = '';
let failures = 0;

function ok(label, cond, extra = '') {
  if (cond) console.log(`  PASS  ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label} ${extra}`);
  }
}

async function call(method, path, body, expect = null) {
  const headers = { 'content-type': 'application/json', origin: BASE };
  if (cookie) headers.cookie = cookie;
  if (csrf) headers['x-csrf-token'] = csrf;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.getSetCookie?.() || [];
  for (const c of setCookie) {
    if (c.startsWith('tarang_sid=')) cookie = c.split(';')[0];
  }
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
  if (expect !== null && res.status !== expect) {
    failures++;
    console.log(`  FAIL  ${method} ${path} -> ${res.status} (expected ${expect})`, JSON.stringify(json).slice(0, 300));
  }
  return { status: res.status, json };
}

const USER = 'tarangadmin';
const PASS = 'Str0ng!Passphrase#2026';

console.log('\n--- auth ---');
let r = await call('GET', '/api/auth/status', undefined, 200);
if (!r.json.initialized) {
  r = await call('POST', '/api/auth/bootstrap', { username: USER, password: PASS, displayName: 'Vrushabh', timezone: 'Asia/Kolkata' }, 201);
  csrf = r.json.csrfToken;
  ok('bootstrap created account', !!r.json.user);
} else {
  r = await call('POST', '/api/auth/login', { username: USER, password: PASS }, 200);
  csrf = r.json.csrfToken;
  ok('login', !!r.json.user);
}

r = await call('POST', '/api/auth/bootstrap', { username: 'x2', password: PASS });
ok('second bootstrap is rejected', r.status === 403, `got ${r.status}`);

r = await call('GET', '/api/auth/me', undefined, 200);
ok('me returns user', r.json.user?.username === USER);

// CSRF must be enforced
{
  const res = await fetch(BASE + '/api/tasks', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, origin: BASE },
    body: JSON.stringify({ title: 'nope', date: '2026-08-19' }),
  });
  ok('missing CSRF token is rejected', res.status === 403, `got ${res.status}`);
}
// Cross-origin must be blocked
{
  const res = await fetch(BASE + '/api/tasks', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, origin: 'http://evil.example', 'x-csrf-token': csrf },
    body: JSON.stringify({ title: 'nope', date: '2026-08-19' }),
  });
  ok('cross-origin request is blocked', res.status === 403, `got ${res.status}`);
}
// Weak password rejected
{
  const res = await call('POST', '/api/auth/change-password', { currentPassword: PASS, newPassword: 'weak' });
  ok('weak password rejected', res.status === 400, `got ${res.status}`);
}

console.log('\n--- org ---');
r = await call('POST', '/api/org/categories', { name: 'Deep Work', color: '#6366f1' }, 201);
const categoryId = r.json.category.id;
r = await call('POST', '/api/org/projects', { name: 'TarangOS Launch', targetDate: '2026-10-01' }, 201);
const projectId = r.json.project.id;
ok('category + project created', !!categoryId && !!projectId);

console.log('\n--- goals ---');
r = await call('POST', '/api/goals', {
  title: 'Ship v1', type: 'monthly', targetDate: '2026-09-30', projectId,
  milestones: [{ title: 'Backend' }, { title: 'Frontend' }],
}, 201);
const goalId = r.json.goal.id;
ok('goal with milestones', r.json.goal.milestoneCount === 2, JSON.stringify(r.json.goal?.milestoneCount));
const msId = r.json.goal.milestones[0].id;
await call('PATCH', `/api/goals/${goalId}/milestones/${msId}`, { done: true }, 200);
r = await call('GET', `/api/goals/${goalId}`, undefined, 200);
ok('goal progress reflects milestone', Math.abs(r.json.goal.progress - 0.5) < 0.001, String(r.json.goal.progress));

console.log('\n--- tasks ---');
const today = (await call('GET', '/api/tasks?view=today', undefined, 200)).json.today;
r = await call('POST', '/api/tasks', {
  title: 'Write the API layer', date: today, priority: 'high', categoryId, projectId, goalId,
  estimatedMinutes: 90, startTime: '10:00', reminderMinutesBefore: 10,
  tags: ['build', 'focus'], subtasks: [{ title: 'routes' }, { title: 'tests' }],
}, 201);
const taskId = r.json.task.id;
ok('task created with tags + subtasks', r.json.task.tags.length === 2 && r.json.task.subtaskCount === 2);
ok('reminder computed', !!r.json.task.reminderAt);

r = await call('POST', '/api/tasks/quick', { text: 'Gym tomorrow 7 PM high priority #health ~45m' }, 201);
ok('quick capture parsed priority', r.json.task.priority === 'high', r.json.task.priority);
ok('quick capture parsed time', r.json.task.startTime === '19:00', String(r.json.task.startTime));
ok('quick capture parsed duration', r.json.task.estimatedMinutes === 45, String(r.json.task.estimatedMinutes));
ok('quick capture parsed tag', r.json.task.tags[0]?.name === 'health');
ok('quick capture cleaned title', r.json.task.title.toLowerCase() === 'gym', JSON.stringify(r.json.task.title));
const gymId = r.json.task.id;

r = await call('POST', '/api/tasks/parse', { text: 'Review deck every monday 9am urgent' }, 200);
ok('parser detects weekly recurrence', r.json.parsed.recurrence?.freq === 'weekly', JSON.stringify(r.json.parsed.recurrence));
ok('parser detects urgent', r.json.parsed.priority === 'urgent');

r = await call('POST', '/api/tasks', { title: 'Daily standup', date: today, recurrence: { freq: 'daily', interval: 1 } }, 201);
const seriesId = r.json.task.id;

r = await call('POST', '/api/tasks/' + taskId + '/postpone', { days: 1 }, 200);
ok('postpone records history', r.json.task.postponedCount === 1 && r.json.task.originalDate === today);
await call('POST', '/api/tasks/' + taskId + '/postpone', { to: today }, 200);

r = await call('POST', '/api/tasks/' + taskId + '/duplicate', {}, 201);
const dupId = r.json.task.id;
ok('duplicate copies subtasks', r.json.task.subtaskCount === 2);

r = await call('POST', '/api/tasks/' + taskId + '/complete', {}, 200);
ok('complete sets completedAt', !!r.json.task.completedAt && r.json.task.subtasksDone === 2);

r = await call('GET', '/api/tasks?view=today&search=API', undefined, 200);
ok('search finds task', r.json.tasks.some(t => t.id === taskId));

r = await call('POST', '/api/tasks/bulk', { ids: [dupId], action: 'archive' }, 200);
ok('bulk archive', r.json.affected === 1);

console.log('\n--- habits ---');
r = await call('POST', '/api/habits', { name: 'Read 20 pages', cadence: 'daily', color: '#10b981', reminderTime: '21:00' }, 201);
const habitId = r.json.habit.id;
r = await call('POST', `/api/habits/${habitId}/check`, {}, 200);
ok('habit checked today', r.json.done === true);
r = await call('GET', '/api/habits', undefined, 200);
ok('habit streak counted', r.json.habits[0].currentStreak === 1, String(r.json.habits[0].currentStreak));
r = await call('POST', `/api/habits/${habitId}/check`, {}, 200);
ok('habit toggles off', r.json.done === false);
await call('POST', `/api/habits/${habitId}/check`, { done: true }, 200);

console.log('\n--- focus ---');
r = await call('POST', '/api/focus/start', { taskId: gymId, plannedMinutes: 25 }, 201);
const focusId = r.json.session.id;
r = await call('POST', `/api/focus/${focusId}/finish`, { actualMinutes: 25, completed: true }, 200);
ok('focus session finished', r.json.session.actualMinutes === 25);
r = await call('GET', '/api/focus/stats', undefined, 200);
ok('focus stats today', r.json.today.minutes === 25, JSON.stringify(r.json.today));

console.log('\n--- notes ---');
r = await call('POST', '/api/notes', { title: 'Design idea', content: '# Heading\n\nSome **markdown**', date: today, taskId: gymId }, 201);
ok('note created and linked', r.json.note.task?.id === gymId);

console.log('\n--- dashboard ---');
r = await call('GET', '/api/dashboard', undefined, 200);
const d = r.json;
ok('dashboard has greeting', typeof d.greeting === 'string' && d.greeting.length > 0);
ok('dashboard score is 0..100', d.metrics.score >= 0 && d.metrics.score <= 100, String(d.metrics.score));
ok('score has explanation', d.metrics.components.length === 6 && Array.isArray(d.metrics.positives));
ok('recurring series materialized', d.upcoming.some(t => t.title === 'Daily standup'), JSON.stringify(d.upcoming.map(t=>t.title)));
ok('habits on dashboard', d.habits.length === 1 && d.habits[0].doneToday === true);
ok('focus minutes counted', d.metrics.focusMinutes === 25, String(d.metrics.focusMinutes));

r = await call('POST', '/api/dashboard/plan-my-day', {}, 200);
ok('plan-my-day returns reasons', r.json.plan.length > 0 && r.json.plan[0].reasons.length > 0);
r = await call('GET', '/api/dashboard/eisenhower', undefined, 200);
ok('eisenhower quadrants', !!r.json.quadrants.do && !!r.json.quadrants.schedule);

console.log('\n--- analytics ---');
r = await call('GET', '/api/analytics/overview?range=30', undefined, 200);
ok('overview totals', r.json.totals.completed >= 1, JSON.stringify(r.json.totals));
ok('overview has weekday perf', Array.isArray(r.json.weekday.rows) && r.json.weekday.rows.length === 7);
ok('overview has comparison', typeof r.json.comparison.scoreDelta === 'number');
r = await call('GET', '/api/analytics/heatmap?days=180', undefined, 200);
ok('heatmap 180 days', r.json.days.length === 180, String(r.json.days.length));
r = await call('GET', '/api/analytics/records', undefined, 200);
ok('records lifetime', r.json.lifetime.tasksCompleted >= 1);
r = await call('GET', '/api/analytics/history?days=180', undefined, 200);
ok('history 180 days', r.json.days.length === 180, String(r.json.days.length));
r = await call('GET', `/api/analytics/history/${today}`, undefined, 200);
ok('history day detail', r.json.tasks.length > 0 && !!r.json.metrics);
r = await call('GET', `/api/analytics/calendar?from=${today}&to=${today}`, undefined, 200);
ok('calendar day', r.json.days[0].tasks.length > 0);

console.log('\n--- reviews ---');
r = await call('GET', '/api/reviews/prepare?type=daily', undefined, 200);
ok('review prepare lists completed', r.json.completed.length >= 1);
r = await call('POST', '/api/reviews', {
  type: 'daily', date: today, wentWell: 'Shipped the API', missedWhy: 'Ran out of time',
  missReasons: ['ran_out_of_time'], rating: 4, energy: 4, mood: 'focused',
}, 200);
ok('review saved with snapshot', r.json.review.snapshot.score >= 0);
r = await call('GET', '/api/reviews/prepare?type=weekly', undefined, 200);
ok('weekly review prepare', typeof r.json.metrics.avgScore === 'number');
r = await call('GET', '/api/reviews/insights/miss-reasons', undefined, 200);
ok('miss reason insights', r.json.reasons.some(x => x.reason === 'ran_out_of_time'), JSON.stringify(r.json.reasons));

console.log('\n--- settings + backup ---');
r = await call('PATCH', '/api/settings', { theme: 'dark', settings: { dailyFocusTargetMinutes: 180 } }, 200);
ok('settings persisted', r.json.user.theme === 'dark' && r.json.user.settings.dailyFocusTargetMinutes === 180);
r = await call('GET', '/api/settings/stats', undefined, 200);
ok('data stats', r.json.tasks >= 3);
r = await call('POST', '/api/backup', {}, 201);
const backupFile = r.json.filename;
ok('backup created', !!backupFile && r.json.counts.tasks >= 3);
r = await call('GET', '/api/backup', undefined, 200);
ok('backup listed', r.json.backups.some(b => b.filename === backupFile));
{
  const res = await fetch(BASE + '/api/backup/download/..%2F..%2Fpackage.json', { headers: { cookie, 'x-csrf-token': csrf } });
  ok('path traversal blocked', res.status === 400 || res.status === 404, `got ${res.status}`);
}
r = await call('GET', '/api/backup/export.csv', undefined, 200);
ok('csv export has header', String(r.json.raw || '').includes('title'), String(r.json.raw || '').slice(0, 60));
r = await call('POST', '/api/backup/import/csv', {
  csv: 'title,date,priority\r\n"Imported task",' + today + ',high\r\n"Another",' + today + ',low',
  dryRun: false,
}, 200);
ok('csv import', r.json.created === 2, JSON.stringify(r.json));
r = await call('POST', '/api/backup/restore', { password: 'wrong-password', filename: backupFile, mode: 'merge' });
ok('restore needs correct password', r.status === 401, `got ${r.status}`);

console.log('\n--- lock / unlock ---');
await call('POST', '/api/auth/pin', { password: PASS, pin: '481902' }, 200);
await call('POST', '/api/auth/lock', {}, 200);
r = await call('GET', '/api/dashboard');
ok('locked session blocks data', r.status === 423, `got ${r.status}`);
r = await call('POST', '/api/auth/unlock', { pin: '000000' });
ok('wrong PIN rejected', r.status === 401, `got ${r.status}`);
r = await call('POST', '/api/auth/unlock', { pin: '481902' }, 200);
ok('correct PIN unlocks', r.json.locked === false);
r = await call('GET', '/api/dashboard', undefined, 200);
ok('data available after unlock', !!r.json.metrics);

console.log('\n--- 2FA ---');
r = await call('POST', '/api/auth/2fa/setup', { password: PASS }, 200);
const secret = r.json.secret;
ok('2fa setup returns otpauth url', String(r.json.otpauthUrl).startsWith('otpauth://totp/TarangOS'));
{
  const crypto = await import('node:crypto');
  const ALPH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, value = 0; const out = [];
  for (const ch of secret) { value = (value << 5) | ALPH.indexOf(ch); bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  const key = Buffer.from(out);
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const off = hmac[hmac.length - 1] & 0x0f;
  const bin = ((hmac[off] & 0x7f) << 24) | ((hmac[off+1] & 0xff) << 16) | ((hmac[off+2] & 0xff) << 8) | (hmac[off+3] & 0xff);
  const code = String(bin % 1000000).padStart(6, '0');
  r = await call('POST', '/api/auth/2fa/enable', { code }, 200);
  ok('2fa enabled with valid code', r.json.recoveryCodes?.length === 10);
  const recovery = r.json.recoveryCodes[0];

  await call('POST', '/api/auth/logout', {}, 200);
  cookie = ''; csrf = '';
  r = await call('POST', '/api/auth/login', { username: USER, password: PASS });
  ok('login now demands 2FA', r.status === 401 && r.json.error.code === 'TOTP_REQUIRED', JSON.stringify(r.json.error));
  r = await call('POST', '/api/auth/login', { username: USER, password: PASS, recoveryCode: recovery }, 200);
  csrf = r.json.csrfToken;
  ok('recovery code logs in', !!r.json.user);
  r = await call('POST', '/api/auth/login', { username: USER, password: PASS, recoveryCode: recovery });
  ok('recovery code is single-use', r.status === 401, `got ${r.status}`);
  r = await call('POST', '/api/auth/2fa/disable', { password: PASS, code: '000000' });
  ok('disabling 2fa needs a valid code', r.status === 400, `got ${r.status}`);
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}\n`);
process.exit(failures === 0 ? 0 : 1);
