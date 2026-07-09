import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Project } from '../api/types';
import { Badge, Card, Spinner } from '../components/ui';
import { useToast } from '../components/Toast';
import { ApiError } from '../api/client';
import { formatIdr } from '../lib/format';
import { categoryLabel, PROJECT_STATUS_BADGE } from '../lib/labels';
import CharterPanel from './panels/CharterPanel';
import CostPanel from './panels/CostPanel';
import TimesheetPanel from './panels/TimesheetPanel';
import ForecastPanel from './panels/ForecastPanel';
import RiskPanel from './panels/RiskPanel';
import IssuePanel from './panels/IssuePanel';
import StakeholderPanel from './panels/StakeholderPanel';
import ProcurementPanel from './panels/ProcurementPanel';
import RaidPanel from './panels/RaidPanel';
import SchedulePanel from './panels/SchedulePanel';
import ChangeRequestPanel from './panels/ChangeRequestPanel';
import AuditPanel from './panels/AuditPanel';
import CloseoutPanel from './panels/CloseoutPanel';
import UatPanel from './panels/UatPanel';
import KickoffPanel from './panels/KickoffPanel';
import EvmTrendPanel from './panels/EvmTrendPanel';
import ProjectAlerts from './panels/ProjectAlerts';
import NextStepsGuide from './panels/NextStepsGuide';
import CrDecisionBanner from '../components/CrDecisionBanner';
import ReassignPm from '../components/ReassignPm';
import EditProjectModal from '../components/EditProjectModal';
import CloseProjectModal from '../components/CloseProjectModal';
import LifecycleActions from '../components/LifecycleActions';
import MoreMenu, { MenuItem } from '../components/MoreMenu';
import AgilePanel from './panels/AgilePanel';
import { useAuth } from '../context/AuthContext';
import { DELIVERY_APPROACH_BADGE, DELIVERY_APPROACH_LABEL } from '../lib/labels';

type Tab = 'Charter' | 'Kick-Off' | 'Stakeholders' | 'Agile' | 'Cost' | 'Procurement' | 'Timesheet' | 'Forecast' | 'EVM Trend' | 'Risk' | 'RAID' | 'Issues' | 'UAT' | 'Schedule' | 'Change Req' | 'Closeout' | 'Audit';

