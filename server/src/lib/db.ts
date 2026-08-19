import { PrismaClient } from '@prisma/client';
import { config } from '../config';

export const prisma = new PrismaClient({
  log: config.isProd ? ['warn', 'error'] : ['warn', 'error'],
});

/**
 * SQLite pragmas: WAL for concurrent reads, FK enforcement, durable commits.
 * Some pragmas return a row (journal_mode) and some do not, so each is issued
 * as a query and failures are tolerated rather than blocking startup.
 */
const PRAGMAS = [
  'PRAGMA journal_mode = WAL;',
  'PRAGMA foreign_keys = ON;',
  'PRAGMA synchronous = NORMAL;',
  'PRAGMA busy_timeout = 5000;',
];

export async function initDatabase(): Promise<void> {
  for (const pragma of PRAGMAS) {
    try {
      await prisma.$queryRawUnsafe(pragma);
    } catch {
      try {
        await prisma.$executeRawUnsafe(pragma);
      } catch {
        // eslint-disable-next-line no-console
        console.warn(`[tarangos] could not apply "${pragma}"`);
      }
    }
  }
}

export async function closeDatabase(): Promise<void> {
  await prisma.$disconnect();
}
