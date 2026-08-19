/**
 * Command-line backup — handy for cron/Task Scheduler or a pre-upgrade snapshot.
 *
 *   npm run backup
 */
import { prisma } from '../lib/db';
import { writeBackupFile } from '../lib/backup';
import { config } from '../config';

async function main() {
  const user = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!user) {
    console.error('No account exists yet — nothing to back up.');
    process.exit(1);
  }

  const result = await writeBackupFile(user.id, 'manual');
  console.log(`Backup written: ${config.backupDir}\\${result.filename}`);
  console.log(`Size: ${(result.size / 1024).toFixed(1)} KB`);
  for (const [key, count] of Object.entries(result.counts)) {
    if (count) console.log(`  ${key}: ${count}`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
