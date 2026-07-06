// =====================================================================
// Project Charter — pure business helpers (no DB). Unit-tested.
// =====================================================================
import type { ProjectCategory } from '@prisma/client';

export const PROJECT_CATEGORIES: ProjectCategory[] = [
  'NETWORK_INFRA',
  'SERVER_INFRA',
  'CLOUD_INFRA',
  'CYBERSECURITY_INFRA',
  'APP_DEV',
];

// The mandatory charter fields (must all be present to Commit).
export const REQUIRED_CHARTER_FIELDS = [
  'description',
  'goals',
  'category',
  'hiScope',
  'hiCostIdr',
  'hiScheduleStart',
  'hiScheduleEnd',
  'hiDeliverables',
  'pmUserId',
] as const;

export type CharterFieldKey = (typeof REQUIRED_CHARTER_FIELDS)[number];

export interface CompletenessResult {
  ok: boolean;
  missing: CharterFieldKey[];
}

/** A field counts as "filled" when it is not null/undefined and not an empty/zero. */
function isFilled(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return value > 0; // hiCostIdr must be > 0
  return true;
}

/** Verify every mandatory charter field is present (defensive pre-commit check). */
export function checkCharterCompleteness(data: Record<string, unknown>): CompletenessResult {
  const missing = REQUIRED_CHARTER_FIELDS.filter((f) => !isFilled(data[f]));
  return { ok: missing.length === 0, missing };
}

export interface CommitGuardInput {
  locked: boolean;
}

export interface CommitGuard {
  allowed: boolean;
  reason?: string;
}

/** A locked (already committed) charter cannot be edited/committed without a Change Request. */
export function canEditCharter(charter: CommitGuardInput | null): CommitGuard {
  if (!charter) return { allowed: true }; // no charter yet -> can create
  if (charter.locked) {
    return { allowed: false, reason: 'Charter is committed/locked. Raise a Change Request to edit.' };
  }
  return { allowed: true };
}

/** Build an immutable snapshot object stored in CharterVersion.snapshot on commit. */
export function buildCharterSnapshot(charter: Record<string, unknown>): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {};
  for (const f of REQUIRED_CHARTER_FIELDS) snapshot[f] = charter[f] ?? null;
  snapshot.version = charter.version ?? 1;
  return snapshot;
}

/**
 * Generate a human-readable project code: PRJ-<YYYY>-<seq padded 4>.
 * `seq` is the 1-based ordinal of the project within the year.
 */
export function generateProjectCode(year: number, seq: number): string {
  return `PRJ-${year}-${String(seq).padStart(4, '0')}`;
}

/**
 * Next 1-based sequence number for the year, from the HIGHEST existing code — not a
 * row count. Count-based numbering collided after deletions/gaps: a soft-deleted or
 * manually-coded project leaves the count below the real max, so `count + 1` lands on a
 * code that is already taken (Prisma P2002 → "That value is already in use"). Pass ALL
 * codes for the year (active AND soft-deleted), since `Project.code` is globally unique.
 */
export function nextProjectSeq(existingCodes: string[], year: number): number {
  const prefix = `PRJ-${year}-`;
  const maxSeq = existingCodes.reduce((max, code) => {
    if (!code.startsWith(prefix)) return max;
    const n = Number.parseInt(code.slice(prefix.length), 10);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
  return maxSeq + 1;
}

/** Validate that the planned schedule window is coherent (end after start). */
export function isScheduleValid(start: Date, end: Date): boolean {
  return end.getTime() > start.getTime();
}
