// Pure activation-readiness policy — no I/O, so it stays unit-testable without a DB.
// PMBOK: a project should not enter execution (CHARTERED -> IN_PROGRESS) until its
// performance-measurement baseline is set, otherwise SV/SPI are measured against a moving
// target. Hard blockers: the cost baseline (PMB/BAC) must be LOCKED, and — when the project
// has a WBS — a SCHEDULE baseline must be captured. ADMIN/PMO can force-activate with a reason.

export type ActivationSeverity = 'block' | 'warn';

export interface ActivationItem {
  key: string;
  label: string;
  severity: ActivationSeverity;
  ok: boolean;
  detail?: string;
}

export interface ActivationReadiness {
  items: ActivationItem[]; // full checklist (passing + failing), for the UI
  blockers: ActivationItem[]; // failing hard checks — must pass or be force-activated
  warnings: ActivationItem[]; // failing advisory checks
  canActivate: boolean; // no blockers outstanding
}

export interface ActivationInputs {
  baselineLocked: boolean; // Project.baselineLockedAt is set (PMB/BAC frozen)
  scheduleBaselined: boolean; // Project.scheduleBaselinedAt is set (plan dates snapshotted)
  hasWbs: boolean; // the project has WBS tasks (predictive/hybrid schedule to baseline)
  deliveryApproach: string; // PREDICTIVE | AGILE | HYBRID (informational)
}

export function assessActivationReadiness(i: ActivationInputs): ActivationReadiness {
  const items: ActivationItem[] = [];

  // Hard block: the cost baseline (PMB/BAC) must be locked before execution starts, so
  // variance analysis has a frozen budget to measure against.
  items.push({
    key: 'baselineLock',
    label: 'Cost baseline (PMB/BAC) locked',
    severity: 'block',
    ok: i.baselineLocked,
    detail: i.baselineLocked ? undefined : 'Lock the baseline (Cost tab) to freeze the budget first',
  });

  // Schedule baseline: a hard block when there is a WBS to baseline; an advisory note for
  // pure-agile projects with no WBS (they plan by sprint, not a schedule baseline).
  if (i.hasWbs) {
    items.push({
      key: 'scheduleBaseline',
      label: 'Schedule baseline captured',
      severity: 'block',
      ok: i.scheduleBaselined,
      detail: i.scheduleBaselined ? undefined : 'Capture the schedule baseline (Schedule tab) to snapshot planned dates',
    });
  } else {
    items.push({
      key: 'scheduleBaseline',
      label: 'Schedule baseline captured',
      severity: 'warn',
      ok: i.scheduleBaselined,
      detail: i.scheduleBaselined ? undefined : 'No WBS to baseline (agile plans by sprint)',
    });
  }

  const blockers = items.filter((x) => x.severity === 'block' && !x.ok);
  const warnings = items.filter((x) => x.severity === 'warn' && !x.ok);
  return { items, blockers, warnings, canActivate: blockers.length === 0 };
}
