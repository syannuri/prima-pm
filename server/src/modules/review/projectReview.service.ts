// Anett Project Review / Audit — a DETERMINISTIC gap/quality collector for ONE project. It reuses the
// existing domain services (requirement coverage, CPM, cost/EVM, risk) to surface prioritized findings
// across four dimensions: SCOPE, SCHEDULE, COST, RISK, GOVERNANCE. Mirrors getPortfolioAttention: pure
// signal gathering here; the AI narration (persona + PMI framing) is layered on top in the route and
// the assistant tool. Findings work with AI OFF; nothing here calls the model.

import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';
import { getTenantStore } from '../../lib/tenant/context.js';
import { getAiPort, aiNotEnabledError } from '../../lib/ai.js';
import { listRequirements } from '../requirement/requirement.service.js';
import { listRisks } from '../risk/risk.service.js';
import { getCostSummary } from '../cost/cost.service.js';
import { getProjectForecast } from '../forecast/forecast.service.js';
import { computeCpm, type CpmTaskInput, type CpmEdgeInput } from '../schedule/schedule.helpers.js';
import { resolvePersonasForCategory } from '../assistant/domainKnowledge.js';

export type ReviewDimension = 'SCOPE' | 'SCHEDULE' | 'COST' | 'RISK' | 'GOVERNANCE';
export type ReviewSeverity = 'HIGH' | 'MEDIUM' | 'LOW';

export interface Finding {
  id: string;                 // = code (stable, one finding per code)
  dimension: ReviewDimension;
  severity: ReviewSeverity;
  code: string;
  title: string;              // short, user-facing (Indonesian)
  detail: string;             // one-line explanation, grounded in the numbers
  count?: number;             // how many rows are affected (when applicable)
  refs?: { kind: string; id: string }[]; // affected entity rows (for deep-linking)
}

