import type { Role } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { AppError, Forbidden } from '../../lib/errors.js';
import { getTenantStore } from '../../lib/tenant/context.js';
import { aiEnabled, getAiPort, type AiToolDef } from '../../lib/ai.js';
import { listProjects } from '../projects/projects.service.js';
import { getProjectReport } from '../report/report.service.js';
import { listRisks } from '../risk/risk.service.js';
import { listMyApprovals } from '../approval/approval.service.js';
import { proposeAction, AI_ACTION_TYPES } from '../aiActions/aiActions.service.js';
import { findGuide, guideIndex } from './processGuide.js';
import { callerMemoryEnabled, loadMemoriesForPrompt, buildMemoryBlock, addMemory, forgetMemory, normalizeKind, type MemScope } from './memory.service.js';
import { runQuery, queryCatalog, type QuerySpec, type QueryTable } from './query.service.js';

// Cross-project (portfolio) Q&A assistant (Phase 4). READ-ONLY: it answers questions about the
// projects the CALLER can access, via a server-side manual tool loop. The API key and all data
// access stay on the server; the model never touches the DB. Security boundary: every tool operates
// ONLY on the pre-computed set of projects the user is allowed to see (same rule as listProjects) —
// a project outside that set is unknown to the assistant, so it cannot leak inaccessible data.

export type AssistantLang = 'id' | 'en';

const SYSTEM_PROMPT_ID = [
  'Anda adalah "Anett", PM Assistant untuk aplikasi manajemen proyek Prismatix. Anda menjawab pertanyaan pengguna tentang proyek-proyek yang DAPAT DIAKSES olehnya.',
  'Jika pengguna menyapa atau menanyakan nama Anda, perkenalkan diri sebagai Anett secara singkat dan ramah. Jangan menyebut nama diri di setiap jawaban.',
  'Jawab dalam Bahasa Indonesia manajemen proyek yang natural dan ringkas.',
  '',
  'ATURAN (WAJIB):',
  '- Gunakan tool untuk mengambil data sebelum menjawab hal yang butuh angka. Jangan mengarang angka, tanggal, atau nama.',
  '- Anda HANYA dapat melihat proyek yang dikembalikan oleh tool. Jika pengguna menyebut proyek yang tidak ada di daftar, katakan Anda tidak menemukannya atau tidak punya akses.',
  '- Interpretasikan EVM dengan benar: SPI/CPI < 1 = di belakang jadwal / over budget; > 1 = baik.',
  '- Anda bersifat READ-ONLY: Anda tidak dapat mengubah data. Jika diminta melakukan aksi, jelaskan langkahnya secara ringkas namun jangan mengklaim sudah melakukannya.',
  '- Jika data tidak cukup untuk menjawab, katakan dengan jujur.',
  '- Jawab ringkas dan langsung; sertakan angka kunci bila relevan.',
  '- Untuk pertanyaan CARA/PROSES ("bagaimana cara…", "apa yang harus saya lakukan untuk…", "di mana menu…"), GUNAKAN tool get_process_guide lalu sampaikan langkah ringkas + JALUR MENU persis (mis. Proyek → tab Cost → Baseline → Lock). JANGAN mengarang nama menu/tab; jika topik tak ada di panduan, katakan dan sarankan yang terdekat.',
  '',
  'FORMAT JAWABAN (Markdown):',
  '- Bila menyebut beberapa hal (daftar proyek, risiko, langkah), gunakan bullet point ("- ") satu item per baris — jangan menumpuk dalam satu paragraf panjang.',
  '- Tulis kode/konteks proyek dalam inline code backtick, mis. `AI-1`, `CPI`, `SPI`, agar mudah dibaca.',
  '- Gunakan **tebal** untuk menyorot angka/kesimpulan penting. Jaga tetap ringkas.',
].join('\n');

