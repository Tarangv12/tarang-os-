import type { Request } from 'express';
import { prisma } from './db';
import { clientIp } from './net';

// IP and user-agent resolution lives in lib/net so that rate limiting, banning
// and the audit trail all agree on who the caller is — and so none of them can
// be fooled by a forged X-Forwarded-For header.
export { clientIp, userAgent } from './net';

/** Fire-and-forget security/activity trail. Never throws into the request path. */
export function audit(
  req: Request,
  action: string,
  opts: { userId?: string | null; detail?: string; ok?: boolean } = {},
): void {
  prisma.auditLog
    .create({
      data: {
        userId: opts.userId ?? null,
        action,
        detail: (opts.detail ?? '').slice(0, 512),
        ok: opts.ok ?? true,
        ip: clientIp(req),
      },
    })
    .catch(() => {
      /* auditing must never break the request */
    });
}

/** Keeps the audit trail bounded — retains the most recent 5000 entries. */
export async function pruneAuditLog(keep = 5000): Promise<void> {
  const total = await prisma.auditLog.count();
  if (total <= keep) return;
  const cutoff = await prisma.auditLog.findMany({
    orderBy: { at: 'desc' },
    skip: keep,
    take: 1,
    select: { at: true },
  });
  if (!cutoff.length) return;
  await prisma.auditLog.deleteMany({ where: { at: { lt: cutoff[0].at } } });
}