export default function ProjectPage() {
  const { projectId = '' } = useParams();
  const toast = useToast();
  const { user } = useAuth();
  const canEdit = !!user && ['ADMIN', 'PMO'].includes(user.role); // mirrors EditProjectModal's gate
  const [tab, setTab] = useState<Tab | null>(null);
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const exportReport = async (kind: 'excel' | 'pdf') => {
    setExporting(kind);
    try {
      await api.download(`/projects/${projectId}/export/${kind}`, `report.${kind === 'excel' ? 'xlsx' : 'pdf'}`);
    } catch (e) {
      // api.download throws a generic ApiError; show an export-specific message instead.
      const status = e instanceof ApiError ? ` (${e.status})` : '';
      toast.error(`Couldn't generate the ${kind.toUpperCase()} report${status}. Please try again.`);
    } finally {
      setExporting(null);
    }
  };

  const { data, isLoading } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.get<{ project: Project }>(`/projects/${projectId}`),
  });

  // Lightweight total-changes count for the Audit tab badge (limit=1 → just the count).
  const { data: auditMeta } = useQuery({
    queryKey: ['audit-count', projectId],
    queryFn: () => api.get<{ total: number }>(`/projects/${projectId}/audit?limit=1`),
  });
  const changeCount = auditMeta?.total ?? 0;

  if (isLoading) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }
  const project = data?.project;
  if (!project) return <Card>Project not found.</Card>;

  const chartered = project.status !== 'DRAFT';
  const isAgile = project.deliveryApproach === 'AGILE' || project.deliveryApproach === 'HYBRID';
  // Agile tab for agile/hybrid; the predictive Schedule (WBS/Gantt) is hidden for pure
  // Agile (its scheduling lives in sprints/board) but kept for predictive & hybrid.
  const showSchedule = project.deliveryApproach !== 'AGILE';
  const tabs: Tab[] = [
    ...(showSchedule ? (['Schedule'] as Tab[]) : []),
    ...(isAgile ? (['Agile'] as Tab[]) : []),
    'Cost', 'Procurement', 'Timesheet', 'Forecast', 'EVM Trend', 'Risk', 'RAID', 'Issues', 'Change Req',
    'Charter', 'Kick-Off', 'Stakeholders', 'UAT', 'Closeout', 'Audit',
  ];
  // Fresh (DRAFT) projects land on Charter — commit it to unlock the rest. Once
  // chartered, land on the first working tab (Schedule/Agile); Charter stays
  // available near the end but is no longer the default landing tab.
  const activeTab: Tab = tab ?? (chartered ? tabs[0] : 'Charter');

  return (
    <div className="space-y-5">
      <div>
        <Link to="/" className="text-sm text-brand-600 hover:underline">
          ← All projects
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <span className="font-mono text-sm text-slate-500 dark:text-slate-400">{project.code}</span>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">{project.name}</h1>
          <Badge color={PROJECT_STATUS_BADGE[project.status] ?? 'slate'}>{project.status}</Badge>
          <Badge color={DELIVERY_APPROACH_BADGE[project.deliveryApproach]}>{DELIVERY_APPROACH_LABEL[project.deliveryApproach]}</Badge>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {/* Primary stage action stays prominent; secondary actions tuck into "⋯ More". */}
            <LifecycleActions project={project} />
            <CloseProjectModal project={project} />
            <MoreMenu>
              {canEdit && <MenuItem onClick={() => setEditOpen(true)}>✏️ Edit details</MenuItem>}
              {chartered && <MenuItem disabled={exporting !== null} onClick={() => exportReport('excel')}>⬇ {exporting === 'excel' ? 'Exporting…' : 'Download Excel'}</MenuItem>}
              {chartered && <MenuItem disabled={exporting !== null} onClick={() => exportReport('pdf')}>⬇ {exporting === 'pdf' ? 'Exporting…' : 'Download PDF'}</MenuItem>}
            </MoreMenu>
          </div>
          {/* Controlled modal, mounted outside the menu so it survives the menu closing. */}
          <EditProjectModal project={project} open={editOpen} onOpenChange={setEditOpen} />
        </div>
        <p className="flex flex-wrap items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <span>Client: {project.clientName ?? '—'} · PM: {project.pm?.name ?? '—'} · Sponsor: {project.sponsor ?? '—'}</span>
          <ReassignPm projectId={projectId} currentPmId={project.pm?.id ?? project.pmUserId} />
        </p>
        {(project.category || project.costBaselineIdr || project.totalRevenueIdr) && (
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            {project.category && <Badge color="slate">{categoryLabel(project.category)}</Badge>}
            {project.costBaselineIdr && <span>Cost Baseline: <span className="font-medium text-slate-700 dark:text-slate-200">{formatIdr(project.costBaselineIdr)}</span></span>}
            {project.totalRevenueIdr && <span>· Revenue: <span className="font-medium text-slate-700 dark:text-slate-200">{formatIdr(project.totalRevenueIdr)}</span></span>}
            {project.costBaselineIdr && project.totalRevenueIdr && (
              <span>· Margin: <span className="font-medium text-slate-700 dark:text-slate-200">{formatIdr(Number(project.totalRevenueIdr) - Number(project.costBaselineIdr))}</span></span>
            )}
          </div>
        )}
        {project.status === 'ON_HOLD' && (
          <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300">
            ⏸ On hold{project.onHoldReason && <> · <span className="italic">“{project.onHoldReason}”</span></>}
          </div>
        )}
        {project.status === 'CLOSED' && project.closedAt && (
          <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
            🔒 Closed on {new Date(project.closedAt).toLocaleDateString()}
            {project.closureNote && <> · <span className="italic">“{project.closureNote}”</span></>}
          </div>
        )}
      </div>

      <CrDecisionBanner projectId={projectId} onJump={(t) => setTab(t as Tab)} />

      <ProjectAlerts projectId={projectId} onJump={(t) => setTab(t as Tab)} />

      <NextStepsGuide projectId={projectId} onJump={(t) => setTab(t as Tab)} />

      <GroupedTabs tabs={tabs} activeTab={activeTab} changeCount={changeCount} onSelect={(t) => setTab(t)} />

      {!chartered && activeTab !== 'Charter' && activeTab !== 'Audit' && activeTab !== 'Agile' && activeTab !== 'Issues' && activeTab !== 'Closeout' && activeTab !== 'Stakeholders' && activeTab !== 'RAID' && (
        <Card>
          <p className="text-center text-amber-600">
            Commit the Project Charter first to unlock {activeTab} Management.
          </p>
        </Card>
      )}

      {activeTab === 'Charter' && <CharterPanel projectId={projectId} approach={project.deliveryApproach} sponsor={project.sponsor} />}
      {activeTab === 'Agile' && <AgilePanel projectId={projectId} approach={project.deliveryApproach} chartered={chartered} />}
      {activeTab === 'Cost' && chartered && <CostPanel projectId={projectId} />}
      {activeTab === 'Procurement' && chartered && <ProcurementPanel projectId={projectId} />}
      {activeTab === 'Stakeholders' && <StakeholderPanel projectId={projectId} />}
      {activeTab === 'Timesheet' && chartered && <TimesheetPanel projectId={projectId} />}
      {activeTab === 'Forecast' && chartered && <ForecastPanel projectId={projectId} />}
      {activeTab === 'EVM Trend' && chartered && <EvmTrendPanel projectId={projectId} />}
      {activeTab === 'Risk' && chartered && <RiskPanel projectId={projectId} />}
      {activeTab === 'RAID' && <RaidPanel projectId={projectId} onJump={(t) => setTab(t as Tab)} />}
      {activeTab === 'Issues' && <IssuePanel projectId={projectId} />}
      {activeTab === 'Schedule' && chartered && <SchedulePanel projectId={projectId} />}
      {activeTab === 'Change Req' && chartered && <ChangeRequestPanel projectId={projectId} projectCode={project.code} projectName={project.name} />}
      {activeTab === 'Kick-Off' && chartered && <KickoffPanel projectId={projectId} />}
      {activeTab === 'UAT' && chartered && <UatPanel projectId={projectId} />}
      {activeTab === 'Closeout' && <CloseoutPanel projectId={projectId} />}
      {activeTab === 'Audit' && <AuditPanel projectId={projectId} />}
    </div>
  );
}