const SYSTEM_PROMPT_EN = [
  'You are "Anett", the PM Assistant for the Prismatix project-management app. You answer the user\'s questions about the projects they CAN ACCESS.',
  'If the user greets you or asks your name, introduce yourself as Anett briefly and warmly. Do not repeat your name in every answer.',
  'Answer in natural, concise project-management English.',
  '',
  'RULES (MANDATORY):',
  '- Use tools to fetch data before answering anything that needs numbers. Do not make up numbers, dates, or names.',
  '- You can ONLY see projects returned by the tools. If the user names a project not in the list, say you cannot find it or do not have access.',
  '- Interpret EVM correctly: SPI/CPI < 1 = behind schedule / over budget; > 1 = good.',
  '- You are READ-ONLY: you cannot change data. If asked to perform an action, explain the steps briefly but never claim you have done it.',
  '- If the data is not enough to answer, say so honestly.',
  '- Answer concisely and directly; include key numbers when relevant.',
  '- For HOW-TO / PROCESS questions ("how do I…", "what should I do to…", "where is the menu…"), USE the get_process_guide tool then give the brief steps + the EXACT MENU PATH (e.g. Project → Cost tab → Baseline → Lock). Do NOT invent menu/tab names; if the topic is not in the guide, say so and suggest the closest one.',
  '',
  'ANSWER FORMAT (Markdown):',
  '- When listing several things (projects, risks, steps), use bullet points ("- "), one item per line — do not cram them into one long paragraph.',
  '- Write project codes/context in inline code backticks, e.g. `AI-1`, `CPI`, `SPI`, for readability.',
  '- Use **bold** to highlight key numbers/conclusions. Keep it concise.',
].join('\n');

const systemPromptFor = (lang: AssistantLang): string => (lang === 'en' ? SYSTEM_PROMPT_EN : SYSTEM_PROMPT_ID);

