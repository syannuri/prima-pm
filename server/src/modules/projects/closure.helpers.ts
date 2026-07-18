// Pure closure-readiness policy — no I/O, so it stays unit-testable without a DB.
//
// Hard blockers are methodology-aware:
//  - PREDICTIVE: WBS schedule 100% complete.
//  - AGILE: (1) scope complete — every backlog item is DONE or DEFERRED (item-based, NOT
//    story points — points are a relative estimation tool, not a "done" gauge); and
//    (2) a formal acceptance sign-off is on record. Story points still drive EVM/velocity,
//    but never gate closure.
//  - HYBRID: the WBS schedule gate AND the agile scope + acceptance gates.
// Everything else (open CRs / HIGH risks / issues, actual cost, lessons) is an advisory
// warning that does not stop closure. Force-close (ADMIN/PMO + reason) overrides blockers.

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
  deliveryApproach: string; // PREDICTIVE | AGILE | HYBRID
  // WBS schedule (predictive + hybrid). Pure agile has no WBS → wbsLeafCount 0.
  wbsLeafCount: number; // WBS leaf tasks
  wbsProgress: number; // 0..1 WBS %complete (duration/cost-weighted)
  // Agile/Hybrid backlog — scope is judged by ITEM completion, not story points (points are a
  // relative estimation/velocity tool, not a "done" gauge). DEFERRED items are out of scope.
  backlogTotal: number; // all backlog items (any status)
  backlogOpen: number; // TODO + IN_PROGRESS — the items that block closure
  backlogDone: number; // DONE
  backlogDeferred: number; // DEFERRED (consciously descoped)
  // Shared advisory inputs.
  openChangeRequests: number; // SUBMITTED / UNDER_REVIEW
  openHighRisks: number; // HIGH|CRITICAL and still open
  openIssues: number; // OPEN | IN_PROGRESS
  actualCost: number; // recorded AC total
  lessonsCount: number; // lessons-learned register entries
  hasAcceptance: boolean; // at least one formal acceptance sign-off recorded
}

export function assessClosureReadiness(i: ClosureInputs): ClosureReadiness {
  const items: ClosureItem[] = [];
  const isAgile = i.deliveryApproach === 'AGILE';
  const isHybrid = i.deliveryApproach === 'HYBRID';
  const usesBacklog = isAgile || isHybrid;
  const usesWbs = !isAgile; // PREDICTIVE + HYBRID carry a WBS schedule

  // ── Hard block: WBS schedule 100% (predictive + hybrid) ──
  if (usesWbs) {
    if (i.wbsLeafCount > 0) {
      const pct = Math.round(i.wbsProgress * 100);
      items.push({
        key: 'schedule',
        label: 'Schedule 100% complete',
        severity: 'block',
        ok: i.wbsProgress >= 1,
        detail: `${pct}% complete`,
      });
    } else if (!usesBacklog) {
      // Pure predictive with no WBS → nothing to judge; warn so it isn't silently skipped.
      items.push({
        key: 'schedule',
        label: 'Schedule present',
        severity: 'warn',
        ok: false,
        detail: 'No schedule to verify completion',
      });
    }
  }

  // ── Hard block: Agile scope complete — ITEM-based, not story points (agile + hybrid) ──
  // Every backlog item must be DONE or consciously DEFERRED (descoped). Unestimated items
  // therefore can't hide: they count as open until closed or deferred.
  if (usesBacklog) {
    if (i.backlogTotal > 0) {
      const inScope = i.backlogTotal - i.backlogDeferred;
      const pct = inScope > 0 ? Math.round((i.backlogDone / inScope) * 100) : 100;
      const parts = [`${i.backlogDone}/${inScope} in-scope done`];
      if (i.backlogDeferred) parts.push(`${i.backlogDeferred} deferred`);
      if (i.backlogOpen) parts.push(`${i.backlogOpen} still open`);
      items.push({
        key: 'scope',
        label: 'All backlog items done or deferred',
        severity: 'block',
        ok: i.backlogOpen === 0,
        detail: `${parts.join(' · ')} (${pct}%)`,
      });
    } else if (isAgile) {
      items.push({
        key: 'scope',
        label: 'Backlog present',
        severity: 'warn',
        ok: false,
        detail: 'No backlog to verify completion',
      });
    }
  }

  // ── Formal acceptance — a HARD block for agile/hybrid (an increment lives or dies on
  // acceptance); advisory for predictive. ──
  items.push({
    key: 'acceptance',
    label: 'Formal acceptance recorded',
    severity: usesBacklog ? 'block' : 'warn',
    ok: i.hasAcceptance,
    detail: i.hasAcceptance ? undefined : 'No deliverable acceptance sign-off (Closeout tab)',
  });

  // ── Advisory warnings (do not block closure) ──
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
  items.push({
    key: 'lessons',
    label: 'Lessons learned captured',
    severity: 'warn',
    ok: i.lessonsCount > 0,
    detail: i.lessonsCount > 0 ? undefined : 'No lessons recorded (Closeout tab)',
  });

  const blockers = items.filter((x) => x.severity === 'block' && !x.ok);
  const warnings = items.filter((x) => x.severity === 'warn' && !x.ok);
  return { items, blockers, warnings, canClose: blockers.length === 0 };
}
