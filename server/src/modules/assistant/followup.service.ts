import type { Role } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { getTenantStore } from '../../lib/tenant/context.js';
import { Forbidden } from '../../lib/errors.js';
import { canWriteTenantScope } from './memory.service.js';

// Follow-up chip click telemetry (Anett elevation #4). One row per clicked suggestion so an admin can
// see whether the chips are used — and which kind earns its place (model vs derived vs static question,
// and navigational deep-links). Best-effort: a telemetry failure must NEVER affect the click/UX.

const KINDS = new Set(['question', 'nav']);
const ORIGINS = new Set(['model', 'derived', 'static', 'nav_cite']);

export async function recordFollowupClick(input: { kind: string; origin: string; userId?: string | null }): Promise<void> {
  try {
    const kind = KINDS.has(input.kind) ? input.kind : 'question';
    const origin = ORIGINS.has(input.origin) ? input.origin : 'static';
    await prisma.aiFollowupEvent.create({
      data: { tenantId: getTenantStore()?.tenantId ?? null, kind, origin, userId: input.userId ?? null },
    });
  } catch {
    // Telemetry is non-critical — swallow (mirrors recordAiUsage).
  }
}

export interface FollowupStats {
  days: number;
  total: number;
  byKind: Record<string, number>;
  byOrigin: Record<string, number>;
}

// Click counts over the window, broken down by kind + origin. ADMIN/PMO only; tenant-scoped by the
// Prisma extension.
export async function getFollowupStats(caller: { role: Role }, opts?: { days?: number }): Promise<FollowupStats> {
  if (!canWriteTenantScope(caller.role)) throw Forbidden('Hanya admin/PMO yang dapat melihat statistik follow-up.');
  const days = Math.max(1, Math.min(365, opts?.days ?? 30));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await prisma.aiFollowupEvent.findMany({ where: { createdAt: { gte: since } }, select: { kind: true, origin: true } });
  const byKind: Record<string, number> = {};
  const byOrigin: Record<string, number> = {};
  for (const r of rows) {
    byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
    byOrigin[r.origin] = (byOrigin[r.origin] ?? 0) + 1;
  }
  return { days, total: rows.length, byKind, byOrigin };
}
