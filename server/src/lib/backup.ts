import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from './db';
import { config } from '../config';

export const BACKUP_FORMAT = 'tarangos-backup';
export const BACKUP_VERSION = 1;

export type BackupPayload = {
  format: string;
  version: number;
  createdAt: string;
  app: string;
  user: {
    username: string;
    displayName: string;
    theme: string;
    accent: string;
    timezone: string;
    settings: string;
  };
  counts: Record<string, number>;
  data: {
    categories: unknown[];
    tags: unknown[];
    projects: unknown[];
    goals: unknown[];
    milestones: unknown[];
    tasks: unknown[];
    subtasks: unknown[];
    taskTags: unknown[];
    habits: unknown[];
    habitEntries: unknown[];
    focusSessions: unknown[];
    reviews: unknown[];
    notes: unknown[];
  };
};

/** Full export of everything except credentials — never the password hash. */
export async function buildBackup(userId: string): Promise<BackupPayload> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  const [categories, tags, projects, goals, tasks, habits, focusSessions, reviews, notes] = await Promise.all([
    prisma.category.findMany({ where: { userId } }),
    prisma.tag.findMany({ where: { userId } }),
    prisma.project.findMany({ where: { userId } }),
    prisma.goal.findMany({ where: { userId } }),
    prisma.task.findMany({ where: { userId } }),
    prisma.habit.findMany({ where: { userId } }),
    prisma.focusSession.findMany({ where: { userId } }),
    prisma.review.findMany({ where: { userId } }),
    prisma.note.findMany({ where: { userId } }),
  ]);

  const [milestones, subtasks, taskTags, habitEntries] = await Promise.all([
    prisma.milestone.findMany({ where: { goalId: { in: goals.map((g) => g.id) } } }),
    prisma.subtask.findMany({ where: { taskId: { in: tasks.map((t) => t.id) } } }),
    prisma.taskTag.findMany({ where: { taskId: { in: tasks.map((t) => t.id) } } }),
    prisma.habitEntry.findMany({ where: { habitId: { in: habits.map((h) => h.id) } } }),
  ]);

  const data = {
    categories, tags, projects, goals, milestones, tasks, subtasks, taskTags,
    habits, habitEntries, focusSessions, reviews, notes,
  };

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    app: 'TarangOS',
    user: {
      username: user.username,
      displayName: user.displayName,
      theme: user.theme,
      accent: user.accent,
      timezone: user.timezone,
      settings: user.settings,
    },
    counts: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, (v as unknown[]).length])),
    data: data as BackupPayload['data'],
  };
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

/**
 * Whether backup *files* are meaningful in this deployment.
 *
 * On serverless there is no durable disk, so a written file would vanish with
 * the invocation. Export and restore still work end to end — they just move
 * through the browser rather than through the server's filesystem.
 */
export function fileBackupsAvailable(): boolean {
  return config.hasPersistentDisk;
}

export class BackupsUnavailableError extends Error {
  constructor() {
    super(
      'Server-side backup files are not available on this deployment, because it has no ' +
        'persistent disk. Use Export (JSON) to download a full backup instead — it contains ' +
        'exactly the same data and can be restored from the same screen.',
    );
    this.name = 'BackupsUnavailableError';
  }
}

export async function writeBackupFile(userId: string, kind: 'auto' | 'manual' = 'manual'): Promise<{ filename: string; size: number; counts: Record<string, number> }> {
  if (!fileBackupsAvailable()) throw new BackupsUnavailableError();
  const payload = await buildBackup(userId);
  const filename = `tarangos-${kind}-${stamp()}.json`;
  const filePath = path.join(config.backupDir, filename);
  const body = JSON.stringify(payload, null, 2);
  await fs.writeFile(filePath, body, { mode: 0o600 });
  await pruneBackups(config.backup.keep);
  return { filename, size: Buffer.byteLength(body), counts: payload.counts };
}

