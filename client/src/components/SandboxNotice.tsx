import { Link } from 'react-router-dom';
import { Card } from './ui';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LanguageContext';

// Friendly explainer shown when a sandbox GUEST lands on an org-admin surface (Users, Members,
// Billing). A guest account is a personal sandbox — team/user management belongs to a real
// organization — so instead of a bare "you need the Admin role" wall we frame it positively and
// point at the org-signup path. Non-guest, non-admin roles fall back to the caller's plain message.
export default function SandboxNotice({ fallback }: { fallback: React.ReactNode }) {
  const { user } = useAuth();
  const { lang } = useLang();
  const id = lang === 'id';
  if (user?.role !== 'GUEST') return <>{fallback}</>;

  return (
    <Card>
      <div className="mx-auto max-w-lg py-8 text-center">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-brand-100 text-2xl dark:bg-brand-900/40">🧪</div>
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
          {id ? 'Ini akun Sandbox pribadi' : 'This is a personal Sandbox account'}
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-500 dark:text-slate-400">
          {id
            ? 'Anda bebas membuat project, jadwal, dan anggaran Anda sendiri di sini. Mengelola tim, mengundang user, dan langganan hanya tersedia untuk sebuah organisasi.'
            : 'You can freely build your own projects, schedules and budgets here. Managing a team, inviting users and billing are only available to an organization.'}
        </p>
        <Link
          to="/login?mode=org"
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700"
        >
          {id ? 'Daftarkan organisasi Anda' : 'Register your organization'} →
        </Link>
        <p className="mt-3 text-xs text-slate-400">
          {id
            ? 'Anda menjadi admin-nya setelah disetujui — lalu bisa mengundang tim & mengatur peran.'
            : 'You become its admin once approved — then you can invite your team & set roles.'}
        </p>
      </div>
    </Card>
  );
}
