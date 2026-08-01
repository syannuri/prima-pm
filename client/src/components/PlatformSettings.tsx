import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { Card, SectionTitle, Select, Spinner, Toggle } from './ui';
import { useToast } from './Toast';

interface AppSettings {
  guestSignupEnabled: boolean;
  googleLoginEnabled: boolean;
  orgSignupEnabled: boolean;
  googleConfigured: boolean;
  evmAutoCaptureEnabled: boolean;
  evmAutoCaptureWeekday: number;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// DEPLOYMENT-level (global) settings — the open sign-up toggles + weekly EVM auto-capture. These live
// on the single global AppSetting row and affect ALL tenants, so this is a PLATFORM (super-admin)
// card, gated by /admin/settings (requirePlatformAdmin). Not a per-tenant admin concern.
export default function PlatformSettings() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useQuery({
    queryKey: ['admin-settings'],
    queryFn: () => api.get<AppSettings>('/admin/settings'),
  });
  const save = useMutation({
    mutationFn: (patch: Partial<Omit<AppSettings, 'googleConfigured'>>) => api.patch<AppSettings>('/admin/settings', patch),
    onSuccess: (s) => {
      qc.setQueryData(['admin-settings'], s);
      qc.invalidateQueries({ queryKey: ['auth-providers'] });
      toast.success('Deployment settings updated');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not update settings'),
  });

  return (
    <Card>
      <SectionTitle sub="Deployment-wide — applies to ALL tenants. Changes take effect immediately, no restart.">Access &amp; sign-up</SectionTitle>
      {isLoading || !data ? (
        <div className="flex justify-center py-6"><Spinner /></div>
      ) : (
        <div className="mt-3 space-y-3">
          <SettingRow
            title="Guest sign-up"
            desc="Anyone can self-register with an email + password (any email works). Creates a sandboxed guest who only ever sees their own personal projects."
            checked={data.guestSignupEnabled}
            onChange={(v) => save.mutate({ guestSignupEnabled: v })}
            busy={save.isPending}
          />
          <SettingRow
            title="Organization sign-up"
            desc="Anyone can self-register a NEW organization (a corporate workspace) and become its admin. Turn on to open self-serve SaaS onboarding."
            checked={data.orgSignupEnabled}
            onChange={(v) => save.mutate({ orgSignupEnabled: v })}
            busy={save.isPending}
          />
          <SettingRow
            title="Google sign-in"
            desc={data.googleConfigured
              ? 'Show the “Continue with Google” button. Google users get the same sandboxed guest account.'
              : 'Disabled — set GOOGLE_CLIENT_ID on the server first, then this can be turned on.'}
            checked={data.googleLoginEnabled && data.googleConfigured}
            onChange={(v) => save.mutate({ googleLoginEnabled: v })}
            busy={save.isPending}
            disabled={!data.googleConfigured}
          />
          <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Weekly EVM auto-capture</p>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Automatically capture an EVM status snapshot for every active (non-draft) project once a week, so the EVM Trend builds up without a manual “Capture all”.</p>
              </div>
              <div className="shrink-0 pt-0.5">
                <Toggle checked={data.evmAutoCaptureEnabled} onChange={(v) => save.mutate({ evmAutoCaptureEnabled: v })} disabled={save.isPending} label="Weekly EVM auto-capture" />
              </div>
            </div>
            {data.evmAutoCaptureEnabled && (
              <label className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500 dark:border-slate-800/70 dark:text-slate-400">
                <span className="uppercase tracking-wide">Capture every</span>
                <Select
                  value={String(data.evmAutoCaptureWeekday)}
                  onChange={(e) => save.mutate({ evmAutoCaptureWeekday: Number(e.target.value) })}
                  disabled={save.isPending}
                  className="!w-40 !py-1.5"
                >
                  {WEEKDAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
                </Select>
              </label>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function SettingRow({ title, desc, checked, onChange, busy, disabled }: { title: string; desc: string; checked: boolean; onChange: (v: boolean) => void; busy?: boolean; disabled?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{title}</p>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{desc}</p>
      </div>
      <div className="shrink-0 pt-0.5">
        <Toggle checked={checked} onChange={onChange} disabled={disabled || busy} label={title} />
      </div>
    </div>
  );
}
