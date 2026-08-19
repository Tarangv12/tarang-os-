import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db';
import { ApiError, ah } from '../lib/errors';
import { requireAuth, csrfProtect } from '../middleware/auth';
import { generationLimiter, searchLimiter, writeLimiter } from '../middleware/rateLimit';
import { resolveTagIds, serializeTask, taskInclude } from '../lib/tasks';
import { addDays, instantFor, isDateStr, todayStr } from '../lib/dates';
import { serializeRule } from '../lib/recurrence';
import { parseQuickCapture } from '../lib/quickCapture';
import { parseSettings } from '../lib/user';
import { audit } from '../lib/audit';

export const tasksRouter = Router();
tasksRouter.use(requireAuth, csrfProtect);

// Bulk-write and generation surfaces get their own budgets on top of the
// global API limit — these are what a script would target to flood the
// database or to walk every task out of it.
tasksRouter.post(['/parse', '/quick'], generationLimiter);
tasksRouter.post(['/bulk', '/reorder'], writeLimiter);
tasksRouter.get('/', searchLimiter);

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');
const priority = z.enum(['urgent', 'high', 'medium', 'low']);
const energy = z.enum(['high', 'medium', 'low']);
const status = z.enum(['pending', 'in_progress', 'completed', 'archived']);

const recurrenceSchema = z
  .object({
    freq: z.enum(['daily', 'weekdays', 'weekly', 'monthly', 'yearly', 'custom']),
    interval: z.number().int().min(1).max(365).default(1),
    byWeekday: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    byMonthDay: z.number().int().min(1).max(31).optional(),
    until: dateStr.nullable().optional(),
    count: z.number().int().min(1).max(500).nullable().optional(),
  })
  .nullable();

const taskBody = z.object({
  title: z.string().trim().min(1, 'Give the task a title').max(200),
  description: z.string().max(4000).optional(),
  notes: z.string().max(20000).optional(),
  date: dateStr,
  startTime: timeStr.nullable().optional(),
  dueTime: timeStr.nullable().optional(),
  priority: priority.optional(),
  status: status.optional(),
  energy: energy.optional(),
  estimatedMinutes: z.number().int().min(0).max(1440).optional(),
  actualMinutes: z.number().int().min(0).max(10080).optional(),
  reminderMinutesBefore: z.number().int().min(0).max(10080).nullable().optional(),
  categoryId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  goalId: z.string().nullable().optional(),
  pinned: z.boolean().optional(),
  order: z.number().int().optional(),
  tags: z.array(z.string().max(30)).max(20).optional(),
  subtasks: z.array(z.object({ title: z.string().trim().min(1).max(160), done: z.boolean().optional() })).max(50).optional(),
  recurrence: recurrenceSchema.optional(),
});

async function ownedTask(userId: string, id: string) {
  const task = await prisma.task.findFirst({ where: { id, userId }, include: taskInclude });
  if (!task) throw ApiError.notFound('Task not found');
  return task;
}

/** Verifies any referenced category/project/goal actually belongs to this user. */
async function assertReferences(
  userId: string,
  refs: { categoryId?: string | null; projectId?: string | null; goalId?: string | null },
) {
  if (refs.categoryId) {
    const found = await prisma.category.findFirst({ where: { id: refs.categoryId, userId }, select: { id: true } });
    if (!found) throw ApiError.badRequest('Unknown category');
  }
  if (refs.projectId) {
    const found = await prisma.project.findFirst({ where: { id: refs.projectId, userId }, select: { id: true } });
    if (!found) throw ApiError.badRequest('Unknown project');
  }
  if (refs.goalId) {
    const found = await prisma.goal.findFirst({ where: { id: refs.goalId, userId }, select: { id: true } });
    if (!found) throw ApiError.badRequest('Unknown goal');
  }
}

function reminderInstant(
  date: string,
  time: string | null | undefined,
  minutesBefore: number | null | undefined,
  timezone: string,
): Date | null {
  if (minutesBefore === null || minutesBefore === undefined) return null;
  const anchor = time || '09:00';
  const at = instantFor(date, anchor, timezone);
  return new Date(at.getTime() - minutesBefore * 60_000);
}

// ---------------------------------------------------------------------------
// List / search
// ---------------------------------------------------------------------------

