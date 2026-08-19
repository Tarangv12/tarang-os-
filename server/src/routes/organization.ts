import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db';
import { ApiError, ah } from '../lib/errors';
import { csrfProtect, requireAuth } from '../middleware/auth';

/** Categories, tags and projects — the containers tasks live in. */
export const organizationRouter = Router();
organizationRouter.use(requireAuth, csrfProtect);

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #6366f1');
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

organizationRouter.get(
  '/categories',
  ah(async (req, res) => {
    const categories = await prisma.category.findMany({
      where: { userId: req.user!.id },
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { tasks: true } } },
    });
    res.json({
      categories: categories.map((c) => ({
        id: c.id, name: c.name, color: c.color, icon: c.icon, order: c.order, taskCount: c._count.tasks,
      })),
    });
  }),
);

organizationRouter.post(
  '/categories',
  ah(async (req, res) => {
    const body = z
      .object({ name: z.string().trim().min(1).max(40), color: color.optional(), icon: z.string().max(40).optional() })
      .parse(req.body);
    const max = await prisma.category.aggregate({ where: { userId: req.user!.id }, _max: { order: true } });
    const created = await prisma.category.create({
      data: {
        userId: req.user!.id,
        name: body.name,
        color: body.color ?? '#6366f1',
        icon: body.icon ?? 'folder',
        order: (max._max.order ?? 0) + 1,
      },
    });
    res.status(201).json({ category: created });
  }),
);

organizationRouter.patch(
  '/categories/:id',
  ah(async (req, res) => {
    const body = z
      .object({
        name: z.string().trim().min(1).max(40).optional(),
        color: color.optional(),
        icon: z.string().max(40).optional(),
        order: z.number().int().optional(),
      })
      .parse(req.body);
    const result = await prisma.category.updateMany({ where: { id: req.params.id, userId: req.user!.id }, data: body });
    if (!result.count) throw ApiError.notFound('Category not found');
    res.json({ ok: true });
  }),
);

organizationRouter.delete(
  '/categories/:id',
  ah(async (req, res) => {
    const result = await prisma.category.deleteMany({ where: { id: req.params.id, userId: req.user!.id } });
    if (!result.count) throw ApiError.notFound('Category not found');
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

organizationRouter.get(
  '/tags',
  ah(async (req, res) => {
    const tags = await prisma.tag.findMany({
      where: { userId: req.user!.id },
      orderBy: { name: 'asc' },
      include: { _count: { select: { tasks: true } } },
    });
    res.json({ tags: tags.map((t) => ({ id: t.id, name: t.name, color: t.color, taskCount: t._count.tasks })) });
  }),
);

organizationRouter.patch(
  '/tags/:id',
  ah(async (req, res) => {
    const body = z.object({ name: z.string().trim().min(1).max(30).optional(), color: color.optional() }).parse(req.body);
    const result = await prisma.tag.updateMany({
      where: { id: req.params.id, userId: req.user!.id },
      data: { ...(body.name ? { name: body.name.toLowerCase() } : {}), ...(body.color ? { color: body.color } : {}) },
    });
    if (!result.count) throw ApiError.notFound('Tag not found');
    res.json({ ok: true });
  }),
);

organizationRouter.delete(
  '/tags/:id',
  ah(async (req, res) => {
    const result = await prisma.tag.deleteMany({ where: { id: req.params.id, userId: req.user!.id } });
    if (!result.count) throw ApiError.notFound('Tag not found');
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

const projectBody = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(2000).optional(),
  color: color.optional(),
  icon: z.string().max(40).optional(),
  status: z.enum(['active', 'paused', 'done']).optional(),
  startDate: dateStr.nullable().optional(),
  targetDate: dateStr.nullable().optional(),
  order: z.number().int().optional(),
});

async function projectStats(userId: string, ids: string[]) {
  if (!ids.length) return new Map<string, { total: number; done: number; overdue: number }>();
  const grouped = await prisma.task.groupBy({
    by: ['projectId', 'status'],
    where: { userId, projectId: { in: ids }, archivedAt: null },
    _count: { _all: true },
  });
  const map = new Map<string, { total: number; done: number; overdue: number }>();
  for (const id of ids) map.set(id, { total: 0, done: 0, overdue: 0 });
  for (const row of grouped) {
    if (!row.projectId) continue;
    const entry = map.get(row.projectId)!;
    entry.total += row._count._all;
    if (row.status === 'completed') entry.done += row._count._all;
  }
  return map;
}

organizationRouter.get(
  '/projects',
  ah(async (req, res) => {
    const includeArchived = req.query.includeArchived === 'true';
    const projects = await prisma.project.findMany({
      where: { userId: req.user!.id, ...(includeArchived ? {} : { archivedAt: null }) },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
    const stats = await projectStats(req.user!.id, projects.map((p) => p.id));
    res.json({
      projects: projects.map((p) => {
        const s = stats.get(p.id) ?? { total: 0, done: 0, overdue: 0 };
        return { ...p, taskCount: s.total, completedCount: s.done, progress: s.total ? s.done / s.total : 0 };
      }),
    });
  }),
);

organizationRouter.get(
  '/projects/:id',
  ah(async (req, res) => {
    const project = await prisma.project.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
      include: { goals: true },
    });
    if (!project) throw ApiError.notFound('Project not found');
    const stats = await projectStats(req.user!.id, [project.id]);
    const s = stats.get(project.id)!;
    res.json({ project: { ...project, taskCount: s.total, completedCount: s.done, progress: s.total ? s.done / s.total : 0 } });
  }),
);

organizationRouter.post(
  '/projects',
  ah(async (req, res) => {
    const body = projectBody.parse(req.body);
    const max = await prisma.project.aggregate({ where: { userId: req.user!.id }, _max: { order: true } });
    const created = await prisma.project.create({
      data: {
        userId: req.user!.id,
        name: body.name,
        description: body.description ?? '',
        color: body.color ?? '#6366f1',
        icon: body.icon ?? 'layers',
        status: body.status ?? 'active',
        startDate: body.startDate ?? null,
        targetDate: body.targetDate ?? null,
        order: (max._max.order ?? 0) + 1,
      },
    });
    res.status(201).json({ project: { ...created, taskCount: 0, completedCount: 0, progress: 0 } });
  }),
);

organizationRouter.patch(
  '/projects/:id',
  ah(async (req, res) => {
    const body = projectBody.partial().extend({ archived: z.boolean().optional() }).parse(req.body);
    const { archived, ...rest } = body;
    const result = await prisma.project.updateMany({
      where: { id: req.params.id, userId: req.user!.id },
      data: { ...rest, ...(archived !== undefined ? { archivedAt: archived ? new Date() : null } : {}) },
    });
    if (!result.count) throw ApiError.notFound('Project not found');
    res.json({ ok: true });
  }),
);

organizationRouter.delete(
  '/projects/:id',
  ah(async (req, res) => {
    const detachTasks = req.query.deleteTasks !== 'true';
    const project = await prisma.project.findFirst({ where: { id: req.params.id, userId: req.user!.id } });
    if (!project) throw ApiError.notFound('Project not found');
    if (!detachTasks) {
      await prisma.task.deleteMany({ where: { projectId: project.id, userId: req.user!.id } });
    }
    await prisma.project.delete({ where: { id: project.id } });
    res.json({ ok: true });
  }),
);
