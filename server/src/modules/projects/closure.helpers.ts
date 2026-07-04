// Pure closure-readiness policy — no I/O, so it stays unit-testable without a DB.
// Per the agreed PMO policy: the ONLY hard blocker is schedule completeness
// (100% — judged by the project's methodology: WBS %, agile points, or a hybrid
// blend); everything else is an advisory warning that does not stop closure.

export type ClosureSeverity = 'block' | 'warn';

export interface ClosureItem {
  key: string;
  label: string;
  severity: ClosureSeverity;
  ok: boolean;
  detail?: string;
}

export interface ClosureReadiness {
  items: ClosureItem[]; // full checklist (passing + failing), for the UI
  blockers: ClosureItem[]; // failing hard checks — must pass or be force-closed
  warnings: ClosureItem[]; // failing advisory checks
  canClose: boolean; // no blockers outstanding
}

export interface ClosureInputs {
  leafTaskCount: number; // schedule "leaves" per methodology: WBS leaves, agile backlog items, or both (hybrid)
  scheduleProgress: number; // 0..1 (methodology-weighted % complete: WBS / agile points / hybrid blend)
  openChangeRequests: number; // SUBMITTED / UNDER_REVIEW
  openHighRisks: number; // HIGH|CRITICAL and still open
  openIssues: number; // OPEN | IN_PROGRESS
  actualCost: number; // recorded AC total
  deliveryApproach: string; // PREDICTIVE | AGILE | HYBRID
  openBacklogItems: number; // backlog items not DONE (agile/hybrid only)
}

export function assessClosureReadiness(i: ClosureInputs): ClosureReadiness {
  const items: ClosureItem[] = [];

  // Hard block: schedule 100% — but only when the project actually has a plan to judge
  // (WBS tasks and/or agile backlog items). A project with neither can't be judged on
  // schedule, so we don't block it; we surface a warning instead so it's not silently skipped.
  if (i.leafTaskCount > 0) {
    const pct = Math.round(i.scheduleProgress * 100);
    items.push({
      key: 'schedule',
      label: 'Schedule 100% complete',
      severity: 'block',
      ok: i.scheduleProgress >= 1,
      detail: `${pct}% complete`,
    });
  } else {
    items.push({
      key: 'schedule',
      label: 'Schedule or backlog present',
      severity: 'warn',
      ok: false,
      detail: 'No schedule or backlog to verify completion',
    });
  }

  // Advisory warnings (do not block closure).
  items.push({
    key: 'changeRequests',
    label: 'No undecided change requests',
    severity: 'warn',
    ok: i.openChangeRequests === 0,
    detail: i.openChangeRequests ? `${i.openChangeRequests} awaiting decision` : undefined,
  });
  items.push({
    key: 'risks',
    label: 'No open HIGH/CRITICAL risks',
    severity: 'warn',
    ok: i.openHighRisks === 0,
    detail: i.openHighRisks ? `${i.openHighRisks} still open` : undefined,
  });
  items.push({
    key: 'issues',
    label: 'No open issues',
    severity: 'warn',
    ok: i.openIssues === 0,
    detail: i.openIssues ? `${i.openIssues} still open` : undefined,
  });
  items.push({
    key: 'actualCost',
    label: 'Actual cost recorded',
    severity: 'warn',
    ok: i.actualCost > 0,
    detail: i.actualCost > 0 ? undefined : 'No actual cost entered',
  });
  if (i.deliveryApproach === 'AGILE' || i.deliveryApproach === 'HYBRID') {
    items.push({
      key: 'backlog',
      label: 'All backlog items done',
      severity: 'warn',
      ok: i.openBacklogItems === 0,
      detail: i.openBacklogItems ? `${i.openBacklogItems} not done` : undefined,
    });
  }

  const blockers = items.filter((x) => x.severity === 'block' && !x.ok);
  const warnings = items.filter((x) => x.severity === 'warn' && !x.ok);
  return { items, blockers, warnings, canClose: blockers.length === 0 };
}