tasksRouter.get(
  '/',
  ah(async (req, res) => {
    const user = req.user!;
    const today = todayStr(user.timezone);
    const q = z
      .object({
        view: z.enum(['today', 'upcoming', 'overdue', 'completed', 'all', 'archived', 'unscheduled']).optional(),
        from: dateStr.optional(),
        to: dateStr.optional(),
        date: dateStr.optional(),
        status: z.string().optional(),
        priority: z.string().optional(),
        categoryId: z.string().optional(),
        projectId: z.string().optional(),
        goalId: z.string().optional(),
        tag: z.string().optional(),
        search: z.string().max(120).optional(),
        limit: z.coerce.number().int().min(1).max(1000).optional(),
        offset: z.coerce.number().int().min(0).optional(),
        sort: z.enum(['smart', 'date', 'priority', 'created', 'title']).optional(),
      })
      .parse(req.query);

    const where: Record<string, unknown> = { userId: user.id };
    const and: Record<string, unknown>[] = [];

    switch (q.view) {
      case 'today':
        and.push({ date: today, archivedAt: null });
        break;
      case 'upcoming':
        and.push({ date: { gt: today }, archivedAt: null, status: { not: 'completed' } });
        break;
      case 'overdue':
        and.push({ date: { lt: today }, archivedAt: null, status: { notIn: ['completed', 'archived'] } });
        break;
      case 'completed':
        and.push({ status: 'completed' });
        break;
      case 'archived':
        and.push({ NOT: { archivedAt: null } });
        break;
      case 'all':
      default:
        and.push({ archivedAt: null });
        break;
    }

    if (q.date) and.push({ date: q.date });
    if (q.from) and.push({ date: { gte: q.from } });
    if (q.to) and.push({ date: { lte: q.to } });
    if (q.status) and.push({ status: { in: q.status.split(',').filter(Boolean) } });
    if (q.priority) and.push({ priority: { in: q.priority.split(',').filter(Boolean) } });
    if (q.categoryId) and.push({ categoryId: q.categoryId });
    if (q.projectId) and.push({ projectId: q.projectId });
    if (q.goalId) and.push({ goalId: q.goalId });
    if (q.tag) and.push({ tags: { some: { tag: { name: q.tag.toLowerCase() } } } });
    if (q.search) {
      const term = q.search.trim();
      and.push({
        OR: [
          { title: { contains: term, mode: 'insensitive' } },
          { description: { contains: term, mode: 'insensitive' } },
          { notes: { contains: term, mode: 'insensitive' } },
        ],
      });
    }
    if (and.length) where.AND = and;

    const orderBy =
      q.sort === 'priority'
        ? [{ priority: 'asc' as const }, { date: 'asc' as const }]
        : q.sort === 'created'
          ? [{ createdAt: 'desc' as const }]
          : q.sort === 'title'
            ? [{ title: 'asc' as const }]
            : [{ date: 'asc' as const }, { order: 'asc' as const }, { startTime: 'asc' as const }, { createdAt: 'asc' as const }];

    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where,
        include: taskInclude,
        orderBy,
        take: q.limit ?? 300,
        skip: q.offset ?? 0,
      }),
      prisma.task.count({ where }),
    ]);

    let serialized = tasks.map(serializeTask);
    if (q.sort === 'smart' || !q.sort) {
      const rank: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
      serialized = serialized.sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        if (a.status === 'completed' !== (b.status === 'completed')) return a.status === 'completed' ? 1 : -1;
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        if (a.order !== b.order) return a.order - b.order;
        if (a.priority !== b.priority) return rank[a.priority] - rank[b.priority];
        return (a.startTime || '99:99').localeCompare(b.startTime || '99:99');
      });
    }

    res.json({ tasks: serialized, total, today });
  }),
);

tasksRouter.get(
  '/:id',
  ah(async (req, res) => {
    const task = await ownedTask(req.user!.id, req.params.id);
    res.json({ task: serializeTask(task) });
  }),
);

// ---------------------------------------------------------------------------
// Create / update / delete
// ---------------------------------------------------------------------------

