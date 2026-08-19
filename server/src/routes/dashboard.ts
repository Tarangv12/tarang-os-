import { Router } from 'express';
import { prisma } from '../lib/db';
import { ah } from '../lib/errors';
import { csrfProtect, requireAuth } from '../middleware/auth';
import { addDays, nowTimeStr, startOfWeek, todayStr } from '../lib/dates';
import { getDayMetrics, getDayTasks } from '../lib/dayView';
import { computeStreaks, loadRange, summarizeRange } from '../lib/metrics';
import { parseSettings } from '../lib/user';
import { materializeRecurring } from '../lib/tasks';

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth, csrfProtect);

function greeting(time: string): string {
  const hour = Number(time.slice(0, 2));
  if (hour < 5) return 'Still up';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  if (hour < 21) return 'Good evening';
  return 'Good night';
}

dashboardRouter.get(
  '/',
  ah(async (req, res) => {
    const user = req.user!;
    const settings = parseSettings(user.settings);
    const today = todayStr(user.timezone);
    const now = nowTimeStr(user.timezone);

    // Keep recurring series populated before anything reads them.
    await materializeRecurring(user.id, today);

    const rangeFrom = addDays(today, -89);
    const [
      metrics,
      tasks,
      overdue,
      upcoming,
      habits,
      habitEntriesToday,
      goals,
      activeFocus,
      todayReview,
      bundle,
    ] = await Promise.all([
      getDayMetrics(user, today),
      getDayTasks(user.id, today),
      prisma.task.findMany({
        where: { userId: user.id, date: { lt: today }, archivedAt: null, status: { notIn: ['completed', 'archived'] } },
        orderBy: [{ date: 'asc' }, { priority: 'asc' }],
        take: 50,
        select: { id: true, title: true, date: true, priority: true, status: true, postponedCount: true },
      }),
      prisma.task.findMany({
        where: { userId: user.id, date: { gt: today, lte: addDays(today, 7) }, archivedAt: null, status: { not: 'completed' } },
        orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
        take: 25,
        select: { id: true, title: true, date: true, startTime: true, dueTime: true, priority: true },
      }),
      prisma.habit.findMany({
        where: { userId: user.id, archivedAt: null },
        orderBy: { order: 'asc' },
        select: { id: true, name: true, color: true, icon: true, cadence: true, targetPerWeek: true, reminderTime: true },
      }),
      prisma.habitEntry.findMany({
        where: { habit: { userId: user.id }, date: today, done: true },
        select: { habitId: true },
      }),
      prisma.goal.findMany({
        where: { userId: user.id, status: 'active' },
        orderBy: [{ targetDate: 'asc' }],
        take: 6,
        include: { milestones: { select: { done: true } }, _count: { select: { tasks: true } } },
      }),
      prisma.focusSession.findFirst({
        where: { userId: user.id, endedAt: null },
        include: { task: { select: { id: true, title: true } } },
      }),
      prisma.review.findUnique({ where: { userId_type_date: { userId: user.id, type: 'daily', date: today } } }),
      loadRange(user.id, rangeFrom, today),
    ]);

    const summaries = summarizeRange(bundle, rangeFrom, today, today, settings);
    const streaks = computeStreaks(summaries, today);
    const weekStart = startOfWeek(today);
    const weekDays = summaries.filter((d) => d.date >= weekStart);
    const doneHabitIds = new Set(habitEntriesToday.map((e) => e.habitId));

    const goalSummaries = goals.map((g) => {
      const done = g.milestones.filter((m) => m.done).length;
      const progress =
        g.metricType === 'numeric' && g.targetValue > 0
          ? Math.min(1, g.currentValue / g.targetValue)
          : g.milestones.length
            ? done / g.milestones.length
            : 0;
      return {
        id: g.id,
        title: g.title,
        type: g.type,
        color: g.color,
        targetDate: g.targetDate,
        progress,
        milestonesDone: done,
        milestoneCount: g.milestones.length,
        taskCount: g._count.tasks,
      };
    });

    const nextUp = tasks.find((t) => t.status !== 'completed') ?? null;

    res.json({
      today,
      now,
      greeting: greeting(now),
      user: { displayName: user.displayName || user.username, timezone: user.timezone },
      metrics,
      tasks,
      nextUp,
      overdue,
      upcoming,
      highPriority: tasks.filter((t) => (t.priority === 'urgent' || t.priority === 'high') && t.status !== 'completed'),
      habits: habits.map((h) => ({ ...h, doneToday: doneHabitIds.has(h.id) })),
      goals: goalSummaries,
      activeFocus,
      todayReview,
      streak: streaks,
      week: {
        start: weekStart,
        planned: weekDays.reduce((s, d) => s + d.planned, 0),
        completed: weekDays.reduce((s, d) => s + d.completed, 0),
        focusMinutes: weekDays.reduce((s, d) => s + d.focusMinutes, 0),
        avgScore: weekDays.length ? Math.round(weekDays.reduce((s, d) => s + d.score, 0) / weekDays.length) : 0,
        days: weekDays,
      },
      trend: summaries.slice(-30),
      targets: {
        dailyTasks: settings.dailyTaskTarget,
        dailyFocusMinutes: settings.dailyFocusTargetMinutes,
      },
    });
  }),
);

