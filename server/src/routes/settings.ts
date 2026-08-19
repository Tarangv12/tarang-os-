import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db';
import { ah } from '../lib/errors';
import { csrfProtect, requireAuth } from '../middleware/auth';
import { DEFAULT_SETTINGS, parseSettings, publicUser } from '../lib/user';
import { audit } from '../lib/audit';
import { config } from '../config';
import { addDays, nowTimeStr, todayStr } from '../lib/dates';
import { materializeRecurring } from '../lib/tasks';
import {
  composeAgenda,
  composeReviewNudge,
  composeUnfinished,
  isScheduledDue,
  parseNotifyState,
  parseScheduledId,
  scheduledId,
} from '../lib/notifications';

export const settingsRouter = Router();
settingsRouter.use(requireAuth, csrfProtect);

const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const settingsSchema = z.object({
  dailyTaskTarget: z.number().int().min(1).max(50).optional(),
  dailyFocusTargetMinutes: z.number().int().min(15).max(960).optional(),
  workdayStart: timeStr.optional(),
  workdayEnd: timeStr.optional(),
  weekStartsOn: z.union([z.literal(0), z.literal(1)]).optional(),
  defaultPriority: z.enum(['urgent', 'high', 'medium', 'low']).optional(),
  defaultView: z.string().max(30).optional(),
  pomodoro: z
    .object({
      focus: z.number().int().min(5).max(180),
      shortBreak: z.number().int().min(1).max(60),
      longBreak: z.number().int().min(5).max(120),
      longBreakEvery: z.number().int().min(2).max(12),
    })
    .partial()
    .optional(),
  notifications: z
    .object({
      enabled: z.boolean(),
      taskReminders: z.boolean(),
      habitReminders: z.boolean(),
      dailyAgenda: z.boolean(),
      dailyAgendaTime: timeStr.nullable(),
      dailyReviewTime: timeStr.nullable(),
      unfinishedImportantAt: timeStr.nullable(),
    })
    .partial()
    .optional(),
  reduceMotion: z.boolean().optional(),
  compactMode: z.boolean().optional(),
  quickCaptureDefaults: z
    .object({ category: z.string().max(40).nullable(), priority: z.string().max(10) })
    .partial()
    .optional(),
  onboardedAt: z.string().max(40).nullable().optional(),
});

settingsRouter.get(
  '/',
  ah(async (req, res) => {
    res.json({
      user: publicUser(req.user!),
      defaults: DEFAULT_SETTINGS,
      security: {
        autoLockMinutes: config.session.autoLockMinutes,
        sessionIdleMinutes: config.session.idleMinutes,
        sessionAbsoluteDays: config.session.absoluteDays,
        minPasswordLength: config.auth.minPasswordLength,
        cookieSecure: config.cookie.secure,
      },
    });
  }),
);

settingsRouter.patch(
  '/',
  ah(async (req, res) => {
    const body = z
      .object({
        displayName: z.string().trim().max(60).optional(),
        theme: z.enum(['system', 'light', 'dark']).optional(),
        accent: z.string().max(20).optional(),
        timezone: z.string().max(64).optional(),
        settings: settingsSchema.optional(),
      })
      .parse(req.body);

    if (body.timezone) {
      try {
        new Intl.DateTimeFormat('en', { timeZone: body.timezone });
      } catch {
        res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Unknown timezone' } });
        return;
      }
    }

    const current = parseSettings(req.user!.settings);
    const merged = body.settings
      ? {
          ...current,
          ...body.settings,
          pomodoro: { ...current.pomodoro, ...(body.settings.pomodoro || {}) },
          notifications: { ...current.notifications, ...(body.settings.notifications || {}) },
          quickCaptureDefaults: {
            ...current.quickCaptureDefaults,
            ...(body.settings.quickCaptureDefaults || {}),
          },
        }
      : current;

    const updated = await prisma.user.update({
      where: { id: req.user!.id },
      data: {
        ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
        ...(body.theme !== undefined ? { theme: body.theme } : {}),
        ...(body.accent !== undefined ? { accent: body.accent } : {}),
        ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
        ...(body.settings ? { settings: JSON.stringify(merged) } : {}),
      },
    });

    res.json({ user: publicUser(updated) });
  }),
);

