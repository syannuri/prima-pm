// Map a stored notification `type` to the project tab it's about, so a click deep-links to where the
// event happened (ProjectPage reads ?tab=). Mirrors the map inlined in NotificationBell.
export const TYPE_TAB: Record<string, string> = {
  OVERDUE_TASK: 'Schedule', DUE_SOON_TASK: 'Schedule', SCHEDULE: 'Schedule',
  HIGH_RISK: 'Risk',
  BUDGET_OVERRUN: 'Cost', OVERSPEND: 'Cost', COST_BASELINE: 'Cost',
  CHANGE_REQUEST: 'Change Req', CR_SUBMITTED: 'Change Req', CR_APPROVED: 'Change Req', CR_REJECTED: 'Change Req',
  APPROVAL_PENDING: 'Change Req', APPROVAL_OVERDUE: 'Change Req',
  ACTIVATION_APPROVED: 'Closeout', ACTIVATION_READY: 'Closeout', ACTIVATION_REVISION: 'Closeout',
};

// /projects/:id (+ ?tab= &focus=) when we know where the event happened.
export function projectLink(projectId: string, tab?: string, focus?: string): string {
  const qs = new URLSearchParams();
  if (tab) qs.set('tab', tab);
  if (focus) qs.set('focus', focus);
  const q = qs.toString();
  return `/projects/${projectId}${q ? `?${q}` : ''}`;
}

// The href a notification row links to: its project tab, else nothing (non-project events).
export function notificationHref(n: { type: string; projectId: string | null }): string | null {
  if (!n.projectId) return null;
  return projectLink(n.projectId, TYPE_TAB[n.type]);
}
