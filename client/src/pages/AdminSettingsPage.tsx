import { Card } from '../components/ui';
import { ConsoleHero } from '../components/platform/ConsoleUI';
import PlatformSettings from '../components/PlatformSettings';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LanguageContext';

// Platform (super-admin) console → Settings. Deployment-wide configuration (sign-up/access toggles,
// EVM auto-capture) that affects ALL tenants — moved here from the general Settings page so platform
// config lives in the console. Gated by isPlatformAdmin.
export default function AdminSettingsPage() {
  const { user } = useAuth();
  const { lang } = useLang();
  const id = lang === 'id';
  if (!user?.isPlatformAdmin) {
    return <Card><p className="py-6 text-center text-slate-500 dark:text-slate-400">{id ? 'Butuh hak Platform Admin.' : 'You need Platform Admin privilege.'}</p></Card>;
  }
  return (
    <div className="space-y-5">
      <ConsoleHero
        eyebrow={id ? 'Konsol Platform' : 'Platform Console'}
        title={id ? 'Pengaturan' : 'Settings'}
        subtitle={id ? 'Konfigurasi tingkat-deployment yang berlaku untuk semua organisasi.' : 'Deployment-wide configuration affecting every organization.'}
      />
      <PlatformSettings />
    </div>
  );
}