/** Counts everything you have stored — shown on the Settings > Data panel. */
settingsRouter.get(
  '/stats',
  ah(async (req, res) => {
    const userId = req.user!.id;
    const [tasks, completedTasks, projects, goals, habits, habitEntries, focus, reviews, notes, oldest] =
      await Promise.all([
        prisma.task.count({ where: { userId } }),
        prisma.task.count({ where: { userId, status: 'completed' } }),
        prisma.project.count({ where: { userId } }),
        prisma.goal.count({ where: { userId } }),
        prisma.habit.count({ where: { userId } }),
        prisma.habitEntry.count({ where: { habit: { userId } } }),
        prisma.focusSession.aggregate({ where: { userId }, _sum: { actualMinutes: true }, _count: { _all: true } }),
        prisma.review.count({ where: { userId } }),
        prisma.note.count({ where: { userId } }),
        prisma.task.findFirst({ where: { userId }, orderBy: { date: 'asc' }, select: { date: true } }),
      ]);

    res.json({
      tasks,
      completedTasks,
      projects,
      goals,
      habits,
      habitEntries,
      focusSessions: focus._count._all,
      focusMinutes: focus._sum.actualMinutes ?? 0,
      reviews,
      notes,
      historyFrom: oldest?.date ?? null,
      historyDays: oldest ? Math.max(1, Math.round((Date.now() - Date.parse(`${oldest.date}T00:00:00Z`)) / 86_400_000)) : 0,
    });
  }),
);

/** Manually top up recurring occurrences (also runs automatically). */
settingsRouter.post(
  '/materialize-recurring',
  ah(async (req, res) => {
    const created = await materializeRecurring(req.user!.id, todayStr(req.user!.timezone), 60);
    res.json({ ok: true, created });
  }),
);

/**
 * Anything due a browser notification right now. The client polls this and
 * raises the notification locally, so nothing leaves the device.
 *
 * Covers both per-task reminders (relative to a task's own time) and the
 * fixed-time daily nudges — the morning agenda, the review prompt and the
 * unfinished-important check.
 */
settingsRouter.get(
  '/due-reminders',
  ah(async (req, res) => {
    const user = req.user!;
    const settings = parseSettings(user.settings);
    if (!settings.notifications.enabled) {
      res.json({ reminders: [] });
      return;
    }

    const now = new Date();
    const horizon = new Date(now.getTime() + 5 * 60_000);
    const today = todayStr(user.timezone);
    const nowHM = nowTimeStr(user.timezone, now);
    const state = parseNotifyState(user.notifyState);
    const reminders: { id: string; kind: string; title: string; body: string; at: string; url?: string }[] = [];

    // --- fixed-time daily nudges ------------------------------------------
    const notifications = settings.notifications;

    if (
      isScheduledDue({
        kind: 'daily_agenda',
        time: notifications.dailyAgendaTime,
        enabled: notifications.dailyAgenda,
        nowHM,
        today,
        state,
      })
    ) {
      const tasks = await prisma.task.findMany({
        where: { userId: user.id, date: today, archivedAt: null },
        select: { title: true, priority: true, startTime: true, status: true },
      });
      const { title, body } = composeAgenda(tasks, user.displayName || user.username);
      reminders.push({
        id: scheduledId('daily_agenda', today),
        kind: 'daily_agenda',
        title,
        body,
        at: now.toISOString(),
        url: '/today',
      });
    }

    if (
      isScheduledDue({
        kind: 'unfinished_important',
        time: notifications.unfinishedImportantAt,
        enabled: Boolean(notifications.unfinishedImportantAt),
        nowHM,
        today,
        state,
      })
    ) {
      const open = await prisma.task.findMany({
        where: {
          userId: user.id,
          date: { lte: today },
          archivedAt: null,
          status: { notIn: ['completed', 'archived'] },
          priority: { in: ['urgent', 'high'] },
        },
        select: { title: true },
        orderBy: [{ date: 'asc' }],
        take: 10,
      });
      if (open.length) {
        const { title, body } = composeUnfinished(open);
        reminders.push({
          id: scheduledId('unfinished_important', today),
          kind: 'unfinished_important',
          title,
          body,
          at: now.toISOString(),
          url: '/today',
        });
      }
    }

    if (
      isScheduledDue({
        kind: 'daily_review',
        time: notifications.dailyReviewTime,
        enabled: Boolean(notifications.dailyReviewTime),
        nowHM,
        today,
        state,
      })
    ) {
      const existing = await prisma.review.findUnique({
        where: { userId_type_date: { userId: user.id, type: 'daily', date: today } },
        select: { id: true },
      });
      // Do not nag about a review that is already written.
      if (!existing) {
        const [completed, planned] = await Promise.all([
          prisma.task.count({ where: { userId: user.id, date: today, status: 'completed' } }),
          prisma.task.count({ where: { userId: user.id, date: today, archivedAt: null } }),
        ]);
        const { title, body } = composeReviewNudge(completed, planned);
        reminders.push({
          id: scheduledId('daily_review', today),
          kind: 'daily_review',
          title,
          body,
          at: now.toISOString(),
          url: '/reviews',
        });
      }
    }

    // --- per-task reminders ------------------------------------------------
    if (settings.notifications.taskReminders) {
      const tasks = await prisma.task.findMany({
        where: {
          userId: user.id,
          status: { notIn: ['completed', 'archived'] },
          reminderAt: { not: null, lte: horizon, gte: new Date(now.getTime() - 30 * 60_000) },
          reminderSentAt: null,
        },
        select: { id: true, title: true, startTime: true, dueTime: true, reminderAt: true, priority: true },
        take: 20,
      });
      for (const task of tasks) {
        reminders.push({
          id: `task:${task.id}`,
          kind: 'task',
          title: task.title,
          body: task.startTime ? `Starts at ${task.startTime}` : 'Due today',
          at: task.reminderAt!.toISOString(),
        });
      }
    }

    if (settings.notifications.habitReminders) {
      const nowHm = nowHM;

      const habits = await prisma.habit.findMany({
        where: { userId: user.id, archivedAt: null, reminderTime: { not: null } },
        select: { id: true, name: true, reminderTime: true },
      });
      const doneToday = new Set(
        (await prisma.habitEntry.findMany({ where: { habit: { userId: user.id }, date: today, done: true }, select: { habitId: true } }))
          .map((e) => e.habitId),
      );
      for (const habit of habits) {
        if (doneToday.has(habit.id)) continue;
        if (habit.reminderTime && habit.reminderTime <= nowHm && habit.reminderTime >= subtractMinutes(nowHm, 5)) {
          reminders.push({
            id: `habit:${habit.id}:${today}`,
            kind: 'habit',
            title: habit.name,
            body: 'Time for your habit',
            at: now.toISOString(),
          });
        }
      }
    }

    res.json({ reminders });
  }),
);

