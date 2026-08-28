import type { Role } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { AppError, Forbidden } from '../../lib/errors.js';
import { getTenantStore } from '../../lib/tenant/context.js';
import { aiEnabled, getAiPort } from '../../lib/ai.js';
import { getPortfolioSummary } from './portfolio.service.js';
import { detectConflicts } from '../resource/resourceConflicts.service.js';

// =====================================================================
// Portfolio "one thing" attention digest — deterministic ranking of where attention matters most
// this week, with the driving reasons. Reuses getPortfolioSummary (batched per-project spi/cpi/
// health) + cheap grouped queries + detectConflicts. Honest heuristic (NOT ML). The AI layer only
// narrates the ranked, deterministic data. Read-only.
// =====================================================================

// Structured reason — the client formats it bilingually.
export interface Reason { kind: 'schedule' | 'cost' | 'slip' | 'overdue' | 'dueSoon' | 'risks' | 'crs' | 'resource'; n?: number; detail?: string }
export interface AttentionItem { projectId: string; code: string; name: string; score: number; health: string; costHealth: string; reasons: Reason[] }

export interface SignalRow {
  projectId: string; code: string; name: string;
  health: string; costHealth: string; spi: number; cpi: number; finishVarianceDays: number | null;
  overdue: number; dueSoon: number; highRisks: number; openCRs: number; resourceOverBy: number;
}

const clampAdd = (n: number, per: number, cap = 10) => Math.min(n, cap) * per;

// PURE: weight the signals into a score + reasons per project. Unit-tested.
export function scoreProjects(rows: SignalRow[]): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const r of rows) {
    let score = 0;
    const reasons: Reason[] = [];

    if (r.health === 'RED') { score += 40; reasons.push({ kind: 'schedule', detail: r.spi.toFixed(2) }); }
    else if (r.health === 'AMBER') { score += 20; reasons.push({ kind: 'schedule', detail: r.spi.toFixed(2) }); }

    if (r.costHealth === 'RED') { score += 35; reasons.push({ kind: 'cost', detail: r.cpi.toFixed(2) }); }
    else if (r.costHealth === 'AMBER') { score += 18; reasons.push({ kind: 'cost', detail: r.cpi.toFixed(2) }); }

    if (r.finishVarianceDays != null && r.finishVarianceDays > 0) { score += Math.min(r.finishVarianceDays, 60) * 0.5; reasons.push({ kind: 'slip', n: r.finishVarianceDays }); }
    if (r.overdue > 0) { score += clampAdd(r.overdue, 6); reasons.push({ kind: 'overdue', n: r.overdue }); }
    if (r.dueSoon > 0) { score += clampAdd(r.dueSoon, 3); reasons.push({ kind: 'dueSoon', n: r.dueSoon }); }
    if (r.highRisks > 0) { score += clampAdd(r.highRisks, 8); reasons.push({ kind: 'risks', n: r.highRisks }); }
    if (r.openCRs > 0) { score += clampAdd(r.openCRs, 4); reasons.push({ kind: 'crs', n: r.openCRs }); }
    if (r.resourceOverBy > 0) { score += Math.min(r.resourceOverBy, 40); reasons.push({ kind: 'resource', detail: r.resourceOverBy.toFixed(1) }); }

    if (score <= 0) continue; // healthy projects don't need attention
    items.push({ projectId: r.projectId, code: r.code, name: r.name, score: Math.round(score), health: r.health, costHealth: r.costHealth, reasons });
  }
  return items.sort((a, b) => b.score - a.score).slice(0, 8);
}

// Whether the advisory AI narrative is usable (env + tenant opt-in) — drives the client button.
export async function attentionAiAvailable(): Promise<boolean> {
  if (!aiEnabled()) return false;
  const tid = getTenantStore()?.tenantId;
  if (!tid) return true;
  const t = await prisma.tenant.findUnique({ where: { id: tid }, select: { aiNarrativeEnabled: true } });
  return t?.aiNarrativeEnabled === true;
}

