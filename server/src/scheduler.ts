import { prisma } from './lib/db';
import { config } from './config';
import { listBackups, writeBackupFile } from './lib/backup';
import { purgeExpiredSessions } from './lib/session';
import { pruneAuditLog } from './lib/audit';
import { purgeExpiredBlocks } from './lib/abuse';
import { clearStaleReminders, materializeRecurring } from './lib/tasks';
import { getAdmin } from './lib/user';
import { todayStr } from './lib/dates';

/**
 * Lightweight in-process housekeeping. No external scheduler needed — this is
 * a single-user app that runs on your own machine.
 */

const FIFTEEN_MINUTES = 15 * 60_000;
let timer: NodeJS.Timeout | null = null;

async function runHousekeeping(): Promise<void> {
  try {
    await purgeExpiredSessions();
    await pruneAuditLog();
    await purgeExpiredBlocks();

    const user = await getAdmin();
    if (!user) return;

    const today = todayStr(user.timezone);
    await materializeRecurring(user.id, today);
    await clearStaleReminders(user.id, new Date());

    if (config.backup.autoDaily) {
      const backups = await listBackups();
      const lastAuto = backups.find((b) => b.kind === 'auto');
      const ageHours = lastAuto ? (Date.now() - Date.parse(lastAuto.createdAt)) / 3_600_000 : Infinity;
      if (ageHours >= 20) {
        const created = await writeBackupFile(user.id, 'auto');
        // eslint-disable-next-line no-console
        console.log(`[tarangos] automatic backup written: ${created.filename}`);
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[tarangos] housekeeping failed:', (err as Error).message);
  }
}

export function startScheduler(): void {
  void runHousekeeping();
  timer = setInterval(runHousekeeping, FIFTEEN_MINUTES);
  timer.unref?.();
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

export async function shutdown(): Promise<void> {
  stopScheduler();
  await prisma.$disconnect();
}
