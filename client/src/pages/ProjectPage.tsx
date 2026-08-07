import { useState, useEffect, useRef, Fragment } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Project } from '../api/types';
import { Badge, Card, Spinner } from '../components/ui';
import { useToast } from '../components/Toast';
import { ApiError } from '../api/client';
import { PROJECT_STATUS_BADGE } from '../lib/labels';
import { useIsMobile } from '../hooks/useIsMobile';
import CharterPanel from './panels/CharterPanel';
import CostPanel from './panels/CostPanel';
import TimesheetPanel from './panels/TimesheetPanel';
import ForecastPanel from './panels/ForecastPanel';
import RiskPanel from './panels/RiskPanel';
import IssuePanel from './panels/IssuePanel';
import StakeholderPanel from './panels/StakeholderPanel';
import RequirementsPanel from './panels/RequirementsPanel';
import ProcurementPanel from './panels/ProcurementPanel';
import RaidPanel from './panels/RaidPanel';
import SchedulePanel from './panels/SchedulePanel';
import ChangeRequestPanel from './panels/ChangeRequestPanel';
import AuditPanel from './panels/AuditPanel';
import CloseoutPanel from './panels/CloseoutPanel';
import UatPanel from './panels/UatPanel';
import KickoffPanel from './panels/KickoffPanel';
import EvmTrendPanel from './panels/EvmTrendPanel';
import EditProjectModal from '../components/EditProjectModal';
import CloseProjectModal from '../components/CloseProjectModal';
import LifecycleActions from '../components/LifecycleActions';
import ActivationReviewModal from '../components/ActivationReviewModal';
import EvmHealth from '../components/EvmHealth';
import ProjectOverview from '../components/ProjectOverview';
import MoreMenu, { MenuItem, MenuHeader, MenuGroupHeader, MenuDivider } from '../components/MoreMenu';
import AgilePanel from './panels/AgilePanel';
import { useAuth } from '../context/AuthContext';
import { canGovernProject } from '../lib/perms';
import { useLang } from '../context/LanguageContext';
import { DELIVERY_APPROACH_BADGE, DELIVERY_APPROACH_LABEL } from '../lib/labels';

type Tab = 'Overview' | 'Charter' | 'Kick-Off' | 'Stakeholders' | 'Requirements' | 'Agile' | 'Cost' | 'Procurement' | 'Timesheet' | 'Health' | 'Forecast' | 'EVM Trend' | 'Risk' | 'RAID' | 'Issues' | 'UAT' | 'Schedule' | 'Change Req' | 'Closeout' | 'Audit';

// Tabs hidden on phones (kept on tablet/desktop). Data-entry / governance surfaces that don't suit
// a small screen; excluded from the tab bar and never resolved as the active tab on mobile.
const MOBILE_HIDDEN: Tab[] = ['Timesheet', 'Change Req'];

