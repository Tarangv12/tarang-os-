import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db';
import { ApiError, ah } from '../lib/errors';
import { csrfProtect, requireAuth } from '../middleware/auth';

export const notesRouter = Router();
notesRouter.use(requireAuth, csrfProtect);

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const noteBody = z.object({
  title: z.string().max(200).optional(),
  content: z.string().max(100_000).optional(),
  date: dateStr.nullable().optional(),
  pinned: z.boolean().optional(),
  color: z.string().max(20).optional(),
  taskId: z.string().nullable().optional(),
  goalId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
});

async function assertLinks(userId: string, body: { taskId?: string | null; goalId?: string | null; projectId?: string | null }) {
  if (body.taskId) {
    const found = await prisma.task.findFirst({ where: { id: body.taskId, userId }, select: { id: true } });
    if (!found) throw ApiError.badRequest('Unknown task');
  }
  if (body.goalId) {
    const found = await prisma.goal.findFirst({ where: { id: body.goalId, userId }, select: { id: true } });
    if (!found) throw ApiError.badRequest('Unknown goal');
  }
  if (body.projectId) {
    const found = await prisma.project.findFirst({ where: { id: body.projectId, userId }, select: { id: true } });
    if (!found) throw ApiError.badRequest('Unknown project');
  }
}

const include = {
  task: { select: { id: true, title: true } },
  goal: { select: { id: true, title: true } },
  project: { select: { id: true, name: true, color: true } },
};

notesRouter.get(
  '/',
  ah(async (req, res) => {
    const q = z
      .object({
        search: z.string().max(120).optional(),
        date: dateStr.optional(),
        from: dateStr.optional(),
        to: dateStr.optional(),
        taskId: z.string().optional(),
        goalId: z.string().optional(),
        projectId: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(500).optional(),
      })
      .parse(req.query);

    const where: Record<string, unknown> = { userId: req.user!.id };
    if (q.date) where.date = q.date;
    if (q.from || q.to) where.date = { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) };
    if (q.taskId) where.taskId = q.taskId;
    if (q.goalId) where.goalId = q.goalId;
    if (q.projectId) where.projectId = q.projectId;
    if (q.search) {
      where.OR = [{ title: { contains: q.search } }, { content: { contains: q.search } }];
    }

    const notes = await prisma.note.findMany({
      where,
      include,
      orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }],
      take: q.limit ?? 200,
    });
    res.json({ notes });
  }),
);

notesRouter.get(
  '/:id',
  ah(async (req, res) => {
    const note = await prisma.note.findFirst({ where: { id: req.params.id, userId: req.user!.id }, include });
    if (!note) throw ApiError.notFound('Note not found');
    res.json({ note });
  }),
);

notesRouter.post(
  '/',
  ah(async (req, res) => {
    const body = noteBody.parse(req.body);
    if (!body.title && !body.content) throw ApiError.badRequest('A note needs a title or some content');
    await assertLinks(req.user!.id, body);

    const note = await prisma.note.create({
      data: {
        userId: req.user!.id,
        title: body.title ?? '',
        content: body.content ?? '',
        date: body.date ?? null,
        pinned: body.pinned ?? false,
        color: body.color ?? '',
        taskId: body.taskId ?? null,
        goalId: body.goalId ?? null,
        projectId: body.projectId ?? null,
      },
      include,
    });
    res.status(201).json({ note });
  }),
);

notesRouter.patch(
  '/:id',
  ah(async (req, res) => {
    const body = noteBody.partial().parse(req.body);
    await assertLinks(req.user!.id, body);
    const existing = await prisma.note.findFirst({ where: { id: req.params.id, userId: req.user!.id }, select: { id: true } });
    if (!existing) throw ApiError.notFound('Note not found');
    const note = await prisma.note.update({ where: { id: existing.id }, data: body, include });
    res.json({ note });
  }),
);

notesRouter.delete(
  '/:id',
  ah(async (req, res) => {
    const result = await prisma.note.deleteMany({ where: { id: req.params.id, userId: req.user!.id } });
    if (!result.count) throw ApiError.notFound('Note not found');
    res.json({ ok: true });
  }),
);
