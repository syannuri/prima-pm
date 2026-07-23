import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { DeliveryApproach, Project, ProjectCategory, PortfolioSummary as Summary, User } from '../api/types';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, MoneyInput, Select, Skeleton } from '../components/ui';
import type { InputState } from '../components/ui';
import { useToast } from '../components/Toast';
import { formatIdr, formatIdrShort } from '../lib/format';
import { DELIVERY_APPROACH_LABEL, PROJECT_CATEGORIES, PROJECT_STATUS_BADGE } from '../lib/labels';
import { projectAccent } from '../lib/projectColor';

// HYBRID is hidden from the picker (kept in the type/labels for existing projects) — new
// projects choose Predictive or Agile only.
const APPROACHES: DeliveryApproach[] = ['PREDICTIVE', 'AGILE'];

// Health → calm pill (label + Badge colour). Shown on a card only when meaningful.
const HEALTH_PILL: Record<string, [string, string]> = {
  GREEN: ['green', 'On track'],
  AMBER: ['amber', 'At risk'],
  RED: ['red', 'Behind'],
};
import { useAuth } from '../context/AuthContext';
import { useLang, greet, dateLocale } from '../context/LanguageContext';
import PortfolioSummary from '../components/PortfolioSummary';
import MobileDashboard from '../components/MobileDashboard';
import Fab from '../components/Fab';
import PullToRefresh from '../components/PullToRefresh';
import { useSwipe } from '../hooks/useSwipe';
import { useIsMobile } from '../hooks/useIsMobile';
import PortfolioForecast from '../components/PortfolioForecast';
import PortfolioEvmTrend from '../components/PortfolioEvmTrend';
import AssignmentBanner from '../components/AssignmentBanner';
import AwaitingActivation from '../components/AwaitingActivation';
import AwaitingClosure from '../components/AwaitingClosure';
import PlanningReminders from '../components/PlanningReminders';
import PendingApprovals from '../components/PendingApprovals';
import ActionCenter from '../components/ActionCenter';
import ResourceCapacity from '../components/ResourceCapacity';

const STATUS_COLOR = PROJECT_STATUS_BADGE;

