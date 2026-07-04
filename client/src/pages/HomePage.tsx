import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useLang, type Lang } from '../context/LanguageContext';

/**
 * Public landing page — the front door shown to guests at `/` before the login screen.
 * Aurora-dark, bilingual (EN/ID via the shared LanguageContext), and deliberately light:
 * the aurora is pure CSS (transform-only drift, respects prefers-reduced-motion), sections
 * reveal on scroll via a tiny IntersectionObserver, and only ONE real screenshot is used
 * (the rest is aurora + typography) so it stays fast and a little magical.
 */

/* ------------------------------- copy (EN/ID) ------------------------------ */
type Group = { icon: string; name: string; items: [string, string][] };
type Content = {
  signin: string;
  hero: { badge: string; titlePre: string; titleAccent: string; sub: string; enter: string; explore: string };
  why: { eyebrow: string; body: string };
  what: { title: string; body: string };
  features: { title: string; sub: string; groups: Group[] };
  evm: { title: string; sub: string; items: [string, string][] };
  principles: { title: string; chips: string[] };
  community: { eyebrow: string; title: string; body: string };
  audience: { title: string; chips: string[] };
  cta: { title: string; enter: string; note: string };
  footer: { tagline: string; rights: string };
};

const ICON = {
  plan: 'M9 3 4 5v16l5-2 6 2 5-2V3l-5 2-6-2Zm0 0v16m6-14v16',
  track: 'M3 12h4l2 6 4-14 2 8h6',
  steer: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 6a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0-6v6m0 8v6m10-10h-6M8 12H2',
  see: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
};

