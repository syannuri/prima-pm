// Rotating, intent-ordered starter cards for the Anett chat box.
// A bilingual POOL of starter questions tagged by scope + intent. `selectChips` orders them by
// what the project/portfolio currently needs (live signals — overdue tasks, pending approvals) —
// the "maksud" — then rotates the non-urgent tail by a seed so the surfaced set changes each time
// the panel is opened or a new chat starts. Pure + unit-tested (see anettChips.test.ts).

export type ChipIntent = 'approval' | 'schedule' | 'risk' | 'health' | 'cost' | 'forecast' | 'nextstep' | 'data' | 'action';
export interface ChipItem { scope: 'project' | 'portfolio'; intent: ChipIntent; propose?: boolean; label: { id: string; en: string } }
export interface ChipCtx { proj: boolean; propose: boolean; overdue: number; approvals: number; lang: 'id' | 'en' }

export const CHIP_POOL: ChipItem[] = [
  // ---- Viewing a project ----
  { scope: 'project', intent: 'health', label: { id: 'Ringkas kesehatan proyek ini', en: 'Summarize this project’s health' } },
  { scope: 'project', intent: 'schedule', label: { id: 'Tugas apa saja yang telat di sini?', en: 'Which tasks are overdue here?' } },
  { scope: 'project', intent: 'risk', label: { id: 'Apa risiko tertinggi di proyek ini?', en: "What's the top risk in this project?" } },
  { scope: 'project', intent: 'forecast', label: { id: 'Bagaimana forecast & EAC proyek ini?', en: 'Forecast & EAC for this project?' } },
  { scope: 'project', intent: 'cost', label: { id: 'Biaya vs baseline sekarang bagaimana?', en: 'Cost vs baseline right now?' } },
  { scope: 'project', intent: 'nextstep', label: { id: 'Apa langkah berikutnya di proyek ini?', en: "What's the next step here?" } },
  { scope: 'project', intent: 'action', propose: true, label: { id: 'Usulkan mitigasi untuk proyek ini', en: 'Propose mitigations for this project' } },
  // ---- Portfolio (no project open) ----
  { scope: 'portfolio', intent: 'schedule', label: { id: 'Proyek mana yang paling di belakang jadwal?', en: 'Which project is most behind schedule?' } },
  { scope: 'portfolio', intent: 'health', label: { id: 'Ringkas kesehatan portofolio saya', en: 'Summarize my portfolio health' } },
  { scope: 'portfolio', intent: 'approval', label: { id: 'Apa yang menunggu persetujuan saya?', en: 'What is waiting for my approval?' } },
  { scope: 'portfolio', intent: 'risk', label: { id: 'Apa risiko tertinggi di proyek saya?', en: "What's the top risk across my projects?" } },
  { scope: 'portfolio', intent: 'cost', label: { id: 'Proyek mana yang paling boros anggaran?', en: 'Which project is most over budget?' } },
  { scope: 'portfolio', intent: 'data', label: { id: 'Proyek mana yang SPI-nya di bawah 0,9?', en: 'Which projects have SPI below 0.9?' } },
  { scope: 'portfolio', intent: 'action', propose: true, label: { id: 'Usulkan mitigasi untuk proyek paling berisiko', en: 'Propose mitigations for the riskiest project' } },
];

/** Pick ~`count` starter cards, ordered by current need (the lead card) then rotated by `seed`. */
export function selectChips(ctx: ChipCtx, seed: number, count = 3): string[] {
  const inScope = CHIP_POOL.filter((c) => c.scope === (ctx.proj ? 'project' : 'portfolio') && (!c.propose || ctx.propose));
  // Urgency from live signals decides the LEAD card (the "maksud"); higher = more urgent.
  const urgency = (c: ChipItem): number => {
    if (c.intent === 'approval' && ctx.approvals > 0) return 3;
    if (c.intent === 'schedule' && ctx.overdue > 0) return 2;
    return 0;
  };
  const hot = inScope.filter((c) => urgency(c) > 0).sort((a, b) => urgency(b) - urgency(a));
  const rest = inScope.filter((c) => urgency(c) === 0);
  // Rotate the non-urgent tail so the surfaced set changes between opens.
  const off = rest.length ? ((seed % rest.length) + rest.length) % rest.length : 0;
  const rotated = [...rest.slice(off), ...rest.slice(0, off)];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of [...hot, ...rotated]) {
    const text = c.label[ctx.lang];
    if (seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= count) break;
  }
  return out;
}