export interface ProjectReview {
  generatedAt: string;
  projectId: string;
  projectCode: string;
  projectName: string;
  category: string | null;    // charter category → drives the domain-expert lens in narration
  findings: Finding[];
  counts: { high: number; medium: number; low: number; total: number };
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const durationDays = (start: Date, end: Date) => Math.max(0, Math.round((end.getTime() - start.getTime()) / MS_PER_DAY));
const blank = (s: string | null | undefined) => !s || s.trim() === '';

const SEV_RANK: Record<ReviewSeverity, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
const DIM_RANK: Record<ReviewDimension, number> = { SCOPE: 0, SCHEDULE: 1, COST: 2, RISK: 3, GOVERNANCE: 4 };

export async function reviewProject(projectId: string): Promise<ProjectReview> {
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { id: true, code: true, name: true, status: true, baselineLockedAt: true },
  });
  const charter = await prisma.projectCharter.findUnique({
    where: { projectId },
    select: { goals: true, hiScope: true, hiDeliverables: true, category: true, locked: true },
  });
  const active = project.status === 'IN_PROGRESS';

  const findings: Finding[] = [];
  const add = (f: Finding) => findings.push(f);

  // ── GOVERNANCE ─────────────────────────────────────────────────────────────────────────────────
  if (!charter) {
    add({ id: 'GOV_NO_CHARTER', code: 'GOV_NO_CHARTER', dimension: 'GOVERNANCE', severity: 'MEDIUM',
      title: 'Charter belum dibuat', detail: 'Proyek belum memiliki Project Charter — dasar otorisasi & lingkup awal belum terdokumentasi.' });
  } else {
    const missing = [
      blank(charter.goals) ? 'tujuan' : null,
      blank(charter.hiScope) ? 'lingkup' : null,
      blank(charter.hiDeliverables) ? 'deliverable' : null,
    ].filter(Boolean);
    if (missing.length) {
      add({ id: 'GOV_CHARTER_INCOMPLETE', code: 'GOV_CHARTER_INCOMPLETE', dimension: 'GOVERNANCE', severity: 'MEDIUM',
        title: 'Charter belum lengkap', detail: `Charter belum mengisi: ${missing.join(', ')}.`, count: missing.length });
    }
  }

  // ── SCOPE / requirements ───────────────────────────────────────────────────────────────────────
  const { requirements, coverage } = await listRequirements(projectId);
  const mustUncovered = requirements.filter((r) => r.priority === 'MUST' && r.taskLinks.length === 0);
  if (mustUncovered.length) {
    add({ id: 'SCOPE_MUST_UNCOVERED', code: 'SCOPE_MUST_UNCOVERED', dimension: 'SCOPE', severity: 'HIGH',
      title: 'Requirement MUST belum ter-cover WBS', count: mustUncovered.length,
      detail: `${mustUncovered.length} requirement prioritas MUST belum tertaut ke satu pun task WBS (gap lingkup).`,
      refs: mustUncovered.map((r) => ({ kind: 'Requirement', id: r.id })) });
  }
  const otherUncovered = coverage.uncovered - mustUncovered.length;
  if (otherUncovered > 0) {
    add({ id: 'SCOPE_UNCOVERED', code: 'SCOPE_UNCOVERED', dimension: 'SCOPE', severity: 'MEDIUM',
      title: 'Requirement belum ter-cover', count: otherUncovered,
      detail: `${otherUncovered} requirement (non-MUST) belum tertaut ke task WBS (${coverage.covered}/${coverage.total} ter-cover).` });
  }
  if (active && coverage.total > 0 && coverage.verified === 0) {
    add({ id: 'SCOPE_NONE_VERIFIED', code: 'SCOPE_NONE_VERIFIED', dimension: 'SCOPE', severity: 'LOW',
      title: 'Belum ada requirement terverifikasi', detail: `Belum ada dari ${coverage.total} requirement yang berstatus VERIFIED pada proyek aktif.` });
  }

  // ── SCHEDULE / critical path ─────────────────────────────────────────────────────────────────────
  const [tasks, deps] = await Promise.all([
    prisma.task.findMany({ where: { projectId }, select: { id: true, name: true, wbsCode: true, parentTaskId: true, planStart: true, planEnd: true, isMilestone: true, picResourceId: true, owners: { select: { resourceId: true } } } }),
    prisma.taskDependency.findMany({ where: { predecessor: { projectId } }, select: { predecessorId: true, successorId: true, type: true, lagDays: true } }),
  ]);
  const parentIds = new Set(tasks.map((t) => t.parentTaskId).filter(Boolean) as string[]);
  const leaves = tasks.filter((t) => !parentIds.has(t.id));

  if (active && !project.baselineLockedAt) {
    add({ id: 'SCHED_NO_BASELINE', code: 'SCHED_NO_BASELINE', dimension: 'SCHEDULE', severity: 'MEDIUM',
      title: 'Baseline jadwal belum dikunci', detail: 'Proyek aktif tetapi baseline schedule/cost belum di-lock — varian tak bisa diukur terhadap rencana dasar.' });
  }
  const noOwner = leaves.filter((t) => !t.isMilestone && !t.picResourceId && t.owners.length === 0);
  if (noOwner.length) {
    add({ id: 'SCHED_TASK_NO_OWNER', code: 'SCHED_TASK_NO_OWNER', dimension: 'SCHEDULE', severity: 'MEDIUM',
      title: 'Task tanpa penanggung jawab', count: noOwner.length,
      detail: `${noOwner.length} task tanpa owner (lead maupun co-owner) — akuntabilitas eksekusi tidak jelas.`,
      refs: noOwner.map((t) => ({ kind: 'Task', id: t.id })) });
  }
  if (leaves.length >= 2) {
    const cpmTasks: CpmTaskInput[] = leaves.map((t) => ({ id: t.id, duration: durationDays(t.planStart, t.planEnd) }));
    const cpmEdges: CpmEdgeInput[] = deps.map((d) => ({ predecessorId: d.predecessorId, successorId: d.successorId, type: d.type, lagDays: d.lagDays }));
    const cpm = computeCpm(cpmTasks, cpmEdges);
    if (cpm.cyclic) {
      add({ id: 'SCHED_CYCLIC_DEPS', code: 'SCHED_CYCLIC_DEPS', dimension: 'SCHEDULE', severity: 'HIGH',
        title: 'Dependency melingkar (cyclic)', detail: 'Terdapat siklus pada jaringan dependency — jadwal tak bisa dihitung dengan benar sampai siklus diputus.' });
    } else if (leaves.length >= 3 && !cpm.hasNetwork) {
      add({ id: 'SCHED_NO_DEPENDENCIES', code: 'SCHED_NO_DEPENDENCIES', dimension: 'SCHEDULE', severity: 'MEDIUM',
        title: 'Tidak ada logika dependency', detail: `${leaves.length} task tanpa satu pun tautan dependency — urutan kerja & jalur kritis tidak terbentuk.` });
    } else if (cpm.hasNetwork && cpm.criticalTaskIds.length === leaves.length) {
      add({ id: 'SCHED_ALL_CRITICAL', code: 'SCHED_ALL_CRITICAL', dimension: 'SCHEDULE', severity: 'MEDIUM',
        title: 'Seluruh task di jalur kritis', detail: 'Semua task berada di jalur kritis (float 0) — tidak ada kelonggaran; keterlambatan satu task menggeser tanggal selesai.' });
    }
  }

  // ── COST / EVM ───────────────────────────────────────────────────────────────────────────────────
  const cost = await getCostSummary(projectId);
  const bac = cost.baseline?.budgetAtCompletion == null ? 0 : Number(cost.baseline.budgetAtCompletion);
  if (active && bac <= 0) {
    add({ id: 'COST_NO_BASELINE', code: 'COST_NO_BASELINE', dimension: 'COST', severity: 'HIGH',
      title: 'Cost baseline kosong (BAC = 0)', detail: 'Belum ada cost baseline / BAC = 0 — EVM, S-curve, dan kontrol biaya tidak dapat berjalan.' });
  }
  const overLines = cost.directCosts.filter((d) => typeof d.remaining === 'number' && d.remaining < 0);
  if (overLines.length) {
    add({ id: 'COST_OVER_BUDGET_LINES', code: 'COST_OVER_BUDGET_LINES', dimension: 'COST', severity: 'HIGH',
      title: 'Baris biaya melebihi anggaran', count: overLines.length,
      detail: `${overLines.length} baris biaya langsung sudah melewati pagunya (actual > budget).`,
      refs: overLines.map((d) => ({ kind: 'Cost', id: d.id })) });
  }
  if (bac > 0) {
    try {
      const fc = await getProjectForecast(projectId, new Date());
      if (typeof fc.spi === 'number' && fc.spi > 0 && fc.spi < 0.9) {
        add({ id: 'COST_SPI_LOW', code: 'COST_SPI_LOW', dimension: 'COST', severity: 'MEDIUM',
          title: 'Kinerja jadwal rendah (SPI)', detail: `SPI = ${fc.spi.toFixed(2)} (< 0,90) — pekerjaan tertinggal dari rencana.` });
      }
      if (typeof fc.cpi === 'number' && fc.cpi > 0 && fc.cpi < 0.9) {
        add({ id: 'COST_CPI_LOW', code: 'COST_CPI_LOW', dimension: 'COST', severity: 'MEDIUM',
          title: 'Kinerja biaya rendah (CPI)', detail: `CPI = ${fc.cpi.toFixed(2)} (< 0,90) — biaya melebihi nilai yang diperoleh.` });
      }
      const eacLikely = fc.eac?.likely;
      if (typeof eacLikely === 'number' && eacLikely > bac * 1.05) {
        add({ id: 'COST_EAC_OVERRUN', code: 'COST_EAC_OVERRUN', dimension: 'COST', severity: 'MEDIUM',
          title: 'Perkiraan biaya melebihi anggaran (EAC > BAC)', detail: `EAC (likely) diproyeksikan melampaui BAC lebih dari 5% — indikasi overrun bila tren berlanjut.` });
      }
    } catch {
      // Forecast needs enough EVM signal; if it cannot compute, the deterministic BAC/over-budget
      // findings above still stand. Never let the audit fail because a forecast is unavailable.
    }
  }

  // ── RISK ─────────────────────────────────────────────────────────────────────────────────────────
  const risks = await listRisks(projectId);
  const openHigh = risks.filter((r) => r.status !== 'CLOSED' && (r.severity === 'HIGH' || r.severity === 'CRITICAL'));
  const highNoStrategy = openHigh.filter((r) => !r.responseStrategy);
  if (highNoStrategy.length) {
    add({ id: 'RISK_HIGH_NO_STRATEGY', code: 'RISK_HIGH_NO_STRATEGY', dimension: 'RISK', severity: 'HIGH',
      title: 'Risiko tinggi tanpa strategi respons', count: highNoStrategy.length,
      detail: `${highNoStrategy.length} risiko HIGH/CRITICAL yang masih terbuka belum punya strategi respons (avoid/mitigate/transfer/accept).`,
      refs: highNoStrategy.map((r) => ({ kind: 'Risk', id: r.id })) });
  }
  const highNoOwner = openHigh.filter((r) => !r.ownerUserId);
  if (highNoOwner.length) {
    add({ id: 'RISK_HIGH_NO_OWNER', code: 'RISK_HIGH_NO_OWNER', dimension: 'RISK', severity: 'MEDIUM',
      title: 'Risiko tinggi tanpa owner', count: highNoOwner.length,
      detail: `${highNoOwner.length} risiko HIGH/CRITICAL terbuka belum punya penanggung jawab.`,
      refs: highNoOwner.map((r) => ({ kind: 'Risk', id: r.id })) });
  }
  if (active && risks.length === 0) {
    add({ id: 'RISK_EMPTY_REGISTER', code: 'RISK_EMPTY_REGISTER', dimension: 'RISK', severity: 'MEDIUM',
      title: 'Register risiko kosong', detail: 'Proyek aktif tetapi belum ada satu pun risiko teridentifikasi — kemungkinan under-identified, bukan bebas risiko.' });
  }

  findings.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || DIM_RANK[a.dimension] - DIM_RANK[b.dimension]);
  const counts = {
    high: findings.filter((f) => f.severity === 'HIGH').length,
    medium: findings.filter((f) => f.severity === 'MEDIUM').length,
    low: findings.filter((f) => f.severity === 'LOW').length,
    total: findings.length,
  };
  return { generatedAt: new Date().toISOString(), projectId: project.id, projectCode: project.code, projectName: project.name, category: charter?.category ?? null, findings, counts };
}

