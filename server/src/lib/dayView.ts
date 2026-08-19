import type { User } from '@prisma/client';
import { prisma } from './db';
import { addDays, type DateStr, todayStr } from './dates';
import {
  computeStreaks,
  loadRange,
  scoreDay,
  summarizeRange,
  type DayMetrics,
} from './metrics';
import { parseSettings } from './user';
import { serializeTask, taskInclude } from './tasks';

/**
 * Everything needed to render (or review) a single day, including the streak
 * leading up to it. Used by the dashboard, the day review and history.
 */
export async function getDayMetrics(user: User, date: DateStr): Promise<DayMetrics> {
  const settings = parseSettings(user.settings);
  const today = todayStr(user.timezone);
  const streakFrom = addDays(date, -60);

  const [tasks, focus, habitsPlanned, habitsDone, priorRange] = await Promise.all([
    prisma.task.findMany({ where: { userId: user.id, date } }),
    prisma.focusSession.aggregate({
      where: { userId: user.id, date, mode: 'focus' },
      _sum: { actualMinutes: true },
      _count: { _all: true },
    }),
    prisma.habit.count({
      where: {
        userId: user.id,
        cadence: 'daily',
        OR: [{ archivedAt: null }, { archivedAt: { gt: new Date(`${date}T00:00:00Z`) } }],
      },
    }),
    prisma.habitEntry.count({ where: { habit: { userId: user.id }, date, done: true } }),
    loadRange(user.id, streakFrom, addDays(date, -1)),
  ]);

  const priorSummaries = summarizeRange(priorRange, streakFrom, addDays(date, -1), today, settings);
  const { current: streak } = computeStreaks(priorSummaries, addDays(date, -1));

  return scoreDay(date, {
    tasks,
    focusMinutes: focus._sum.actualMinutes ?? 0,
    focusSessions: focus._count._all ?? 0,
    habitsPlanned,
    habitsDone,
    streak,
    settings,
    isPast: date < today,
  });
}

/** Tasks for a day, fully serialized and sorted the way the UI shows them. */
export async function getDayTasks(userId: string, date: DateStr) {
  const tasks = await prisma.task.findMany({
    where: { userId, date, archivedAt: null },
    include: taskInclude,
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
  });
  const rank: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
  return tasks
    .map(serializeTask)
    .sort((a, b) => {
      if (a.status === 'completed' !== (b.status === 'completed')) return a.status === 'completed' ? 1 : -1;
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (a.order !== b.order) return a.order - b.order;
      if (a.priority !== b.priority) return rank[a.priority] - rank[b.priority];
      return (a.startTime || '99:99').localeCompare(b.startTime || '99:99');
    });
}