export async function listBackups() {
  if (!fileBackupsAvailable()) return [];
  const entries = await fs.readdir(config.backupDir).catch(() => [] as string[]);
  const files = entries.filter((f) => f.endsWith('.json') && f.startsWith('tarangos-'));
  const stats = await Promise.all(
    files.map(async (filename) => {
      const stat = await fs.stat(path.join(config.backupDir, filename));
      return {
        filename,
        size: stat.size,
        createdAt: stat.mtime.toISOString(),
        kind: filename.includes('-auto-') ? 'auto' : 'manual',
      };
    }),
  );
  return stats.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Keeps the newest `keep` files of each kind. */
export async function pruneBackups(keep: number): Promise<number> {
  const all = await listBackups();
  const groups = { auto: all.filter((b) => b.kind === 'auto'), manual: all.filter((b) => b.kind === 'manual') };
  let removed = 0;
  for (const list of Object.values(groups)) {
    for (const file of list.slice(keep)) {
      await fs.unlink(path.join(config.backupDir, file.filename)).catch(() => undefined);
      removed += 1;
    }
  }
  return removed;
}

/** Guards against path traversal — only plain filenames from our own folder. */
export function resolveBackupPath(filename: string): string {
  if (!/^tarangos-[a-z]+-[\d-]+\.json$/.test(filename)) {
    throw new Error('Invalid backup filename');
  }
  const resolved = path.resolve(config.backupDir, filename);
  if (!resolved.startsWith(path.resolve(config.backupDir))) throw new Error('Invalid backup path');
  return resolved;
}

export function validateBackup(payload: unknown): asserts payload is BackupPayload {
  const p = payload as BackupPayload;
  if (!p || typeof p !== 'object') throw new Error('Backup file is not valid JSON');
  if (p.format !== BACKUP_FORMAT) throw new Error('This file is not a TarangOS backup');
  if (typeof p.version !== 'number' || p.version > BACKUP_VERSION) {
    throw new Error(`Backup version ${p.version} is newer than this app supports`);
  }
  if (!p.data || typeof p.data !== 'object') throw new Error('Backup is missing its data section');
}

type RestoreMode = 'replace' | 'merge';

/**
 * Restores a backup into the current account.
 *
 * `replace` wipes existing content first (a safety backup is taken by the route
 * before this runs); `merge` keeps what is there and skips colliding ids.
 */
export async function restoreBackup(userId: string, payload: BackupPayload, mode: RestoreMode) {
  validateBackup(payload);
  const d = payload.data;

  if (mode === 'replace') {
    await prisma.$transaction([
      prisma.habitEntry.deleteMany({ where: { habit: { userId } } }),
      prisma.habit.deleteMany({ where: { userId } }),
      prisma.focusSession.deleteMany({ where: { userId } }),
      prisma.note.deleteMany({ where: { userId } }),
      prisma.review.deleteMany({ where: { userId } }),
      prisma.taskTag.deleteMany({ where: { task: { userId } } }),
      prisma.subtask.deleteMany({ where: { task: { userId } } }),
      prisma.task.deleteMany({ where: { userId } }),
      prisma.milestone.deleteMany({ where: { goal: { userId } } }),
      prisma.goal.deleteMany({ where: { userId } }),
      prisma.project.deleteMany({ where: { userId } }),
      prisma.tag.deleteMany({ where: { userId } }),
      prisma.category.deleteMany({ where: { userId } }),
      prisma.dayStat.deleteMany({ where: { userId } }),
    ]);
  }

  // Rows come from a JSON file, so they are structurally unchecked here; Prisma
  // still validates them at insert time and failures are skipped per-row.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const stripUser = (row: any): any => ({ ...row, userId });
  const dates = (row: any, keys: string[]): any => {
    const out = { ...row };
    for (const key of keys) {
      const value = out[key];
      if (typeof value === 'string') out[key] = new Date(value);
    }
    return out;
  };

  const created: Record<string, number> = {};
  const insert = async (name: string, rows: unknown[], fn: (row: any) => Promise<unknown>) => {
    let count = 0;
    for (const row of rows ?? []) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await fn(row);
        count += 1;
      } catch {
        /* merge mode: skip rows that collide or reference missing parents */
      }
    }
    created[name] = count;
  };

  // Order matters — parents before children.
  await insert('categories', d.categories, (row) =>
    prisma.category.create({ data: stripUser(row) }));
  await insert('tags', d.tags, (row) => prisma.tag.create({ data: stripUser(row) }));
  await insert('projects', d.projects, (row) =>
    prisma.project.create({ data: dates(stripUser(row), ['createdAt', 'updatedAt', 'archivedAt']) }));
  await insert('goals', d.goals, (row) =>
    prisma.goal.create({ data: dates(stripUser(row), ['createdAt', 'updatedAt', 'completedAt']) }));
  await insert('milestones', d.milestones, (row) =>
    prisma.milestone.create({ data: dates(row, ['doneAt']) }));
  await insert('tasks', d.tasks, (row) =>
    prisma.task.create({
      data: dates(stripUser(row), ['createdAt', 'updatedAt', 'completedAt', 'archivedAt', 'reminderAt', 'reminderSentAt']),
    }));
  await insert('subtasks', d.subtasks, (row) =>
    prisma.subtask.create({ data: dates(row, ['doneAt']) }));
  await insert('taskTags', d.taskTags, (row) => prisma.taskTag.create({ data: row }));
  await insert('habits', d.habits, (row) =>
    prisma.habit.create({ data: dates(stripUser(row), ['createdAt', 'updatedAt', 'archivedAt']) }));
  await insert('habitEntries', d.habitEntries, (row) =>
    prisma.habitEntry.create({ data: dates(row, ['at']) }));
  await insert('focusSessions', d.focusSessions, (row) =>
    prisma.focusSession.create({ data: dates(stripUser(row), ['startedAt', 'endedAt']) }));
  await insert('reviews', d.reviews, (row) =>
    prisma.review.create({ data: dates(stripUser(row), ['createdAt', 'updatedAt']) }));
  await insert('notes', d.notes, (row) =>
    prisma.note.create({ data: dates(stripUser(row), ['createdAt', 'updatedAt']) }));
  /* eslint-enable @typescript-eslint/no-explicit-any */

  return created;
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  // Neutralise spreadsheet formula injection.
  const safe = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
  return `"${safe.replace(/"/g, '""')}"`;
}