tasksRouter.post(
  '/',
  ah(async (req, res) => {
    const user = req.user!;
    const body = taskBody.parse(req.body);
    await assertReferences(user.id, body);

    const tagIds = body.tags ? await resolveTagIds(user.id, body.tags) : [];
    const maxOrder = await prisma.task.aggregate({
      where: { userId: user.id, date: body.date },
      _max: { order: true },
    });

    const created = await prisma.task.create({
      data: {
        userId: user.id,
        title: body.title,
        description: body.description ?? '',
        notes: body.notes ?? '',
        date: body.date,
        startTime: body.startTime ?? null,
        dueTime: body.dueTime ?? null,
        priority: body.priority ?? parseSettings(user.settings).defaultPriority,
        status: body.status ?? 'pending',
        energy: body.energy ?? 'medium',
        estimatedMinutes: body.estimatedMinutes ?? 0,
        reminderMinutesBefore: body.reminderMinutesBefore ?? null,
        reminderAt: reminderInstant(body.date, body.startTime ?? body.dueTime, body.reminderMinutesBefore, user.timezone),
        categoryId: body.categoryId ?? null,
        projectId: body.projectId ?? null,
        goalId: body.goalId ?? null,
        pinned: body.pinned ?? false,
        order: body.order ?? (maxOrder._max.order ?? 0) + 1,
        recurrenceRule: body.recurrence ? serializeRule({ ...body.recurrence, interval: body.recurrence.interval ?? 1 }) : null,
        subtasks: body.subtasks?.length
          ? { create: body.subtasks.map((s, i) => ({ title: s.title, done: s.done ?? false, order: i })) }
          : undefined,
        tags: tagIds.length ? { create: tagIds.map((tagId) => ({ tagId })) } : undefined,
      },
      include: taskInclude,
    });

    res.status(201).json({ task: serializeTask(created) });
  }),
);

tasksRouter.patch(
  '/:id',
  ah(async (req, res) => {
    const user = req.user!;
    const existing = await ownedTask(user.id, req.params.id);
    const body = taskBody.partial().parse(req.body);
    await assertReferences(user.id, body);

    const nextDateValue = body.date ?? existing.date;
    const nextStart = body.startTime !== undefined ? body.startTime : existing.startTime;
    const nextDue = body.dueTime !== undefined ? body.dueTime : existing.dueTime;
    const nextReminderBefore =
      body.reminderMinutesBefore !== undefined ? body.reminderMinutesBefore : existing.reminderMinutesBefore;

    const data: Record<string, unknown> = {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
      ...(body.date !== undefined ? { date: body.date } : {}),
      ...(body.startTime !== undefined ? { startTime: body.startTime } : {}),
      ...(body.dueTime !== undefined ? { dueTime: body.dueTime } : {}),
      ...(body.priority !== undefined ? { priority: body.priority } : {}),
      ...(body.energy !== undefined ? { energy: body.energy } : {}),
      ...(body.estimatedMinutes !== undefined ? { estimatedMinutes: body.estimatedMinutes } : {}),
      ...(body.actualMinutes !== undefined ? { actualMinutes: body.actualMinutes } : {}),
      ...(body.categoryId !== undefined ? { categoryId: body.categoryId } : {}),
      ...(body.projectId !== undefined ? { projectId: body.projectId } : {}),
      ...(body.goalId !== undefined ? { goalId: body.goalId } : {}),
      ...(body.pinned !== undefined ? { pinned: body.pinned } : {}),
      ...(body.order !== undefined ? { order: body.order } : {}),
      ...(body.reminderMinutesBefore !== undefined ? { reminderMinutesBefore: body.reminderMinutesBefore } : {}),
      reminderAt: reminderInstant(nextDateValue, nextStart ?? nextDue, nextReminderBefore, user.timezone),
    };

    if (body.status !== undefined) {
      data.status = body.status;
      data.completedAt = body.status === 'completed' ? existing.completedAt ?? new Date() : null;
      if (body.status === 'archived') data.archivedAt = new Date();
    }

    if (body.recurrence !== undefined) {
      data.recurrenceRule = body.recurrence
        ? serializeRule({ ...body.recurrence, interval: body.recurrence.interval ?? 1 })
        : null;
    }

    if (body.tags) {
      const tagIds = await resolveTagIds(user.id, body.tags);
      await prisma.taskTag.deleteMany({ where: { taskId: existing.id } });
      if (tagIds.length) {
        await prisma.taskTag.createMany({ data: tagIds.map((tagId) => ({ taskId: existing.id, tagId })) });
      }
    }

    if (body.subtasks) {
      await prisma.subtask.deleteMany({ where: { taskId: existing.id } });
      if (body.subtasks.length) {
        await prisma.subtask.createMany({
          data: body.subtasks.map((s, i) => ({ taskId: existing.id, title: s.title, done: s.done ?? false, order: i })),
        });
      }
    }

    const updated = await prisma.task.update({ where: { id: existing.id }, data, include: taskInclude });
    res.json({ task: serializeTask(updated) });
  }),
);