export default function DashboardPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  const { lang } = useLang();
  const [showForm, setShowForm] = useState(false);
  const [view, setView] = useState<'portfolio' | 'forecast' | 'resources' | 'cards'>('portfolio');
  // The mobile "Projects" tab deep-links to ?view=cards; keep the view in sync with the URL.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const v = searchParams.get('view');
    setView(v === 'cards' ? 'cards' : v === 'forecast' ? 'forecast' : v === 'resources' ? 'resources' : 'portfolio');
  }, [searchParams]);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [clientName, setClientName] = useState('');
  const [sponsor, setSponsor] = useState('');
  const [category, setCategory] = useState<ProjectCategory | ''>('');
  const [categoryOther, setCategoryOther] = useState('');
  const [deliveryApproach, setDeliveryApproach] = useState<DeliveryApproach>('PREDICTIVE');
  const [costBaseline, setCostBaseline] = useState('');
  const [revenue, setRevenue] = useState('');
  const [pmUserId, setPmUserId] = useState('');
  // Per-field validation surfacing (same pattern as the Charter form): a required field warns
  // once touched, and every missing one is revealed at once on a Create attempt.
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [showAllErrors, setShowAllErrors] = useState(false);
  const touch = (k: string) => setTouched((t) => ({ ...t, [k]: true }));

  const { data, isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<{ projects: Project[] }>('/projects'),
  });
  // Card view enriches each project with % complete + health from the portfolio roll-up.
  const cardsMeta = useQuery({
    queryKey: ['portfolio', 'cards'],
    queryFn: () => api.get<Summary>('/portfolio/summary'),
    enabled: view === 'cards',
  });
  const metaById = new Map((cardsMeta.data?.projects ?? []).map((r) => [r.id, r]));
  // PMO assigns the project to a PM at creation.
  const usersQ = useQuery({ queryKey: ['directory'], queryFn: () => api.get<{ users: User[] }>('/users/directory'), enabled: showForm });

  const resetForm = () => { setName(''); setCode(''); setClientName(''); setSponsor(''); setCategory(''); setCategoryOther(''); setDeliveryApproach('PREDICTIVE'); setCostBaseline(''); setRevenue(''); setPmUserId(''); setTouched({}); setShowAllErrors(false); };
  const create = useMutation({
    mutationFn: () => api.post<{ project: Project }>('/projects', {
      name,
      code: code.trim() || undefined,
      clientName: clientName || undefined,
      sponsor: sponsor || undefined,
      category: category || undefined,
      categoryOther: category === 'OTHER' ? (categoryOther.trim() || undefined) : undefined,
      deliveryApproach,
      costBaselineIdr: costBaseline ? Number(costBaseline) : undefined,
      totalRevenueIdr: revenue ? Number(revenue) : undefined,
      pmUserId: pmUserId || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      setShowForm(false);
      resetForm();
      toast.success('Project created');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not create project'),
  });

  // Only `name` (min 2 chars) and — when category is Other — its free-text detail are
  // mandatory here; the rest of the shell is completed later in the Charter.
  const missing: Record<string, boolean> = {
    name: name.trim().length < 2,
    categoryOther: category === 'OTHER' && categoryOther.trim() === '',
  };
  const showErr = (k: string) => missing[k] && (showAllErrors || !!touched[k]);
  const errState = (k: string): InputState => (showErr(k) ? 'invalid' : 'none');
  const t = (id: string, en: string) => (lang === 'id' ? id : en);
  const nameError = showErr('name') ? (name.trim() ? t('Nama minimal 2 karakter', 'Name must be at least 2 characters') : t('Field ini wajib diisi', 'This field is required')) : undefined;
  const categoryOtherError = showErr('categoryOther') ? t('Jelaskan kategori "Other"', 'Describe the "Other" category') : undefined;
  const canSubmit = !missing.name && !missing.categoryOther;
  const submit = () => {
    if (!canSubmit) { setShowAllErrors(true); touch('name'); return; }
    create.mutate();
  };

  // PMO/Admin get the portfolio-wide framing; PMs see a "my projects" view.
  const isPmo = !!user && ['ADMIN', 'PMO'].includes(user.role);
  // ADMIN/PMO create corporate projects; a GUEST creates their own personal project.
  const canCreate = isPmo || user?.role === 'GUEST';
  const isMobile = useIsMobile();

  // Phones: swipe left/right to move between the two dashboard tabs
  // (Home/portfolio ⇄ Projects/cards), mirroring the bottom tab bar.
  const swipeRef = useRef<HTMLDivElement>(null);
  const goView = (v: 'portfolio' | 'cards') =>
    setSearchParams(v === 'cards' ? { view: 'cards' } : {}, { replace: true });
  useSwipe(swipeRef, {
    enabled: isMobile && (view === 'portfolio' || view === 'cards'),
    onLeft: () => { if (view === 'portfolio') goView('cards'); },
    onRight: () => { if (view === 'cards') goView('portfolio'); },
  });

  // Warm header: time-based greeting + today's date + a one-line portfolio pulse,
  // in the user's chosen language (auto-detected from the browser, overridable in Settings).
  const now = new Date();
  const greeting = greet(lang, now.getHours());
  const firstName = user?.name?.split(' ')[0] ?? (lang === 'id' ? 'Anda' : 'there');
  const today = now.toLocaleDateString(dateLocale(lang), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const projectCount = data?.projects.length ?? 0;
  const noun = projectCount === 1 ? 'project' : 'projects';
  // Don't claim "No projects yet" while the list is still loading (misleads on a slow paint).
  const pulse = isLoading
    ? (lang === 'id' ? 'Memuat…' : 'Loading…')
    : projectCount === 0
    ? (lang === 'id' ? 'Belum ada proyek' : 'No projects yet')
    : lang === 'id'
      ? `${projectCount} proyek ${isPmo ? 'di portfolio' : 'untuk Anda'}`
      : `${projectCount} ${noun} ${isPmo ? 'in the portfolio' : 'assigned to you'}`;

  return (
    <div ref={swipeRef} className="space-y-5">
      {/* Whole header row (greeting + view toggle + New Project) is desktop-only; on phones the
          mobile dashboard hero + quick actions + bottom tab bar handle greeting and navigation. */}
      <div className="hidden flex-wrap items-center justify-between gap-3 sm:flex">
        <div className="hidden sm:block">
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">{greeting}, {firstName} 👋</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{today} · {pulse}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex max-w-full overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-0.5 text-sm">
            <button
              onClick={() => setView('portfolio')}
              className={`shrink-0 whitespace-nowrap rounded-md px-3 py-1 transition ${view ==='portfolio' ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'}`}
            >
              {isPmo ? 'Portfolio EVM' : 'My Projects'}
            </button>
            <button
              onClick={() => setView('forecast')}
              className={`shrink-0 whitespace-nowrap rounded-md px-3 py-1 transition ${view ==='forecast' ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'}`}
            >
              Forecast
            </button>
            <button
              onClick={() => setView('resources')}
              className={`shrink-0 whitespace-nowrap rounded-md px-3 py-1 transition ${view ==='resources' ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'}`}
            >
              Utilization
            </button>
            <button
              onClick={() => setView('cards')}
              className={`shrink-0 whitespace-nowrap rounded-md px-3 py-1 transition ${view ==='cards' ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'}`}
            >
              Project Cards
            </button>
          </div>
          {canCreate && <Button data-tour="new-project" onClick={() => setShowForm((s) => !s)}>+ New Project</Button>}
        </div>
      </div>

      <AssignmentBanner />
      {/* Phones (PM/PMO) get a tailored, card-first portfolio dashboard; desktop keeps the full stack. */}
      {view === 'portfolio' && (isMobile ? (
        <PullToRefresh onRefresh={() => qc.refetchQueries({ type: 'active' })}>
          <MobileDashboard />
        </PullToRefresh>
      ) : (
        <>
          <ActionCenter />
          <PlanningReminders />
          <AwaitingActivation />
          <AwaitingClosure />
          <PendingApprovals />
          <PortfolioSummary />
          <PortfolioEvmTrend />
        </>
      ))}
      {view === 'forecast' && <PortfolioForecast />}
      {view === 'resources' && <ResourceCapacity />}

      {/* Phones: floating "+" to create a project (portfolio & cards views). */}
      {isMobile && canCreate && !showForm && (view === 'portfolio' || view === 'cards') && (
        <Fab label={lang === 'id' ? 'Proyek baru' : 'New Project'} onClick={() => setShowForm(true)} />
      )}

      {showForm && (
        <Modal onClose={() => setShowForm(false)} title="New Project" size="lg">
            <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">Create a project shell, then build its Charter, WBS, Cost & Risk.</p>
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Project name" required error={nameError}>
                  <Input state={errState('name')} value={name} onChange={(e) => setName(e.target.value)} onBlur={() => touch('name')} placeholder="e.g. SOC Modernization" />
                </Field>
                <Field label="Project code">
                  <Input value={code} onChange={(e) => setCode(e.target.value)} spellCheck={false} placeholder="auto-generated if blank" />
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Client">
                  <Input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="e.g. Bank XYZ" />
                </Field>
                <Field label="Sponsor">
                  <Input value={sponsor} onChange={(e) => setSponsor(e.target.value)} placeholder="e.g. CISO Office" />
                </Field>
                <Field label="Project category" error={categoryOtherError}>
                  <Select value={category} onChange={(e) => setCategory(e.target.value as ProjectCategory | '')}>
                    <option value="">— select —</option>
                    {PROJECT_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </Select>
                  {category === 'OTHER' && (
                    <Input className="mt-2" state={errState('categoryOther')} value={categoryOther} onChange={(e) => setCategoryOther(e.target.value)} onBlur={() => touch('categoryOther')} placeholder="Describe the category" />
                  )}
                </Field>
                <Field label="Delivery approach" hint="Agile/Hybrid unlocks the Backlog & Board">
                  <Select value={deliveryApproach} onChange={(e) => setDeliveryApproach(e.target.value as DeliveryApproach)}>
                    {APPROACHES.map((a) => <option key={a} value={a}>{DELIVERY_APPROACH_LABEL[a]}</option>)}
                  </Select>
                </Field>
                {/* A guest owns their personal project themselves — no PM to assign. */}
                {user?.role !== 'GUEST' && (
                  <Field label="Assign Project Manager">
                    <Select value={pmUserId} onChange={(e) => setPmUserId(e.target.value)}>
                      <option value="">— unassigned —</option>
                      {usersQ.data?.users.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
                    </Select>
                  </Field>
                )}
                <Field label="Cost Baseline (IDR)">
                  <MoneyInput value={costBaseline} onValueChange={setCostBaseline} placeholder="e.g. 1.000.000.000" />
                </Field>
                <Field label="Total Revenue (IDR)">
                  <MoneyInput value={revenue} onValueChange={setRevenue} placeholder="e.g. 1.500.000.000" />
                </Field>
              </div>
              {costBaseline && revenue && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Projected margin: {formatIdr(Number(revenue) - Number(costBaseline))}
                  {Number(revenue) > 0 && ` (${(((Number(revenue) - Number(costBaseline)) / Number(revenue)) * 100).toFixed(1)}%)`}
                </p>
              )}
              {create.isError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-300">{(create.error as Error).message}</p>}
              <div className="flex gap-2 pt-1">
                <Button variant="secondary" className="flex-1" onClick={() => { setShowForm(false); resetForm(); }}>Cancel</Button>
                <Button className="flex-1" onClick={submit} disabled={create.isPending}>
                  {create.isPending ? 'Creating…' : 'Create Project'}
                </Button>
              </div>
            </div>
        </Modal>
      )}

      {/* Mobile-only page title for the Projects (cards) tab — desktop has the view toggle instead. */}
      {view === 'cards' && <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100 sm:hidden">{lang === 'id' ? 'Kartu Proyek' : 'Project Cards'}</h1>}

      {view === 'cards' && (isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="space-y-3">
              <div className="flex items-center justify-between">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-5 w-20 rounded-full" />
              </div>
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-1.5 w-full rounded-full" />
              <div className="flex items-center justify-between pt-2">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-3 w-16" />
              </div>
            </Card>
          ))}
        </div>
      ) : !data?.projects.length ? (
        <Card>
          <EmptyState
            icon="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z"
            title="No projects yet"
            hint={canCreate ? 'Create your first project to start tracking cost, schedule and risk.' : 'Projects assigned to you will appear here.'}
            action={canCreate ? <Button onClick={() => setShowForm(true)}>+ New Project</Button> : undefined}
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.projects.map((p) => {
            const meta = metaById.get(p.id);
            const pct = meta ? Math.round(Math.min(1, Math.max(0, meta.scheduleProgress)) * 100) : null;
            const pill = meta && HEALTH_PILL[meta.health];
            const bacFull = p.costBaseline ? formatIdr(p.costBaseline.budgetAtCompletion) : undefined;
            return (
              <Link key={p.id} to={`/projects/${p.id}`} className="block min-w-0">
                {/* Compact card (~4 fit a phone): code + status, name, a health-coloured progress
                    bar, and one muted meta line. Verbose labels and the "N changes" row were
                    dropped — that detail lives on the project page. min-w-0 on the grid item (Link)
                    is essential: without it, the truncated (nowrap) title/meta force the card wider
                    than the viewport on long real-world names → horizontal overflow. */}
                <div className="relative h-full overflow-hidden rounded-xl border border-slate-200 bg-white p-4 pl-5 shadow-sm transition duration-150 hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-lg dark:border-slate-700/60 dark:bg-slate-900 dark:hover:border-brand-700">
                  {/* per-project colour spine (monday.com-style identity accent) */}
                  <span className={`absolute inset-y-0 left-0 w-1.5 ${projectAccent(p.id).solid}`} />
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <span className="min-w-0 truncate font-mono text-[11px] text-slate-400 dark:text-slate-500">{p.code}</span>
                    <Badge color={STATUS_COLOR[p.status]} solid>{p.status}</Badge>
                  </div>
                  <h3 className="mt-1 truncate font-semibold text-slate-800 dark:text-slate-100" title={p.name}>{p.name}</h3>

                  {/* health-coloured progress bar + % */}
                  <div className="mt-2.5 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <div
                        className={`h-full rounded-full transition-[width] duration-500 ${meta ? (meta.health === 'RED' ? 'bg-red-500' : meta.health === 'AMBER' ? 'bg-amber-500' : 'bg-emerald-500') : p.status === 'IN_PROGRESS' ? 'bg-emerald-500' : 'bg-slate-400 dark:bg-slate-500'}`}
                        style={{ width: `${pct ?? 0}%` }}
                      />
                    </div>
                    <span className="w-10 shrink-0 text-right text-xs font-semibold tabular-nums text-slate-600 dark:text-slate-300">{pct != null ? `${pct}%` : '—'}</span>
                  </div>

                  {/* one muted meta line: client · PM · budget (+ a health word when at-risk) */}
                  <p className="mt-2 truncate text-xs text-slate-400 dark:text-slate-500" title={bacFull}>
                    {[p.clientName, p.pm?.name, p.costBaseline ? formatIdrShort(p.costBaseline.budgetAtCompletion) : null]
                      .filter(Boolean).join(' · ') || '—'}
                    {pill && pill[0] !== 'green' && <span className={`ml-1 font-medium ${pill[0] === 'red' ? 'text-red-500' : 'text-amber-500'}`}>· {pill[1]}</span>}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      ))}
    </div>
  );
}