export const TASK_CSV_COLUMNS = [
  'title', 'description', 'notes', 'date', 'startTime', 'dueTime', 'priority', 'status',
  'energy', 'estimatedMinutes', 'actualMinutes', 'category', 'project', 'goal', 'tags',
  'postponedCount', 'missReason', 'completedAt', 'createdAt',
] as const;

export async function exportTasksCsv(userId: string, from?: string, to?: string): Promise<string> {
  const tasks = await prisma.task.findMany({
    where: { userId, ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}) },
    include: {
      category: { select: { name: true } },
      project: { select: { name: true } },
      goal: { select: { title: true } },
      tags: { include: { tag: { select: { name: true } } } },
    },
    orderBy: { date: 'asc' },
  });

  const rows = tasks.map((t) =>
    [
      t.title, t.description, t.notes, t.date, t.startTime, t.dueTime, t.priority, t.status,
      t.energy, t.estimatedMinutes, t.actualMinutes,
      t.category?.name ?? '', t.project?.name ?? '', t.goal?.title ?? '',
      t.tags.map((x) => x.tag.name).join(' '),
      t.postponedCount, t.missReason,
      t.completedAt?.toISOString() ?? '', t.createdAt.toISOString(),
    ]
      .map(csvCell)
      .join(','),
  );

  return [TASK_CSV_COLUMNS.join(','), ...rows].join('\r\n');
}

/** Minimal RFC-4180 parser — handles quotes, escaped quotes and embedded newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else inQuotes = false;
      } else field += char;
      continue;
    }
    if (char === '"') inQuotes = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') field += char;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}