// ── Contextual follow-up chips (elevation #1 smart fallback + #2 ground/dedup) ───────────────────
// The chip row under the latest answer prefers Anett's own [[followups:…]] suggestions, but those are
// (a) optional — the model often omits them — and (b) unvalidated. These pure helpers make the row
// RELIABLY contextual: ground the suggestions against the accessible project codes, dedup against what
// was already asked, and — when nothing usable remains — synthesise follow-ups from the entities the
// answer actually cited (so the fallback is relevant, not the generic static list).

const CITE_RE = /\[\[cite:([A-Za-z0-9-]+)\|(\w+)(?:\|[^\]]+)?\]\]/g; // [[cite:CODE|SOURCE(|id)]]
const CODE_IN_Q = /`([A-Z][A-Z0-9]*-\d+)`/g;                        // a `PRJ-1`-style code inside a question
const normQ = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// A follow-up is ungrounded ONLY if it explicitly names a project code the user cannot access.
function followupGrounded(q: string, accessibleCodes: Set<string>): boolean {
  for (const m of q.matchAll(CODE_IN_Q)) if (!accessibleCodes.has(m[1].toUpperCase())) return false;
  return true;
}

// One tailored next-question per cited SOURCE (deduped by source). Bilingual.
function followupForSource(source: string, code: string, lang: 'id' | 'en'): string | null {
  const id = lang === 'id';
  switch (source) {
    case 'Risk': return id ? 'Apa rencana mitigasi risiko itu?' : "What's the mitigation plan for that risk?";
    case 'Schedule': return id ? `Apa yang ada di jalur kritis \`${code}\`?` : `What's on \`${code}\`'s critical path?`;
    case 'Cost': return id ? `Di mana varian biaya terbesar \`${code}\`?` : `Where is \`${code}\`'s biggest cost variance?`;
    case 'ChangeRequest': return id ? 'Apa dampak change request itu?' : "What's the impact of that change request?";
    case 'Overview': return id ? `Bagaimana forecast & EAC \`${code}\`?` : `Forecast & EAC for \`${code}\`?`;
    default: return null;
  }
}

// Build contextual follow-ups from the entities the answer cited (deterministic, no LLM).
export function citedFollowups(answer: string, lang: 'id' | 'en'): string[] {
  const out: string[] = [];
  const seenSource = new Set<string>();
  for (const m of answer.matchAll(CITE_RE)) {
    const source = m[2];
    if (seenSource.has(source)) continue;
    seenSource.add(source);
    const q = followupForSource(source, m[1].toUpperCase(), lang);
    if (q) out.push(q);
    if (out.length >= 3) break;
  }
  return out;
}

// Resolve the follow-up chips to show, in precedence order:
//   1. the model's [[followups:…]] suggestions (grounded + deduped),
//   2. else contextual follow-ups derived from the answer's citations (grounded + deduped),
//   3. else the static fallback list.
export function resolveFollowups(input: {
  answer: string;
  modelFollowups: string[];
  accessibleCodes: Set<string>;
  priorQuestions: string[];
  lang: 'id' | 'en';
  staticFallback: string[];
}): string[] {
  const prior = new Set(input.priorQuestions.map(normQ));
  const refine = (qs: string[]): string[] => {
    const seen = new Set<string>();
    return qs
      .map((q) => q.trim())
      .filter((q) => q.length > 0 && followupGrounded(q, input.accessibleCodes))
      .filter((q) => { const n = normQ(q); if (!n || prior.has(n) || seen.has(n)) return false; seen.add(n); return true; })
      .slice(0, 4);
  };
  const model = refine(input.modelFollowups);
  if (model.length) return model;
  const derived = refine(citedFollowups(input.answer, input.lang));
  if (derived.length) return derived;
  return input.staticFallback;
}
