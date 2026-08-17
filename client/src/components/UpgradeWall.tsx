import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LanguageContext';

// Full-screen block shown once a trial has ended (the server 402-walls every app route). The billing
// page stays reachable so the admin can upgrade; logout is always available. Personal (guest) tenants
// are never expired server-side, so this never shows for them.
export default function UpgradeWall() {
  const { workspace, logout } = useAuth();
  const { lang } = useLang();
  const { pathname } = useLocation();
  const id = lang === 'id';
  if (!workspace?.trialExpired) return null;
  if (pathname.startsWith('/admin/billing')) return null; // let them reach checkout to upgrade
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-2xl dark:bg-slate-800">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-2xl dark:bg-amber-900/40" aria-hidden>⏳</div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-white">{id ? 'Masa uji coba telah berakhir' : 'Your trial has ended'}</h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          {id
            ? 'Tingkatkan ke paket berbayar untuk kembali mengakses workspace Anda. Data Anda aman dan menunggu.'
            : 'Upgrade to a paid plan to regain access to your workspace. Your data is safe and waiting.'}
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <Link to="/admin/billing" className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700">
            {id ? 'Lihat paket & tingkatkan' : 'View plans & upgrade'}
          </Link>
          <button onClick={logout} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
            {id ? 'Keluar' : 'Log out'}
          </button>
        </div>
      </div>
    </div>
  );
}
