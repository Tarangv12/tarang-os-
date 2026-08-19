import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db';
import { ApiError, ah } from '../lib/errors';
import { csrfProtect, requireAuth } from '../middleware/auth';
import { todayStr } from '../lib/dates';

export const goalsRouter = Router();
goalsRouter.use(requireAuth, csrfProtect);

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const goalBody = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().max(4000).optional(),
  type: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'longterm']).optional(),
  status: z.enum(['active', 'done', 'dropped']).optional(),
  metricType: z.enum(['milestones', 'tasks', 'numeric']).optional(),
  targetValue: z.number().min(0).max(1_000_000).optional(),
  currentValue: z.number().min(0).max(1_000_000).optional(),
  unit: z.string().max(20).optional(),
  startDate: dateStr.nullable().optional(),
  targetDate: dateStr.nullable().optional(),
  projectId: z.string().nullable().optional(),
  color: color.optional(),
  order: z.number().int().optional(),
});

type GoalRow = Awaited<ReturnType<typeof loadGoals>>[number];

async function loadGoals(userId: string, where: Record<string, unknown> = {}) {
  return prisma.goal.findMany({
    where: { userId, ...where },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    include: {
      milestones: { orderBy: { order: 'asc' } },
      project: { select: { id: true, name: true, color: true } },
      _count: { select: { tasks: true } },
    },
  });
}

