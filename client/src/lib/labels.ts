import type { ProjectCategory, ChangeImpact } from '../api/types';

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