export default function ProjectPage() {
  const { projectId = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  // Deep-link from the ACTIVATION_READY notification / PMO queue: ?review=activation opens the
  // activation review card (governors only). Read once on mount.
  const [reviewOpen, setReviewOpen] = useState(searchParams.get('review') === 'activation');
  const closeReview = () => {
    setReviewOpen(false);
    if (searchParams.get('review')) { searchParams.delete('review'); setSearchParams(searchParams, { replace: true }); }
  };
  const toast = useToast();
  const { user } = useAuth();
  // Deep-link support: an external link (e.g. the dashboard "Ready to close" panel) can open a
  // specific tab via ?tab=<TabId>. It seeds the initial tab; once the user clicks a tab, that
  // local choice takes over. Validated against the project's actual tab list below.
  const requestedTab = searchParams.get('tab') as Tab | null;
  const [tab, setTab] = useState<Tab | null>(null);
  const isMobile = useIsMobile();
  // Anchor at the top of the tab strip — selecting a tab scrolls it up so the freshly-loaded
  // panel is in view (the project header/alerts above can push content below the fold).
  const tabsAnchorRef = useRef<HTMLDivElement>(null);
  // "Jump to" (More menu) — switch tab and optionally deep-link to a section anchor within it.
  const [jump, setJump] = useState<string | null>(null);
  const goto = (t: Tab, sectionId?: string) => { setTab(t); setJump(sectionId ?? null); };
  useEffect(() => {
    if (!jump) return;
    const raf = requestAnimationFrame(() => {
      document.getElementById(jump)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setJump(null);
    });
    return () => cancelAnimationFrame(raf);
  }, [jump, tab]);
  // Auto-scroll on a plain tab click is intentionally DISABLED (user preference) — clicking a tab
  // no longer jumps the page to the tab strip; the view stays put. The "Jump to" deep-link (above)
  // still scrolls to its target section, since that's an explicit navigation.
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null);
  const { lang } = useLang();
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

  // Governance rights: ADMIN/PMO on corporate projects, or the guest owner of a personal one.
  const canEdit = canGovernProject(user, project);
  const chartered = project.status !== 'DRAFT';
  const isAgile = project.deliveryApproach === 'AGILE' || project.deliveryApproach === 'HYBRID';
  // Agile tab for agile/hybrid; the predictive Schedule (WBS/Gantt) is hidden for pure
  // Agile (its scheduling lives in sprints/board) but kept for predictive & hybrid.
  const showSchedule = project.deliveryApproach !== 'AGILE';
  const tabs: Tab[] = ([
    // Graphic Overview — a visual EVM/health cockpit and the default landing on every device:
    // a bento dashboard on the web, a charts-first home on phones. DRAFT projects have no EVM
    // yet, so skip it there.
    ...(chartered ? (['Overview'] as Tab[]) : []),
    ...(showSchedule ? (['Schedule'] as Tab[]) : []),
    ...(isAgile ? (['Agile'] as Tab[]) : []),
    'Cost', 'Procurement', 'Timesheet', 'Health', 'Forecast', 'EVM Trend', 'Risk', 'RAID', 'Issues', 'Change Req',
    'Charter', 'Stakeholders', 'Requirements', 'UAT', 'Closeout', 'Audit',
    // Timesheet & Change Req are data-entry/governance tabs kept to desktop/tablet — hidden on
    // phones to keep the two-level tab bar lean (they're still fully reachable on a wide screen).
  ] as Tab[]).filter((t) => !(isMobile && MOBILE_HIDDEN.includes(t)));
  // Fresh (DRAFT) projects land on Charter — commit it to unlock the rest. Once chartered,
  // every device lands on the graphic Overview (the project home); the first working tab
  // (Schedule/Agile/Cost) is only the fallback for the mobile-hidden-tab guard below.
  const landingTab: Tab = chartered ? (showSchedule ? 'Schedule' : isAgile ? 'Agile' : 'Cost') : 'Charter';
  const chosenTab: Tab =
    tab ?? (requestedTab && tabs.includes(requestedTab) ? requestedTab
      : chartered ? 'Overview'
      : landingTab);
  // The mobile-hidden tabs (Timesheet/Change Req) never resolve on a phone — whether reached via a
  // ?tab= deep link, a resize, or a jump (e.g. the CR banner) — so the panel can't show behind a
  // hidden tab. (Overview now resolves on desktop too — it's an available tab there.)
  const activeTab: Tab =
    isMobile && MOBILE_HIDDEN.includes(chosenTab) ? landingTab
    : chosenTab;

  return (
    <div className="space-y-1.5">
      <div>
        {/* Header leads straight with the project name — the in-page breadcrumb link and the
            project-code chip were dropped to keep the top tight and lift the tab bar up. The
            top-bar (and browser back) already carry the "back to projects" affordance. */}
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="min-w-0 break-words text-xl font-bold text-slate-800 dark:text-slate-100 sm:text-2xl">{project.name}</h1>
          <span className="flex items-center gap-2">
            <Badge color={PROJECT_STATUS_BADGE[project.status] ?? 'slate'} solid>{project.status}</Badge>
            <Badge color={DELIVERY_APPROACH_BADGE[project.deliveryApproach]}>{DELIVERY_APPROACH_LABEL[project.deliveryApproach]}</Badge>
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {/* Primary stage action stays prominent; secondary actions tuck into "⋯ More". */}
            <LifecycleActions project={project} onReview={() => setReviewOpen(true)} />
            <CloseProjectModal project={project} />
            {/* "⋯ More" (edit + exports + jump-to) is desktop-only; phones keep the header lean. */}
            {!isMobile && (
            <MoreMenu title={project.name}>
              {canEdit && <MenuHeader>{lang === 'id' ? 'Aksi' : 'Actions'}</MenuHeader>}
              {canEdit && <MenuItem icon="✏️" onClick={() => setEditOpen(true)}>{lang === 'id' ? 'Ubah detail' : 'Edit details'}</MenuItem>}
              {/* Exports hidden on phones — download/print is a desktop task. */}
              {chartered && !isMobile && <MenuItem icon="⬇️" disabled={exporting !== null} onClick={() => exportReport('excel')}>{exporting === 'excel' ? 'Exporting…' : 'Download Excel'}</MenuItem>}
              {chartered && !isMobile && <MenuItem icon="⬇️" disabled={exporting !== null} onClick={() => exportReport('pdf')}>{exporting === 'pdf' ? 'Exporting…' : 'Download PDF'}</MenuItem>}
              {/* Jump to — deep-link to any tab (and to sections within Schedule), grouped by
                  management domain. Handy on phones where the two-level tab bar scrolls. */}
              {canEdit && <MenuDivider />}
              <MenuHeader>{lang === 'id' ? 'Lompat ke' : 'Jump to'}</MenuHeader>
              {TAB_GROUPS.map((g) => {
                const gTabs = g.tabs.filter((t) => tabs.includes(t));
                if (!gTabs.length) return null;
                return (
                  <Fragment key={g.label}>
                    <MenuGroupHeader>{lang === 'id' ? (GROUP_LABEL_ID[g.label] ?? g.label) : g.label}</MenuGroupHeader>
                    {gTabs.map((t) => (
                      <Fragment key={t}>
                        {/* The Schedule tab is surfaced as "Timeline" in this Jump-to menu (the on-page
                            tab label stays "Schedule"); its two sub-sections are Gantt Chart and the
                            Manpower ↔ Schedule Sync. Critical Path stays on the page, just not listed here. */}
                        <MenuItem icon={TAB_ICONS[t]} active={t === activeTab} onClick={() => goto(t)}>{t === 'Schedule' ? 'Timeline' : t}</MenuItem>
                        {t === 'Schedule' && (
                          <>
                            <MenuItem indent onClick={() => goto('Schedule', 'section-wbs')}>↳ Gantt Chart</MenuItem>
                            <MenuItem indent onClick={() => goto('Schedule', 'section-manpower')}>↳ Manpower ↔ Schedule Sync</MenuItem>
                          </>
                        )}
                      </Fragment>
                    ))}
                  </Fragment>
                );
              })}
            </MoreMenu>
            )}
          </div>
          {/* Controlled modal, mounted outside the menu so it survives the menu closing. */}
          <EditProjectModal project={project} open={editOpen} onOpenChange={setEditOpen} />
        </div>
        {/* Header carries NO inline status/alert banners — project status shows as the badge
            beside the name, and every notification (budget/risk/schedule signals, pending change
            requests, activation-ready) lives only in the top-bar notification bell. The meta rows
            (EVM health strip + PM/Client/Margin/Next-step chips) are hidden too; that info stays in
            Monitoring → Health and the graphic Overview tab. */}
      </div>

      {/* Activation review modal still mounts — it's opened from the bell's "activation ready"
          deep-link (?review=activation) or the lifecycle action, not an inline banner. */}
      {reviewOpen && canEdit && <ActivationReviewModal projectId={projectId} onClose={closeReview} />}

      <div ref={tabsAnchorRef} className="scroll-mt-4" />
      {/* Tab strip + active panel share one wrapper with a viewport-tall min-height (desktop only)
          so a short panel still gives <main> enough scroll room to pin the whole tab strip to the
          top on a tab switch — the align-to-top scroll then lands consistently for every tab,
          not just the tall ones (WBS/Gantt). 3.5rem = the 56px top bar. */}
      <div className="space-y-2 sm:min-h-[calc(100vh-3.5rem)]">
      <GroupedTabs tabs={tabs} activeTab={activeTab} changeCount={changeCount} isMobile={isMobile} onSelect={(t) => setTab(t)} />

      {!chartered && activeTab !== 'Charter' && activeTab !== 'Audit' && activeTab !== 'Agile' && activeTab !== 'Issues' && activeTab !== 'Closeout' && activeTab !== 'Stakeholders' && activeTab !== 'Requirements' && activeTab !== 'RAID' && (
        <Card>
          <p className="text-center text-amber-600">
            Commit the Project Charter first to unlock {activeTab} Management.
          </p>
        </Card>
      )}

      {activeTab === 'Overview' && chartered && <ProjectOverview projectId={projectId} onJump={(t) => setTab(t as Tab)} />}
      {activeTab === 'Charter' && <CharterPanel projectId={projectId} approach={project.deliveryApproach} sponsor={project.sponsor} costBaselineIdr={project.costBaselineIdr} personalOwnerId={project.personalOwnerId ?? null} assignedPmId={project.pmUserId} assignedPmName={project.pm?.name ?? null} />}
      {activeTab === 'Agile' && <AgilePanel projectId={projectId} approach={project.deliveryApproach} chartered={chartered} />}
      {activeTab === 'Cost' && chartered && <CostPanel projectId={projectId} onNavigateTab={(t) => goto(t as Tab)} />}
      {activeTab === 'Procurement' && chartered && <ProcurementPanel projectId={projectId} />}
      {activeTab === 'Stakeholders' && <StakeholderPanel projectId={projectId} />}
      {activeTab === 'Requirements' && <RequirementsPanel projectId={projectId} />}
      {activeTab === 'Timesheet' && chartered && <TimesheetPanel projectId={projectId} />}
      {activeTab === 'Health' && chartered && (
        <EvmHealth
          base={`/projects/${projectId}`}
          sub={project.deliveryApproach === 'HYBRID' ? 'Blended EVM — WBS schedule + agile story points' : project.deliveryApproach === 'AGILE' ? 'Agile EVM — earned value from story points' : 'Earned Value Management — schedule + cost + progress'}
          countLabel={project.deliveryApproach === 'AGILE' ? 'backlog items' : project.deliveryApproach === 'HYBRID' ? 'work items' : 'leaf tasks'}
          progressHint={project.deliveryApproach === 'PREDICTIVE' ? 'Physical % complete — WBS-weighted roll-up (budget- or duration-weighted)' : 'Physical % complete — methodology roll-up'}
        />
      )}
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
    </div>
  );
}

