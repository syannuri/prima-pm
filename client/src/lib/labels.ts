import type { ProjectCategory, ChangeImpact, DeliveryApproach, BacklogType, BacklogStatus } from '../api/types';

export const DELIVERY_APPROACH_LABEL: Record<DeliveryApproach, string> = {
  PREDICTIVE: 'Predictive',
  AGILE: 'Agile',
  HYBRID: 'Hybrid',
};
export const DELIVERY_APPROACH_BADGE: Record<DeliveryApproach, string> = {
  PREDICTIVE: 'sky',
  AGILE: 'indigo',
  HYBRID: 'amber',
};
export const BACKLOG_TYPE_BADGE: Record<BacklogType, string> = {
  EPIC: 'indigo',
  STORY: 'sky',
  TASK: 'slate',
  BUG: 'red',
};
export const BACKLOG_STATUS_LABEL: Record<BacklogStatus, string> = {
  TODO: 'To Do',
  IN_PROGRESS: 'In Progress',
  DONE: 'Done',
};

export const PROJECT_CATEGORIES: { value: ProjectCategory; label: string }[] = [
  { value: 'NETWORK_INFRA', label: 'Network Infrastructure' },
  { value: 'SERVER_INFRA', label: 'Server Infrastructure' },
  { value: 'CLOUD_INFRA', label: 'Cloud Infrastructure' },
  { value: 'CYBERSECURITY_INFRA', label: 'Cyber Security Infrastructure' },
  { value: 'APP_DEV', label: 'Application Development' },
];
export const categoryLabel = (c?: ProjectCategory | null) =>
  PROJECT_CATEGORIES.find((x) => x.value === c)?.label ?? null;

export const CHANGE_IMPACTS: { value: ChangeImpact; label: string }[] = [
  { value: 'COST', label: 'Cost' },
  { value: 'SCHEDULE', label: 'Schedule' },
  { value: 'RESOURCE', label: 'Resource' },
  { value: 'QUALITY', label: 'Quality' },
  { value: 'RISK', label: 'Risk' },
];

// Lifecycle status colours — calm & semantic, NOT alarming. Red is reserved for
// health (Behind / At risk), never for a normal lifecycle status. Coral (the
// brand) means "done" (a positive). Keys map to Badge colours / Tailwind bg-*.
export const PROJECT_STATUS_BADGE: Record<string, string> = {
  DRAFT: 'slate',
  CHARTERED: 'sky',
  IN_PROGRESS: 'indigo',
  ON_HOLD: 'amber',
  CLOSED: 'coral',
};
export const PROJECT_STATUS_DOT: Record<string, string> = {
  DRAFT: 'bg-slate-400',
  CHARTERED: 'bg-sky-400',
  IN_PROGRESS: 'bg-indigo-400',
  ON_HOLD: 'bg-amber-400',
  CLOSED: 'bg-brand-500',
};