// Gather cheap batched signals over the caller's visible ACTIVE projects and rank them.
export async function getPortfolioAttention(userId: string, role: string): Promise<{ generatedAt: string; items: AttentionItem[]; aiAvailable: boolean }> {
  const summary = await getPortfolioSummary(userId, role, new Date());
  const active = summary.projects.filter((p) => p.status === 'IN_PROGRESS');
  const ids = active.map((p) => p.id);

  if (ids.length === 0) return { generatedAt: new Date().toISOString(), items: [], aiAvailable: await attentionAiAvailable() };

  const now = new Date();
  const dueSoonCutoff = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const [overdueG, dueSoonG, riskG, crG, conflicts, aiAvailable] = await Promise.all([
    prisma.task.groupBy({ by: ['projectId'], where: { projectId: { in: ids }, progressPct: { lt: 100 }, planEnd: { lt: now } }, _count: { _all: true } }),
    prisma.task.groupBy({ by: ['projectId'], where: { projectId: { in: ids }, progressPct: { lt: 100 }, planEnd: { gte: now, lte: dueSoonCutoff } }, _count: { _all: true } }),
    prisma.risk.groupBy({ by: ['projectId'], where: { projectId: { in: ids }, status: { not: 'CLOSED' }, severity: { in: ['HIGH', 'CRITICAL'] } }, _count: { _all: true } }),
    prisma.changeRequest.groupBy({ by: ['projectId'], where: { projectId: { in: ids }, status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } }, _count: { _all: true } }),
    detectConflicts(userId, role, {}),
    attentionAiAvailable(),
  ]);

  const cnt = (g: { projectId: string; _count: { _all: number } }[]) => new Map(g.map((x) => [x.projectId, x._count._all]));
  const overdue = cnt(overdueG), dueSoon = cnt(dueSoonG), risks = cnt(riskG), crs = cnt(crG);
  // Attribute each conflict's overrun to every project that contributes to it.
  const resourceOverBy = new Map<string, number>();
  for (const c of conflicts) {
    for (const pid of new Set(c.contributions.map((x) => x.projectId))) {
      resourceOverBy.set(pid, (resourceOverBy.get(pid) ?? 0) + c.overBy);
    }
  }

  const rows: SignalRow[] = active.map((p) => ({
    projectId: p.id, code: p.code, name: p.name,
    health: p.health, costHealth: p.costHealth, spi: p.spi, cpi: p.cpi, finishVarianceDays: p.finishVarianceDays,
    overdue: overdue.get(p.id) ?? 0, dueSoon: dueSoon.get(p.id) ?? 0, highRisks: risks.get(p.id) ?? 0,
    openCRs: crs.get(p.id) ?? 0, resourceOverBy: resourceOverBy.get(p.id) ?? 0,
  }));

  return { generatedAt: now.toISOString(), items: scoreProjects(rows), aiAvailable };
}

// --- AI "focus this week" narrative (advisory, gated) --------------------------------------------

const NARRATE_SYSTEM = [
  'Anda seorang kepala PMO yang memberi arahan mingguan singkat kepada eksekutif: DI MANA harus fokus minggu ini dan MENGAPA.',
  'Tulis Bahasa Indonesia manajemen proyek yang ringkas & tegas. HANYA gunakan proyek + alasan pada payload (sudah diranking). Jangan mengarang.',
  'headline: 1 kalimat prioritas utama. focus: daftar 2-4 proyek (code + why singkat berbasis alasan). summary: 1 kalimat penutup.',
].join('\n');

const NARRATE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    focus: { type: 'array', items: { type: 'object', properties: { code: { type: 'string' }, why: { type: 'string' } }, required: ['code', 'why'], additionalProperties: false } },
    summary: { type: 'string' },
  },
  required: ['headline', 'focus', 'summary'], additionalProperties: false,
} as const;

export interface AttentionNarrative { headline: string; focus: { code: string; why: string }[]; summary: string }

// Recompute server-side (grounding) then narrate. Assumes the route checked the env gate (503).
export async function draftAttentionNarrative(userId: string, role: string): Promise<{ items: AttentionItem[]; narrative: AttentionNarrative }> {
  const tid = getTenantStore()?.tenantId;
  if (tid) {
    const t = await prisma.tenant.findUnique({ where: { id: tid }, select: { aiNarrativeEnabled: true } });
    if (t?.aiNarrativeEnabled !== true) throw Forbidden('Fitur AI belum diaktifkan untuk workspace ini.');
  }
  const { items } = await getPortfolioAttention(userId, role);
  if (items.length === 0) return { items, narrative: { headline: 'Tidak ada proyek yang butuh perhatian khusus minggu ini.', focus: [], summary: 'Portofolio dalam kondisi sehat.' } };
  const raw = await getAiPort().draftJson({ system: NARRATE_SYSTEM, user: JSON.stringify({ items }), jsonSchema: NARRATE_JSON_SCHEMA, maxTokens: 900 });
  if (raw == null || typeof raw !== 'object' || !('headline' in raw)) throw new AppError(502, 'AI tidak dapat menyusun arahan fokus saat ini.', 'AI_UNAVAILABLE');
  return { items, narrative: raw as AttentionNarrative };
}
