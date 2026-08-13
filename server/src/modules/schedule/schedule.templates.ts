// Curated, code-defined WBS templates — standard work-breakdown structures per project type
// so a PM can seed a proven schedule instead of starting blank. Dates are RELATIVE: offsetDays
// from the chosen start + durationDays (milestones have durationDays 0). No DB model — edit here
// to add/adjust templates.

export interface TemplateTask {
  name: string;
  offsetDays: number; // start = projectStart + offsetDays
  durationDays: number; // 0 = milestone
  isMilestone?: boolean;
  deliverable?: string;
  acceptanceCriteria?: string;
  // Manual work-package weight (Model B): a curated effort distribution so the seeded schedule's
  // % roll-up reflects effort, not raw duration. Omitted on milestones (auto). Sum ≈ 100/template.
  weight?: number;
}

export interface WbsTemplate {
  id: string;
  name: string;
  category: string;
  description: string;
  tasks: TemplateTask[];
}

export const WBS_TEMPLATES: WbsTemplate[] = [
  {
    id: 'server-migration',
    name: 'Server / Infrastructure Migration',
    category: 'Infrastructure',
    description: 'Assess → design → build → migrate → cut-over → UAT → go-live → hypercare.',
    tasks: [
      { name: 'Kick-Off Meeting', offsetDays: 0, durationDays: 0, isMilestone: true },
      { name: 'Requirements & Assessment', offsetDays: 1, durationDays: 4, deliverable: 'Current-state assessment report', weight: 10 },
      { name: 'Solution Design', offsetDays: 6, durationDays: 5, deliverable: 'Signed-off design document', weight: 15 },
      { name: 'Procurement & Staging Setup', offsetDays: 12, durationDays: 3, weight: 8 },
      { name: 'Installation & Configuration', offsetDays: 15, durationDays: 5, weight: 20 },
      { name: 'Data Migration & Validation', offsetDays: 21, durationDays: 4, acceptanceCriteria: 'All data migrated with 0 validation errors', weight: 20 },
      { name: 'Cut-Over', offsetDays: 26, durationDays: 2, weight: 7 },
      { name: 'User Acceptance Test', offsetDays: 29, durationDays: 3, deliverable: 'UAT sign-off', weight: 12 },
      { name: 'Go-Live', offsetDays: 33, durationDays: 0, isMilestone: true },
      { name: 'Hypercare / Stabilization', offsetDays: 34, durationDays: 5, weight: 8 },
    ],
  },
  {
    id: 'cloud-migration',
    name: 'M365 / Cloud Tenant Migration',
    category: 'Cloud',
    description: 'Discovery → tenant design → build → identity/SSO → data migration → cut-over → UAT → go-live.',
    tasks: [
      { name: 'Kick-Off Meeting', offsetDays: 0, durationDays: 0, isMilestone: true },
      { name: 'Discovery & Assessment', offsetDays: 1, durationDays: 5, deliverable: 'Discovery report & migration approach', weight: 12 },
      { name: 'Tenant / Landing-Zone Design', offsetDays: 7, durationDays: 5, deliverable: 'Target tenant design', weight: 13 },
      { name: 'Build Target Environment', offsetDays: 13, durationDays: 6, weight: 18 },
      { name: 'Identity & SSO Configuration', offsetDays: 20, durationDays: 4, acceptanceCriteria: 'SSO works for all pilot users', weight: 12 },
      { name: 'Mailbox / Data Migration', offsetDays: 25, durationDays: 6, weight: 20 },
      { name: 'Cut-Over', offsetDays: 32, durationDays: 2, weight: 8 },
      { name: 'User Acceptance Test', offsetDays: 35, durationDays: 3, deliverable: 'UAT sign-off', weight: 10 },
      { name: 'Go-Live', offsetDays: 39, durationDays: 0, isMilestone: true },
      { name: 'Stabilization', offsetDays: 40, durationDays: 5, weight: 7 },
    ],
  },
  {
    id: 'generic-it',
    name: 'Generic IT Project',
    category: 'General',
    description: 'A lightweight lifecycle: initiation → requirements → design → build → test → deploy → closeout.',
    tasks: [
      { name: 'Kick-Off Meeting', offsetDays: 0, durationDays: 0, isMilestone: true },
      { name: 'Requirements', offsetDays: 1, durationDays: 4, deliverable: 'Requirements document', weight: 12 },
      { name: 'Design', offsetDays: 6, durationDays: 4, deliverable: 'Design document', weight: 15 },
      { name: 'Build / Development', offsetDays: 11, durationDays: 10, weight: 35 },
      { name: 'Testing / UAT', offsetDays: 22, durationDays: 4, deliverable: 'Test & UAT sign-off', weight: 18 },
      { name: 'Deployment', offsetDays: 27, durationDays: 2, weight: 10 },
      { name: 'Go-Live', offsetDays: 30, durationDays: 0, isMilestone: true },
      { name: 'Closure & Handover', offsetDays: 31, durationDays: 3, deliverable: 'Lessons learned & handover', weight: 10 },
    ],
  },
];

// Lightweight list for the picker (no task bodies).
export function listTemplates() {
  return WBS_TEMPLATES.map(({ id, name, category, description, tasks }) => ({ id, name, category, description, taskCount: tasks.length }));
}

export function getTemplate(id: string): WbsTemplate | undefined {
  return WBS_TEMPLATES.find((t) => t.id === id);
}
