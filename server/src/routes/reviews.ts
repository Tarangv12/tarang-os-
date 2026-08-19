import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db';
import { ApiError, ah } from '../lib/errors';
import { csrfProtect, requireAuth } from '../middleware/auth';
import { addDays, eachDay, endOfWeek, startOfWeek, todayStr } from '../lib/dates';
import { getDayMetrics } from '../lib/dayView';
import { computeStreaks, loadRange, summarizeRange, weekdayPerformance } from '../lib/metrics';
import { parseSettings } from '../lib/user';

export const reviewsRouter = Router();
reviewsRouter.use(requireAuth, csrfProtect);

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Canonical reason codes; free text is kept separately in `missedWhy`. */
export const MISS_REASONS = [
  'ran_out_of_time',
  'low_energy',
  'interrupted',
  'unclear_next_step',
  'task_too_big',
  'waiting_on_someone',
  'changed_priorities',
  'procrastinated',
  'unwell',
  'overplanned',
] as const;

const reviewBody = z.object({
  type: z.enum(['daily', 'weekly']).default('daily'),
  date: dateStr,
  wentWell: z.string().max(4000).optional(),
  missedWhy: z.string().max(4000).optional(),
  missReasons: z.array(z.string().max(40)).max(12).optional(),
  distractions: z.string().max(2000).optional(),
  lessons: z.string().max(4000).optional(),
  improvements: z.string().max(4000).optional(),
  gratitude: z.string().max(2000).optional(),
  rating: z.number().int().min(0).max(5).optional(),
  mood: z.string().max(40).optional(),
  energy: z.number().int().min(0).max(5).optional(),
});

/**
 * Pre-fills a review with what actually happened, so the writing part is
 * reflection rather than recall.
 */
reviewsRouter.get(
  '/prepare',
  ah(async (req, res) => {
    const user = req.user!;
    const q = z
      .object({ type: z.enum(['daily', 'weekly']).default('daily'), date: dateStr.optional() })
      .parse(req.query);
    const today = todayStr(user.timezone);
    const date = q.date ?? (q.type === 'weekly' ? startOfWeek(today) : today);
    const settings = parseSettings(user.settings);

    if (q.type === 'daily') {
      const [metrics, tasks, existing, focus] = await Promise.all([
        getDayMetrics(user, date),
        prisma.task.findMany({
          where: { userId: user.id, date, archivedAt: null },
          select: { id: true, title: true, status: true, priority: true, missReason: true, postponedCount: true },
          orderBy: { order: 'asc' },
        }),
        prisma.review.findUnique({ where: { userId_type_date: { userId: user.id, type: 'daily', date } } }),
        prisma.focusSession.findMany({
          where: { userId: user.id, date, mode: 'focus' },
          select: { actualMinutes: true, interruptions: true },
        }),
      ]);

      res.json({
        type: 'daily',
        date,
        metrics,
        completed: tasks.filter((t) => t.status === 'completed'),
        missed: tasks.filter((t) => t.status !== 'completed'),
        interruptions: focus.reduce((s, f) => s + f.interruptions, 0),
        reasonOptions: MISS_REASONS,
        existing,
      });
      return;
    }

    const weekStart = startOfWeek(date);
    const weekEnd = endOfWeek(date);
    const bundle = await loadRange(user.id, weekStart, weekEnd);
    const summaries = summarizeRange(bundle, weekStart, weekEnd, today, settings);
    const [tasks, existing] = await Promise.all([
      prisma.task.findMany({
        where: { userId: user.id, date: { gte: weekStart, lte: weekEnd }, archivedAt: null },
        select: { id: true, title: true, status: true, priority: true, date: true, postponedCount: true, missReason: true },
      }),
      prisma.review.findUnique({ where: { userId_type_date: { userId: user.id, type: 'weekly', date: weekStart } } }),
    ]);

    const planned = summaries.reduce((s, d) => s + d.planned, 0);
    const completed = summaries.reduce((s, d) => s + d.completed, 0);

    res.json({
      type: 'weekly',
      date: weekStart,
      weekStart,
      weekEnd,
      days: summaries,
      metrics: {
        planned,
        completed,
        missed: summaries.reduce((s, d) => s + d.missed, 0),
        postponed: summaries.reduce((s, d) => s + d.postponed, 0),
        focusMinutes: summaries.reduce((s, d) => s + d.focusMinutes, 0),
        completionRate: planned ? completed / planned : 0,
        avgScore: summaries.length ? Math.round(summaries.reduce((s, d) => s + d.score, 0) / summaries.length) : 0,
        streaks: computeStreaks(summaries, today),
        weekday: weekdayPerformance(summaries),
      },
      completedTasks: tasks.filter((t) => t.status === 'completed'),
      missedTasks: tasks.filter((t) => t.status !== 'completed'),
      reasonOptions: MISS_REASONS,
      existing,
    });
  }),
);

