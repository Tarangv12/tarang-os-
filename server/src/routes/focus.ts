import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db';
import { ApiError, ah } from '../lib/errors';
import { csrfProtect, requireAuth } from '../middleware/auth';
import { addDays, eachDay, startOfWeek, todayStr } from '../lib/dates';

export const focusRouter = Router();
focusRouter.use(requireAuth, csrfProtect);

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Starts a session. Any earlier session still open is closed first. */
focusRouter.post(
  '/start',
  ah(async (req, res) => {
    const user = req.user!;
    const body = z
      .object({
        taskId: z.string().nullable().optional(),
        plannedMinutes: z.number().int().min(1).max(240).default(25),
        mode: z.enum(['focus', 'short_break', 'long_break']).default('focus'),
      })
      .parse(req.body ?? {});

    if (body.taskId) {
      const task = await prisma.task.findFirst({ where: { id: body.taskId, userId: user.id }, select: { id: true } });
      if (!task) throw ApiError.badRequest('Unknown task');
    }

    await closeDanglingSessions(user.id);

    const session = await prisma.focusSession.create({
      data: {
        userId: user.id,
        taskId: body.taskId ?? null,
        date: todayStr(user.timezone),
        mode: body.mode,
        plannedMinutes: body.plannedMinutes,
        startedAt: new Date(),
      },
    });

    if (body.taskId && body.mode === 'focus') {
      await prisma.task.updateMany({
        where: { id: body.taskId, userId: user.id, status: 'pending' },
        data: { status: 'in_progress' },
      });
    }

    res.status(201).json({ session });
  }),
);

/** Finishes a session and rolls the elapsed minutes into the linked task. */
focusRouter.post(
  '/:id/finish',
  ah(async (req, res) => {
    const user = req.user!;
    const body = z
      .object({
        actualMinutes: z.number().int().min(0).max(600).optional(),
        completed: z.boolean().default(true),
        interruptions: z.number().int().min(0).max(200).optional(),
        note: z.string().max(500).optional(),
      })
      .parse(req.body ?? {});

    const session = await prisma.focusSession.findFirst({ where: { id: req.params.id, userId: user.id } });
    if (!session) throw ApiError.notFound('Focus session not found');
    if (session.endedAt) {
      res.json({ session });
      return;
    }

    const elapsed =
      body.actualMinutes ?? Math.max(0, Math.round((Date.now() - session.startedAt.getTime()) / 60_000));
    const minutes = Math.min(elapsed, session.plannedMinutes + 30);

    const updated = await prisma.focusSession.update({
      where: { id: session.id },
      data: {
        endedAt: new Date(),
        actualMinutes: minutes,
        completed: body.completed,
        interruptions: body.interruptions ?? session.interruptions,
        note: body.note ?? session.note,
      },
    });

    if (session.taskId && session.mode === 'focus' && minutes > 0) {
      await prisma.task.updateMany({
        where: { id: session.taskId, userId: user.id },
        data: { actualMinutes: { increment: minutes } },
      });
    }

    res.json({ session: updated });
  }),
);

focusRouter.post(
  '/:id/cancel',
  ah(async (req, res) => {
    const result = await prisma.focusSession.updateMany({
      where: { id: req.params.id, userId: req.user!.id, endedAt: null },
      data: { endedAt: new Date(), completed: false, actualMinutes: 0 },
    });
    if (!result.count) throw ApiError.notFound('Focus session not found');
    res.json({ ok: true });
  }),
);

focusRouter.get(
  '/active',
  ah(async (req, res) => {
    const session = await prisma.focusSession.findFirst({
      where: { userId: req.user!.id, endedAt: null },
      orderBy: { startedAt: 'desc' },
      include: { task: { select: { id: true, title: true, priority: true } } },
    });
    res.json({ session });
  }),
);

/** Daily / weekly totals plus a 30-day trend for the Focus screen. */
focusRouter.get(
  '/stats',
  ah(async (req, res) => {
    const user = req.user!;
    const today = todayStr(user.timezone);
    const weekStart = startOfWeek(today);
    const from = addDays(today, -29);

    const sessions = await prisma.focusSession.findMany({
      where: { userId: user.id, date: { gte: from, lte: today }, mode: 'focus' },
      include: { task: { select: { id: true, title: true } } },
      orderBy: { startedAt: 'desc' },
    });

    const byDate = new Map<string, { minutes: number; sessions: number }>();
    for (const s of sessions) {
      const cur = byDate.get(s.date) || { minutes: 0, sessions: 0 };
      cur.minutes += s.actualMinutes;
      if (s.completed) cur.sessions += 1;
      byDate.set(s.date, cur);
    }

    const trend = eachDay(from, today).map((date) => ({
      date,
      minutes: byDate.get(date)?.minutes ?? 0,
      sessions: byDate.get(date)?.sessions ?? 0,
    }));

    const todayStats = byDate.get(today) ?? { minutes: 0, sessions: 0 };
    const week = trend.filter((d) => d.date >= weekStart);

    const byTask = new Map<string, { taskId: string; title: string; minutes: number }>();
    for (const s of sessions) {
      if (!s.task) continue;
      const cur = byTask.get(s.task.id) || { taskId: s.task.id, title: s.task.title, minutes: 0 };
      cur.minutes += s.actualMinutes;
      byTask.set(s.task.id, cur);
    }

    res.json({
      today: todayStats,
      week: {
        minutes: week.reduce((s, d) => s + d.minutes, 0),
        sessions: week.reduce((s, d) => s + d.sessions, 0),
      },
      month: {
        minutes: trend.reduce((s, d) => s + d.minutes, 0),
        sessions: trend.reduce((s, d) => s + d.sessions, 0),
      },
      trend,
      topTasks: Array.from(byTask.values()).sort((a, b) => b.minutes - a.minutes).slice(0, 8),
      recent: sessions.slice(0, 25),
    });
  }),
);

focusRouter.get(
  '/sessions',
  ah(async (req, res) => {
    const q = z
      .object({ from: dateStr.optional(), to: dateStr.optional(), limit: z.coerce.number().int().min(1).max(500).optional() })
      .parse(req.query);
    const sessions = await prisma.focusSession.findMany({
      where: {
        userId: req.user!.id,
        ...(q.from || q.to ? { date: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {}),
      },
      include: { task: { select: { id: true, title: true } } },
      orderBy: { startedAt: 'desc' },
      take: q.limit ?? 100,
    });
    res.json({ sessions });
  }),
);

/** A session left open by a closed tab is capped at its planned length. */
async function closeDanglingSessions(userId: string) {
  const open = await prisma.focusSession.findMany({ where: { userId, endedAt: null } });
  for (const s of open) {
    const elapsed = Math.round((Date.now() - s.startedAt.getTime()) / 60_000);
    // eslint-disable-next-line no-await-in-loop
    await prisma.focusSession.update({
      where: { id: s.id },
      data: {
        endedAt: new Date(),
        actualMinutes: Math.min(elapsed, s.plannedMinutes),
        completed: elapsed >= s.plannedMinutes,
      },
    });
  }
}
