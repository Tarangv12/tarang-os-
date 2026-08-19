import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db';
import { ah } from '../lib/errors';
import { csrfProtect, requireAuth } from '../middleware/auth';
import { analyticsLimiter } from '../middleware/rateLimit';
import { addDays, eachDay, todayStr } from '../lib/dates';
import {
  computeStreaks,
  loadRange,
  monthlyBuckets,
  summarizeRange,
  weekdayPerformance,
  weeklyBuckets,
} from '../lib/metrics';
import { parseSettings } from '../lib/user';
import { getDayMetrics, getDayTasks } from '../lib/dayView';

export const analyticsRouter = Router();
analyticsRouter.use(requireAuth, csrfProtect);

// Every route here fans out across the whole dataset, so it is both the most
// expensive surface to serve and the most attractive one to scrape.
analyticsRouter.use(analyticsLimiter);

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const RANGES = { '7': 7, '30': 30, '90': 90, '180': 180, '365': 365 } as const;

/** Everything the Progress + Analytics screens need, in one round trip. */
analyticsRouter.get(
  '/overview',
  ah(async (req, res) => {
    const user = req.user!;
    const settings = parseSettings(user.settings);
    const today = todayStr(user.timezone);
    const q = z
      .object({ range: z.enum(['7', '30', '90', '180', '365']).default('30'), from: dateStr.optional(), to: dateStr.optional() })
      .parse(req.query);

    const to = q.to ?? today;
    const from = q.from ?? addDays(to, -(RANGES[q.range] - 1));

    const bundle = await loadRange(user.id, from, to);
    const summaries = summarizeRange(bundle, from, to, today, settings);

    const planned = summaries.reduce((s, d) => s + d.planned, 0);
    const completed = summaries.reduce((s, d) => s + d.completed, 0);
    const missed = summaries.reduce((s, d) => s + d.missed, 0);
    const postponed = summaries.reduce((s, d) => s + d.postponed, 0);
    const focusMinutes = summaries.reduce((s, d) => s + d.focusMinutes, 0);
    const activeDays = summaries.filter((d) => d.planned > 0 || d.completed > 0).length;

    // Comparison against the immediately preceding window of the same length.
    const span = summaries.length;
    const prevTo = addDays(from, -1);
    const prevFrom = addDays(prevTo, -(span - 1));
    const prevBundle = await loadRange(user.id, prevFrom, prevTo);
    const prevSummaries = summarizeRange(prevBundle, prevFrom, prevTo, today, settings);
    const prevPlanned = prevSummaries.reduce((s, d) => s + d.planned, 0);
    const prevCompleted = prevSummaries.reduce((s, d) => s + d.completed, 0);

    const [byCategory, byPriority, byProject] = await Promise.all([
      groupCompletion(user.id, from, to, 'categoryId'),
      groupCompletion(user.id, from, to, 'priority'),
      groupCompletion(user.id, from, to, 'projectId'),
    ]);

    const categories = await prisma.category.findMany({
      where: { userId: user.id },
      select: { id: true, name: true, color: true },
    });
    const projects = await prisma.project.findMany({
      where: { userId: user.id },
      select: { id: true, name: true, color: true },
    });
    const categoryMap = new Map(categories.map((c) => [c.id, c]));
    const projectMap = new Map(projects.map((p) => [p.id, p]));

    const avgScore = summaries.length
      ? Math.round(summaries.reduce((s, d) => s + d.score, 0) / summaries.length)
      : 0;
    const prevAvgScore = prevSummaries.length
      ? Math.round(prevSummaries.reduce((s, d) => s + d.score, 0) / prevSummaries.length)
      : 0;

    res.json({
      range: { from, to, days: summaries.length, label: q.range },
      totals: {
        planned,
        completed,
        missed,
        postponed,
        focusMinutes,
        focusHours: Math.round((focusMinutes / 60) * 10) / 10,
        completionRate: planned ? completed / planned : 0,
        avgTasksPerDay: summaries.length ? completed / summaries.length : 0,
        avgTasksPerActiveDay: activeDays ? completed / activeDays : 0,
        avgFocusPerDay: summaries.length ? focusMinutes / summaries.length : 0,
        avgScore,
        activeDays,
      },
      comparison: {
        previous: {
          from: prevFrom,
          to: prevTo,
          planned: prevPlanned,
          completed: prevCompleted,
          completionRate: prevPlanned ? prevCompleted / prevPlanned : 0,
          avgScore: prevAvgScore,
        },
        completedDelta: completed - prevCompleted,
        completionRateDelta: (planned ? completed / planned : 0) - (prevPlanned ? prevCompleted / prevPlanned : 0),
        scoreDelta: avgScore - prevAvgScore,
      },
      daily: summaries,
      weekly: weeklyBuckets(summaries),
      monthly: monthlyBuckets(summaries),
      weekday: weekdayPerformance(summaries),
      streaks: computeStreaks(summaries, today),
      byCategory: byCategory.map((row) => ({
        key: row.key,
        name: row.key ? categoryMap.get(row.key)?.name ?? 'Unknown' : 'Uncategorised',
        color: row.key ? categoryMap.get(row.key)?.color ?? '#94a3b8' : '#94a3b8',
        total: row.total,
        completed: row.completed,
        completionRate: row.total ? row.completed / row.total : 0,
      })),
      byProject: byProject
        .filter((row) => row.key)
        .map((row) => ({
          key: row.key,
          name: projectMap.get(row.key!)?.name ?? 'Unknown',
          color: projectMap.get(row.key!)?.color ?? '#94a3b8',
          total: row.total,
          completed: row.completed,
          completionRate: row.total ? row.completed / row.total : 0,
        })),
      byPriority: ['urgent', 'high', 'medium', 'low'].map((p) => {
        const row = byPriority.find((r) => r.key === p);
        return {
          key: p,
          name: p,
          total: row?.total ?? 0,
          completed: row?.completed ?? 0,
          completionRate: row?.total ? row.completed / row.total : 0,
        };
      }),
    });
  }),
);