reviewsRouter.get(
  '/',
  ah(async (req, res) => {
    const q = z
      .object({
        type: z.enum(['daily', 'weekly']).optional(),
        from: dateStr.optional(),
        to: dateStr.optional(),
        limit: z.coerce.number().int().min(1).max(400).optional(),
      })
      .parse(req.query);

    const reviews = await prisma.review.findMany({
      where: {
        userId: req.user!.id,
        ...(q.type ? { type: q.type } : {}),
        ...(q.from || q.to ? { date: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {}),
      },
      orderBy: { date: 'desc' },
      take: q.limit ?? 120,
    });
    res.json({ reviews: reviews.map(hydrate) });
  }),
);

/**
 * Which reasons show up most — the "why do I miss things" answer.
 * Declared before `/:type/:date` so the literal path wins over the parameter.
 */
reviewsRouter.get(
  '/insights/miss-reasons',
  ah(async (req, res) => {
    const user = req.user!;
    const today = todayStr(user.timezone);
    const days = Math.min(Number(req.query.days) || 180, 800);
    const from = addDays(today, -days);

    const reviews = await prisma.review.findMany({
      where: { userId: user.id, date: { gte: from, lte: today } },
      select: { missReasons: true, date: true },
    });

    const counts = new Map<string, number>();
    for (const r of reviews) {
      let list: string[] = [];
      try {
        list = JSON.parse(r.missReasons || '[]');
      } catch {
        list = [];
      }
      for (const reason of list) counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }

    const tasks = await prisma.task.findMany({
      where: { userId: user.id, date: { gte: from, lte: today }, missReason: { not: '' } },
      select: { missReason: true },
    });
    for (const t of tasks) {
      const key = t.missReason.trim().toLowerCase().replace(/\s+/g, '_').slice(0, 40);
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    const total = Array.from(counts.values()).reduce((s, n) => s + n, 0);
    const rows = Array.from(counts.entries())
      .map(([reason, count]) => ({ reason, count, share: total ? count / total : 0 }))
      .sort((a, b) => b.count - a.count);

    const mostPostponed = await prisma.task.findMany({
      where: { userId: user.id, postponedCount: { gt: 0 } },
      select: { id: true, title: true, postponedCount: true, date: true, priority: true },
      orderBy: { postponedCount: 'desc' },
      take: 10,
    });

    res.json({ from, to: today, reasons: rows, totalReviews: reviews.length, mostPostponed });
  }),
);

reviewsRouter.get(
  '/:type/:date',
  ah(async (req, res) => {
    const type = z.enum(['daily', 'weekly']).parse(req.params.type);
    const date = dateStr.parse(req.params.date);
    const review = await prisma.review.findUnique({
      where: { userId_type_date: { userId: req.user!.id, type, date } },
    });
    if (!review) throw ApiError.notFound('No review saved for that date');
    res.json({ review: hydrate(review) });
  }),
);

/** Upsert — reviews are edited in place, one per day/week. */
reviewsRouter.post(
  '/',
  ah(async (req, res) => {
    const user = req.user!;
    const body = reviewBody.parse(req.body);
    const date = body.type === 'weekly' ? startOfWeek(body.date) : body.date;

    const snapshot =
      body.type === 'daily'
        ? await getDayMetrics(user, date).then((m) => ({
            score: m.score,
            planned: m.planned,
            completed: m.completed,
            missed: m.missed,
            focusMinutes: m.focusMinutes,
            habitsDone: m.habitsDone,
            habitsPlanned: m.habitsPlanned,
          }))
        : await weeklySnapshot(user.id, date, parseSettings(user.settings), todayStr(user.timezone));

    const data = {
      wentWell: body.wentWell ?? '',
      missedWhy: body.missedWhy ?? '',
      missReasons: JSON.stringify(body.missReasons ?? []),
      distractions: body.distractions ?? '',
      lessons: body.lessons ?? '',
      improvements: body.improvements ?? '',
      gratitude: body.gratitude ?? '',
      rating: body.rating ?? 0,
      mood: body.mood ?? '',
      energy: body.energy ?? 0,
      snapshot: JSON.stringify(snapshot),
    };

    const review = await prisma.review.upsert({
      where: { userId_type_date: { userId: user.id, type: body.type, date } },
      update: data,
      create: { userId: user.id, type: body.type, date, ...data },
    });

    res.json({ review: hydrate(review) });
  }),
);

reviewsRouter.delete(
  '/:type/:date',
  ah(async (req, res) => {
    const type = z.enum(['daily', 'weekly']).parse(req.params.type);
    const date = dateStr.parse(req.params.date);
    await prisma.review.deleteMany({ where: { userId: req.user!.id, type, date } });
    res.json({ ok: true });
  }),
);

function hydrate(review: { missReasons: string; snapshot: string } & Record<string, unknown>) {
  let missReasons: string[] = [];
  let snapshot: Record<string, unknown> = {};
  try {
    missReasons = JSON.parse(review.missReasons || '[]');
  } catch {
    missReasons = [];
  }
  try {
    snapshot = JSON.parse(review.snapshot || '{}');
  } catch {
    snapshot = {};
  }
  return { ...review, missReasons, snapshot };
}

async function weeklySnapshot(userId: string, weekStart: string, settings: ReturnType<typeof parseSettings>, today: string) {
  const weekEnd = endOfWeek(weekStart);
  const bundle = await loadRange(userId, weekStart, weekEnd);
  const summaries = summarizeRange(bundle, weekStart, weekEnd, today, settings);
  const planned = summaries.reduce((s, d) => s + d.planned, 0);
  const completed = summaries.reduce((s, d) => s + d.completed, 0);
  return {
    planned,
    completed,
    missed: summaries.reduce((s, d) => s + d.missed, 0),
    focusMinutes: summaries.reduce((s, d) => s + d.focusMinutes, 0),
    completionRate: planned ? completed / planned : 0,
    avgScore: summaries.length ? Math.round(summaries.reduce((s, d) => s + d.score, 0) / summaries.length) : 0,
    days: eachDay(weekStart, weekEnd).length,
  };
}
