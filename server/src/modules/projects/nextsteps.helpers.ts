// Pure guided-next-step policy — no I/O, so it stays unit-testable without a DB.
// Given a project's lifecycle state, it produces an ordered list of recommended
// next actions ("cues") to guide a PM through the delivery flow:
//   DRAFT → commit charter → CHARTERED → lock baseline / baseline schedule →
//   activate → IN_PROGRESS → track → (deliverables done) record acceptance /
//   capture lessons → close.
// The heavy readiness (activation/closure) is computed by the caller and passed
// in as booleans so this stays pure.

export type ProjectStage = 'DRAFT' | 'CHARTERED' | 'IN_PROGRESS' | 'ON_HOLD' | 'CLOSED';

export interface NextStepsInput {
  status: ProjectStage;
  // CHARTERED planning gates
  baselineLocked: boolean;
  scheduleBaselined: boolean;
  hasWbs: boolean; // predictive/hybrid schedule to baseline & track on the Schedule tab
  activationReady: boolean; // activation readiness has no outstanding blockers
  // IN_PROGRESS / closing signals
  openHighRisks: number;
  hasAcceptance: boolean; // ≥1 non-rejected acceptance sign-off
  hasLessons: boolean; // ≥1 lesson-learned entry
  closureReady: boolean; // closure readiness has no outstanding blockers (schedule complete)
}

export interface NextStep {
  key: string;
  title: string;
  detail: string;
  tab?: string; // ProjectPage tab to jump to (primary interaction)
  action?: 'activate' | 'resume' | 'close'; // a header lifecycle control (no tab nav)
}

export interface NextStepsResult {
  stage: string; // human label of the current lifecycle stage
  steps: NextStep[]; // ordered, highest-priority first; empty = nothing pending
}

const STAGE_LABEL: Record<ProjectStage, string> = {
  DRAFT: 'Draft — define the charter',
  CHARTERED: 'Chartered — plan the baseline',
  IN_PROGRESS: 'In execution',
  ON_HOLD: 'On hold',
  CLOSED: 'Closed',
};

export function computeNextSteps(i: NextStepsInput): NextStepsResult {
  const steps: NextStep[] = [];

  switch (i.status) {
    case 'DRAFT':
      steps.push({
        key: 'commitCharter',
        title: 'Commit the Project Charter',
        detail: 'Define scope, cost and schedule, then commit the charter to baseline the project and unlock the modules.',
        tab: 'Charter',
      });
      break;

    case 'CHARTERED': {
      // Planning-baseline checkpoint: the activation gate needs the cost baseline
      // locked and (with a WBS) a schedule baseline captured. Locking the cost baseline
      // ALSO freezes the WBS + schedule-baseline capture, so it must be the LAST planning
      // step — capture the schedule baseline first, then lock.
      const scheduleNeeded = i.hasWbs && !i.scheduleBaselined;
      if (i.baselineLocked && scheduleNeeded) {
        // Stuck state: the baseline was locked before the schedule was baselined, so the
        // WBS is frozen and the schedule baseline can't be captured. Cue an unlock.
        steps.push({
          key: 'unlockToBaselineSchedule',
          title: 'Unlock the baseline to finish the schedule',
          detail: 'Locking the cost baseline froze the WBS. Unlock it on the Cost tab, capture the schedule baseline, then re-lock.',
          tab: 'Cost',
        });
      } else {
        if (scheduleNeeded) {
          steps.push({
            key: 'baselineSchedule',
            title: 'Capture the schedule baseline',
            detail: 'Snapshot the planned dates so schedule variance (SV/SPI) stays trustworthy. Do this before locking the cost baseline.',
            tab: 'Schedule',
          });
        }
        if (!i.baselineLocked) {
          steps.push({
            key: 'lockBaseline',
            title: 'Lock the cost baseline',
            detail: 'The final planning step — it freezes the PMB/BAC, the WBS and the schedule baseline, so finish the schedule first.',
            tab: 'Cost',
          });
        }
      }
      if (i.activationReady) {
        steps.push({
          key: 'activate',
          title: 'Start execution',
          detail: 'The baseline is set — activate the project to begin tracking progress.',
          action: 'activate',
        });
      }
      break;
    }

    case 'IN_PROGRESS':
      if (!i.closureReady) {
        // Steady state: keep the plan and actuals current.
        steps.push({
          key: 'trackProgress',
          title: 'Track execution',
          detail: 'Update task progress and log actual cost as work completes.',
          tab: i.hasWbs ? 'Schedule' : 'Agile',
        });
        if (i.openHighRisks > 0) {
          steps.push({
            key: 'mitigateRisks',
            title: `Address ${i.openHighRisks} open high/critical risk${i.openHighRisks > 1 ? 's' : ''}`,
            detail: 'Mitigate or close high-severity risks before they impact delivery.',
            tab: 'Risk',
          });
        }
      } else {
        // Deliverables complete — capture the closing artifacts, then close.
        if (!i.hasAcceptance) {
          steps.push({
            key: 'recordAcceptance',
            title: 'Record deliverable acceptance',
            detail: 'Capture formal sign-off from the sponsor or customer on the Closeout tab.',
            tab: 'Closeout',
          });
        }
        if (!i.hasLessons) {
          steps.push({
            key: 'captureLessons',
            title: 'Capture lessons learned',
            detail: 'Record what went well and what to improve, for future projects.',
            tab: 'Closeout',
          });
        }
        steps.push({
          key: 'closeProject',
          title: 'Close the project',
          detail: 'Deliverables are complete — run the closure checklist and close the project.',
          action: 'close',
        });
      }
      break;

    case 'ON_HOLD':
      steps.push({
        key: 'resume',
        title: 'Resume the project',
        detail: 'The project is paused. Resume it when work restarts to keep tracking progress.',
        action: 'resume',
      });
      break;

    case 'CLOSED':
      // Terminal & read-only — nothing pending.
      break;
  }

  return { stage: STAGE_LABEL[i.status], steps };
}
