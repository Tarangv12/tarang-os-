import { prisma } from './lib/db';
import { config } from './config';
import { listBackups, writeBackupFile } from './lib/backup';
import { purgeExpiredSessions } from './lib/session';
import { pruneAuditLog } from './lib/audit';
import { purgeExpiredBlocks } from './lib/abuse';
import { purgeExpiredRateBuckets } from './lib/rateStore';
import { clearStaleReminders, materializeRecurring } from './lib/tasks';
import { getAdmin } from './lib/user';
import { todayStr } from './lib/dates';

/**
 * Lightweight in-process housekeeping. No external scheduler needed — this is
 * a single-user app that runs on your own machine.
 */

const FIFTEEN_MINUTES = 15 * 60_000;
let timer: NodeJS.Timeout | null = null;

export type HousekeepingResult = {
  sessionsPurged: boolean;
  blocksPurged: boolean;
  rateBucketsPurged: number;
  recurringCreated: number;
  backupWritten: string | null;
};

/**
 * One pass of maintenance. Driven by a timer on a long-running server and by
 * the platform's cron on serverless, where nothing runs between requests.
 */
export async function runHousekeeping(): Promise<HousekeepingResult> {
  const result: HousekeepingResult = {
    sessionsPurged: false,
    blocksPurged: false,
    rateBucketsPurged: 0,
    recurringCreated: 0,
    backupWritten: null,
  };
  try {
    await purgeExpiredSessions();
    result.sessionsPurged = true;
    await pruneAuditLog();
    await purgeExpiredBlocks();
    result.blocksPurged = true;
    result.rateBucketsPurged = await purgeExpiredRateBuckets();

    const user = await getAdmin();
    if (!user) return result;

    const today = todayStr(user.timezone);
    result.recurringCreated = await materializeRecurring(user.id, today);
    await clearStaleReminders(user.id, new Date());

    if (config.backup.autoDaily) {
      const backups = await listBackups();
      const lastAuto = backups.find((b) => b.kind === 'auto');
      const ageHours = lastAuto ? (Date.now() - Date.parse(lastAuto.createdAt)) / 3_600_000 : Infinity;
      if (ageHours >= 20) {
        const created = await writeBackupFile(user.id, 'auto');
        result.backupWritten = created.filename;
        // eslint-disable-next-line no-console
        console.log(`[tarangos] automatic backup written: ${created.filename}`);
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[tarangos] housekeeping failed:', (err as Error).message);
  }
  return result;
}

export function startScheduler(): void {
  // Serverless functions are torn down between requests, so an interval would
  // never fire. There, the platform's cron calls /api/cron/housekeeping instead.
  if (config.isServerless) return;
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
