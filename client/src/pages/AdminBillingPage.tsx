import { useMutation, useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { TenantPlan } from '../api/types';
import { Badge, Button, Card, SectionTitle, Spinner } from '../components/ui';
import { useToast } from '../components/Toast';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LanguageContext';
import { formatDate } from '../lib/format';

interface BillingStatus {
  plan: TenantPlan;
  subscriptionStatus?: string | null;
  renewsAt?: string | null;
  endsAt?: string | null;
  hasSubscription: boolean;
  billingEnabled: boolean;
}

// The self-serve plans and what each unlocks. Numbers mirror server PLAN_LIMITS (plans.ts) — keep
// them in sync when tuning quotas. ENTERPRISE is "unlimited" (null limits on the server).
const PLANS: { plan: Exclude<TenantPlan, 'FREE'>; priceHint: string; perks: { en: string; id: string }[] }[] = [
  {
    plan: 'PRO',
    priceHint: '',
    perks: [
      { en: 'Up to 50 active projects', id: 'Hingga 50 proyek aktif' },
      { en: 'Up to 50 members', id: 'Hingga 50 anggota' },
      { en: '20 GB attachment storage', id: 'Penyimpanan lampiran 20 GB' },
    ],
  },
  {
    plan: 'ENTERPRISE',
    priceHint: '',
    perks: [
      { en: 'Unlimited projects', id: 'Proyek tanpa batas' },
      { en: 'Unlimited members', id: 'Anggota tanpa batas' },
      { en: 'Unlimited storage', id: 'Penyimpanan tanpa batas' },
    ],
  },
];

// Billing & plan management for the active tenant (ADMIN-only). Shows the current plan and lets an
// admin start a Lemon Squeezy checkout to upgrade, or open the customer portal to manage/cancel.
export default function AdminBillingPage() {
  const { user, tenants, activeTenantId } = useAuth();
  const { lang } = useLang();
  const id = lang === 'id';
  const toast = useToast();
  const activeTenant = tenants.find((t) => t.id === activeTenantId);

  const { data: status, isLoading } = useQuery({
    queryKey: ['billing-status'],
    queryFn: () => api.get<BillingStatus>('/billing/status'),
    enabled: user?.role === 'ADMIN',
  });

  const checkout = useMutation({
    mutationFn: (plan: 'PRO' | 'ENTERPRISE') => api.post<{ url: string }>('/billing/checkout', { plan }),
    onSuccess: (r) => { window.location.href = r.url; },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to start checkout'),
  });
  const portal = useMutation({
    mutationFn: () => api.get<{ url: string }>('/billing/portal'),
    onSuccess: (r) => { window.location.href = r.url; },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to open portal'),
  });

  if (user?.role !== 'ADMIN') {
    return <Card><p className="py-6 text-center text-slate-500 dark:text-slate-400">{id ? 'Butuh peran Admin untuk mengelola langganan.' : 'You need the Admin role to manage billing.'}</p></Card>;
  }

  const currentPlan = status?.plan ?? activeTenant?.plan ?? 'FREE';
  const planColor = currentPlan === 'ENTERPRISE' ? 'violet' : currentPlan === 'PRO' ? 'green' : 'slate';

  return (
    <div className="space-y-5">
      <SectionTitle sub={activeTenant ? (id ? `Paket & tagihan untuk “${activeTenant.name}”` : `Plan & billing for “${activeTenant.name}”`) : (id ? 'Paket & tagihan organisasi aktif' : 'Plan & billing for the active tenant')}>
        {id ? 'Tagihan' : 'Billing'}
      </SectionTitle>

      {isLoading ? (
        <div className="flex justify-center py-10"><Spinner /></div>
      ) : (
        <>
          {/* Current plan summary */}
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">{id ? 'Paket saat ini' : 'Current plan'}</p>
                <div className="mt-1 flex items-center gap-2">
                  <Badge color={planColor} solid>{currentPlan}</Badge>
                  {status?.subscriptionStatus && <span className="text-sm text-slate-500 dark:text-slate-400">{status.subscriptionStatus}</span>}
                </div>
                {status?.renewsAt && currentPlan !== 'FREE' && !status.endsAt && (
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{id ? 'Diperpanjang' : 'Renews'} {formatDate(status.renewsAt)}</p>
                )}
                {status?.endsAt && (
                  <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">{id ? 'Berakhir' : 'Ends'} {formatDate(status.endsAt)} — {id ? 'akses berlanjut sampai tanggal itu' : 'access continues until then'}</p>
                )}
              </div>
              {status?.hasSubscription && (
                <Button variant="secondary" onClick={() => portal.mutate()} disabled={portal.isPending}>
                  {portal.isPending ? (id ? 'Membuka…' : 'Opening…') : (id ? 'Kelola langganan' : 'Manage subscription')}
                </Button>
              )}
            </div>
          </Card>

          {!status?.billingEnabled && (
            <Card>
              <p className="text-sm text-amber-600 dark:text-amber-400">
                {id ? 'Pembayaran belum dikonfigurasi pada deployment ini. Hubungi admin platform untuk mengaktifkannya.' : 'Billing is not configured on this deployment yet. Contact the platform admin to enable it.'}
              </p>
            </Card>
          )}

          {/* Upgrade options */}
          <div className="grid gap-4 sm:grid-cols-2">
            {PLANS.map(({ plan, perks }) => {
              const isCurrent = currentPlan === plan;
              return (
                <Card key={plan} className={isCurrent ? 'ring-2 ring-brand-400' : ''}>
                  <div className="flex items-center justify-between">
                    <h3 className="font-brand text-lg font-bold text-slate-800 dark:text-slate-100">{plan}</h3>
                    {isCurrent && <Badge color="green">{id ? 'Aktif' : 'Current'}</Badge>}
                  </div>
                  <ul className="mt-3 space-y-1.5 text-sm text-slate-600 dark:text-slate-300">
                    {perks.map((p) => (
                      <li key={p.en} className="flex items-start gap-2">
                        <span className="mt-0.5 text-brand-500">✓</span>
                        <span>{id ? p.id : p.en}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-4">
                    {isCurrent ? (
                      <Button variant="secondary" disabled className="w-full">{id ? 'Paket Anda' : 'Your plan'}</Button>
                    ) : (
                      <Button
                        onClick={() => checkout.mutate(plan)}
                        disabled={!status?.billingEnabled || checkout.isPending}
                        className="w-full"
                      >
                        {checkout.isPending ? (id ? 'Mengarahkan…' : 'Redirecting…') : (id ? `Tingkatkan ke ${plan}` : `Upgrade to ${plan}`)}
                      </Button>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>

          <p className="text-center text-xs text-slate-400 dark:text-slate-500">
            {id ? 'Pembayaran diproses aman oleh Lemon Squeezy (termasuk pajak & faktur). Anda dapat membatalkan kapan saja.' : 'Payments are securely handled by Lemon Squeezy (tax & invoicing included). Cancel anytime.'}
          </p>
        </>
      )}
    </div>
  );
}
