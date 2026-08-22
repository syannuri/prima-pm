// Guided first-project setup for new guests — a state-gated adoption checklist (backbone) that
// walks the full lifecycle: create → charter → schedule → cost → lock baseline → activate.
// Progression is driven by REAL persisted state (not UI clicks), so it's resilient to refresh,
// navigation, or the user doing a step their own way. Coach-marks (P2) point at each `anchor`.

export type GuidedStepId = 'create' | 'charter' | 'schedule' | 'cost' | 'lock' | 'activate';

export interface GuidedStep {
  id: GuidedStepId;
  anchor?: string;               // data-tour anchor to spotlight (P2)
  title: { en: string; id: string };
  hint: { en: string; id: string };
}

export const GUIDED_STEPS: GuidedStep[] = [
  {
    id: 'create',
    anchor: 'new-project',
    title: { en: 'Create your project', id: 'Buat project Anda' },
    hint: {
      en: 'Click "+ New Project" and fill in the form to create your own project.',
      id: 'Klik "+ New Project" lalu isi formnya untuk membuat project Anda sendiri.',
    },
  },
  {
    id: 'charter',
    anchor: 'charter-commit',
    title: { en: 'Commit the Charter', id: 'Commit Charter' },
    hint: {
      en: 'Open Initiating → Charter, fill the required fields, then Commit — this locks scope and unlocks Schedule & Cost.',
      id: 'Buka Initiating → Charter, isi field wajib, lalu Commit — ini mengunci ruang lingkup & membuka Schedule & Cost.',
    },
  },
  {
    id: 'schedule',
    anchor: 'schedule-baseline',
    title: { en: 'Build the schedule', id: 'Susun jadwal' },
    hint: {
      en: 'In Schedule, add tasks (and subtasks if needed) with a plan Start & Finish, then capture the schedule baseline.',
      id: 'Di Schedule, tambah Task (dan Subtask jika perlu) dengan plan Start & Finish, lalu capture schedule baseline.',
    },
  },
  {
    id: 'cost',
    anchor: 'cost-add-line',
    title: { en: 'Enter the budget', id: 'Isi anggaran' },
    hint: {
      en: 'In Cost, add your Direct and Indirect cost lines — these build the BAC (cost baseline).',
      id: 'Di Cost, tambah baris Direct Cost dan Indirect Cost — ini membentuk BAC (cost baseline).',
    },
  },
  {
    id: 'lock',
    anchor: 'baseline-lock',
    title: { en: 'Lock the baseline', id: 'Kunci baseline' },
    hint: {
      en: 'Lock the baseline — one combined lock freezes both the cost and schedule baseline (2 of 2).',
      id: 'Kunci baseline — satu kunci gabungan membekukan cost dan schedule baseline sekaligus (2 of 2).',
    },
  },
  {
    id: 'activate',
    anchor: 'activate',
    title: { en: 'Activate the project', id: 'Aktifkan project' },
    hint: {
      en: 'Activate the project — you’re all set. Tracking (EVM) starts now. 🎉',
      id: 'Aktifkan project — semua siap. Pelacakan (EVM) dimulai sekarang. 🎉',
    },
  },
];

// Per-user localStorage key (device-scoped, mirrors the tour's onboardedKey).
export const guidedKey = (userId: string) => `prima_guided_${userId}`;

export interface GuidedState {
  projectId?: string;   // the project this guide is following (adopted once the user creates one)
  seenProjectIds?: string[]; // snapshot of pre-existing (demo) projects, to detect the new one
  dismissed?: boolean;  // user skipped the guide
  done?: boolean;       // completed (activated)
}