// Grouping of the project tabs so the bar isn't a wall of 14 buttons. Grouped by MANAGEMENT
// DOMAIN / knowledge area (what you manage), NOT by PMBOK process group. Rationale: an
// artifact tab like Schedule or Cost holds BOTH its baseline AND its actuals/tracking, so it
// can't sit cleanly in a "Planning" vs "Executing" phase — those tabs are used across the
// whole lifecycle. The phase/lifecycle sequence lives instead in the project STATUS
// (Draft→Chartered→In-progress→Closed) and the Next-steps guide. The underlying Tab ids are
// kept stable (e.g. 'Charter', 'Closeout') so deep-links and server-emitted next-step cues
// still resolve. A single-tab group renders as a plain tab; a multi-tab group shows a sub-row.
const TAB_GROUPS: { label: string; tabs: Tab[] }[] = [
  { label: 'Overview', tabs: ['Overview'] },
  { label: 'Initiating', tabs: ['Charter', 'Stakeholders', 'Requirements'] },
  { label: 'Schedule & WBS', tabs: ['Schedule', 'Agile'] },
  { label: 'Cost', tabs: ['Cost', 'Procurement'] },
  { label: 'Risk', tabs: ['Risk', 'RAID', 'Issues'] },
  { label: 'Quality', tabs: ['UAT'] },
  // Change Req = Integrated Change Control, a Monitoring & Controlling activity → grouped
  // with the monitoring/control views (Forecast, EVM Trend) rather than with Quality.
  { label: 'Monitoring', tabs: ['Health', 'Timesheet', 'Change Req', 'Forecast', 'EVM Trend'] },
  { label: 'Closing', tabs: ['Closeout'] },
  // Label only; the Tab id stays 'Audit' so the change-count badge (keyed on g.tabs[0]) works.
  { label: 'Governance & Audit', tabs: ['Audit'] },
];