/**
 * Marks reminders as delivered so they are never raised twice.
 *
 * Task reminders are stamped on the task itself; the fixed-time daily nudges
 * record the date they fired on the user, which is what makes "once per day,
 * even across reloads and devices" hold.
 */
settingsRouter.post(
  '/reminders/ack',
  ah(async (req, res) => {
    const body = z.object({ ids: z.array(z.string().max(80)).max(50) }).parse(req.body);
    const user = req.user!;

    const taskIds = body.ids.filter((id) => id.startsWith('task:')).map((id) => id.slice(5));
    if (taskIds.length) {
      await prisma.task.updateMany({
        where: { id: { in: taskIds }, userId: user.id },
        data: { reminderSentAt: new Date() },
      });
    }

    const scheduled = body.ids.map(parseScheduledId).filter(Boolean) as { kind: string; date: string }[];
    if (scheduled.length) {
      const state = parseNotifyState(user.notifyState);
      for (const entry of scheduled) {
        (state as Record<string, string>)[entry.kind] = entry.date;
      }
      await prisma.user.update({ where: { id: user.id }, data: { notifyState: JSON.stringify(state) } });
    }

    res.json({ ok: true, acknowledged: body.ids.length });
  }),
);

/**
 * Sends the morning agenda immediately, ignoring the schedule. Used by the
 * "Send a test notification" button so you can confirm delivery works on a
 * device without waiting until 10:00.
 */
settingsRouter.post(
  '/reminders/preview',
  ah(async (req, res) => {
    const user = req.user!;
    const today = todayStr(user.timezone);
    const tasks = await prisma.task.findMany({
      where: { userId: user.id, date: today, archivedAt: null },
      select: { title: true, priority: true, startTime: true, status: true },
    });
    const { title, body } = composeAgenda(tasks, user.displayName || user.username);
    res.json({ reminder: { id: `preview:${Date.now()}`, kind: 'daily_agenda', title, body, at: new Date().toISOString(), url: '/today' } });
  }),
);

/** Unfinished important work — surfaced in the evening nudge. */
settingsRouter.get(
  '/unfinished-important',
  ah(async (req, res) => {
    const user = req.user!;
    const today = todayStr(user.timezone);
    const tasks = await prisma.task.findMany({
      where: {
        userId: user.id,
        date: { lte: today },
        archivedAt: null,
        status: { notIn: ['completed', 'archived'] },
        priority: { in: ['urgent', 'high'] },
      },
      orderBy: [{ date: 'asc' }],
      take: 20,
      select: { id: true, title: true, date: true, priority: true, postponedCount: true },
    });
    res.json({ tasks, today, cutoff: addDays(today, -1) });
  }),
);

function subtractMinutes(hm: string, minutes: number): string {
  const [h, m] = hm.split(':').map(Number);
  const total = Math.max(0, h * 60 + m - minutes);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