/** Calendar heatmap data — up to 12 months at day resolution. */
analyticsRouter.get(
  '/heatmap',
  ah(async (req, res) => {
    const user = req.user!;
    const settings = parseSettings(user.settings);
    const today = todayStr(user.timezone);
    const days = Math.min(Number(req.query.days) || 182, 400);
    const from = addDays(today, -(days - 1));

    const bundle = await loadRange(user.id, from, today);
    const summaries = summarizeRange(bundle, from, today, today, settings);

    res.json({
      from,
      to: today,
      days: summaries.map((d) => ({
        date: d.date,
        score: d.score,
        completed: d.completed,
        planned: d.planned,
        focusMinutes: d.focusMinutes,
        level: d.completed === 0 ? 0 : d.score >= 85 ? 4 : d.score >= 65 ? 3 : d.score >= 40 ? 2 : 1,
      })),
    });
  }),
);

/** Personal records — the "you have done this before" evidence. */
analyticsRouter.get(
  '/records',
  ah(async (req, res) => {
    const user = req.user!;
    const settings = parseSettings(user.settings);
    const today = todayStr(user.timezone);
    const from = addDays(today, -729);

    const bundle = await loadRange(user.id, from, today);
    const summaries = summarizeRange(bundle, from, today, today, settings);
    const withActivity = summaries.filter((d) => d.completed > 0);

    const bestDay = [...withActivity].sort((a, b) => b.completed - a.completed)[0] ?? null;
    const bestScoreDay = [...withActivity].sort((a, b) => b.score - a.score)[0] ?? null;
    const bestFocusDay = [...summaries].sort((a, b) => b.focusMinutes - a.focusMinutes)[0] ?? null;
    const weeks = weeklyBuckets(summaries);
    const bestWeek = [...weeks].sort((a, b) => b.completed - a.completed)[0] ?? null;
    const months = monthlyBuckets(summaries);
    const bestMonth = [...months].sort((a, b) => b.completed - a.completed)[0] ?? null;

    const [totalCompleted, totalFocus, habitBest] = await Promise.all([
      prisma.task.count({ where: { userId: user.id, status: 'completed' } }),
      prisma.focusSession.aggregate({ where: { userId: user.id, mode: 'focus' }, _sum: { actualMinutes: true } }),
      prisma.habitEntry.count({ where: { habit: { userId: user.id }, done: true } }),
    ]);

    res.json({
      streaks: computeStreaks(summaries, today),
      bestDay,
      bestScoreDay,
      bestFocusDay,
      bestWeek,
      bestMonth,
      lifetime: {
        tasksCompleted: totalCompleted,
        focusMinutes: totalFocus._sum.actualMinutes ?? 0,
        focusHours: Math.round(((totalFocus._sum.actualMinutes ?? 0) / 60) * 10) / 10,
        habitCheckIns: habitBest,
        daysTracked: withActivity.length,
      },
    });
  }),
);

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

