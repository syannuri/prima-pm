import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LanguageContext';

// Slim countdown strip shown during an ACTIVE trial (hidden once it expires — the UpgradeWall takes
// over then). Turns urgent (amber) in the final week.
export default function TrialBanner() {
  const { workspace } = useAuth();
  const { lang } = useLang();
  const id = lang === 'id';
  if (!workspace || workspace.plan !== 'TRIAL' || workspace.trialExpired || workspace.trialDaysLeft == null) return null;
  const days = workspace.trialDaysLeft;
  const urgent = days <= 7;
  return (
    <div className={`flex items-center justify-center gap-3 px-4 py-1.5 text-center text-sm font-medium ${urgent ? 'bg-amber-500 text-amber-950' : 'bg-indigo-600 text-indigo-50'}`}>
      <span aria-hidden>{urgent ? '⏳' : '✨'}</span>
      <span>
        {id
          ? <>Masa uji coba tersisa <strong>{days} hari</strong>. Tingkatkan untuk terus memakai PRIMA.</>
          : <><strong>{days} day{days === 1 ? '' : 's'}</strong> left in your trial. Upgrade to keep using PRIMA.</>}
      </span>
      <Link
        to="/admin/billing"
        className={`shrink-0 rounded-full px-3 py-0.5 text-xs font-semibold ${urgent ? 'bg-amber-950/90 text-amber-50 hover:bg-amber-950' : 'bg-white/15 text-white hover:bg-white/25'}`}
      >
        {id ? 'Tingkatkan' : 'Upgrade'}
      </Link>
    </div>
  );
}
