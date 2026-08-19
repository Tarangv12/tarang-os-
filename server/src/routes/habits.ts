import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db';
import { ApiError, ah } from '../lib/errors';
import { csrfProtect, requireAuth } from '../middleware/auth';
import { addDays, eachDay, startOfWeek, todayStr } from '../lib/dates';
import { habitStreak } from '../lib/metrics';

export const habitsRouter = Router();
habitsRouter.use(requireAuth, csrfProtect);

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const habitBody = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(1000).optional(),
  cadence: z.enum(['daily', 'weekly']).optional(),
  targetPerWeek: z.number().int().min(1).max(7).optional(),
  targetValue: z.number().min(0).max(100000).optional(),
  unit: z.string().max(20).optional(),
  color: color.optional(),
  icon: z.string().max(40).optional(),
  reminderTime: timeStr.nullable().optional(),
  startDate: dateStr.nullable().optional(),
  order: z.number().int().optional(),
});

async function ownedHabit(userId: string, id: string) {
  const habit = await prisma.habit.findFirst({ where: { id, userId } });
  if (!habit) throw ApiError.notFound('Habit not found');
  return habit;
}

/** Full habit payload: 180 days of history, streaks, weekly progress. */
habitsRouter.get(
  '/',
  ah(async (req, res) => {
    const user = req.user!;
    const today = todayStr(user.timezone);
    const historyDays = Math.min(Number(req.query.days) || 180, 400);
    const from = addDays(today, -historyDays);
    const includeArchived = req.query.includeArchived === 'true';

    const habits = await prisma.habit.findMany({
      where: { userId: user.id, ...(includeArchived ? {} : { archivedAt: null }) },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });

    const entries = await prisma.habitEntry.findMany({
      where: { habitId: { in: habits.map((h) => h.id) }, date: { gte: from, lte: today } },
      orderBy: { date: 'asc' },
    });

    const byHabit = new Map<string, typeof entries>();
    for (const e of entries) {
      const list = byHabit.get(e.habitId);
      if (list) list.push(e);
      else byHabit.set(e.habitId, [e]);
    }

    const weekStart = startOfWeek(today);
    const weekDays = eachDay(weekStart, today);

    const payload = habits.map((habit) => {
      const list = byHabit.get(habit.id) ?? [];
      const doneDates = new Set(list.filter((e) => e.done).map((e) => e.date));
      const { current, best } = habitStreak(doneDates, today);
      const start = habit.startDate || habit.createdAt.toISOString().slice(0, 10);
      const trackedFrom = start > from ? start : from;
      const possible = eachDay(trackedFrom, today).length;
      const thisWeek = weekDays.filter((d) => doneDates.has(d)).length;

      return {
        id: habit.id,
        name: habit.name,
        description: habit.description,
        cadence: habit.cadence,
        targetPerWeek: habit.targetPerWeek,
        targetValue: habit.targetValue,
        unit: habit.unit,
        color: habit.color,
        icon: habit.icon,
        reminderTime: habit.reminderTime,
        startDate: habit.startDate,
        archivedAt: habit.archivedAt,
        order: habit.order,
        doneToday: doneDates.has(today),
        currentStreak: current,
        bestStreak: best,
        totalDone: doneDates.size,
        possibleDays: possible,
        completionRate: possible ? doneDates.size / possible : 0,
        thisWeek,
        weekTarget: habit.cadence === 'weekly' ? habit.targetPerWeek : 7,
        history: list.map((e) => ({ date: e.date, done: e.done, value: e.value, note: e.note })),
      };
    });

    res.json({ habits: payload, today, from });
  }),
);

habitsRouter.post(
  '/',
  ah(async (req, res) => {
    const body = habitBody.parse(req.body);
    const max = await prisma.habit.aggregate({ where: { userId: req.user!.id }, _max: { order: true } });
    const created = await prisma.habit.create({
      data: {
        userId: req.user!.id,
        name: body.name,
        description: body.description ?? '',
        cadence: body.cadence ?? 'daily',
        targetPerWeek: body.targetPerWeek ?? (body.cadence === 'weekly' ? 3 : 7),
        targetValue: body.targetValue ?? 1,
        unit: body.unit ?? '',
        color: body.color ?? '#10b981',
        icon: body.icon ?? 'check',
        reminderTime: body.reminderTime ?? null,
        startDate: body.startDate ?? todayStr(req.user!.timezone),
        order: (max._max.order ?? 0) + 1,
      },
    });
    res.status(201).json({ habit: created });
  }),
);

habitsRouter.patch(
  '/:id',
  ah(async (req, res) => {
    const body = habitBody.partial().extend({ archived: z.boolean().optional() }).parse(req.body);
    const habit = await ownedHabit(req.user!.id, req.params.id);
    const { archived, ...rest } = body;
    const updated = await prisma.habit.update({
      where: { id: habit.id },
      data: { ...rest, ...(archived !== undefined ? { archivedAt: archived ? new Date() : null } : {}) },
    });
    res.json({ habit: updated });
  }),
);

habitsRouter.delete(
  '/:id',
  ah(async (req, res) => {
    const habit = await ownedHabit(req.user!.id, req.params.id);
    await prisma.habit.delete({ where: { id: habit.id } });
    res.json({ ok: true });
  }),
);

/** Toggle or explicitly set a day. Idempotent by (habit, date). */
habitsRouter.post(
  '/:id/check',
  ah(async (req, res) => {
    const user = req.user!;
    const habit = await ownedHabit(user.id, req.params.id);
    const body = z
      .object({
        date: dateStr.optional(),
        done: z.boolean().optional(),
        value: z.number().min(0).max(100000).optional(),
        note: z.string().max(500).optional(),
      })
      .parse(req.body ?? {});

    const date = body.date ?? todayStr(user.timezone);
    if (date > addDays(todayStr(user.timezone), 1)) throw ApiError.badRequest('Cannot log a habit in the future');

    const existing = await prisma.habitEntry.findUnique({ where: { habitId_date: { habitId: habit.id, date } } });
    const nextDone = body.done ?? !(existing?.done ?? false);

    if (!nextDone && existing) {
      await prisma.habitEntry.delete({ where: { id: existing.id } });
      res.json({ ok: true, date, done: false });
      return;
    }

    const entry = await prisma.habitEntry.upsert({
      where: { habitId_date: { habitId: habit.id, date } },
      update: { done: true, value: body.value ?? habit.targetValue, note: body.note ?? existing?.note ?? '' },
      create: { habitId: habit.id, date, done: true, value: body.value ?? habit.targetValue, note: body.note ?? '' },
    });
    res.json({ ok: true, date, done: true, entry });
  }),
);

habitsRouter.get(
  '/:id/history',
  ah(async (req, res) => {
    const user = req.user!;
    const habit = await ownedHabit(user.id, req.params.id);
    const today = todayStr(user.timezone);
    const days = Math.min(Number(req.query.days) || 365, 800);
    const from = addDays(today, -days);

    const entries = await prisma.habitEntry.findMany({
      where: { habitId: habit.id, date: { gte: from, lte: today } },
      orderBy: { date: 'asc' },
    });
    const done = new Set(entries.filter((e) => e.done).map((e) => e.date));
    const { current, best } = habitStreak(done, today);

    res.json({
      habit,
      from,
      to: today,
      entries,
      currentStreak: current,
      bestStreak: best,
      calendar: eachDay(from, today).map((date) => ({ date, done: done.has(date) })),
    });
  }),
);