tasksRouter.delete(
  '/:id',
  ah(async (req, res) => {
    const task = await ownedTask(req.user!.id, req.params.id);
    const scope = z.enum(['one', 'series']).catch('one').parse(req.query.scope);

    if (scope === 'series') {
      const seedId = task.recurrenceParentId ?? task.id;
      const { count } = await prisma.task.deleteMany({
        where: { userId: req.user!.id, OR: [{ id: seedId }, { recurrenceParentId: seedId }] },
      });
      audit(req, 'task.delete_series', { userId: req.user!.id, detail: `${count} tasks` });
      res.json({ ok: true, deleted: count });
      return;
    }

    await prisma.task.delete({ where: { id: task.id } });
    res.json({ ok: true, deleted: 1 });
  }),
);

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

tasksRouter.post(
  '/:id/complete',
  ah(async (req, res) => {
    const user = req.user!;
    const task = await ownedTask(user.id, req.params.id);
    const body = z.object({ actualMinutes: z.number().int().min(0).max(10080).optional() }).parse(req.body ?? {});

    // Close out subtasks first so the response reflects the final state.
    await prisma.subtask.updateMany({
      where: { taskId: task.id, done: false },
      data: { done: true, doneAt: new Date() },
    });
    const updated = await prisma.task.update({
      where: { id: task.id },
      data: {
        status: 'completed',
        completedAt: new Date(),
        missReason: '',
        ...(body.actualMinutes !== undefined ? { actualMinutes: body.actualMinutes } : {}),
      },
      include: taskInclude,
    });

    res.json({ task: serializeTask(updated) });
  }),
);

tasksRouter.post(
  '/:id/reopen',
  ah(async (req, res) => {
    const task = await ownedTask(req.user!.id, req.params.id);
    const updated = await prisma.task.update({
      where: { id: task.id },
      data: { status: 'pending', completedAt: null, archivedAt: null },
      include: taskInclude,
    });
    res.json({ task: serializeTask(updated) });
  }),
);

/**
 * Postpone keeps an honest record: the day it was moved off is appended to
 * `postponeHistory`, which is what the reliability score and the "commonly
 * postponed" analytics read from.
 */
tasksRouter.post(
  '/:id/postpone',
  ah(async (req, res) => {
    const user = req.user!;
    const task = await ownedTask(user.id, req.params.id);
    const body = z
      .object({
        to: dateStr.optional(),
        days: z.number().int().min(1).max(365).optional(),
        reason: z.string().max(200).optional(),
      })
      .parse(req.body ?? {});

    const target = body.to ?? addDays(task.date, body.days ?? 1);
    if (!isDateStr(target)) throw ApiError.badRequest('Invalid target date');

    let history: string[] = [];
    try {
      history = JSON.parse(task.postponeHistory || '[]');
    } catch {
      history = [];
    }
    history.push(task.date);

    const updated = await prisma.task.update({
      where: { id: task.id },
      data: {
        date: target,
        postponedCount: task.postponedCount + 1,
        originalDate: task.originalDate ?? task.date,
        postponeHistory: JSON.stringify(history.slice(-40)),
        missReason: body.reason ?? task.missReason,
        status: task.status === 'completed' ? 'pending' : task.status,
        completedAt: null,
        reminderAt: reminderInstant(target, task.startTime ?? task.dueTime, task.reminderMinutesBefore, user.timezone),
        reminderSentAt: null,
      },
      include: taskInclude,
    });

    res.json({ task: serializeTask(updated) });
  }),
);

tasksRouter.post(
  '/:id/duplicate',
  ah(async (req, res) => {
    const user = req.user!;
    const task = await ownedTask(user.id, req.params.id);
    const body = z.object({ date: dateStr.optional(), title: z.string().max(200).optional() }).parse(req.body ?? {});

    const copy = await prisma.task.create({
      data: {
        userId: user.id,
        title: body.title ?? `${task.title} (copy)`,
        description: task.description,
        notes: task.notes,
        date: body.date ?? task.date,
        startTime: task.startTime,
        dueTime: task.dueTime,
        priority: task.priority,
        energy: task.energy,
        estimatedMinutes: task.estimatedMinutes,
        categoryId: task.categoryId,
        projectId: task.projectId,
        goalId: task.goalId,
        reminderMinutesBefore: task.reminderMinutesBefore,
        order: task.order + 1,
        subtasks: { create: task.subtasks.map((s) => ({ title: s.title, order: s.order })) },
        tags: { create: task.tags.map((t) => ({ tagId: t.tagId })) },
      },
      include: taskInclude,
    });

    res.status(201).json({ task: serializeTask(copy) });
  }),
);

