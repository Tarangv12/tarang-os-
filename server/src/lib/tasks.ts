import type { Prisma } from '@prisma/client';
import { prisma } from './db';
import { addDays, type DateStr } from './dates';
import { describeRule, nextDate, parseRule } from './recurrence';

export const taskInclude = {
  subtasks: { orderBy: { order: 'asc' } },
  tags: { include: { tag: true } },
  category: { select: { id: true, name: true, color: true, icon: true } },
  project: { select: { id: true, name: true, color: true } },
  goal: { select: { id: true, title: true, color: true } },
} satisfies Prisma.TaskInclude;

export type TaskWithRelations = Prisma.TaskGetPayload<{ include: typeof taskInclude }>;

export function serializeTask(task: TaskWithRelations) {
  const rule = parseRule(task.recurrenceRule);
  const subtasks = task.subtasks ?? [];
  const doneSubtasks = subtasks.filter((s) => s.done).length;

  return {
    id: task.id,
    title: task.title,
    description: task.description,
    notes: task.notes,
    date: task.date,
    startTime: task.startTime,
    dueTime: task.dueTime,
    priority: task.priority,
    status: task.status,
    energy: task.energy,
    estimatedMinutes: task.estimatedMinutes,
    actualMinutes: task.actualMinutes,
    reminderAt: task.reminderAt,
    reminderMinutesBefore: task.reminderMinutesBefore,
    recurrence: rule,
    recurrenceLabel: rule ? describeRule(rule) : null,
    recurrenceParentId: task.recurrenceParentId,
    isRecurring: Boolean(rule || task.recurrenceParentId),
    categoryId: task.categoryId,
    category: task.category,
    projectId: task.projectId,
    project: task.project,
    goalId: task.goalId,
    goal: task.goal,
    completedAt: task.completedAt,
    archivedAt: task.archivedAt,
    postponedCount: task.postponedCount,
    originalDate: task.originalDate,
    missReason: task.missReason,
    order: task.order,
    pinned: task.pinned,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    tags: (task.tags ?? []).map((tt) => ({ id: tt.tag.id, name: tt.tag.name, color: tt.tag.color })),
    subtasks: subtasks.map((s) => ({ id: s.id, title: s.title, done: s.done, order: s.order })),
    subtaskProgress: subtasks.length ? doneSubtasks / subtasks.length : null,
    subtaskCount: subtasks.length,
    subtasksDone: doneSubtasks,
  };
}

export type SerializedTask = ReturnType<typeof serializeTask>;

/** Creates tags on demand and returns their ids. */
export async function resolveTagIds(userId: string, names: string[]): Promise<string[]> {
  const clean = Array.from(
    new Set(names.map((n) => n.trim().toLowerCase()).filter((n) => n.length > 0 && n.length <= 30)),
  ).slice(0, 20);
  if (!clean.length) return [];

  const existing = await prisma.tag.findMany({ where: { userId, name: { in: clean } } });
  const found = new Map(existing.map((t) => [t.name, t.id]));
  const missing = clean.filter((n) => !found.has(n));

  for (const name of missing) {
    const created = await prisma.tag.upsert({
      where: { userId_name: { userId, name } },
      update: {},
      create: { userId, name, color: pickTagColor(name) },
    });
    found.set(name, created.id);
  }
  return clean.map((n) => found.get(n)!).filter(Boolean);
}

const TAG_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];
function pickTagColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return TAG_COLORS[hash % TAG_COLORS.length];
}

/**
 * Generates upcoming occurrences of every active recurring series so they show
 * up in Upcoming/Calendar ahead of time and can be edited individually.
 *
 * Idempotent: it only ever appends dates after the latest existing occurrence.
 */
export async function materializeRecurring(
  userId: string,
  today: DateStr,
  horizonDays = 30,
): Promise<number> {
  const horizon = addDays(today, horizonDays);

  const seeds = await prisma.task.findMany({
    where: { userId, recurrenceRule: { not: null }, archivedAt: null },
    include: { subtasks: true, tags: true },
  });

  let created = 0;

  for (const seed of seeds) {
    const rule = parseRule(seed.recurrenceRule);
    if (!rule) continue;

    const siblings = await prisma.task.findMany({
      where: {
        userId,
        OR: [{ id: seed.id }, { recurrenceParentId: seed.id }],
      },
      select: { date: true },
      orderBy: { date: 'desc' },
      take: 1,
    });

    let cursor: DateStr = siblings[0]?.date ?? seed.date;
    if (rule.count) {
      const existing = await prisma.task.count({
        where: { userId, OR: [{ id: seed.id }, { recurrenceParentId: seed.id }] },
      });
      if (existing >= rule.count) continue;
    }

    let guard = 0;
    while (guard < 400) {
      guard += 1;
      const next = nextDate(rule, cursor);
      if (!next || next > horizon) break;

      const exists = await prisma.task.findFirst({
        where: {
          userId,
          date: next,
          OR: [{ id: seed.id }, { recurrenceParentId: seed.id }],
        },
        select: { id: true },
      });

      if (!exists) {
        await prisma.task.create({
          data: {
            userId,
            title: seed.title,
            description: seed.description,
            notes: '',
            date: next,
            startTime: seed.startTime,
            dueTime: seed.dueTime,
            priority: seed.priority,
            energy: seed.energy,
            estimatedMinutes: seed.estimatedMinutes,
            reminderMinutesBefore: seed.reminderMinutesBefore,
            categoryId: seed.categoryId,
            projectId: seed.projectId,
            goalId: seed.goalId,
            recurrenceParentId: seed.id,
            order: seed.order,
            subtasks: {
              create: seed.subtasks.map((s) => ({ title: s.title, order: s.order })),
            },
            tags: {
              create: seed.tags.map((t) => ({ tagId: t.tagId })),
            },
          },
        });
        created += 1;
      }
      cursor = next;
    }
  }

  return created;
}

/** Nightly hygiene: nothing is deleted, but stale reminders are cleared. */
export async function clearStaleReminders(userId: string, now: Date): Promise<void> {
  await prisma.task.updateMany({
    where: { userId, status: 'completed', reminderAt: { not: null, lt: now } },
    data: { reminderAt: null },
  });
}