// Lifecycle-phase grouping of the project tabs so the bar isn't a wall of 14 buttons.
// A single-tab phase renders as a plain tab; a multi-tab phase is a dropdown whose button
// shows the active sub-tab (or the phase name) and highlights when one of its tabs is active.
const TAB_GROUPS: { label: string; tabs: Tab[] }[] = [
  { label: 'Charter', tabs: ['Charter', 'Kick-Off', 'Stakeholders'] },
  { label: 'Plan', tabs: ['Schedule', 'Agile', 'Cost', 'Procurement', 'Risk'] },
  { label: 'Execute', tabs: ['Timesheet', 'RAID', 'Issues', 'UAT', 'Change Req'] },
  { label: 'Track', tabs: ['Forecast', 'EVM Trend'] },
  { label: 'Close', tabs: ['Closeout'] },
  { label: 'Audit', tabs: ['Audit'] },
];

function GroupedTabs({ tabs, activeTab, changeCount, onSelect }: { tabs: Tab[]; activeTab: Tab; changeCount: number; onSelect: (t: Tab) => void }) {
  const groups = TAB_GROUPS
    .map((g) => ({ label: g.label, tabs: g.tabs.filter((t) => tabs.includes(t)) }))
    .filter((g) => g.tabs.length > 0);
  // The active group is whichever contains the active tab — its sub-tabs get the second row.
  const activeGroup = groups.find((g) => g.tabs.includes(activeTab)) ?? groups[0];

  const AuditBadge = () => (changeCount > 0 ? (
    <span className="grid h-5 min-w-[20px] place-items-center rounded-full bg-slate-200 px-1 text-xs font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">{changeCount}</span>
  ) : null);

  // Level 1: lifecycle-phase groups (underline tabs).
  const groupBtn = (active: boolean) =>
    `flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-t-lg border-b-2 px-4 py-2 text-sm font-medium transition ${
      active
        ? 'border-brand-600 bg-brand-50 font-semibold text-brand-700 dark:bg-brand-900/30 dark:text-brand-300'
        : 'border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-200'
    }`;
  // Level 2: sub-tabs of the active group (pills), always visible so the group's contents are discoverable.
  const subBtn = (active: boolean) =>
    `flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
      active
        ? 'bg-brand-600 text-white shadow-sm'
        : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200'
    }`;

  return (
    <div>
      {/* Level 1 — phase groups */}
      <div className="flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800">
        {groups.map((g) => {
          const active = g.tabs.includes(activeTab);
          const single = g.tabs.length === 1;
          return (
            // Single-tab groups show the tab's own name (e.g. "Closeout"); multi-tab groups show
            // the phase label + a stable aria-label so tests/AT can target the phase.
            <button key={g.label} aria-label={single ? undefined : g.label} onClick={() => onSelect(active ? activeTab : g.tabs[0])} className={groupBtn(active)}>
              {single ? g.tabs[0] : g.label}{single && g.tabs[0] === 'Audit' && <AuditBadge />}
            </button>
          );
        })}
      </div>
      {/* Level 2 — sub-tabs of the active group (only when the group has more than one) */}
      {activeGroup.tabs.length > 1 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {activeGroup.tabs.map((t) => (
            <button key={t} onClick={() => onSelect(t)} className={subBtn(activeTab === t)}>
              {t}{t === 'Audit' && <AuditBadge />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