// Tool schemas (raw JSON schema — the SDK zod helper targets a different zod major than the app).
const TOOLS: AiToolDef[] = [
  {
    name: 'list_projects',
    description: 'Daftar proyek yang dapat diakses pengguna (kode, nama, status, PM). Panggil ini dulu untuk mengetahui proyek apa saja yang tersedia.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_project_details',
    description: 'Ringkasan kesehatan sebuah proyek: EVM (BAC/EV/AC/SPI/CPI/% selesai), forecast (EAC, perkiraan selesai, varians hari), dan tugas (total/selesai/overdue). Argumen: project_code dari list_projects.',
    input_schema: {
      type: 'object',
      properties: { project_code: { type: 'string', description: 'Kode proyek, mis. "AI-1"' } },
      required: ['project_code'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_project_risks',
    description: 'Daftar risiko sebuah proyek (kode, judul, jenis, severity, status, skor, EMV). Argumen: project_code dari list_projects.',
    input_schema: {
      type: 'object',
      properties: { project_code: { type: 'string' } },
      required: ['project_code'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_portfolio_summary',
    description: 'Ringkasan portofolio proyek yang dapat diakses pengguna: jumlah per status, total anggaran (BAC), dan proyek yang punya tugas telat (overdue). Panggil untuk pertanyaan "bagaimana portofolio saya".',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_my_approvals',
    description: 'Item yang MENUNGGU keputusan (approve/reject) pengguna saat ini: CR, lock/unlock baseline, closure, atau aksi AI. Panggil untuk "apa yang menunggu persetujuan saya".',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_project_tasks',
    description: 'Daftar tugas sebuah proyek (kode WBS, nama, % progress, tenggat, status telat/overdue). Fokus ke yang belum selesai & telat. Argumen: project_code dari list_projects.',
    input_schema: {
      type: 'object',
      properties: { project_code: { type: 'string' } },
      required: ['project_code'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_change_requests',
    description: 'Daftar Change Request sebuah proyek (judul, status, magnitude, chargeable). Argumen: project_code dari list_projects.',
    input_schema: {
      type: 'object',
      properties: { project_code: { type: 'string' } },
      required: ['project_code'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_process_guide',
    description: 'Panduan CARA memakai aplikasi ini: langkah + jalur menu yang benar untuk sebuah tugas (mis. "cara membuat baseline biaya & jadwal", "cara membuat change request", "cara menutup proyek"). Argumen: topic = frasa bebas tentang yang ingin dilakukan pengguna.',
    input_schema: {
      type: 'object',
      properties: { topic: { type: 'string', description: 'Apa yang ingin dilakukan pengguna, mis. "lock baseline" / "buat CR"' } },
      required: ['topic'],
      additionalProperties: false,
    },
  },
  {
    name: 'query_data',
    description: [
      'JAWAB pertanyaan "list/filter/urutkan/peringkat" dengan sebuah TABEL. Bangun spec terstruktur (BUKAN SQL); server memvalidasi & menjalankannya, dibatasi ke data yang dapat diakses pengguna. Hasil ditampilkan sebagai tabel + ekspor CSV ke pengguna — jadi ringkas saja temuannya, jangan salin seluruh baris.',
      'entity + field yang tersedia: ' + queryCatalog() + '.',
      'op: eq, ne, gt, gte, lt, lte, contains, in. Contoh: {entity:"projects", filters:[{field:"spi",op:"lt",value:0.9},{field:"pendingCRs",op:"gt",value:0}], sort:{field:"spi",dir:"asc"}, limit:20}.',
      'Tanggal ISO (YYYY-MM-DD). Gunakan untuk "proyek dengan …", "tugas telat …", "5 teratas menurut …".',
    ].join('\n'),
    input_schema: {
      type: 'object',
      properties: {
        entity: { type: 'string', enum: ['projects', 'tasks'] },
        filters: { type: 'array', items: { type: 'object', properties: { field: { type: 'string' }, op: { type: 'string', enum: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'in'] }, value: {} }, required: ['field', 'op', 'value'], additionalProperties: false } },
        sort: { type: 'object', properties: { field: { type: 'string' }, dir: { type: 'string', enum: ['asc', 'desc'] } }, required: ['field'], additionalProperties: false },
        limit: { type: 'number' },
        columns: { type: 'array', items: { type: 'string' } },
      },
      required: ['entity'],
      additionalProperties: false,
    },
  },
];

// Stage C — the ONE write-adjacent tool. It does NOT change data: it stages an AI-proposed action
// into the approval engine, and the action runs only after a human approves. Added to the loop only
// when the caller's tenant has opted into AI actions (aiActionsEnabled). Params vary per action_type
// and are validated server-side; a bad shape returns an error the model can relay.
const PROPOSE_ACTION_TOOL: AiToolDef = {
  name: 'propose_action',
  description: [
    'USULKAN sebuah aksi untuk proyek — TIDAK langsung dijalankan; harus disetujui manusia lewat approval dulu.',
    'Gunakan hanya bila pengguna secara eksplisit meminta melakukan/mengusulkan perubahan. Selalu konfirmasi ke pengguna sebelum memanggil.',
    'action_type & bentuk params:',
    '- CREATE_RISK: { title (>=3 char), probabilityScore 1-5, impactScore 1-5, kind "THREAT"|"OPPORTUNITY"?, description? }',
    '- CREATE_CHANGE_REQUEST: { title, description (>=5 char), impactAreas: ["SCOPE"?...] salah satu dari CHARTER/COST/SCHEDULE/RESOURCE/QUALITY/RISK, magnitude "MINOR"|"MAJOR"?, chargeable? , amountIdr? }',
    '- TIDY_SCHEDULE: { mode "push"|"asap"? } — rapikan jadwal mengikuti dependensi.',
    'project_code dari list_projects. rationale = alasan singkat mengapa aksi ini diusulkan.',
  ].join('\n'),
  input_schema: {
    type: 'object',
    properties: {
      project_code: { type: 'string' },
      action_type: { type: 'string', enum: [...AI_ACTION_TYPES] },
      params: { type: 'object', description: 'Parameter aksi sesuai action_type (lihat deskripsi tool).' },
      rationale: { type: 'string', description: 'Alasan singkat aksi diusulkan.' },
    },
    required: ['project_code', 'action_type', 'params'],
    additionalProperties: false,
  },
};

// Cross-session memory tools — exposed only when the caller's tenant opted into AI memory. They let
// Anett persist durable facts/preferences (remember) or drop them (forget). Deterministic, no cost.
const REMEMBER_TOOL: AiToolDef = {
  name: 'remember',
  description: [
    'SIMPAN sebuah ingatan jangka panjang agar diingat lintas sesi.',
    'Gunakan HANYA bila pengguna memintanya ("ingat bahwa…", "mulai sekarang…") atau jelas menyatakan preferensi/fakta durable. Konfirmasi ke pengguna sebelum memanggil.',
    'Ringkas jadi SATU kalimat padat (maks 280 karakter).',
    'scope: "user" = preferensi/fakta pribadi pengguna ini (default); "tenant" = fakta/istilah berlaku untuk seluruh organisasi (hanya admin/PMO).',
    'kind: "preference" | "fact" | "glossary".',
  ].join('\n'),
  input_schema: {
    type: 'object',
    properties: {
      content: { type: 'string', description: 'Kalimat ingatan yang padat.' },
      scope: { type: 'string', enum: ['user', 'tenant'] },
      kind: { type: 'string', enum: ['preference', 'fact', 'glossary'] },
    },
    required: ['content'],
    additionalProperties: false,
  },
};
const FORGET_TOOL: AiToolDef = {
  name: 'forget',
  description: 'LUPAKAN (hapus) sebuah ingatan yang cocok dengan deskripsi. Berikan kutipan/deskripsi ingatan yang ingin dilupakan. Jika tidak ada atau ambigu, minta pengguna memperjelas.',
  input_schema: {
    type: 'object',
    properties: { query: { type: 'string', description: 'Kutipan/deskripsi ingatan yang ingin dilupakan.' } },
    required: ['query'],
    additionalProperties: false,
  },
};

// Per-tenant opt-in for the CALLER's tenant (no single project here). Applies only when a tenant
// exists (single-tenant deploy with no tenant → env gate alone governs).
async function assertCallerTenantOptedIn(): Promise<void> {
  const tid = getTenantStore()?.tenantId;
  if (!tid) return;
  const tenant = await prisma.tenant.findUnique({ where: { id: tid }, select: { aiNarrativeEnabled: true } });
  if (tenant?.aiNarrativeEnabled !== true) {
    throw Forbidden('Fitur AI belum diaktifkan untuk workspace ini.');
  }
}

// Whether the CALLER's tenant has opted into AI actions (Stage C) — a SEPARATE, stronger opt-in than
// the narrative gate above. Governs whether Anett is given the propose_action tool at all.
async function callerActionsEnabled(): Promise<boolean> {
  const tid = getTenantStore()?.tenantId;
  if (!tid) return true; // single-tenant deploy: env gate alone governs
  const tenant = await prisma.tenant.findUnique({ where: { id: tid }, select: { aiActionsEnabled: true } });
  return tenant?.aiActionsEnabled === true;
}

// Whether the assistant is usable for the caller right now: global env gate + the caller tenant's
// opt-in. Drives the client's show/hide of the AI assistant launcher.
export async function assistantAvailable(): Promise<boolean> {
  if (!aiEnabled()) return false;
  const tid = getTenantStore()?.tenantId;
  if (!tid) return true; // single-tenant deploy: env gate alone governs
  const tenant = await prisma.tenant.findUnique({ where: { id: tid }, select: { aiNarrativeEnabled: true } });
  return tenant?.aiNarrativeEnabled === true;
}

// Whether Anett may PROPOSE actions for the caller (Stage C) — env + the caller tenant's separate
// aiActionsEnabled opt-in. Drives the client's capability-aware footer + the action suggestion chip.
export async function assistantActionsAvailable(): Promise<boolean> {
  if (!aiEnabled()) return false;
  return callerActionsEnabled();
}

// A proposal Anett staged during a turn (surfaced to the client so it can show a "view in Approvals"
// card). Kept minimal — the full detail lives in the approvals inbox.
export interface ProposedRef { actionType: string; projectCode: string; routed: boolean }

// A grounded in-app navigation target the process guide surfaced (id-less top-level route only) — the
// client renders it as a real router-Link button so "buka Reports" actually navigates.
export interface NavRef { label: string; path: string }

// A memory Anett stored during a turn (surfaced to the client as a "🧠 mengingat …" chip).
export interface MemoryRef { scope: MemScope; content: string }

function compactReport(r: Awaited<ReturnType<typeof getProjectReport>>) {
  const overdue = r.tasks.remaining.filter((t) => t.overdue).slice(0, 15)
    .map((t) => ({ name: t.name, pct: t.pct, due: t.planEnd }));
  return {
    project: { code: r.project.code, name: r.project.name, status: r.project.status },
    health: r.health,
    evm: { bac: r.evm.bac, pv: r.evm.pv, ev: r.evm.ev, ac: r.evm.ac, spi: r.evm.spi, cpi: r.evm.cpi, percentComplete: r.evm.percentComplete },
    forecast: { eac: r.forecast.eac, forecastFinish: r.forecast.schedule.forecastFinish, varianceDays: r.forecast.schedule.varianceDays },
    tasks: { total: r.tasks.total, completed: r.tasks.completed, inProgress: r.tasks.inProgress, overdueCount: overdue.length, overdue },
  };
}

// Build the executeTool callback bound to the caller's accessible project set. Returns a JSON string
// per tool call. Unknown/inaccessible project_code → a friendly error object (not an exception), so
// the model can tell the user rather than crash the loop.
interface ProjectSummary { id: string; code: string; name: string; status: string; bac: number }

// A friendly, lang-aware "what Anett is doing" label for a tool call — streamed live to the client so
// it can show the reasoning process ("Menganalisis EVM PRJ-7…"). Kept here (domain-aware) rather than
// in the generic AI port.
function stepLabel(name: string, code: string, en: boolean): string {
  const c = code ? ` ${code}` : '';
  switch (name) {
    case 'list_projects': return en ? 'Reading your project list' : 'Membaca daftar proyek';
    case 'get_project_details': return en ? `Analyzing${c} health` : `Menganalisis kesehatan${c}`;
    case 'list_project_risks': return en ? `Reviewing${c} risks` : `Meninjau risiko${c}`;
    case 'get_portfolio_summary': return en ? 'Summarizing your portfolio' : 'Merangkum portofolio Anda';
    case 'list_my_approvals': return en ? 'Checking your approvals' : 'Memeriksa persetujuan Anda';
    case 'list_project_tasks': return en ? `Checking${c} tasks` : `Memeriksa tugas${c}`;
    case 'list_change_requests': return en ? `Reviewing${c} change requests` : `Meninjau change request${c}`;
    case 'query_data': return en ? 'Querying your data' : 'Menjalankan query data';
    case 'get_process_guide': return en ? 'Looking up the how-to guide' : 'Mencari panduan cara-pakai';
    case 'propose_action': return en ? 'Preparing an action proposal' : 'Menyiapkan usulan aksi';
    case 'remember': return en ? 'Saving a memory' : 'Menyimpan ingatan';
    case 'forget': return en ? 'Removing a memory' : 'Menghapus ingatan';
    default: return en ? 'Working' : 'Memproses';
  }
}

function makeExecuteTool(accessibleByCode: Map<string, string>, ctx: { userId: string; role: Role; proposals: ProposedRef[]; navs: NavRef[]; memories: MemoryRef[]; tables: QueryTable[]; memoryEnabled: boolean; en: boolean; emitStep?: (label: string) => void; projectsSummary: ProjectSummary[] }) {
  return async (name: string, input: unknown): Promise<string> => {
    const args = (input ?? {}) as { project_code?: string; action_type?: string; params?: unknown; rationale?: string; topic?: string; content?: string; scope?: string; kind?: string; query?: string };
    // Stream a live "thinking" step for this tool call (best-effort; SSE only).
    ctx.emitStep?.(stepLabel(name, typeof args.project_code === 'string' ? args.project_code.trim() : '', ctx.en));
    const resolveId = (): string | null => {
      const code = typeof args.project_code === 'string' ? args.project_code.trim() : '';
      return accessibleByCode.get(code) ?? null;
    };
    switch (name) {
      case 'list_projects': {
        const list = [...accessibleByCode.keys()];
        return JSON.stringify({ count: list.length, projectCodes: list });
      }
      case 'get_project_details': {
        const id = resolveId();
        if (!id) return JSON.stringify({ error: 'Proyek tidak ditemukan atau tidak dapat diakses.' });
        const report = await getProjectReport(id, 'monthly', new Date());
        return JSON.stringify(compactReport(report));
      }
      case 'list_project_risks': {
        const id = resolveId();
        if (!id) return JSON.stringify({ error: 'Proyek tidak ditemukan atau tidak dapat diakses.' });
        const risks = await listRisks(id);
        return JSON.stringify(risks.map((r) => ({
          code: r.code, title: r.title, kind: r.kind, severity: r.severity, status: r.status,
          riskScore: r.riskScore, emv: Number(r.emv),
        })));
      }
      case 'get_portfolio_summary': {
        const byStatus: Record<string, number> = {};
        let totalBac = 0;
        for (const p of ctx.projectsSummary) { byStatus[p.status] = (byStatus[p.status] ?? 0) + 1; totalBac += p.bac; }
        // One cheap query: which accessible projects have an unfinished, past-due task.
        const ids = ctx.projectsSummary.map((p) => p.id);
        const overdue = ids.length
          ? await prisma.task.groupBy({ by: ['projectId'], where: { projectId: { in: ids }, progressPct: { lt: 100 }, planEnd: { lt: new Date() } }, _count: { _all: true } })
          : [];
        const codeById = new Map(ctx.projectsSummary.map((p) => [p.id, p.code]));
        return JSON.stringify({
          totalProjects: ctx.projectsSummary.length,
          byStatus,
          totalBacIdr: totalBac,
          projectsWithOverdueTasks: overdue.map((o) => ({ code: codeById.get(o.projectId), overdueTasks: o._count._all })),
        });
      }
      case 'list_my_approvals': {
        const items = await listMyApprovals(ctx.userId);
        return JSON.stringify(items.map((a) => ({ item: a.actionLabel, project: a.project?.code ?? null, step: a.stepName, since: a.createdAt })));
      }
      case 'list_project_tasks': {
        const id = resolveId();
        if (!id) return JSON.stringify({ error: 'Proyek tidak ditemukan atau tidak dapat diakses.' });
        const report = await getProjectReport(id, 'monthly', new Date());
        const rows = report.tasks.remaining
          .map((t) => ({ name: t.name, pct: t.pct, due: t.planEnd, overdue: t.overdue, milestone: t.isMilestone }))
          .slice(0, 40);
        return JSON.stringify({ total: report.tasks.total, completed: report.tasks.completed, tasks: rows });
      }
      case 'list_change_requests': {
        const id = resolveId();
        if (!id) return JSON.stringify({ error: 'Proyek tidak ditemukan atau tidak dapat diakses.' });
        const crs = await prisma.changeRequest.findMany({
          where: { projectId: id }, orderBy: { createdAt: 'desc' }, take: 30,
          select: { title: true, status: true, magnitude: true, chargeable: true, amountIdr: true },
        });
        return JSON.stringify(crs.map((c) => ({ title: c.title, status: c.status, magnitude: c.magnitude, chargeable: c.chargeable, amountIdr: c.amountIdr == null ? null : Number(c.amountIdr) })));
      }
      case 'get_process_guide': {
        const entry = findGuide(typeof args.topic === 'string' ? args.topic : '');
        if (!entry) return JSON.stringify({ error: 'Topik tidak ada di panduan.', availableTopics: guideIndex() });
        // Surface an id-less top-level route as a clickable nav button (dedupe by path).
        if (entry.route && !ctx.navs.some((n) => n.path === entry.route!.path)) ctx.navs.push({ label: entry.route.label, path: entry.route.path });
        return JSON.stringify({
          title: entry.title,
          summary: entry.summary,
          prerequisites: entry.prerequisites ?? [],
          steps: entry.steps,
          menuPath: entry.menuPath,
          route: entry.route ?? null,
        });
      }
      case 'propose_action': {
        const id = resolveId();
        if (!id) return JSON.stringify({ error: 'Proyek tidak ditemukan atau tidak dapat diakses.' });
        // Write gate mirrors requireProjectAccess({write:true}): VIEWER never writes; a CLOSED
        // project is frozen. Access is already bounded by the accessible set.
        if (ctx.role === 'VIEWER') return JSON.stringify({ error: 'Peran read-only tidak dapat mengusulkan perubahan.' });
        const proj = await prisma.project.findUnique({ where: { id }, select: { status: true } });
        if (proj?.status === 'CLOSED') return JSON.stringify({ error: 'Proyek sudah ditutup (read-only). Buka kembali untuk mengubah.' });
        const actionType = typeof args.action_type === 'string' ? args.action_type : '';
        if (!AI_ACTION_TYPES.includes(actionType as (typeof AI_ACTION_TYPES)[number])) {
          return JSON.stringify({ error: `action_type tidak dikenal. Pilih salah satu: ${AI_ACTION_TYPES.join(', ')}.` });
        }
        try {
          const { routed } = await proposeAction({ projectId: id, actionType, params: args.params, rationale: args.rationale ?? null }, ctx.userId);
          ctx.proposals.push({ actionType, projectCode: (typeof args.project_code === 'string' ? args.project_code.trim() : ''), routed });
          return JSON.stringify({ ok: true, routed, message: routed
            ? 'Usulan aksi telah diajukan untuk approval. Aksi hanya berjalan setelah disetujui.'
            : 'Usulan tersimpan namun belum ada approver yang bisa dituju — minta admin mengatur workflow AI action.' });
        } catch (err) {
          const msg = err instanceof AppError ? err.message : 'Gagal mengajukan usulan aksi.';
          return JSON.stringify({ error: msg });
        }
      }
      case 'query_data': {
        try {
          const table = await runQuery((input ?? {}) as QuerySpec, ctx.userId, ctx.role);
          ctx.tables.push(table);
          // The model gets a compact preview (headers + first rows + total) to summarize; the client
          // renders the full table from ctx.tables.
          return JSON.stringify({ ok: true, entity: table.entity, total: table.total, columns: table.columns.map((c) => c.key), rows: table.rows.slice(0, 10), note: table.total > table.rows.length ? `Menampilkan ${table.rows.length} dari ${table.total} baris ke pengguna.` : undefined });
        } catch (err) {
          return JSON.stringify({ error: err instanceof AppError ? err.message : 'Query gagal dijalankan.' });
        }
      }
      case 'remember': {
        if (!ctx.memoryEnabled) return JSON.stringify({ error: 'Memori AI tidak aktif untuk workspace ini.' });
        const content = typeof args.content === 'string' ? args.content : '';
        const scope: MemScope = args.scope === 'tenant' ? 'TENANT' : 'USER';
        try {
          const m = await addMemory({ content, scope, kind: normalizeKind(args.kind), source: 'EXPLICIT' }, { userId: ctx.userId, role: ctx.role });
          ctx.memories.push({ scope: m.scope, content: m.content });
          return JSON.stringify({ ok: true, remembered: m.content, scope: m.scope.toLowerCase() });
        } catch (err) {
          return JSON.stringify({ error: err instanceof AppError ? err.message : 'Gagal menyimpan memori.' });
        }
      }
      case 'forget': {
        if (!ctx.memoryEnabled) return JSON.stringify({ error: 'Memori AI tidak aktif untuk workspace ini.' });
        const res = await forgetMemory(typeof args.query === 'string' ? args.query : '', { userId: ctx.userId, role: ctx.role });
        if (res.status === 'forgotten') return JSON.stringify({ ok: true, forgotten: res.content });
        if (res.status === 'ambiguous') return JSON.stringify({ error: 'Beberapa ingatan cocok — minta pengguna memperjelas yang mana.', candidates: res.candidates });
        return JSON.stringify({ error: 'Tidak ada ingatan yang cocok untuk dilupakan.' });
      }
      default:
        return JSON.stringify({ error: `Tool tidak dikenal: ${name}` });
    }
  };
}

// A single conversation turn from the client (text only).
export interface AssistantTurn { role: 'user' | 'assistant'; content: string }
// What the user is currently looking at — lets "proyek ini" resolve without naming it.
export interface AskContext { projectId?: string | null; tab?: string | null }

// Answer a portfolio question. Assumes the global env gate (aiEnabled) was already checked by the
// route (→ 503 when off). `messages` is the recent conversation (last turns + the new question).
export async function askAssistant(userId: string, role: Role, messages: AssistantTurn[], context?: AskContext, lang: AssistantLang = 'id', emitStep?: (label: string) => void): Promise<{ answer: string; proposals: ProposedRef[]; navigate: NavRef[]; memories: MemoryRef[]; tables: QueryTable[] }> {
  const en = lang === 'en';
  await assertCallerTenantOptedIn();
  const port = getAiPort();
  if (!port.runToolLoop) throw new AppError(502, 'Asisten AI tidak tersedia.', 'AI_UNAVAILABLE');

  // Pre-compute the accessible project set (same rule the user sees elsewhere) → the security scope.
  const projects = await listProjects(userId, role);
  const byCode = new Map<string, string>();
  const projectsSummary: ProjectSummary[] = [];
  for (const p of projects.slice(0, 200)) {
    byCode.set(p.code, p.id);
    projectsSummary.push({ id: p.id, code: p.code, name: p.name, status: p.status, bac: p.costBaseline?.budgetAtCompletion == null ? 0 : Number(p.costBaseline.budgetAtCompletion) });
  }

  // Context-awareness: if the caller is viewing an ACCESSIBLE project, tell Anett so "proyek ini"
  // resolves. A project outside the accessible set is ignored (never leaked).
  const current = context?.projectId ? projectsSummary.find((p) => p.id === context.projectId) : undefined;
  const contextNote = current
    ? (en
        ? `\n\nContext: the user is viewing project ${current.code} ("${current.name}")${context?.tab ? ` on the ${context.tab} tab` : ''}. If they say "this project" / "here", they mean ${current.code}.`
        : `\n\nKonteks: pengguna sedang membuka proyek ${current.code} ("${current.name}")${context?.tab ? ` di tab ${context.tab}` : ''}. Jika ia menyebut "proyek ini" / "di sini", maksudnya ${current.code}.`)
    : '';

  // Stage C — only expose the propose_action tool when the caller's tenant opted in AND the caller
  // is not a read-only role (Anett can then STAGE actions for approval, never execute them).
  const actionsEnabled = role !== 'VIEWER' && (await callerActionsEnabled());
  const tools = actionsEnabled ? [...TOOLS, PROPOSE_ACTION_TOOL] : TOOLS;
  const actionNote = actionsEnabled
    ? (en
        ? '\n\nYou CAN propose actions (not execute them) via the propose_action tool; an action only runs after a human approves it. Confirm with the user before submitting.'
        : '\n\nAnda DAPAT mengusulkan aksi (bukan mengeksekusi) via tool propose_action; aksi hanya berjalan setelah disetujui manusia. Konfirmasikan ke pengguna sebelum mengajukan.')
    : '';

  // Cross-session memory — inject what Anett remembers (bounded), and expose remember/forget, only
  // when the caller's tenant opted in. Deterministic; no extra LLM cost beyond the longer prompt.
  const memoryEnabled = await callerMemoryEnabled();
  const memoryItems = memoryEnabled ? await loadMemoriesForPrompt(userId) : [];
  const memoryBlock = buildMemoryBlock(memoryItems, lang);
  const memoryNote = memoryEnabled
    ? (en
        ? '\n\nYou have long-term memory: use the remember tool to store a durable fact/preference (confirm with the user first) and the forget tool to drop one.'
        : '\n\nAnda punya memori jangka panjang: pakai tool remember untuk menyimpan fakta/preferensi durable (konfirmasi ke pengguna dulu) dan tool forget untuk menghapusnya.')
    : '';
  const memoryTools = memoryEnabled ? [REMEMBER_TOOL, FORGET_TOOL] : [];

  // Proposals + navigation targets + stored memories Anett surfaces during this turn, for the client.
  const proposals: ProposedRef[] = [];
  const navs: NavRef[] = [];
  const memories: MemoryRef[] = [];
  const tables: QueryTable[] = [];
  // Seed the loop with a short, project-list-aware system prompt + the how-to topic index.
  const accessibleCodes = [...byCode.keys()].join(', ');
  const system = en
    ? `${systemPromptFor('en')}${actionNote}${memoryNote}${contextNote}${memoryBlock}\n\nProjects the user can access (codes): ${accessibleCodes || '(none)'}.\n\nHow-to guide topics (get_process_guide): ${guideIndex()}.`
    : `${systemPromptFor('id')}${actionNote}${memoryNote}${contextNote}${memoryBlock}\n\nProyek yang dapat diakses pengguna (kode): ${accessibleCodes || '(tidak ada)'}.\n\nTopik panduan cara-pakai (get_process_guide): ${guideIndex()}.`;
  const answer = await port.runToolLoop({
    system,
    messages,
    tools: [...tools, ...memoryTools],
    executeTool: makeExecuteTool(byCode, { userId, role, proposals, navs, memories, tables, memoryEnabled, en, emitStep, projectsSummary }),
    maxSteps: 6,
    maxTokens: 1500,
  });
  if (!answer) throw new AppError(502, 'AI tidak dapat menjawab saat ini. Silakan coba lagi.', 'AI_UNAVAILABLE');
  return { answer, proposals, navigate: navs, memories, tables };
}

// Deterministic (NO LLM, NO cost) briefing for the assistant's proactive open-state: what needs the
// user's attention right now. Cheap queries only — approvals count + a single overdue-task rollup.
export async function assistantBriefing(userId: string, role: Role): Promise<{ approvalsWaiting: number; overdueTasks: number; projectsWithOverdue: { code: string; name: string; count: number }[] }> {
  const projects = await listProjects(userId, role);
  const ids = projects.slice(0, 200).map((p) => p.id);
  const byId = new Map(projects.map((p) => [p.id, p]));
  const [approvals, overdue] = await Promise.all([
    listMyApprovals(userId),
    ids.length
      ? prisma.task.groupBy({ by: ['projectId'], where: { projectId: { in: ids }, progressPct: { lt: 100 }, planEnd: { lt: new Date() } }, _count: { _all: true } })
      : Promise.resolve([] as { projectId: string; _count: { _all: number } }[]),
  ]);
  const projectsWithOverdue = overdue
    .map((o) => ({ code: byId.get(o.projectId)?.code ?? '', name: byId.get(o.projectId)?.name ?? '', count: o._count._all }))
    .filter((p) => p.code)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  return {
    approvalsWaiting: approvals.length,
    overdueTasks: projectsWithOverdue.reduce((s, p) => s + p.count, 0),
    projectsWithOverdue,
  };
}