tasksRouter.post(
  '/:id/archive',
  ah(async (req, res) => {
    const task = await ownedTask(req.user!.id, req.params.id);
    const updated = await prisma.task.update({
      where: { id: task.id },
      data: { archivedAt: new Date(), status: 'archived' },
      include: taskInclude,
    });
    res.json({ task: serializeTask(updated) });
  }),
);

tasksRouter.post(
  '/:id/unarchive',
  ah(async (req, res) => {
    const task = await ownedTask(req.user!.id, req.params.id);
    const updated = await prisma.task.update({
      where: { id: task.id },
      data: { archivedAt: null, status: task.completedAt ? 'completed' : 'pending' },
      include: taskInclude,
    });
    res.json({ task: serializeTask(updated) });
  }),
);

tasksRouter.post(
  '/:id/miss-reason',
  ah(async (req, res) => {
    const task = await ownedTask(req.user!.id, req.params.id);
    const body = z.object({ reason: z.string().max(200) }).parse(req.body);
    const updated = await prisma.task.update({
      where: { id: task.id },
      data: { missReason: body.reason },
      include: taskInclude,
    });
    res.json({ task: serializeTask(updated) });
  }),
);

// ---------------------------------------------------------------------------
// Subtasks
// ---------------------------------------------------------------------------

tasksRouter.post(
  '/:id/subtasks',
  ah(async (req, res) => {
    const task = await ownedTask(req.user!.id, req.params.id);
    const body = z.object({ title: z.string().trim().min(1).max(160) }).parse(req.body);
    const max = await prisma.subtask.aggregate({ where: { taskId: task.id }, _max: { order: true } });
    await prisma.subtask.create({
      data: { taskId: task.id, title: body.title, order: (max._max.order ?? 0) + 1 },
    });
    const updated = await ownedTask(req.user!.id, task.id);
    res.status(201).json({ task: serializeTask(updated) });
  }),
);

tasksRouter.patch(
  '/:id/subtasks/:subtaskId',
  ah(async (req, res) => {
    const task = await ownedTask(req.user!.id, req.params.id);
    const body = z
      .object({ title: z.string().trim().min(1).max(160).optional(), done: z.boolean().optional(), order: z.number().int().optional() })
      .parse(req.body);

    const result = await prisma.subtask.updateMany({
      where: { id: req.params.subtaskId, taskId: task.id },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.order !== undefined ? { order: body.order } : {}),
        ...(body.done !== undefined ? { done: body.done, doneAt: body.done ? new Date() : null } : {}),
      },
    });
    if (!result.count) throw ApiError.notFound('Subtask not found');

    const updated = await ownedTask(req.user!.id, task.id);
    res.json({ task: serializeTask(updated) });
  }),
);

tasksRouter.delete(
  '/:id/subtasks/:subtaskId',
  ah(async (req, res) => {
    const task = await ownedTask(req.user!.id, req.params.id);
    await prisma.subtask.deleteMany({ where: { id: req.params.subtaskId, taskId: task.id } });
    const updated = await ownedTask(req.user!.id, task.id);
    res.json({ task: serializeTask(updated) });
  }),
);

// ---------------------------------------------------------------------------
// Bulk operations & manual ordering
// ---------------------------------------------------------------------------

tasksRouter.post(
  '/reorder',
  ah(async (req, res) => {
    const body = z
      .object({ items: z.array(z.object({ id: z.string(), order: z.number().int(), date: dateStr.optional() })).max(500) })
      .parse(req.body);

    await prisma.$transaction(
      body.items.map((item) =>
        prisma.task.updateMany({
          where: { id: item.id, userId: req.user!.id },
          data: { order: item.order, ...(item.date ? { date: item.date } : {}) },
        }),
      ),
    );
    res.json({ ok: true, updated: body.items.length });
  }),
);