// ── AI narration (gated, GROUNDED) ────────────────────────────────────────────────────────────────
// Layer an advisory narrative on top of the deterministic findings, framed in PMI standards + the
// project's domain-expert persona(s). The model ONLY ranks/explains findings it is handed — it never
// invents new ones (mirrors draftAttentionNarrative). Gated by the tenant narrative opt-in.

export interface ReviewNarrative {
  headline: string;
  prioritized: { code: string; why: string; recommendation: string }[];
  summary: string;
}

const NARRATE_SYSTEM = [
  'Anda seorang reviewer proyek senior yang menulis audit ringkas & tegas dalam Bahasa Indonesia manajemen proyek.',
  'Bingkai temuan dalam standar PMI/PMBOK dan, bila persona domain diberikan, tambahkan lensa pakar itu (mis. keamanan siber, arsitektur jaringan, SDLC).',
  'HANYA gunakan temuan pada payload (sudah dikumpulkan deterministik & berprioritas). JANGAN menambah temuan, angka, atau standar yang tak ada di payload; JANGAN mengarang nomor klausul/versi/CVE.',
  'headline: 1 kalimat kondisi keseluruhan. prioritized: 2-5 temuan terpenting (pakai field `code` PERSIS dari payload) dengan `why` (dampak) + `recommendation` (langkah konkret berbasis standar). summary: 1 kalimat penutup.',
].join('\n');