/** Day-by-day list for the History screen. Defaults to the last 6 months. */
analyticsRouter.get(
  '/history',
  ah(async (req, res) => {
    const user = req.user!;
    const settings = parseSettings(user.settings);
    const today = todayStr(user.timezone);
    const q = z.object({ from: dateStr.optional(), to: dateStr.optional(), days: z.coerce.number().int().min(1).max(800).optional() }).parse(req.query);

    const to = q.to ?? today;
    const from = q.from ?? addDays(to, -((q.days ?? 182) - 1));

    const bundle = await loadRange(user.id, from, to);
    const summaries = summarizeRange(bundle, from, to, today, settings);

    const [reviews, notes] = await Promise.all([
      prisma.review.findMany({
        where: { userId: user.id, type: 'daily', date: { gte: from, lte: to } },
        select: { date: true, rating: true, mood: true },
      }),
      prisma.note.groupBy({
        by: ['date'],
        where: { userId: user.id, date: { gte: from, lte: to } },
        _count: { _all: true },
      }),
    ]);

    const reviewMap = new Map(reviews.map((r) => [r.date, r]));
    const noteMap = new Map(notes.map((n) => [n.date!, n._count._all]));

    res.json({
      from,
      to,
      days: summaries
        .map((d) => ({
          ...d,
          hasReview: reviewMap.has(d.date),
          rating: reviewMap.get(d.date)?.rating ?? 0,
          mood: reviewMap.get(d.date)?.mood ?? '',
          noteCount: noteMap.get(d.date) ?? 0,
        }))
        .reverse(),
    });
  }),
);

/** Everything that happened on one specific day. */
analyticsRouter.get(
  '/history/:date',
  ah(async (req, res) => {
    const user = req.user!;
    const date = dateStr.parse(req.params.date);

    const [metrics, tasks, review, notes, focus, habitEntries, habits] = await Promise.all([
      getDayMetrics(user, date),
      getDayTasks(user.id, date),
      prisma.review.findUnique({ where: { userId_type_date: { userId: user.id, type: 'daily', date } } }),
      prisma.note.findMany({ where: { userId: user.id, date }, orderBy: { updatedAt: 'desc' } }),
      prisma.focusSession.findMany({
        where: { userId: user.id, date },
        include: { task: { select: { id: true, title: true } } },
        orderBy: { startedAt: 'asc' },
      }),
      prisma.habitEntry.findMany({ where: { habit: { userId: user.id }, date }, include: { habit: true } }),
      prisma.habit.findMany({ where: { userId: user.id, archivedAt: null }, select: { id: true, name: true, color: true, cadence: true } }),
    ]);

    const doneIds = new Set(habitEntries.filter((e) => e.done).map((e) => e.habitId));

    res.json({
      date,
      metrics,
      tasks,
      review: review
        ? { ...review, missReasons: safeParse(review.missReasons), snapshot: safeParse(review.snapshot) }
        : null,
      notes,
      focusSessions: focus,
      habits: habits.map((h) => ({ ...h, done: doneIds.has(h.id) })),
    });
  }),
);

/** Month grid for the Calendar screen. */
analyticsRouter.get(
  '/calendar',
  ah(async (req, res) => {
    const user = req.user!;
    const settings = parseSettings(user.settings);
    const today = todayStr(user.timezone);
    const q = z.object({ from: dateStr, to: dateStr }).parse(req.query);

    const [bundle, tasks] = await Promise.all([
      loadRange(user.id, q.from, q.to),
      prisma.task.findMany({
        where: { userId: user.id, date: { gte: q.from, lte: q.to }, archivedAt: null },
        select: {
          id: true, title: true, date: true, startTime: true, dueTime: true, priority: true,
          status: true, estimatedMinutes: true,
          category: { select: { id: true, name: true, color: true } },
          project: { select: { id: true, name: true, color: true } },
        },
        orderBy: [{ date: 'asc' }, { startTime: 'asc' }, { order: 'asc' }],
      }),
    ]);

    const summaries = summarizeRange(bundle, q.from, q.to, today, settings);
    const byDate = new Map<string, typeof tasks>();
    for (const t of tasks) {
      const list = byDate.get(t.date);
      if (list) list.push(t);
      else byDate.set(t.date, [t]);
    }

    res.json({
      from: q.from,
      to: q.to,
      today,
      days: eachDay(q.from, q.to).map((date) => {
        const summary = summaries.find((s) => s.date === date);
        return {
          date,
          tasks: byDate.get(date) ?? [],
          planned: summary?.planned ?? 0,
          completed: summary?.completed ?? 0,
          score: summary?.score ?? 0,
        };
      }),
    });
  }),
);

// ---------------------------------------------------------------------------

async function groupCompletion(userId: string, from: string, to: string, field: 'categoryId' | 'priority' | 'projectId') {
  const rows = await prisma.task.groupBy({
    by: [field, 'status'],
    where: { userId, date: { gte: from, lte: to }, archivedAt: null },
    _count: { _all: true },
  });

  const map = new Map<string | null, { key: string | null; total: number; completed: number }>();
  for (const row of rows) {
    const key = (row as Record<string, unknown>)[field] as string | null;
    const entry = map.get(key) ?? { key, total: 0, completed: 0 };
    entry.total += row._count._all;
    if (row.status === 'completed') entry.completed += row._count._all;
    map.set(key, entry);
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}

function safeParse(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
