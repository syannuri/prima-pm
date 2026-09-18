import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { Button, Field, Input, Toggle } from '../components/ui';
import { SettingsGroup, SettingsRow } from '../components/settingsUi';
import { useTheme } from '../context/ThemeContext';
import { useLang, type Lang } from '../context/LanguageContext';
import { useToast } from '../components/Toast';
import { useAuth } from '../context/AuthContext';
import ApiKeysCard from '../components/ApiKeysCard';
import WebhooksCard from '../components/WebhooksCard';
import AutomationsCard from '../components/AutomationsCard';
import ApprovalWorkflowsCard from '../components/ApprovalWorkflowsCard';
import IntakeScoringCard from '../components/IntakeScoringCard';
import AiNarrativeCard from '../components/AiNarrativeCard';
import AiActionOutcomesCard from '../components/AiActionOutcomesCard';
import AiMemoryCard from '../components/AiMemoryCard';
import AiFeedbackInboxCard from '../components/AiFeedbackInboxCard';
import AiUsageCard from '../components/AiUsageCard';
import AiJudgeTrendCard from '../components/AiJudgeTrendCard';
import WorkspaceAddressCard from '../components/WorkspaceAddressCard';
import CalendarFeedCard from '../components/CalendarFeedCard';
import CustomFieldsAdminCard from '../components/CustomFieldsAdminCard';
import CustomRolesAdminCard from '../components/CustomRolesAdminCard';
import { fieldState, isPasswordValid, pwHasLen, pwHasMix, Rule } from '../lib/formValidation';

