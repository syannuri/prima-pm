import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Project } from '../api/types';
import { Badge, Button, Card, Spinner } from '../components/ui';
import CharterPanel from './panels/CharterPanel';
import CostPanel from './panels/CostPanel';
import RiskPanel from './panels/RiskPanel';
import SchedulePanel from './panels/SchedulePanel';
import WbsPanel from './panels/WbsPanel';
import AuditPanel from './panels/AuditPanel';
import ProjectAlerts from './panels/ProjectAlerts';
import ReassignPm from '../components/ReassignPm';

const TABS = ['Charter', 'WBS', 'Cost', 'Risk', 'Schedule', 'Audit'] as const;
type Tab = (typeof TABS)[number];

export default function ProjectPage() {
  const { projectId = '' } = useParams();
  const [tab, setTab] = useState<Tab>('Charter');

  const { data, isLoading } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.get<{ project: Project }>(`/projects/${projectId}`),
  });

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

  return (
    <div className="space-y-5">
      <div>
        <Link to="/" className="text-sm text-brand-600 hover:underline">
          ← All projects
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <span className="font-mono text-sm text-slate-400 dark:text-slate-500">{project.code}</span>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">{project.name}</h1>
          <Badge color={chartered ? 'indigo' : 'slate'}>{project.status}</Badge>
          {chartered && (
            <div className="ml-auto flex gap-2">
              <Button variant="secondary" onClick={() => api.download(`/projects/${projectId}/export/excel`, 'report.xlsx')}>
                ⬇ Excel
              </Button>
              <Button variant="secondary" onClick={() => api.download(`/projects/${projectId}/export/pdf`, 'report.pdf')}>
                ⬇ PDF
              </Button>
            </div>
          )}
        </div>
        <p className="flex flex-wrap items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <span>PM: {project.pm?.name ?? '—'} · Sponsor: {project.sponsor ?? '—'}</span>
          <ReassignPm projectId={projectId} currentPmId={project.pm?.id ?? project.pmUserId} />
        </p>
      </div>

      <ProjectAlerts projectId={projectId} onJump={(t) => setTab(t as Tab)} />

      <div className="flex gap-1 border-b border-slate-200 dark:border-slate-800">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium transition ${
              tab === t
                ? 'border-b-2 border-brand-600 text-brand-700'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {!chartered && tab !== 'Charter' && tab !== 'Audit' && (
        <Card>
          <p className="text-center text-amber-600">
            Commit the Project Charter first to unlock {tab} Management.
          </p>
        </Card>
      )}

      {tab === 'Charter' && <CharterPanel projectId={projectId} />}
      {tab === 'WBS' && chartered && <WbsPanel projectId={projectId} />}
      {tab === 'Cost' && chartered && <CostPanel projectId={projectId} />}
      {tab === 'Risk' && chartered && <RiskPanel projectId={projectId} />}
      {tab === 'Schedule' && chartered && <SchedulePanel projectId={projectId} />}
      {tab === 'Audit' && <AuditPanel projectId={projectId} />}
    </div>
  );
}