const NARRATE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    prioritized: { type: 'array', items: { type: 'object', properties: { code: { type: 'string' }, why: { type: 'string' }, recommendation: { type: 'string' } }, required: ['code', 'why', 'recommendation'], additionalProperties: false } },
    summary: { type: 'string' },
  },
  required: ['headline', 'prioritized', 'summary'], additionalProperties: false,
} as const;

// Recompute the findings server-side (grounding) then narrate. Assumes the route already checked the
// env gate (503). Throws aiNotEnabledError when the caller's tenant has not opted into AI narrative.
export async function draftReviewNarrative(projectId: string): Promise<{ review: ProjectReview; narrative: ReviewNarrative }> {
  const tid = getTenantStore()?.tenantId;
  if (tid) {
    const t = await prisma.tenant.findUnique({ where: { id: tid }, select: { aiNarrativeEnabled: true } });
    if (t?.aiNarrativeEnabled !== true) throw aiNotEnabledError();
  }
  const review = await reviewProject(projectId);
  const personas = resolvePersonasForCategory(review.category).map((p) => p.persona);
  if (review.findings.length === 0) {
    return { review, narrative: { headline: 'Tidak ada temuan berarti — proyek dalam kondisi sehat.', prioritized: [], summary: 'Audit tidak menemukan gap prioritas.' } };
  }
  const raw = await getAiPort().draftJson({
    system: NARRATE_SYSTEM,
    user: JSON.stringify({ project: review.projectCode, category: review.category, personas, findings: review.findings }),
    jsonSchema: NARRATE_JSON_SCHEMA, maxTokens: 1100, feature: 'portfolio_qa',
  });
  if (raw == null || typeof raw !== 'object' || !('headline' in raw)) throw new AppError(502, 'AI tidak dapat menyusun narasi review saat ini.', 'AI_UNAVAILABLE');
  return { review, narrative: raw as ReviewNarrative };
}
