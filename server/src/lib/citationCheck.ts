// #6 deterministic citation-value verification. LLM judges — and the model itself, especially on the
// cheap tier — are unreliable on arithmetic and units: e.g. stating "Rp 423,5 Miliar" when the real
// saving is ~423 Juta (a 1000× slip). This module flags, WITHOUT an LLM, monetary figures in an answer
// whose magnitude is off by a power of 1000 from a value actually present in the tool data (or a simple
// difference of two such values). Pure + conservative: a figure is only flagged when it matches a real
// value SCALED by 1000^k but not the real value itself, so ordinary prose numbers are left alone.

const SCALE: Record<string, number> = {
  ribu: 1e3, rb: 1e3,
  juta: 1e6, jt: 1e6,
  miliar: 1e9, milyar: 1e9, m: 1e9,
  triliun: 1e12, triliyun: 1e12, t: 1e12,
};

// Parse the decimal number that precedes a scale word. The assistant writes human-readable rupiah
// ("Rp 3,09 Miliar", "Rp 423.5 Juta", "Rp 2.6655 Miliar"), so with a scale word the number is a small
// decimal — treat a single '.'/',' as the decimal point. If BOTH appear, the last one is the decimal
// separator and the other is the thousands separator ("Rp 1.234,5 Juta").
function parseScaledNumber(raw: string): number | null {
  let s = raw.trim();
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    // Both present: the LAST separator is the decimal point, the other is the thousands separator.
    const decChar = lastComma > lastDot ? ',' : '.';
    const thouChar = decChar === ',' ? '.' : ',';
    s = s.split(thouChar).join('').replace(decChar, '.');
  } else {
    s = s.replace(',', '.'); // single separator ⇒ decimal
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Re-emit every "<number> <scale-word>" figure in Indonesian locale (comma = decimal, period = thousands)
// so a period is never left standing as a decimal point — where an Indonesian reader parses it as a THOUSANDS
// separator. "Rp 5.096 miliar" reads to us as 5096 miliar (~5 triliun): a 1000× optical slip the ×1000 value
// check misses, because parseScaledNumber (correctly, for *its* job) reads the lone '.' as the decimal and so
// the figure matches the real total. Normalizing the output to "Rp 5,1 miliar" removes the ambiguity at the
// source. parseScaledNumber recovers the value the model meant; toLocaleString('id-ID') re-renders it. Rounds
// to ≤2 decimals ("5,1", "154,55", "4,94") — the human-readable precision the assistant should present.
const SCALE_WORDS = 'ribu|rb|juta|jt|miliar|milyar|triliun|triliyun';
export function normalizeRupiahText(text: string): string {
  const re = new RegExp(`(rp\\.?\\s*)?(\\d[\\d.,]*\\d|\\d)\\s*(${SCALE_WORDS})\\b`, 'gi');
  return text.replace(re, (whole, rp: string | undefined, num: string, scale: string) => {
    const n = parseScaledNumber(num);
    if (n == null) return whole;
    return `${rp ?? ''}${n.toLocaleString('id-ID', { maximumFractionDigits: 2 })} ${scale}`;
  });
}

// Render a raw IDR amount as the ready-to-quote Indonesian human string ("Rp 6,8 miliar", "Rp 154,55 juta").
// This is the DETERMINISTIC scale-word conversion the model must NOT do by hand — hand-converting a raw
// integer to miliar/juta is the recurring 1000× slip (e.g. 6_796_500_200 mis-rendered as "6.796,5 miliar"
// = 6,8 triliun instead of 6,8 miliar). Tool outputs carry this string so the model can quote it verbatim.
export function formatIdrHuman(n: number): string {
  if (!Number.isFinite(n)) return 'Rp 0';
  const abs = Math.abs(n);
  const fmt = (v: number, unit: string) => `Rp ${v.toLocaleString('id-ID', { maximumFractionDigits: 2 })}${unit}`;
  if (abs >= 1e12) return fmt(n / 1e12, ' triliun');
  if (abs >= 1e9) return fmt(n / 1e9, ' miliar');
  if (abs >= 1e6) return fmt(n / 1e6, ' juta');
  return `Rp ${Math.round(n).toLocaleString('id-ID')}`;
}

// Monetary figures in the answer, normalized to IDR. Only "Rp <number> <scale-word>" is parsed — the
// unambiguous, human-readable form the assistant produces. Bare grouped figures ("Rp 2.665.500.000")
// are intentionally skipped (their separators are ambiguous and they rarely carry the unit error).
export function extractMoneyIDR(text: string): number[] {
  const out: number[] = [];
  const re = /rp\.?\s*([\d][\d.,]*)\s*(ribu|rb|juta|jt|miliar|milyar|triliun|triliyun)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const n = parseScaledNumber(m[1]);
    if (n != null) out.push(n * SCALE[m[2].toLowerCase()]);
  }
  return out;
}