// Emoji glyphs for the "Jump to" list — quick visual anchors, consistent with the app's
// existing emoji usage (no icon-lib dependency).
const TAB_ICONS: Record<Tab, string> = {
  Overview: '📊',
  Charter: '📋', 'Kick-Off': '🎯', Stakeholders: '👥', Requirements: '📑',
  Schedule: '📆', Agile: '🏃', Cost: '💰', Procurement: '🛒', Risk: '⚠️',
  Timesheet: '⏱️', RAID: '🗂️', Issues: '🐞', UAT: '✅', 'Change Req': '🔁',
  Health: '🩺', Forecast: '📈', 'EVM Trend': '📊', Closeout: '🏁', Audit: '🔎',
};

// Indonesian names for the domain-group headers (menu follows the language toggle;
// the English `label` above stays the id used by the level-1 tab bar).
const GROUP_LABEL_ID: Record<string, string> = {
  Overview: 'Ringkasan',
  Initiating: 'Inisiasi',
  'Schedule & WBS': 'Jadwal & WBS',
  Cost: 'Biaya',
  Risk: 'Risiko',
  Quality: 'Kualitas',
  Monitoring: 'Pemantauan',
  Closing: 'Penutupan',
  'Governance & Audit': 'Tata Kelola & Audit',
};

