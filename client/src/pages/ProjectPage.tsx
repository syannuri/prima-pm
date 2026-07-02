import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Project } from '../api/types';
import { Badge, Button, Card, Spinner } from '../components/ui';
import { useToast } from '../components/Toast';
import { ApiError } from '../api/client';
import { formatIdr } from '../lib/format';
import { categoryLabel, PROJECT_STATUS_BADGE } from '../lib/labels';
import CharterPanel from './panels/CharterPanel';
import CostPanel from './panels/CostPanel';
import ForecastPanel from './panels/ForecastPanel';
import RiskPanel from './panels/RiskPanel';
import IssuePanel from './panels/IssuePanel';
import SchedulePanel from './panels/SchedulePanel';
import ChangeRequestPanel from './panels/ChangeRequestPanel';
import AuditPanel from './panels/AuditPanel';
import ProjectAlerts from './panels/ProjectAlerts';
import ReassignPm from '../components/ReassignPm';
import EditProjectModal from '../components/EditProjectModal';
import AgilePanel from './panels/AgilePanel';
import { DELIVERY_APPROACH_BADGE, DELIVERY_APPROACH_LABEL } from '../lib/labels';

type Tab = 'Charter' | 'Agile' | 'Cost' | 'Forecast' | 'Risk' | 'Issues' | 'Schedule' | 'Change Req' | 'Audit';

export default function ProjectPage() {
  const { projectId = '' } = useParams();
  const toast = useToast();
  const [tab, setTab] = useState<Tab | null>(null);
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null);

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
    'Cost', 'Forecast', 'Risk', 'Issues', 'Change Req',
    'Charter', 'Audit',
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
          <div className="ml-auto flex flex-wrap gap-2">
            <EditProjectModal project={project} />
            {chartered && (
              <>
                <Button variant="secondary" onClick={() => exportReport('excel')} disabled={exporting !== null}>
                  {exporting === 'excel' ? 'Exporting…' : '⬇ Excel'}
                </Button>
                <Button variant="secondary" onClick={() => exportReport('pdf')} disabled={exporting !== null}>
                  {exporting === 'pdf' ? 'Exporting…' : '⬇ PDF'}
                </Button>
              </>
            )}
          </div>
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
      </div>

      <ProjectAlerts projectId={projectId} onJump={(t) => setTab(t as Tab)} />

      <div className="flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap px-4 py-2 text-sm font-medium transition ${
              activeTab === t
                ? 'border-b-2 border-brand-600 text-brand-700'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
          >
            {t}
            {t === 'Audit' && changeCount > 0 && (
              <span className="grid h-5 min-w-[20px] place-items-center rounded-full bg-slate-200 px-1 text-xs font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                {changeCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {!chartered && activeTab !== 'Charter' && activeTab !== 'Audit' && activeTab !== 'Agile' && activeTab !== 'Issues' && (
        <Card>
          <p className="text-center text-amber-600">
            Commit the Project Charter first to unlock {activeTab} Management.
          </p>
        </Card>
      )}

      {activeTab === 'Charter' && <CharterPanel projectId={projectId} approach={project.deliveryApproach} sponsor={project.sponsor} />}
      {activeTab === 'Agile' && <AgilePanel projectId={projectId} approach={project.deliveryApproach} chartered={chartered} />}
      {activeTab === 'Cost' && chartered && <CostPanel projectId={projectId} />}
      {activeTab === 'Forecast' && chartered && <ForecastPanel projectId={projectId} />}
      {activeTab === 'Risk' && chartered && <RiskPanel projectId={projectId} />}
      {activeTab === 'Issues' && <IssuePanel projectId={projectId} />}
      {activeTab === 'Schedule' && chartered && <SchedulePanel projectId={projectId} />}
      {activeTab === 'Change Req' && chartered && <ChangeRequestPanel projectId={projectId} projectCode={project.code} projectName={project.name} />}
      {activeTab === 'Audit' && <AuditPanel projectId={projectId} />}
    </div>
  );
}
