/**
 * Offline credential recovery.
 *
 * Because TarangOS has no email and no password-reset link (both would be an
 * attack surface for a single-user private app), recovery is done from the
 * machine that holds the database:
 *
 *   npm run reset-admin -- --password "a new strong password"
 *   npm run reset-admin -- --disable-2fa
 *   npm run reset-admin -- --clear-lockout
 */
import { prisma } from '../lib/db';
import { hashSecret } from '../lib/crypto';
import { passwordProblems } from '../lib/user';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  return process.argv[index + 1]?.startsWith('--') ? '' : process.argv[index + 1];
}

function has(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const user = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!user) {
    console.error('No account exists yet. Open the app in a browser to create one.');
    process.exit(1);
  }

  const updates: Record<string, unknown> = {};
  const done: string[] = [];

  const password = arg('password');
  if (password) {
    const problems = passwordProblems(password, user.username);
    if (problems.length) {
      console.error('Password rejected:');
      for (const p of problems) console.error(`  - ${p}`);
      process.exit(1);
    }
    updates.passwordHash = await hashSecret(password);
    updates.passwordChangedAt = new Date();
    done.push('password changed');
  }

  if (has('disable-2fa')) {
    updates.totpEnabled = false;
    updates.totpSecret = null;
    updates.recoveryCodes = null;
    done.push('two-factor authentication disabled');
  }

  if (has('clear-pin')) {
    updates.pinHash = null;
    done.push('PIN removed');
  }

  if (has('clear-lockout')) {
    updates.failedLogins = 0;
    updates.lockedUntil = null;
    done.push('lockout cleared');
  }

  if (!Object.keys(updates).length) {
    console.log(`Account: ${user.username}`);
    console.log(`  two-factor: ${user.totpEnabled ? 'on' : 'off'}`);
    console.log(`  quick PIN:  ${user.pinHash ? 'set' : 'not set'}`);
    console.log(`  locked:     ${user.lockedUntil && user.lockedUntil > new Date() ? 'yes' : 'no'}`);
    console.log('\nUsage:');
    console.log('  npm run reset-admin -- --password "new strong password"');
    console.log('  npm run reset-admin -- --disable-2fa --clear-pin --clear-lockout');
    process.exit(0);
  }

  await prisma.user.update({ where: { id: user.id }, data: updates });
  // Any change to credentials invalidates every existing session.
  const revoked = await prisma.session.deleteMany({ where: { userId: user.id } });
  await prisma.auditLog.create({
    data: { userId: user.id, action: 'auth.cli_recovery', detail: done.join(', '), ip: 'cli' },
  });

  console.log(`Done for "${user.username}":`);
  for (const item of done) console.log(`  - ${item}`);
  console.log(`  - ${revoked.count} session(s) signed out`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