// Domain groups hidden from the phone tab bar (still reachable on desktop) — keeps the
// mobile strip focused on the core delivery domains.
const MOBILE_HIDDEN_GROUPS = new Set(['Quality', 'Closing', 'Governance & Audit']);
// Individual sub-tabs hidden on phones (kept on desktop).
const MOBILE_HIDDEN_TABS = new Set<Tab>(['Kick-Off']);

function GroupedTabs({ tabs, activeTab, changeCount, isMobile, onSelect }: { tabs: Tab[]; activeTab: Tab; changeCount: number; isMobile: boolean; onSelect: (t: Tab) => void }) {
  const groups = TAB_GROUPS
    .map((g) => ({ label: g.label, tabs: g.tabs.filter((t) => tabs.includes(t) && !(isMobile && MOBILE_HIDDEN_TABS.has(t))) }))
    .filter((g) => g.tabs.length > 0 && !(isMobile && MOBILE_HIDDEN_GROUPS.has(g.label)));
  // The active group is whichever contains the active tab — its sub-tabs get the second row.
  const activeGroup = groups.find((g) => g.tabs.includes(activeTab)) ?? groups[0];

  // Auto-scroll the selected domain group fully into view within its scroll strip (horizontal
  // only — never nudges the page) so a tab off the right/left edge slides into sight and lands
  // with a little breathing room instead of half-clipped. Runs on selection + when groups change.
  const listRef = useRef<HTMLDivElement>(null);
  const activeBtnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const box = listRef.current, el = activeBtnRef.current;
    if (!box || !el) return;
    const b = box.getBoundingClientRect(), e = el.getBoundingClientRect();
    const pad = 24;
    if (e.left < b.left + pad) box.scrollBy({ left: e.left - b.left - pad, behavior: 'smooth' });
    else if (e.right > b.right - pad) box.scrollBy({ left: e.right - b.right + pad, behavior: 'smooth' });
  }, [activeGroup?.label, groups.length]);

  const AuditBadge = () => (changeCount > 0 ? (
    <span className="grid h-5 min-w-[20px] place-items-center rounded-full bg-slate-200 px-1 text-xs font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">{changeCount}</span>
  ) : null);

  // Level 1: domain groups (underline tabs). Bold black type like the project title; the active
  // tab keeps its brand underline + tint as the accent, but the text stays black for legibility.
  const groupBtn = (active: boolean) =>
    `flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-t-lg border-b-2 px-4 py-2 text-sm font-bold transition ${
      active
        ? 'border-blue-600 bg-blue-50 text-slate-800 dark:bg-blue-900/30 dark:text-white'
        : 'border-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-slate-800/60 dark:hover:text-white'
    }`;
  // Level 2: sub-tabs of the active group (pills), always visible so the group's contents are
  // discoverable. Bold black; the active sub-tab is the filled brand pill (white text on brand).
  const subBtn = (active: boolean) =>
    `flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-bold transition ${
      active
        ? 'bg-blue-600 text-white shadow-sm'
        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-white'
    }`;

  return (
    // Freeze the whole tab strip at the top of the scroll area so it stays visible while the
    // panel content scrolls under it. Negative insets let the opaque bg span edge-to-edge under
    // <main>'s padding; a hairline + shadow separate it from the scrolling content beneath.
    // z-[31] beats the WBS/Gantt sticky header (frozen th is !z-30) so, when the WBS box scrolls
    // up under the strip, its column header tucks *behind* the opaque strip instead of painting
    // over the tabs. Kept below the mobile drawer (z-40).
    <div className="sticky -top-6 z-[31] -mx-4 border-b border-slate-200 bg-slate-50 px-4 pb-1 pt-6 shadow-sm dark:border-slate-800 dark:bg-slate-950 sm:-mx-6 sm:px-6">
      {/* Level 1 — domain groups. Scrolls horizontally on narrow screens; a right-edge fade
          hints there are more groups to swipe to (hidden on md+ where they all fit). */}
      <div className="relative">
        <div ref={listRef} role="tablist" aria-label="Project sections" className="flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800">
          {groups.map((g) => {
            const active = g.tabs.includes(activeTab);
            const single = g.tabs.length === 1;
            return (
              // Every group shows its domain label (e.g. "Schedule"); the stable
              // aria-label lets tests/AT target the group by that label. role="tab" +
              // aria-selected expose the active section to assistive tech (not colour alone).
              <button key={g.label} ref={active ? activeBtnRef : undefined} role="tab" aria-selected={active} aria-label={g.label} data-tour={g.label === 'Schedule & WBS' ? 'tab-schedule' : g.label === 'Monitoring' ? 'tab-monitoring' : undefined} onClick={() => onSelect(active ? activeTab : g.tabs[0])} className={groupBtn(active)}>
                {g.label}{single && g.tabs[0] === 'Audit' && <AuditBadge />}
              </button>
            );
          })}
        </div>
        <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-slate-50 to-transparent dark:from-slate-950 md:hidden" />
      </div>
      {/* Level 2 — sub-tabs of the active group (only when the group has more than one) */}
      {activeGroup.tabs.length > 1 && (
        <div role="tablist" aria-label={`${activeGroup.label} views`} className="mt-2 flex flex-wrap items-center gap-1.5">
          {activeGroup.tabs.map((t) => (
            <button key={t} role="tab" aria-selected={activeTab === t} onClick={() => onSelect(t)} className={subBtn(activeTab === t)}>
              {t}{t === 'Audit' && <AuditBadge />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