async function decorate(userId: string, goals: GoalRow[], today: string) {
  const ids = goals.map((g) => g.id);
  const completedByGoal = new Map<string, number>();
  if (ids.length) {
    const grouped = await prisma.task.groupBy({
      by: ['goalId'],
      where: { userId, goalId: { in: ids }, status: 'completed' },
      _count: { _all: true },
    });
    for (const row of grouped) if (row.goalId) completedByGoal.set(row.goalId, row._count._all);
  }

  return goals.map((goal) => {
    const doneMilestones = goal.milestones.filter((m) => m.done).length;
    const taskTotal = goal._count.tasks;
    const taskDone = completedByGoal.get(goal.id) ?? 0;

    let progress = 0;
    if (goal.metricType === 'numeric' && goal.targetValue > 0) {
      progress = Math.min(1, goal.currentValue / goal.targetValue);
    } else if (goal.metricType === 'tasks' && taskTotal > 0) {
      progress = taskDone / taskTotal;
    } else if (goal.milestones.length) {
      progress = doneMilestones / goal.milestones.length;
    } else if (taskTotal > 0) {
      progress = taskDone / taskTotal;
    }
    if (goal.status === 'done') progress = 1;

    const daysLeft = goal.targetDate
      ? Math.round((Date.parse(`${goal.targetDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
      : null;

    return {
      ...goal,
      milestoneCount: goal.milestones.length,
      milestonesDone: doneMilestones,
      taskCount: taskTotal,
      tasksDone: taskDone,
      progress,
      daysLeft,
      overdue: daysLeft !== null && daysLeft < 0 && goal.status === 'active',
    };
  });
}

goalsRouter.get(
  '/',
  ah(async (req, res) => {
    const q = z
      .object({ status: z.string().optional(), type: z.string().optional(), projectId: z.string().optional() })
      .parse(req.query);
    const where: Record<string, unknown> = {};
    if (q.status) where.status = { in: q.status.split(',') };
    if (q.type) where.type = { in: q.type.split(',') };
    if (q.projectId) where.projectId = q.projectId;

    const goals = await loadGoals(req.user!.id, where);
    res.json({ goals: await decorate(req.user!.id, goals, todayStr(req.user!.timezone)) });
  }),
);

goalsRouter.get(
  '/:id',
  ah(async (req, res) => {
    const goals = await loadGoals(req.user!.id, { id: req.params.id });
    if (!goals.length) throw ApiError.notFound('Goal not found');
    const [goal] = await decorate(req.user!.id, goals, todayStr(req.user!.timezone));
    const tasks = await prisma.task.findMany({
      where: { userId: req.user!.id, goalId: goal.id },
      orderBy: [{ date: 'asc' }],
      take: 200,
    });
    res.json({ goal, tasks });
  }),
);

goalsRouter.post(
  '/',
  ah(async (req, res) => {
    const body = goalBody
      .extend({ milestones: z.array(z.object({ title: z.string().trim().min(1).max(160), targetDate: dateStr.nullable().optional() })).max(50).optional() })
      .parse(req.body);

    if (body.projectId) {
      const project = await prisma.project.findFirst({ where: { id: body.projectId, userId: req.user!.id } });
      if (!project) throw ApiError.badRequest('Unknown project');
    }

    const max = await prisma.goal.aggregate({ where: { userId: req.user!.id }, _max: { order: true } });
    const { milestones, ...rest } = body;

    const created = await prisma.goal.create({
      data: {
        userId: req.user!.id,
        title: rest.title,
        description: rest.description ?? '',
        type: rest.type ?? 'monthly',
        status: rest.status ?? 'active',
        metricType: rest.metricType ?? 'milestones',
        targetValue: rest.targetValue ?? 0,
        currentValue: rest.currentValue ?? 0,
        unit: rest.unit ?? '',
        startDate: rest.startDate ?? null,
        targetDate: rest.targetDate ?? null,
        projectId: rest.projectId ?? null,
        color: rest.color ?? '#8b5cf6',
        order: (max._max.order ?? 0) + 1,
        milestones: milestones?.length
          ? { create: milestones.map((m, i) => ({ title: m.title, targetDate: m.targetDate ?? null, order: i })) }
          : undefined,
      },
    });

    const goals = await loadGoals(req.user!.id, { id: created.id });
    const [goal] = await decorate(req.user!.id, goals, todayStr(req.user!.timezone));
    res.status(201).json({ goal });
  }),
);

goalsRouter.patch(
  '/:id',
  ah(async (req, res) => {
    const body = goalBody.partial().parse(req.body);
    const existing = await prisma.goal.findFirst({ where: { id: req.params.id, userId: req.user!.id } });
    if (!existing) throw ApiError.notFound('Goal not found');

    await prisma.goal.update({
      where: { id: existing.id },
      data: {
        ...body,
        ...(body.status === 'done' && existing.status !== 'done' ? { completedAt: new Date() } : {}),
        ...(body.status && body.status !== 'done' ? { completedAt: null } : {}),
      },
    });

    const goals = await loadGoals(req.user!.id, { id: existing.id });
    const [goal] = await decorate(req.user!.id, goals, todayStr(req.user!.timezone));
    res.json({ goal });
  }),
);

goalsRouter.delete(
  '/:id',
  ah(async (req, res) => {
    const result = await prisma.goal.deleteMany({ where: { id: req.params.id, userId: req.user!.id } });
    if (!result.count) throw ApiError.notFound('Goal not found');
    res.json({ ok: true });
  }),
);

// --- Milestones ------------------------------------------------------------

async function ownedGoal(userId: string, goalId: string) {
  const goal = await prisma.goal.findFirst({ where: { id: goalId, userId }, select: { id: true } });
  if (!goal) throw ApiError.notFound('Goal not found');
  return goal;
}

goalsRouter.post(
  '/:id/milestones',
  ah(async (req, res) => {
    const goal = await ownedGoal(req.user!.id, req.params.id);
    const body = z.object({ title: z.string().trim().min(1).max(160), targetDate: dateStr.nullable().optional() }).parse(req.body);
    const max = await prisma.milestone.aggregate({ where: { goalId: goal.id }, _max: { order: true } });
    const created = await prisma.milestone.create({
      data: { goalId: goal.id, title: body.title, targetDate: body.targetDate ?? null, order: (max._max.order ?? 0) + 1 },
    });
    res.status(201).json({ milestone: created });
  }),
);

goalsRouter.patch(
  '/:id/milestones/:milestoneId',
  ah(async (req, res) => {
    const goal = await ownedGoal(req.user!.id, req.params.id);
    const body = z
      .object({
        title: z.string().trim().min(1).max(160).optional(),
        done: z.boolean().optional(),
        targetDate: dateStr.nullable().optional(),
        order: z.number().int().optional(),
      })
      .parse(req.body);

    const result = await prisma.milestone.updateMany({
      where: { id: req.params.milestoneId, goalId: goal.id },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.targetDate !== undefined ? { targetDate: body.targetDate } : {}),
        ...(body.order !== undefined ? { order: body.order } : {}),
        ...(body.done !== undefined ? { done: body.done, doneAt: body.done ? new Date() : null } : {}),
      },
    });
    if (!result.count) throw ApiError.notFound('Milestone not found');
    res.json({ ok: true });
  }),
);

goalsRouter.delete(
  '/:id/milestones/:milestoneId',
  ah(async (req, res) => {
    const goal = await ownedGoal(req.user!.id, req.params.id);
    await prisma.milestone.deleteMany({ where: { id: req.params.milestoneId, goalId: goal.id } });
    res.json({ ok: true });
  }),
);