// Two-initial monogram for the profile chip (mirrors AvatarMenu).
const initials = (name?: string) =>
  (name || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?';

// Category glyphs (inline SVG, currentColor) — same visual family as the Sidebar icons.
const NAV_ICON: Record<SectionKey, string> = {
  general: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6', // sliders
  account: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8', // person
  workspace: 'M3 21h18M6 21V7l6-4 6 4v14M10 9h.01M14 9h.01M10 13h.01M14 13h.01M10 17h.01M14 17h.01', // building
  developer: 'M16 18l6-6-6-6M8 6l-6 6 6 6', // code brackets
  governance: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4', // shield-check
  ai: 'M12 2l2.2 6.6L21 11l-6.8 2.4L12 20l-2.2-6.6L3 11l6.8-2.4zM19 3v3M20.5 4.5h-3', // sparkle
};

type SectionKey = 'general' | 'account' | 'workspace' | 'developer' | 'governance' | 'ai';
interface SectionDef { key: SectionKey; label: string; desc: string; adminOnly?: boolean; render: () => ReactNode }

const SECTIONS: SectionDef[] = [
  { key: 'general', label: 'General', desc: 'How Prismatix looks and speaks on this device.', render: () => <AppearanceCard /> },
  { key: 'account', label: 'Account', desc: 'Your password and personal calendar feed.', render: () => <><SecurityCard /><CalendarFeedCard /></> },
  { key: 'workspace', label: 'Workspace', desc: "Your organization's address and data model.", adminOnly: true, render: () => <><WorkspaceAddressCard /><CustomFieldsAdminCard /><CustomRolesAdminCard /></> },
  { key: 'developer', label: 'Developer', desc: 'Workspace-wide API access, webhooks and no-code automations.', adminOnly: true, render: () => <><ApiKeysCard /><WebhooksCard /><AutomationsCard /></> },
  { key: 'governance', label: 'Governance', desc: 'Approval routing for change requests and proposal intake scoring.', adminOnly: true, render: () => <><ApprovalWorkflowsCard /><IntakeScoringCard /></> },
  { key: 'ai', label: 'AI', desc: 'Anett assistant — narrative, actions, memory, feedback and usage.', adminOnly: true, render: () => <><AiNarrativeCard /><AiActionOutcomesCard /><AiMemoryCard /><AiFeedbackInboxCard /><AiJudgeTrendCard /><AiUsageCard /></> },
];

const navIdle =
  'text-slate-600 ring-1 ring-transparent hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100';
// Active item: brand wash + tinted glyph/label + a crisp left accent bar + hairline ring (matches
// the Sidebar's "you are here" language, in the light content surface).
const navActive =
  'bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-200 shadow-[inset_2px_0_0_theme(colors.brand.500)] dark:bg-brand-500/15 dark:text-brand-200 dark:ring-brand-400/30';

export default function SettingsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  // Platform (deployment-wide) settings live in the super-admin console → /admin/settings.
  const sections = useMemo(() => SECTIONS.filter((s) => !s.adminOnly || isAdmin), [isAdmin]);
  const [params, setParams] = useSearchParams();
  const requested = params.get('section');
  const active = sections.find((s) => s.key === requested) ?? sections[0];
  const contentRef = useRef<HTMLDivElement>(null);

  const go = (key: SectionKey) => {
    const p = new URLSearchParams(params);
    p.set('section', key);
    setParams(p, { replace: true }); // bookmarkable, doesn't spam history
    // Reveal the panel only if it's actually off-screen (mobile, after a tall previous section) —
    // 'nearest' is a no-op on desktop, so switching never yanks the profile header out of view.
    requestAnimationFrame(() => contentRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  };
  // Roving arrow-key navigation across the tablist (both axes, since the rail is vertical on desktop
  // and horizontal on mobile). Wraps around; moves focus + selection together.
  const onKey = (e: React.KeyboardEvent) => {
    const i = sections.findIndex((s) => s.key === active.key);
    let n = i;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') n = (i + 1) % sections.length;
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') n = (i - 1 + sections.length) % sections.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = sections.length - 1;
    else return;
    e.preventDefault();
    go(sections[n].key);
    document.getElementById(`settings-tab-${sections[n].key}`)?.focus();
  };

  return (
    <div className="pb-12">
      {/* Profile header — monogram + identity + role chip. */}
      <header className="mb-6 flex items-center gap-4 border-b border-slate-200 pb-5 dark:border-slate-800">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-brand-600 text-base font-bold text-white shadow-sm">
          {initials(user?.name)}
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-xl font-bold text-slate-800 dark:text-slate-100">{user?.name || 'Settings'}</h1>
            {user?.role && (
              <span className="shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-700 ring-1 ring-inset ring-brand-200 dark:bg-brand-500/15 dark:text-brand-200 dark:ring-brand-400/30">
                {user.role}
              </span>
            )}
          </div>
          <p className="truncate text-sm text-slate-500 dark:text-slate-400">{user?.email}</p>
        </div>
      </header>

      <div className="lg:grid lg:grid-cols-[13.5rem_minmax(0,1fr)] lg:gap-8">
        {/* Category rail — a vertical tablist on desktop; a horizontal scroll of pills on mobile. */}
        <nav
          role="tablist"
          aria-label="Settings sections"
          aria-orientation="vertical"
          onKeyDown={onKey}
          className="mb-5 flex gap-1 overflow-x-auto pb-1 lg:sticky lg:top-4 lg:mb-0 lg:flex-col lg:self-start lg:overflow-visible lg:pb-0 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {sections.map((s) => {
            const on = s.key === active.key;
            return (
              <button
                key={s.key}
                id={`settings-tab-${s.key}`}
                role="tab"
                type="button"
                aria-selected={on}
                aria-current={on ? 'page' : undefined}
                tabIndex={on ? 0 : -1}
                onClick={() => go(s.key)}
                className={`flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition lg:w-full ${on ? navActive : navIdle}`}
              >
                <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={NAV_ICON[s.key]} /></svg>
                <span className="whitespace-nowrap">{s.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Active category — its header + cards. */}
        <div ref={contentRef} role="tabpanel" aria-label={active.label} className="min-w-0 scroll-mt-4">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">{active.label}</h2>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{active.desc}</p>
          </div>
          <div className="space-y-8">{active.render()}</div>
        </div>
      </div>
    </div>
  );
}

const LANGS: { value: Lang; label: string }[] = [
  { value: 'id', label: 'Indonesia' },
  { value: 'en', label: 'English' },
];

function AppearanceCard() {
  const { theme, toggle } = useTheme();
  const { lang, setLang } = useLang();
  const dark = theme === 'dark';
  return (
    <SettingsGroup title="Appearance" flush>
      <SettingsRow title="Dark mode" sub={dark ? 'On — easier on the eyes in low light.' : 'Off — using the light theme.'}>
        <Toggle checked={dark} onChange={() => toggle()} label="Toggle dark mode" />
      </SettingsRow>
      <SettingsRow title="Language" sub="Greeting & dates. Auto-detected from your browser.">
        <div className="inline-flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
          {LANGS.map((l) => (
            <button
              key={l.value}
              onClick={() => setLang(l.value)}
              aria-pressed={lang === l.value}
              className={`rounded-md px-3 py-1 text-sm font-medium transition ${
                lang === l.value
                  ? 'bg-white text-slate-800 shadow-sm dark:bg-slate-700 dark:text-white'
                  : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
      </SettingsRow>
    </SettingsGroup>
  );
}

function SecurityCard() {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState('');

  const reset = () => { setCurrent(''); setNext(''); setConfirm(''); setErr(''); };

  const submit = useMutation({
    mutationFn: () =>
      api.post('/auth/change-password', { currentPassword: current, newPassword: next }),
    onSuccess: () => {
      // The server revoked all other sessions and refreshed THIS session's httpOnly cookies,
      // so this tab keeps working with no client-side token handling; others are signed out.
      reset();
      toast.success('Password updated. Any other signed-in sessions have been logged out.');
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Could not change password'),
  });

  const nextOk = isPasswordValid(next);
  const confirmOk = confirm.length > 0 && confirm === next;
  const canSubmit = current.length > 0 && nextOk && confirmOk && !submit.isPending;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    if (next !== confirm) { setErr('New password and confirmation do not match'); return; }
    submit.mutate();
  };

  return (
    <SettingsGroup title="Password" sub="Use a unique password of 10+ characters with at least one letter and one number.">
      <form onSubmit={onSubmit} className="space-y-3">
        <Field label="Current password">
          <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required state={current ? 'valid' : undefined} />
        </Field>
        <Field label="New password">
          <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required state={fieldState(next, nextOk)} />
          {!!next && (
            <span className="mt-1 flex flex-col gap-0.5">
              <Rule ok={pwHasLen(next)}>At least 10 characters</Rule>
              <Rule ok={pwHasMix(next)}>A letter and a number</Rule>
            </span>
          )}
        </Field>
        <Field label="Confirm new password">
          <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required state={fieldState(confirm, confirmOk)} />
          {!!confirm && !confirmOk && <span className="mt-1 block text-xs text-red-500">Does not match the new password</span>}
        </Field>
        {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-300">{err}</p>}
        <div className="flex justify-end pt-1">
          <Button type="submit" disabled={!canSubmit}>
            {submit.isPending ? 'Saving…' : 'Update password'}
          </Button>
        </div>
      </form>
    </SettingsGroup>
  );
}
