import type { ComponentType } from 'react';
import ActionCenter from './ActionCenter';
import PlanningReminders from './PlanningReminders';
import AwaitingActivation from './AwaitingActivation';
import AwaitingClosure from './AwaitingClosure';
import PendingApprovals from './PendingApprovals';
import PortfolioSummary from './PortfolioSummary';
import PortfolioEvmTrend from './PortfolioEvmTrend';

// Registry of the customizable desktop portfolio widgets. `key` MUST match the server's
// DASHBOARD_WIDGET_KEYS (auth.schemas.ts) — it's what dashboardLayout stores. Order here is the
// DEFAULT order (used when a user has no saved layout). Each widget is self-contained (fetches its
// own data, no props), so showing/hiding/reordering is just array manipulation.
export interface DashWidget {
  key: string;
  en: string;
  id: string;
  // Widgets self-hide by returning null when empty, so allow a null-returning component.
  Component: ComponentType;
}

export const DASHBOARD_WIDGETS: DashWidget[] = [
  { key: 'actionCenter', en: 'Action center', id: 'Pusat aksi', Component: ActionCenter },
  { key: 'planningReminders', en: 'Planning reminders', id: 'Pengingat perencanaan', Component: PlanningReminders },
  { key: 'awaitingActivation', en: 'Awaiting activation', id: 'Menunggu aktivasi', Component: AwaitingActivation },
  { key: 'awaitingClosure', en: 'Awaiting closure', id: 'Menunggu penutupan', Component: AwaitingClosure },
  { key: 'pendingApprovals', en: 'Pending approvals', id: 'Persetujuan tertunda', Component: PendingApprovals },
  { key: 'portfolioSummary', en: 'Portfolio summary', id: 'Ringkasan portfolio', Component: PortfolioSummary },
  { key: 'portfolioEvmTrend', en: 'Portfolio EVM trend', id: 'Tren EVM portfolio', Component: PortfolioEvmTrend },
];

export const DEFAULT_WIDGET_ORDER: string[] = DASHBOARD_WIDGETS.map((w) => w.key);
export const WIDGET_BY_KEY: Record<string, DashWidget> = Object.fromEntries(DASHBOARD_WIDGETS.map((w) => [w.key, w]));

// Resolve a user's saved layout to the ORDERED list of enabled widget keys to render. A null/empty
// layout → the full default order. Unknown keys (e.g. a stale layout) are dropped. Disabled widgets
// are simply absent from a saved layout, so they're omitted here.
export function resolveEnabledWidgets(layout: string[] | null | undefined): string[] {
  if (!layout || layout.length === 0) return DEFAULT_WIDGET_ORDER;
  return layout.filter((k) => k in WIDGET_BY_KEY);
}
