// =====================================================================
// Resource pool for the AI timeline — PURE business helpers (no DB).
//
// Two sources feed the pool the AI timeline generator reasons over:
//  1) the structured Resource register (name / role / real capacity), and
//  2) the charter's free-text `hiResources` narrative (always present once
//     the charter is committed, even before the register is filled).
//
// The pool is a bounded, whitelisted list of { ref, label, capacityPerDay,
// resourceId? } the model maps tasks onto (resourceRole + resourceRef). It is
// NEVER trusted for dates — leveling/assignment happen deterministically later.
// Unit-tested without a DB or the LLM.
// =====================================================================

export interface AvailableResource {
  /** Stable short token the AI references from a task's `resourceRef` (e.g. "r1"). */
  ref: string;
  /** Human role/name shown to the model, e.g. "Backend Engineer" or "Andi · Backend Engineer". */
  label: string;
  /** Mandays available per working day (crew size / part-time). >= 0.5, defaults to 1. */
  capacityPerDay: number;
  /** Register id when this row came from a real Resource; absent for narrative-only roles. */
  resourceId?: string;
}

// A register row, narrowed to what the pool needs (mirrors prisma.resource select).
export interface RegisterResourceRow {
  id: string;
  name: string;
  roleTitle: string | null;
  capacityPerDay: number;
}

// A role parsed out of the charter's hiResources narrative.
export interface ParsedRole {
  label: string;
  /** Leading quantity when the line starts with a number ("2 Backend engineers" → 2); else 1. */
  qty: number;
}

const MAX_POOL = 30; // hard cap so a huge narrative can't bloat the prompt / token budget
const MAX_PARSE_LINES = 40;

/** Clamp a capacity to a sane, bounded per-day manday figure. */
function clampCapacity(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(50, Math.max(0.5, Math.round(n * 100) / 100));
}

/** Normalise a label for duplicate detection: lowercase, collapse whitespace, strip punctuation. */
function normLabel(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Parse the charter `hiResources` markdown narrative into candidate roles.
 * Each non-empty line becomes one role: bullet/numbering markers are stripped, a leading
 * quantity is captured, and a trailing parenthetical note ("(full-time)") is dropped from the
 * label. Bounded and defensive — junk lines simply yield a best-effort label.
 */
export function parseHiResources(text: string | null | undefined): ParsedRole[] {
  if (!text || !text.trim()) return [];
  const out: ParsedRole[] = [];
  const lines = text.split(/\r?\n/).slice(0, MAX_PARSE_LINES);
  for (const raw of lines) {
    // Strip a leading list marker: "-", "*", "•", or "1." / "1)".
    let line = raw.trim().replace(/^([-*•]|\d+[.)])\s+/, '').trim();
    if (line.length < 2) continue;
    // Capture a leading quantity ("2 Backend engineers", "x3 …", "3× …").
    let qty = 1;
    const q = /^(?:x\s*)?(\d{1,3})\s*(?:x|×|\*)?\s+(.*)$/i.exec(line);
    if (q) {
      const n = Number.parseInt(q[1], 10);
      if (n >= 1 && n <= 100) { qty = n; line = q[2].trim(); }
    }
    // Drop a trailing parenthetical qualifier so the label stays a clean role.
    const label = line.replace(/\s*\([^)]*\)\s*$/, '').trim().slice(0, 120);
    if (label.length >= 2) out.push({ label, qty });
    if (out.length >= MAX_POOL) break;
  }
  return out;
}

/**
 * Merge the structured register with narrative-parsed roles into the AI pool. The register wins:
 * its rows come first with real ids + capacity; a parsed role is added only when it doesn't already
 * match a register label (case-insensitive substring either way). Parsed crew size becomes capacity.
 * Refs are assigned sequentially ("r1", "r2", …). Bounded to MAX_POOL.
 */
export function mergeResourcePool(
  register: RegisterResourceRow[],
  parsed: ParsedRole[],
): AvailableResource[] {
  const pool: AvailableResource[] = [];
  const seen: string[] = []; // normalised labels already represented

  for (const r of register) {
    if (pool.length >= MAX_POOL) break;
    const role = (r.roleTitle ?? '').trim();
    const label = role ? `${r.name} · ${role}` : r.name;
    pool.push({ ref: `r${pool.length + 1}`, label, capacityPerDay: clampCapacity(r.capacityPerDay), resourceId: r.id });
    seen.push(normLabel(role || r.name));
  }

  for (const p of parsed) {
    if (pool.length >= MAX_POOL) break;
    const norm = normLabel(p.label);
    if (!norm) continue;
    // Skip when a register entry already covers this role (either contains the other).
    if (seen.some((s) => s === norm || s.includes(norm) || norm.includes(s))) continue;
    pool.push({ ref: `r${pool.length + 1}`, label: p.label, capacityPerDay: clampCapacity(p.qty) });
    seen.push(norm);
  }

  return pool;
}
