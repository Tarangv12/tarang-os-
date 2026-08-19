import fs from 'node:fs/promises';
import express, { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/db';
import { config } from '../config';
import { ApiError, ah } from '../lib/errors';
import { csrfProtect, requireAuth } from '../middleware/auth';
import { heavyLimiter } from '../middleware/rateLimit';
import { audit } from '../lib/audit';
import { verifySecret } from '../lib/crypto';
import {
  buildBackup,
  exportTasksCsv,
  listBackups,
  parseCsv,
  pruneBackups,
  resolveBackupPath,
  restoreBackup,
  validateBackup,
  writeBackupFile,
} from '../lib/backup';
import { resolveTagIds } from '../lib/tasks';
import { todayStr } from '../lib/dates';

export const backupRouter = Router();
backupRouter.use(requireAuth, csrfProtect);

/**
 * Restore and import legitimately carry a whole dataset, so they opt into a
 * larger body than the 1 MB the rest of the API accepts. Keeping the ceiling
 * narrow everywhere else means a flood of oversized payloads is rejected at the
 * parser instead of being buffered into memory.
 */
const bulkBody = express.json({ limit: '12mb' });

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

backupRouter.get(
  '/',
  ah(async (_req, res) => {
    const backups = await listBackups();
    res.json({
      backups,
      directory: config.backupDir,
      autoDaily: config.backup.autoDaily,
      keep: config.backup.keep,
    });
  }),
);

backupRouter.post(
  '/',
  ah(async (req, res) => {
    const result = await writeBackupFile(req.user!.id, 'manual');
    audit(req, 'backup.created', { userId: req.user!.id, detail: result.filename });
    res.status(201).json(result);
  }),
);

backupRouter.get(
  '/download/:filename',
  ah(async (req, res) => {
    let filePath: string;
    try {
      filePath = resolveBackupPath(req.params.filename);
    } catch {
      throw ApiError.badRequest('Invalid backup filename');
    }
    const exists = await fs.stat(filePath).catch(() => null);
    if (!exists) throw ApiError.notFound('Backup file not found');

    audit(req, 'backup.downloaded', { userId: req.user!.id, detail: req.params.filename });
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.filename}"`);
    res.send(await fs.readFile(filePath, 'utf8'));
  }),
);

backupRouter.delete(
  '/:filename',
  ah(async (req, res) => {
    let filePath: string;
    try {
      filePath = resolveBackupPath(req.params.filename);
    } catch {
      throw ApiError.badRequest('Invalid backup filename');
    }
    await fs.unlink(filePath).catch(() => undefined);
    audit(req, 'backup.deleted', { userId: req.user!.id, detail: req.params.filename });
    res.json({ ok: true });
  }),
);

backupRouter.post(
  '/prune',
  ah(async (req, res) => {
    const removed = await pruneBackups(config.backup.keep);
    res.json({ ok: true, removed });
  }),
);

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

backupRouter.get(
  '/export.json',
  ah(async (req, res) => {
    const payload = await buildBackup(req.user!.id);
    audit(req, 'data.exported', { userId: req.user!.id, detail: 'json' });
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="tarangos-export-${todayStr(req.user!.timezone)}.json"`);
    res.send(JSON.stringify(payload, null, 2));
  }),
);

backupRouter.get(
  '/export.csv',
  ah(async (req, res) => {
    const q = z.object({ from: dateStr.optional(), to: dateStr.optional() }).parse(req.query);
    const csv = await exportTasksCsv(req.user!.id, q.from, q.to);
    audit(req, 'data.exported', { userId: req.user!.id, detail: 'csv' });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="tarangos-tasks-${todayStr(req.user!.timezone)}.csv"`);
    res.send('﻿' + csv);
  }),
);

// ---------------------------------------------------------------------------
// Restore & import
// ---------------------------------------------------------------------------

/** Restoring rewrites your data, so it needs the account password. */
backupRouter.post(
  '/restore',
  heavyLimiter,
  bulkBody,
  ah(async (req, res) => {
    const body = z
      .object({
        password: z.string().min(1).max(200),
        mode: z.enum(['replace', 'merge']).default('merge'),
        filename: z.string().max(200).optional(),
        payload: z.unknown().optional(),
      })
      .parse(req.body);

    if (!(await verifySecret(body.password, req.user!.passwordHash))) {
      audit(req, 'backup.restore.denied', { userId: req.user!.id, ok: false });
      throw ApiError.unauthorized('Password is incorrect', 'BAD_CREDENTIALS');
    }

    let payload: unknown = body.payload;
    if (body.filename) {
      let filePath: string;
      try {
        filePath = resolveBackupPath(body.filename);
      } catch {
        throw ApiError.badRequest('Invalid backup filename');
      }
      const raw = await fs.readFile(filePath, 'utf8').catch(() => null);
      if (!raw) throw ApiError.notFound('Backup file not found');
      payload = JSON.parse(raw);
    }
    if (!payload) throw ApiError.badRequest('Provide a backup file or its contents');

    try {
      validateBackup(payload);
    } catch (err) {
      throw ApiError.badRequest((err as Error).message);
    }

    // Safety net before a destructive restore.
    const safety = await writeBackupFile(req.user!.id, 'auto');
    const created = await restoreBackup(req.user!.id, payload as never, body.mode);

    audit(req, 'backup.restored', {
      userId: req.user!.id,
      detail: `${body.mode} from ${body.filename ?? 'upload'}`,
    });
    res.json({ ok: true, mode: body.mode, restored: created, safetyBackup: safety.filename });
  }),
);