// Candidate "true" values from the tool-data context: every number of money-like magnitude, plus the
// pairwise absolute differences AND sums of the largest few — so a stated saving (BAC − AC) or a rolled-up
// total (Σ BAC across projects) can be validated even when it isn't a raw field. Bounded to keep it cheap.
export function candidateValues(context: string): number[] {
  const raw = (context.match(/-?\d+(?:\.\d+)?/g) ?? [])
    .map(Number)
    .filter((n) => Number.isFinite(n) && Math.abs(n) >= 1e5); // money-ish only
  const uniq = [...new Set(raw)];
  const top = uniq.slice().sort((a, b) => Math.abs(b) - Math.abs(a)).slice(0, 15);
  const derived: number[] = [];
  for (let i = 0; i < top.length; i++) {
    for (let j = i + 1; j < top.length; j++) {
      const d = Math.abs(top[i] - top[j]);
      if (d >= 1e5) derived.push(d);
      derived.push(top[i] + top[j]); // pairwise rollups (Σ of two projects)
    }
  }
  // Full rollup: Σ of ALL money values in the context — the total of 3+ projects (e.g. "total budget of
  // A + B + C"), which pairwise sums miss. Covers the common case where the context holds exactly the
  // projects being totalled.
  if (top.length > 2) {
    const fullSum = top.reduce((a, b) => a + b, 0);
    if (fullSum >= 1e5) derived.push(fullSum);
  }
  return [...new Set([...uniq, ...derived])];
}

// ── Citation coverage (grounding Fase 3) ─────────────────────────────────────────────────────────
// A "citable figure" is one that is ALWAYS project-specific data the citation rule expects a
// [[cite:…]] marker for: an EVM index (SPI/CPI <n>) or a rupiah scale figure. Percentages and bare
// counts are deliberately EXCLUDED — they appear too often in ordinary prose ("top 5", "about 30%")
// to flag without false positives. Deterministic, no LLM.
const CITABLE_RE = /\b(?:SPI|CPI)\s*[:=]?\s*\d(?:[.,]\d+)?|rp\.?\s*\d[\d.,]*\s*(?:ribu|rb|juta|jt|miliar|milyar|triliun|triliyun)\b/gi;

export interface CoverageResult { total: number; cited: number; coverage: number }

// Fraction of citable figures that carry a [[cite:…]] marker within the same clause (a small window
// AFTER the figure, where the assistant places the marker). coverage = 1 when there are none — an
// answer with no project figures is trivially "fully cited". Conservative by design: a marker placed
// before its figure is missed, which only ever UNDER-counts, so it never over-flags.
export function citationCoverage(answer: string): CoverageResult {
  const WINDOW = 90; // chars after the figure to look for its marker (same sentence/clause)
  let total = 0, cited = 0;
  let m: RegExpExecArray | null;
  CITABLE_RE.lastIndex = 0;
  while ((m = CITABLE_RE.exec(answer)) !== null) {
    total++;
    if (/\[\[cite:/i.test(answer.slice(m.index, m.index + m[0].length + WINDOW))) cited++;
  }
  return { total, cited, coverage: total === 0 ? 1 : cited / total };
}

const REL_TOL = 0.02; // 2% — matches rounding like "3,09 Miliar" vs 3,089,000,000
const near = (a: number, b: number): boolean => Math.abs(a - b) <= REL_TOL * Math.max(Math.abs(a), Math.abs(b));

export interface ValueCheck { ok: boolean; issues: string[] }

// Flag any answer money figure that is a power-of-1000 off from a real value but not itself a real value.
// `context` = this turn's tool data. `priorAnswer` = the previous assistant answer (its stated Rp figures
// are added as reference), so a magnitude FLIP between turns is caught even when this turn made no tool
// call and therefore has no tool context — the exact case where a "you're right, I meant triliun" ×1000
// slip slips through otherwise.
export function verifyCitedValues(answer: string, context?: string, priorAnswer?: string): ValueCheck {
  const figures = extractMoneyIDR(answer);
  if (figures.length === 0) return { ok: true, issues: [] };
  const cands = [
    ...(context ? candidateValues(context) : []),
    ...(priorAnswer ? extractMoneyIDR(priorAnswer) : []),
  ];
  if (cands.length === 0) return { ok: true, issues: [] };
  const factors = [1e3, 1e6, 1e9, 1 / 1e3, 1 / 1e6, 1 / 1e9];
  const issues: string[] = [];
  for (const f of figures) {
    if (f <= 0) continue;
    if (cands.some((c) => near(f, c))) continue; // states a real value → fine
    // Off by a clean power of 1000 from some real value → a unit/magnitude slip (e.g. Juta↔Miliar).
    const slip = cands.some((c) => c > 0 && factors.some((k) => near(f / c, k)));
    if (slip) issues.push(`figure ${f.toExponential(2)} IDR is off by ~1000× from the project data`);
  }
  return { ok: issues.length === 0, issues };
}