tasksRouter.post(
  '/bulk',
  ah(async (req, res) => {
    const user = req.user!;
    const body = z
      .object({
        ids: z.array(z.string()).min(1).max(500),
        action: z.enum(['complete', 'reopen', 'archive', 'delete', 'postpone', 'priority', 'category', 'project']),
        value: z.string().nullable().optional(),
        days: z.number().int().min(1).max(365).optional(),
      })
      .parse(req.body);

    const scope = { id: { in: body.ids }, userId: user.id };
    let affected = 0;

    switch (body.action) {
      case 'complete': {
        affected = (await prisma.task.updateMany({ where: scope, data: { status: 'completed', completedAt: new Date() } })).count;
        break;
      }
      case 'reopen': {
        affected = (await prisma.task.updateMany({ where: scope, data: { status: 'pending', completedAt: null } })).count;
        break;
      }
      case 'archive': {
        affected = (await prisma.task.updateMany({ where: scope, data: { status: 'archived', archivedAt: new Date() } })).count;
        break;
      }
      case 'delete': {
        affected = (await prisma.task.deleteMany({ where: scope })).count;
        audit(req, 'task.bulk_delete', { userId: user.id, detail: `${affected} tasks` });
        break;
      }
      case 'priority': {
        const value = priority.parse(body.value);
        affected = (await prisma.task.updateMany({ where: scope, data: { priority: value } })).count;
        break;
      }
      case 'category': {
        await assertReferences(user.id, { categoryId: body.value ?? null });
        affected = (await prisma.task.updateMany({ where: scope, data: { categoryId: body.value ?? null } })).count;
        break;
      }
      case 'project': {
        await assertReferences(user.id, { projectId: body.value ?? null });
        affected = (await prisma.task.updateMany({ where: scope, data: { projectId: body.value ?? null } })).count;
        break;
      }
      case 'postpone': {
        const tasks = await prisma.task.findMany({ where: scope });
        for (const t of tasks) {
          let history: string[] = [];
          try {
            history = JSON.parse(t.postponeHistory || '[]');
          } catch {
            history = [];
          }
          history.push(t.date);
          // eslint-disable-next-line no-await-in-loop
          await prisma.task.update({
            where: { id: t.id },
            data: {
              date: addDays(t.date, body.days ?? 1),
              postponedCount: t.postponedCount + 1,
              originalDate: t.originalDate ?? t.date,
              postponeHistory: JSON.stringify(history.slice(-40)),
            },
          });
          affected += 1;
        }
        break;
      }
      default:
        break;
    }

    res.json({ ok: true, affected });
  }),
);

// ---------------------------------------------------------------------------
// Quick capture
// ---------------------------------------------------------------------------

tasksRouter.post(
  '/parse',
  ah(async (req, res) => {
    const body = z.object({ text: z.string().min(1).max(400) }).parse(req.body);
    const today = todayStr(req.user!.timezone);
    res.json({ parsed: parseQuickCapture(body.text, today) });
  }),
);

tasksRouter.post(
  '/quick',
  ah(async (req, res) => {
    const user = req.user!;
    const body = z.object({ text: z.string().min(1).max(400), date: dateStr.optional() }).parse(req.body);
    const today = todayStr(user.timezone);
    const parsed = parseQuickCapture(body.text, today);
    const settings = parseSettings(user.settings);

    let projectId: string | null = null;
    if (parsed.projectHint) {
      const project = await prisma.project.findFirst({
        where: { userId: user.id, name: { contains: parsed.projectHint, mode: 'insensitive' } },
        select: { id: true },
      });
      projectId = project?.id ?? null;
    }

    let categoryId: string | null = null;
    const categoryName = parsed.categoryHint || settings.quickCaptureDefaults.category;
    if (categoryName) {
      const category = await prisma.category.findFirst({
        where: { userId: user.id, name: { contains: categoryName, mode: 'insensitive' } },
        select: { id: true },
      });
      categoryId =
        category?.id ??
        (parsed.categoryHint
          ? (await prisma.category.create({ data: { userId: user.id, name: parsed.categoryHint } })).id
          : null);
    }

    const tagIds = parsed.tags.length ? await resolveTagIds(user.id, parsed.tags) : [];
    const date = body.date ?? parsed.date ?? today;

    const created = await prisma.task.create({
      data: {
        userId: user.id,
        title: parsed.title.slice(0, 200),
        date,
        startTime: parsed.startTime,
        priority: parsed.priority ?? settings.defaultPriority,
        estimatedMinutes: parsed.estimatedMinutes ?? 0,
        categoryId,
        projectId,
        recurrenceRule: serializeRule(parsed.recurrence),
        reminderMinutesBefore: parsed.startTime ? 10 : null,
        reminderAt: parsed.startTime
          ? reminderInstant(date, parsed.startTime, 10, user.timezone)
          : null,
        tags: tagIds.length ? { create: tagIds.map((tagId) => ({ tagId })) } : undefined,
      },
      include: taskInclude,
    });

    res.status(201).json({ task: serializeTask(created), parsed });
  }),
);