const COPY: Record<Lang, Content> = {
  en: {
    signin: 'Sign in',
    hero: {
      badge: 'A gift to the project-management community',
      titlePre: 'Clarity in every ',
      titleAccent: 'project',
      sub: 'Prismatix turns scattered updates into Earned-Value truth — cost, schedule, risk and forecast in one calm, role-aware view. Built by practitioners, offered to the craft.',
      enter: 'Enter Prismatix',
      explore: 'Explore the craft',
    },
    why: {
      eyebrow: 'Why it exists',
      body: 'Most projects don’t fail loudly. They drift — a slipped week here, an overrun there, a risk nobody named — until the gap between the plan and the truth is too wide to close. Prismatix exists to surface that gap early, while it’s still small enough to fix.',
    },
    what: {
      title: 'One cockpit — from charter to closure',
      body: 'A full, PMBOK-aligned delivery platform with Earned Value at its heart. Plan the work, watch it earn value in real time, steer with forecasts and change control, and close with confidence — for predictive, agile and hybrid projects alike.',
    },
    features: {
      title: 'Everything a delivery needs, in one calm place',
      sub: 'Four movements of the same rhythm — plan it, track it, steer it, see it.',
      groups: [
        { icon: ICON.plan, name: 'Plan', items: [
          ['Project Charter', 'Goals, scope, sponsor and the delivery approach — committed to a baseline.'],
          ['WBS & Gantt', 'A work-breakdown tree with an interactive schedule and dependencies.'],
          ['Cost baseline', 'Direct + indirect + contingency roll up to a defensible BAC / PMB.'],
        ]},
        { icon: ICON.track, name: 'Track', items: [
          ['Earned Value', 'CPI / SPI, variances and % complete — the truth behind the status.'],
          ['Risk', 'Qualitative 5×5 heatmap and quantitative EMV feeding the reserve.'],
          ['Timesheets', 'Planned vs earned vs consumed man-days, with labour efficiency.'],
        ]},
        { icon: ICON.steer, name: 'Steer', items: [
          ['Change control', 'Raise, review and approve — an approved change opens the baseline.'],
          ['Forecast', 'EAC scenarios, a forecast finish date and a cost S-curve.'],
          ['Governance', 'Baseline lock and a closure gate keep scope honest end-to-end.'],
        ]},
        { icon: ICON.see, name: 'See', items: [
          ['Portfolio dashboard', 'Every project’s health, cost and schedule at a glance.'],
          ['Reports', 'One-click PDF and Excel for cost, risk, schedule and EVM.'],
          ['Role-aware access', 'PMO, PM, Finance, Risk and team each see exactly their view.'],
        ]},
      ],
    },
    evm: {
      title: 'The quiet language of Earned Value',
      sub: 'Four numbers that turn a status update into a decision.',
      items: [
        ['CPI', 'Cost efficiency — how much value you earn per unit spent.'],
        ['SPI', 'Schedule efficiency — how fast value is actually being earned.'],
        ['EAC', 'Estimate at completion — where today’s pace will land the budget.'],
        ['EMV', 'Expected monetary value — risk, priced, funding the reserve.'],
      ],
    },
    principles: {
      title: 'Built on principles, not features',
      chips: ['PMBOK-aligned', 'Earned Value everywhere', 'Secure by design', 'Dark-first, human UX'],
    },
    community: {
      eyebrow: 'For the community',
      title: 'Built by practitioners. Offered to the craft.',
      body: 'We built Prismatix for the people who carry a plan in their head and a dozen unknowns in their inbox. It began as our own tool — and grew into something we wanted to share with the community that taught us this craft. Wherever in the world you manage projects, we hope it helps you see clearly and sleep a little better.',
    },
    audience: {
      title: 'Made for the whole delivery team',
      chips: ['PMO', 'Project Managers', 'Finance', 'Risk Officers', 'Delivery teams'],
    },
    cta: {
      title: 'Ready to see where your projects really stand?',
      enter: 'Enter Prismatix',
      note: 'Accounts are provisioned by your administrator.',
    },
    footer: {
      tagline: 'A contribution to the global project-management community.',
      rights: '© 2026 Xapiens. All rights reserved.',
    },
  },
  id: {
    signin: 'Masuk',
    hero: {
      badge: 'Sebuah hadiah untuk komunitas manajemen proyek',
      titlePre: 'Kejernihan di setiap ',
      titleAccent: 'proyek',
      sub: 'Prismatix mengubah kabar yang tercerai-berai menjadi kebenaran Earned Value — biaya, jadwal, risiko, dan proyeksi dalam satu tampilan yang tenang dan sadar-peran. Dibuat oleh praktisi, dipersembahkan untuk keahliannya.',
      enter: 'Masuk Prismatix',
      explore: 'Telusuri',
    },
    why: {
      eyebrow: 'Kenapa ini ada',
      body: 'Kebanyakan proyek tidak gagal dengan keras. Mereka melenceng pelan — mundur seminggu di sini, boros sedikit di sana, risiko yang tak sempat disebut — sampai jarak antara rencana dan kenyataan terlalu lebar untuk ditutup. Prismatix hadir untuk memunculkan jarak itu lebih dini, selagi masih cukup kecil untuk diperbaiki.',
    },
    what: {
      title: 'Satu kokpit — dari charter hingga penutupan',
      body: 'Platform pengiriman proyek yang selaras PMBOK dengan Earned Value sebagai jantungnya. Rencanakan pekerjaan, lihat ia menghasilkan nilai secara real-time, kemudikan dengan proyeksi dan kontrol perubahan, lalu tutup dengan yakin — untuk proyek predictive, agile, maupun hybrid.',
    },
    features: {
      title: 'Semua kebutuhan pengiriman, dalam satu tempat yang tenang',
      sub: 'Empat gerakan dalam satu irama — rencanakan, lacak, kemudikan, lihat.',
      groups: [
        { icon: ICON.plan, name: 'Rencanakan', items: [
          ['Project Charter', 'Tujuan, ruang lingkup, sponsor dan pendekatan pengiriman — dikunci ke baseline.'],
          ['WBS & Gantt', 'Pohon rincian kerja dengan jadwal interaktif dan dependensi.'],
          ['Cost baseline', 'Direct + indirect + contingency menyusun BAC / PMB yang kokoh.'],
        ]},
        { icon: ICON.track, name: 'Lacak', items: [
          ['Earned Value', 'CPI / SPI, varians, dan % selesai — kebenaran di balik status.'],
          ['Risiko', 'Heatmap 5×5 kualitatif dan EMV kuantitatif yang mengisi cadangan.'],
          ['Timesheet', 'Man-days rencana vs earned vs terpakai, lengkap dengan efisiensi.'],
        ]},
        { icon: ICON.steer, name: 'Kemudikan', items: [
          ['Kontrol perubahan', 'Ajukan, tinjau, setujui — perubahan yang disetujui membuka baseline.'],
          ['Forecast', 'Skenario EAC, perkiraan tanggal selesai, dan kurva-S biaya.'],
          ['Tata kelola', 'Kunci baseline dan gerbang penutupan menjaga scope tetap jujur.'],
        ]},
        { icon: ICON.see, name: 'Lihat', items: [
          ['Dashboard portfolio', 'Kesehatan, biaya, dan jadwal tiap proyek dalam sekejap.'],
          ['Laporan', 'PDF & Excel sekali klik untuk biaya, risiko, jadwal, dan EVM.'],
          ['Akses sadar-peran', 'PMO, PM, Finance, Risk, dan tim melihat tepat porsinya.'],
        ]},
      ],
    },
    evm: {
      title: 'Bahasa senyap Earned Value',
      sub: 'Empat angka yang mengubah laporan status menjadi keputusan.',
      items: [
        ['CPI', 'Efisiensi biaya — berapa nilai yang didapat per unit yang dibelanjakan.'],
        ['SPI', 'Efisiensi jadwal — seberapa cepat nilai benar-benar dihasilkan.'],
        ['EAC', 'Perkiraan saat selesai — ke mana laju hari ini membawa anggaran.'],
        ['EMV', 'Nilai moneter harapan — risiko yang dihargai, mengisi cadangan.'],
      ],
    },
    principles: {
      title: 'Dibangun atas prinsip, bukan sekadar fitur',
      chips: ['Selaras PMBOK', 'Earned Value di mana-mana', 'Aman by-design', 'Dark-first, UX manusiawi'],
    },
    community: {
      eyebrow: 'Untuk komunitas',
      title: 'Dibuat oleh praktisi. Dipersembahkan untuk keahliannya.',
      body: 'Kami membuat Prismatix untuk mereka yang menyimpan rencana di kepala dan selusin ketidakpastian di kotak masuk. Ia bermula sebagai alat kami sendiri — lalu tumbuh menjadi sesuatu yang ingin kami bagikan kepada komunitas yang mengajarkan keahlian ini. Di mana pun Anda mengelola proyek di dunia, semoga ia membantu Anda melihat lebih jernih dan tidur sedikit lebih nyenyak.',
    },
    audience: {
      title: 'Untuk seluruh tim pengiriman',
      chips: ['PMO', 'Project Manager', 'Finance', 'Risk Officer', 'Tim pelaksana'],
    },
    cta: {
      title: 'Siap melihat di mana proyek Anda sebenarnya berada?',
      enter: 'Masuk Prismatix',
      note: 'Akun disediakan oleh administrator Anda.',
    },
    footer: {
      tagline: 'Sebuah kontribusi untuk komunitas manajemen proyek dunia.',
      rights: '© 2026 Xapiens. Semua hak dilindungi.',
    },
  },
};