/** CSV import for tasks — headers are matched case-insensitively. */
backupRouter.post(
  '/import/csv',
  heavyLimiter,
  bulkBody,
  ah(async (req, res) => {
    const body = z.object({ csv: z.string().min(1).max(8_000_000), dryRun: z.boolean().default(false) }).parse(req.body);
    const rows = parseCsv(body.csv);
    if (rows.length < 2) throw ApiError.badRequest('The CSV needs a header row and at least one task');

    const header = rows[0].map((h) => h.trim().toLowerCase());
    const idx = (name: string) => header.indexOf(name.toLowerCase());
    const titleIdx = idx('title');
    if (titleIdx === -1) throw ApiError.badRequest('The CSV must have a "title" column');

    const today = todayStr(req.user!.timezone);
    const categoryCache = new Map<string, string>();
    const projectCache = new Map<string, string>();

    const results = { created: 0, skipped: 0, errors: [] as string[] };
    const preview: Record<string, unknown>[] = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const cell = (name: string) => {
        const at = idx(name);
        return at === -1 ? '' : (row[at] ?? '').trim();
      };
      const title = (row[titleIdx] ?? '').trim();
      if (!title) {
        results.skipped += 1;
        continue;
      }

      const date = /^\d{4}-\d{2}-\d{2}$/.test(cell('date')) ? cell('date') : today;
      const priority = ['urgent', 'high', 'medium', 'low'].includes(cell('priority').toLowerCase())
        ? cell('priority').toLowerCase()
        : 'medium';
      const status = ['pending', 'in_progress', 'completed'].includes(cell('status').toLowerCase())
        ? cell('status').toLowerCase()
        : 'pending';

      if (body.dryRun) {
        if (preview.length < 20) preview.push({ title, date, priority, status });
        results.created += 1;
        continue;
      }

      try {
        let categoryId: string | null = null;
        const categoryName = cell('category');
        if (categoryName) {
          if (!categoryCache.has(categoryName)) {
            const category = await prisma.category.upsert({
              where: { userId_name: { userId: req.user!.id, name: categoryName } },
              update: {},
              create: { userId: req.user!.id, name: categoryName },
            });
            categoryCache.set(categoryName, category.id);
          }
          categoryId = categoryCache.get(categoryName)!;
        }

        let projectId: string | null = null;
        const projectName = cell('project');
        if (projectName) {
          if (!projectCache.has(projectName)) {
            const found = await prisma.project.findFirst({ where: { userId: req.user!.id, name: projectName } });
            const project = found ?? (await prisma.project.create({ data: { userId: req.user!.id, name: projectName } }));
            projectCache.set(projectName, project.id);
          }
          projectId = projectCache.get(projectName)!;
        }

        const tagNames = cell('tags').split(/[\s,;]+/).filter(Boolean);
        const tagIds = tagNames.length ? await resolveTagIds(req.user!.id, tagNames) : [];

        await prisma.task.create({
          data: {
            userId: req.user!.id,
            title: title.slice(0, 200),
            description: cell('description').slice(0, 4000),
            notes: cell('notes').slice(0, 20000),
            date,
            startTime: /^\d{2}:\d{2}$/.test(cell('starttime')) ? cell('starttime') : null,
            dueTime: /^\d{2}:\d{2}$/.test(cell('duetime')) ? cell('duetime') : null,
            priority,
            status,
            completedAt: status === 'completed' ? new Date() : null,
            estimatedMinutes: Number(cell('estimatedminutes')) || 0,
            actualMinutes: Number(cell('actualminutes')) || 0,
            categoryId,
            projectId,
            tags: tagIds.length ? { create: tagIds.map((tagId) => ({ tagId })) } : undefined,
          },
        });
        results.created += 1;
      } catch (err) {
        results.skipped += 1;
        if (results.errors.length < 10) results.errors.push(`Row ${i + 1}: ${(err as Error).message}`);
      }
    }

    if (!body.dryRun) audit(req, 'data.imported', { userId: req.user!.id, detail: `${results.created} tasks` });
    res.json({ ...results, dryRun: body.dryRun, preview });
  }),
);

/** JSON import (merge) — the same payload shape as the export. */
backupRouter.post(
  '/import/json',
  heavyLimiter,
  bulkBody,
  ah(async (req, res) => {
    const body = z.object({ payload: z.unknown() }).parse(req.body);
    try {
      validateBackup(body.payload);
    } catch (err) {
      throw ApiError.badRequest((err as Error).message);
    }
    const created = await restoreBackup(req.user!.id, body.payload as never, 'merge');
    audit(req, 'data.imported', { userId: req.user!.id, detail: 'json merge' });
    res.json({ ok: true, imported: created });
  }),
);