/**
 * "Plan My Day" — orders today's open tasks by a transparent urgency model so
 * you can accept the suggestion or override it with drag-and-drop.
 */
dashboardRouter.post(
  '/plan-my-day',
  ah(async (req, res) => {
    const user = req.user!;
    const today = todayStr(user.timezone);
    const settings = parseSettings(user.settings);

    const tasks = await prisma.task.findMany({
      where: { userId: user.id, date: today, archivedAt: null, status: { not: 'completed' } },
    });

    const priorityWeight: Record<string, number> = { urgent: 100, high: 70, medium: 40, low: 15 };
    const energyWeight: Record<string, number> = { high: 12, medium: 6, low: 0 };

    const scored = tasks.map((task) => {
      let score = priorityWeight[task.priority] ?? 40;
      const reasons: string[] = [`${task.priority} priority`];

      if (task.dueTime) {
        score += 25;
        reasons.push(`due at ${task.dueTime}`);
      }
      if (task.startTime) {
        score += 18;
        reasons.push(`scheduled ${task.startTime}`);
      }
      if (task.postponedCount > 0) {
        score += Math.min(30, task.postponedCount * 12);
        reasons.push(`postponed ${task.postponedCount}×`);
      }
      if (task.originalDate && task.originalDate < today) {
        score += 15;
        reasons.push('carried over');
      }
      if (task.estimatedMinutes > 0 && task.estimatedMinutes <= 15) {
        score += 8;
        reasons.push('quick win');
      }
      if (task.estimatedMinutes > 120) {
        score -= 6;
        reasons.push('long task');
      }
      score += energyWeight[task.energy] ?? 6;
      if (task.pinned) {
        score += 40;
        reasons.push('pinned');
      }

      return { task, score, reasons };
    });

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const at = a.task.startTime || a.task.dueTime || '99:99';
      const bt = b.task.startTime || b.task.dueTime || '99:99';
      return at.localeCompare(bt);
    });

    await prisma.$transaction(
      scored.map((s, index) => prisma.task.update({ where: { id: s.task.id }, data: { order: index + 1 } })),
    );

    const totalMinutes = scored.reduce((s, x) => s + (x.task.estimatedMinutes || 0), 0);

    res.json({
      ok: true,
      plan: scored.map((s, index) => ({
        id: s.task.id,
        title: s.task.title,
        order: index + 1,
        score: s.score,
        reasons: s.reasons,
        estimatedMinutes: s.task.estimatedMinutes,
      })),
      totalEstimatedMinutes: totalMinutes,
      capacityMinutes: settings.dailyFocusTargetMinutes,
      overCapacity: totalMinutes > settings.dailyFocusTargetMinutes * 1.5,
      tasks: await getDayTasks(user.id, today),
    });
  }),
);

/**
 * Eisenhower matrix. Urgency comes from the calendar (how soon it is due),
 * importance from the priority you assigned.
 */
dashboardRouter.get(
  '/eisenhower',
  ah(async (req, res) => {
    const user = req.user!;
    const today = todayStr(user.timezone);
    const horizon = addDays(today, 14);

    const tasks = await prisma.task.findMany({
      where: { userId: user.id, archivedAt: null, status: { not: 'completed' }, date: { lte: horizon } },
      include: { category: { select: { id: true, name: true, color: true } } },
      orderBy: [{ date: 'asc' }],
      take: 400,
    });

    const quadrants = {
      do: [] as typeof tasks,
      schedule: [] as typeof tasks,
      delegate: [] as typeof tasks,
      eliminate: [] as typeof tasks,
    };

    for (const task of tasks) {
      const urgent = task.date <= addDays(today, 1) || task.priority === 'urgent';
      const important = task.priority === 'urgent' || task.priority === 'high';
      if (urgent && important) quadrants.do.push(task);
      else if (!urgent && important) quadrants.schedule.push(task);
      else if (urgent && !important) quadrants.delegate.push(task);
      else quadrants.eliminate.push(task);
    }

    res.json({ today, quadrants });
  }),
);