/* ------------------------------- primitives -------------------------------- */
function Wordmark({ small = false, bare = false }: { small?: boolean; bare?: boolean }) {
  // `bare` = just the wordmark (no box, no corner dot) — a clean, larger logo.
  if (bare) {
    return <span className="font-brand text-2xl font-bold tracking-wide text-white">PRISMATIX</span>;
  }
  return (
    <span
      className={`relative inline-block border-white font-brand font-bold tracking-wide text-white ${
        small ? 'border-[2.5px] px-2 py-0.5 text-sm' : 'border-4 px-4 py-2 text-2xl'
      }`}
    >
      PRISMATIX
      <span
        className={`absolute rounded-full bg-white ${small ? 'right-1 top-1 h-1.5 w-1.5' : 'right-1.5 top-1.5 h-2 w-2'}`}
      />
    </span>
  );
}

// Dumb wrapper: it just carries the `reveal` class. The page-level scroll handler (see
// HomePage) imperatively adds `.in` when the element scrolls into view — driven by the
// scroll container's own 'scroll' event, which is far more reliable across environments
// than an IntersectionObserver rooted in a custom scroll container.
function Reveal({ children, className = '', delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  return (
    <div className={`reveal ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

const SectionTitle = ({ eyebrow, children }: { eyebrow?: string; children: ReactNode }) => (
  <>
    {eyebrow && <div className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-brand-400/90">{eyebrow}</div>}
    <h2 className="text-3xl font-bold leading-tight text-white sm:text-4xl">{children}</h2>
  </>
);

/* --------------------------------- page ------------------------------------ */
export default function HomePage() {
  const { lang, setLang } = useLang();
  const t = COPY[lang];
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const reduced = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  // The app shell can lock the outer (window) scroll, so the landing page owns its own
  // scroll container (aurora + header stay position:fixed to the viewport regardless).
  // One handler on the container both condenses the header AND reveals sections as they
  // enter view — the container's 'scroll' event is reliable everywhere.
  useEffect(() => {
    if (!scroller) return;
    const onScroll = () => {
      setScrolled(scroller.scrollTop > 48);
      const trigger = scroller.getBoundingClientRect().top + scroller.clientHeight * 0.9;
      scroller.querySelectorAll('.reveal:not(.in)').forEach((el) => {
        if (el.getBoundingClientRect().top < trigger) el.classList.add('in');
      });
    };
    onScroll(); // reveal whatever is above the fold on load
    scroller.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    // Safety net: if anything about layout timing is off, don't leave content hidden.
    const t = window.setTimeout(onScroll, 400);
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      window.clearTimeout(t);
    };
  }, [scroller]);

  const explore = () =>
    document.getElementById('features')?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });

  return (
    <div ref={setScroller} className="relative isolate h-screen overflow-y-auto overflow-x-clip bg-[#05070e] text-slate-200 antialiased">
      <style>{`
        @keyframes pmx-drift1 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(26px,-30px)} }
        @keyframes pmx-drift2 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(-30px,24px)} }
        @keyframes pmx-drift3 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(22px,28px)} }
        @keyframes pmx-drift4 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(-20px,-22px)} }
        @keyframes pmx-float  { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-10px)} }
        .reveal { opacity:0; transform:translateY(18px); transition:opacity .7s cubic-bezier(.2,.7,.2,1), transform .7s cubic-bezier(.2,.7,.2,1); }
        .reveal.in { opacity:1; transform:none; }
        .pmx-orb { will-change: transform; }

        /* --- aurora borealis: soft light curtains that sway (transform-only) --- */
        .pmx-aur { position:absolute; left:-25%; right:-25%; top:-16%; height:80%; border-radius:50%;
          filter:blur(56px); opacity:.42; mix-blend-mode:screen; will-change:transform,opacity; }
        .pmx-aur1 { background:linear-gradient(180deg, transparent 4%, rgba(74,222,128,.5) 32%, rgba(34,197,94,.22) 58%, transparent 84%);
          animation:pmx-aurA 18s ease-in-out infinite; }
        .pmx-aur2 { background:linear-gradient(180deg, transparent 8%, rgba(134,239,172,.42) 36%, rgba(16,185,129,.2) 62%, transparent 90%);
          animation:pmx-aurB 24s ease-in-out infinite; }
        @keyframes pmx-aurA { 0%,100%{transform:translateX(-7%) skewX(-9deg) scaleY(1)}   50%{transform:translateX(7%) skewX(7deg) scaleY(1.18)} }
        @keyframes pmx-aurB { 0%,100%{transform:translateX(6%) skewX(8deg) scaleY(1.12)}  50%{transform:translateX(-6%) skewX(-8deg) scaleY(.92)} }

        .pmx-nebula { position:absolute; inset:-20%; filter:blur(22px); opacity:.6; will-change:transform;
          background:linear-gradient(115deg, transparent 36%, rgba(139,92,246,.09) 48%, rgba(96,165,250,.08) 55%, transparent 68%);
          animation:pmx-neb 42s ease-in-out infinite; }
        @keyframes pmx-neb { 0%,100%{transform:translateX(0) rotate(0)} 50%{transform:translateX(34px) rotate(2deg)} }

        html { scroll-behavior: smooth; }
        @media (prefers-reduced-motion: reduce){
          .pmx-orb, .pmx-float, .pmx-nebula, .pmx-aur { animation:none !important; }
          .reveal { opacity:1 !important; transform:none !important; transition:none !important; }
          html { scroll-behavior:auto; }
        }
      `}</style>

      {/* ---------- aurora borealis backdrop (fixed, pure CSS) ---------- */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        {/* faint diagonal nebula band for depth */}
        <div className="pmx-nebula" />
        {/* aurora borealis — two waving green light curtains near the top */}
        <div className="pmx-aur pmx-aur1" />
        <div className="pmx-aur pmx-aur2" />
        {/* one faint deep glow low-down for depth */}
        <div className="pmx-orb absolute -bottom-48 left-1/3 h-[34rem] w-[34rem] rounded-full bg-indigo-800/20 blur-[130px]" style={{ animation: 'pmx-drift2 26s ease-in-out infinite' }} />
        {/* subtle top sheen + deeper midnight vignette */}
        <div className="absolute inset-0 bg-[radial-gradient(70%_50%_at_50%_-8%,rgba(139,92,246,0.10),transparent_60%),radial-gradient(130%_100%_at_50%_115%,rgba(0,0,0,0.88),transparent_55%)]" />
      </div>

      {/* ---------- top nav ---------- */}
      <header className={`fixed inset-x-0 top-0 z-30 transition-colors duration-300 ${scrolled ? 'border-b border-white/10 bg-[#05070e]/80 backdrop-blur-xl' : ''}`}>
        <div className="mx-auto flex h-20 max-w-6xl items-center justify-between px-5 sm:px-8">
          <Wordmark bare />
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="inline-flex rounded-lg bg-white/5 p-0.5 ring-1 ring-white/10">
              {(['en', 'id'] as Lang[]).map((l) => (
                <button
                  key={l}
                  onClick={() => setLang(l)}
                  aria-pressed={lang === l}
                  className={`rounded-md px-2.5 py-1 text-xs font-semibold uppercase transition ${lang === l ? 'bg-white/90 text-slate-900' : 'text-slate-300 hover:text-white'}`}
                >
                  {l}
                </button>
              ))}
            </div>
            <Link
              to="/login"
              className="rounded-lg bg-gradient-to-r from-brand-500 to-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-brand-500/30 transition hover:from-brand-600 hover:to-brand-700"
            >
              {t.signin}
            </Link>
          </div>
        </div>
      </header>

      <main className="relative z-10">
        {/* ---------- hero ---------- */}
        <section className="mx-auto flex max-w-6xl flex-col items-center px-5 pb-16 pt-32 text-center sm:px-8 sm:pt-40">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-medium text-slate-300 backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-400" /> {t.hero.badge}
          </div>
          <h1 className="max-w-3xl text-5xl font-bold leading-[1.08] tracking-tight text-white sm:text-6xl">
            {t.hero.titlePre}
            <span className="bg-gradient-to-r from-brand-400 via-amber-400 to-indigo-400 bg-clip-text text-transparent">{t.hero.titleAccent}</span>.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-slate-300">{t.hero.sub}</p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/login"
              className="rounded-xl bg-gradient-to-r from-brand-500 to-brand-600 px-7 py-3 text-base font-semibold text-white shadow-xl shadow-brand-500/30 transition hover:-translate-y-0.5 hover:from-brand-600 hover:to-brand-700"
            >
              {t.hero.enter}
            </Link>
            <button
              onClick={explore}
              className="rounded-xl border border-white/15 bg-white/5 px-7 py-3 text-base font-semibold text-slate-100 backdrop-blur transition hover:bg-white/10"
            >
              {t.hero.explore} ↓
            </button>
          </div>

          {/* the one real screenshot — proof, framed with an aurora glow */}
          <div className="pmx-float relative mt-16 w-full max-w-5xl" style={{ animation: reduced ? undefined : 'pmx-float 8s ease-in-out infinite' }}>
            <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-gradient-to-tr from-brand-600/30 via-violet-600/20 to-indigo-600/30 blur-3xl" />
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/60 shadow-2xl ring-1 ring-white/10">
              <div className="flex items-center gap-1.5 border-b border-white/10 bg-white/5 px-4 py-2.5">
                <span className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
                <span className="h-2.5 w-2.5 rounded-full bg-green-400/70" />
              </div>
              <img
                src="/hero-dashboard.png"
                width={1600}
                height={900}
                loading="eager"
                decoding="async"
                alt="Prismatix portfolio dashboard — EVM health, status distribution and resource load"
                className="block w-full"
              />
            </div>
          </div>
        </section>

        {/* ---------- why ---------- */}
        <section className="mx-auto max-w-3xl px-5 py-24 text-center sm:px-8">
          <Reveal>
            <div className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-brand-400/90">{t.why.eyebrow}</div>
            <p className="text-2xl font-medium leading-relaxed text-slate-200 sm:text-[1.7rem]">{t.why.body}</p>
          </Reveal>
        </section>

        {/* ---------- what it is ---------- */}
        <section className="mx-auto max-w-4xl px-5 py-8 text-center sm:px-8">
          <Reveal>
            <SectionTitle>{t.what.title}</SectionTitle>
            <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-slate-300">{t.what.body}</p>
          </Reveal>
        </section>

        {/* ---------- feature constellation ---------- */}
        <section id="features" className="mx-auto max-w-6xl scroll-mt-24 px-5 py-24 sm:px-8">
          <Reveal className="mb-14 text-center">
            <SectionTitle>{t.features.title}</SectionTitle>
            <p className="mx-auto mt-4 max-w-2xl text-slate-400">{t.features.sub}</p>
          </Reveal>
          <div className="grid gap-6 md:grid-cols-2">
            {t.features.groups.map((g, gi) => (
              <Reveal key={g.name} delay={(gi % 2) * 90}>
                <div className="group h-full rounded-2xl border border-white/10 bg-white/[0.04] p-7 backdrop-blur-sm transition duration-300 hover:-translate-y-1 hover:border-white/20 hover:bg-white/[0.06]">
                  <div className="mb-5 flex items-center gap-3">
                    <span className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-brand-500/25 to-indigo-500/25 ring-1 ring-white/10">
                      <svg viewBox="0 0 24 24" className="h-5 w-5 text-brand-300" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={g.icon} /></svg>
                    </span>
                    <h3 className="text-lg font-semibold text-white">{g.name}</h3>
                  </div>
                  <ul className="space-y-4">
                    {g.items.map(([name, desc]) => (
                      <li key={name} className="flex gap-3">
                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400/80" />
                        <div>
                          <div className="font-medium text-slate-100">{name}</div>
                          <div className="text-sm leading-relaxed text-slate-400">{desc}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ---------- the language of EVM (abstract, glowing chips) ---------- */}
        <section className="mx-auto max-w-6xl px-5 py-24 sm:px-8">
          <Reveal className="mb-12 text-center">
            <SectionTitle>{t.evm.title}</SectionTitle>
            <p className="mx-auto mt-4 max-w-2xl text-slate-400">{t.evm.sub}</p>
          </Reveal>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {t.evm.items.map(([k, desc], i) => (
              <Reveal key={k} delay={i * 70}>
                <div className="relative h-full overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] p-6">
                  <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-brand-500/20 blur-2xl" />
                  <div className="font-brand text-4xl font-bold text-white">{k}</div>
                  <p className="mt-3 text-sm leading-relaxed text-slate-400">{desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ---------- principles strip ---------- */}
        <section className="mx-auto max-w-5xl px-5 py-10 sm:px-8">
          <Reveal>
            <div className="flex flex-wrap items-center justify-center gap-3">
              {t.principles.chips.map((c) => (
                <span key={c} className="rounded-full border border-white/10 bg-white/5 px-5 py-2 text-sm font-medium text-slate-200 backdrop-blur">
                  {c}
                </span>
              ))}
            </div>
          </Reveal>
        </section>

        {/* ---------- community (heart) ---------- */}
        <section className="mx-auto max-w-3xl px-5 py-24 text-center sm:px-8">
          <Reveal>
            <div className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-brand-400/90">{t.community.eyebrow}</div>
            <h2 className="text-3xl font-bold leading-tight text-white sm:text-4xl">{t.community.title}</h2>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-slate-300">{t.community.body}</p>
            <div className="mt-10">
              <div className="mb-4 text-sm font-medium text-slate-400">{t.audience.title}</div>
              <div className="flex flex-wrap items-center justify-center gap-2.5">
                {t.audience.chips.map((c) => (
                  <span key={c} className="rounded-lg bg-white/5 px-3.5 py-1.5 text-sm text-slate-200 ring-1 ring-white/10">{c}</span>
                ))}
              </div>
            </div>
          </Reveal>
        </section>

        {/* ---------- final CTA (bookend) ---------- */}
        <section className="mx-auto max-w-4xl px-5 py-24 text-center sm:px-8">
          <Reveal>
            <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.04] px-6 py-16 backdrop-blur-sm">
              <div className="pointer-events-none absolute -inset-10 -z-10 bg-gradient-to-tr from-brand-600/25 via-violet-600/20 to-indigo-600/25 blur-3xl" />
              <h2 className="mx-auto max-w-2xl text-3xl font-bold leading-tight text-white sm:text-4xl">{t.cta.title}</h2>
              <div className="mt-8">
                <Link
                  to="/login"
                  className="inline-block rounded-xl bg-gradient-to-r from-brand-500 to-brand-600 px-8 py-3.5 text-base font-semibold text-white shadow-xl shadow-brand-500/30 transition hover:-translate-y-0.5 hover:from-brand-600 hover:to-brand-700"
                >
                  {t.cta.enter}
                </Link>
              </div>
              <p className="mt-4 text-sm text-slate-400">{t.cta.note}</p>
            </div>
          </Reveal>
        </section>

        {/* ---------- footer ---------- */}
        <footer className="border-t border-white/10">
          <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-5 py-10 text-center sm:flex-row sm:justify-between sm:px-8 sm:text-left">
            <div className="flex items-center gap-3">
              <Wordmark small />
            </div>
            <p className="text-sm text-slate-400">{t.footer.tagline}</p>
            <p className="text-xs text-slate-500">{t.footer.rights}</p>
          </div>
        </footer>
      </main>
    </div>
  );
}
