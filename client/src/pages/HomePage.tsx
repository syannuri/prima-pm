import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useLang, type Lang } from '../context/LanguageContext';

// Real product screenshots for the "A look inside" showcase (served from client/public).
// These are tight, pre-cropped close-ups of one feature each (WBS+Gantt / EVM KPIs /
// Kanban board) so they read clearly when shown full-width — see the showcase section.
const SHOWCASE = ['/shot-gantt-zoom.png', '/shot-evm-zoom.png', '/shot-agile-zoom.png'];

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
  showcase: { title: string; sub: string; labels: string[] };
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
      badge: 'Contribute to the Project Management Community',
      titlePre: 'Clarity in every ',
      titleAccent: 'project',
      sub: 'Prismatix brings cost, schedule, risk, and forecast into one clear view — so you always know where a project really stands. Built by practitioners, shared with the community.',
      enter: 'Enter Prismatix',
      explore: 'See how it works',
    },
    why: {
      eyebrow: 'Why it exists',
      body: 'Projects rarely fail all at once. They drift: a week slips, a cost creeps, a risk goes unflagged — and by the time it reaches the status report, the gap is expensive to close. Prismatix surfaces that drift early, while it’s still small.',
    },
    what: {
      title: 'Everything from charter to closure, in one place',
      body: 'A complete, PMBOK-aligned delivery platform with Earned Value at its core. Plan the work, watch it earn value in real time, steer with forecasts and change control, and close with confidence — across predictive, agile, and hybrid projects.',
    },
    features: {
      title: 'Everything a delivery team needs, in one place',
      sub: 'Four steps, one rhythm: plan it, track it, steer it, see it.',
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
    showcase: {
      title: 'A look inside',
      sub: 'A few of the surfaces you work in every day.',
      labels: ['Interactive WBS & Gantt', 'Earned-Value (EVM) health', 'Agile board — drag & drop'],
    },
    evm: {
      title: 'Earned Value, in four numbers',
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
      title: 'Built by practitioners. Shared with the community.',
      body: 'We built Prismatix for people who keep a plan in their head and a dozen open questions in their inbox. It started as our own tool, then grew into something worth sharing with the community that taught us the craft. Wherever you manage projects, we hope it helps you see more clearly and worry a little less.',
    },
    audience: {
      title: 'Made for the whole delivery team',
      chips: ['PMO', 'Project Managers', 'Finance', 'Risk Officers', 'Delivery teams'],
    },
    cta: {
      title: 'See exactly where your projects stand.',
      enter: 'Enter Prismatix',
      note: 'Accounts are provisioned by your administrator.',
    },
    footer: {
      tagline: 'A contribution to the global project-management community.',
      rights: '© 2026 PRISMATIX. All rights reserved.',
    },
  },
  id: {
    signin: 'Masuk',
    hero: {
      badge: 'Kontribusi untuk komunitas manajemen proyek',
      titlePre: 'Kejelasan di setiap ',
      titleAccent: 'proyek',
      sub: 'Prismatix menyatukan biaya, jadwal, risiko, dan proyeksi dalam satu tampilan yang jernih — jadi Anda selalu tahu posisi proyek yang sebenarnya. Dibuat oleh praktisi, dibagikan untuk komunitas.',
      enter: 'Masuk Prismatix',
      explore: 'Lihat cara kerjanya',
    },
    why: {
      eyebrow: 'Alasan kami hadir',
      body: 'Proyek jarang gagal sekaligus. Ia melenceng perlahan: telat seminggu, biaya merayap naik, risiko luput dicatat — dan saat akhirnya muncul di laporan status, jaraknya sudah mahal untuk ditutup. Prismatix menyingkap penyimpangan itu sejak dini, selagi masih kecil.',
    },
    what: {
      title: 'Semua dari charter hingga penutupan, dalam satu tempat',
      body: 'Platform pelaksanaan proyek yang selaras dengan PMBOK, dengan Earned Value sebagai intinya. Susun rencana, pantau nilai yang dihasilkan secara real-time, kendalikan lewat proyeksi dan kontrol perubahan, lalu tutup dengan percaya diri — untuk proyek predictive, agile, maupun hybrid.',
    },
    features: {
      title: 'Semua yang dibutuhkan tim proyek, dalam satu tempat',
      sub: 'Empat langkah, satu irama: rencanakan, pantau, kendalikan, amati.',
      groups: [
        { icon: ICON.plan, name: 'Rencanakan', items: [
          ['Project Charter', 'Tujuan, ruang lingkup, sponsor, dan pendekatan pelaksanaan — dikunci sebagai baseline.'],
          ['WBS & Gantt', 'Struktur rincian kerja (WBS) dengan jadwal interaktif dan dependensi antar-tugas.'],
          ['Cost baseline', 'Biaya langsung + tidak langsung + cadangan menyatu menjadi BAC / PMB yang kuat.'],
        ]},
        { icon: ICON.track, name: 'Pantau', items: [
          ['Earned Value', 'CPI / SPI, varians, dan persentase penyelesaian — fakta di balik status.'],
          ['Risiko', 'Heatmap 5×5 kualitatif dan EMV kuantitatif yang mengisi cadangan kontingensi.'],
          ['Timesheet', 'Man-day rencana vs yang dihasilkan vs yang terpakai, lengkap dengan efisiensinya.'],
        ]},
        { icon: ICON.steer, name: 'Kendalikan', items: [
          ['Kontrol perubahan', 'Ajukan, tinjau, setujui — perubahan yang disetujui membuka kembali baseline.'],
          ['Forecast', 'Skenario EAC, perkiraan tanggal selesai, dan kurva-S biaya.'],
          ['Tata kelola', 'Penguncian baseline dan gerbang penutupan menjaga cakupan tetap terkendali.'],
        ]},
        { icon: ICON.see, name: 'Amati', items: [
          ['Dashboard portofolio', 'Kesehatan, biaya, dan jadwal setiap proyek dalam sekejap.'],
          ['Laporan', 'PDF & Excel sekali klik untuk biaya, risiko, jadwal, dan EVM.'],
          ['Akses sesuai peran', 'PMO, PM, Finance, Risk, dan tim melihat tepat sesuai porsinya.'],
        ]},
      ],
    },
    showcase: {
      title: 'Lihat lebih dekat',
      sub: 'Beberapa tampilan yang Anda gunakan setiap hari.',
      labels: ['WBS & Gantt interaktif', 'Kesehatan Earned Value (EVM)', 'Papan Agile — seret & lepas'],
    },
    evm: {
      title: 'Earned Value dalam empat angka',
      sub: 'Empat angka yang mengubah laporan status menjadi keputusan.',
      items: [
        ['CPI', 'Efisiensi biaya — seberapa besar nilai yang diperoleh per rupiah yang dikeluarkan.'],
        ['SPI', 'Efisiensi jadwal — seberapa cepat nilai benar-benar dihasilkan.'],
        ['EAC', 'Estimasi biaya akhir — ke mana laju hari ini akan membawa anggaran.'],
        ['EMV', 'Nilai moneter harapan — risiko yang dikuantifikasi untuk mengisi cadangan.'],
      ],
    },
    principles: {
      title: 'Dibangun di atas prinsip, bukan sekadar fitur',
      chips: ['Selaras PMBOK', 'Earned Value di mana-mana', 'Aman sejak dirancang', 'Desain gelap yang manusiawi'],
    },
    community: {
      eyebrow: 'Untuk komunitas',
      title: 'Dibuat oleh praktisi. Dibagikan untuk komunitas.',
      body: 'Kami membuat Prismatix untuk mereka yang menyimpan rencana di kepala dan selusin pertanyaan terbuka di kotak masuk. Awalnya alat kami sendiri, lalu tumbuh menjadi sesuatu yang layak dibagikan kepada komunitas yang mengajarkan kami profesi ini. Di mana pun Anda mengelola proyek, semoga ia membantu Anda melihat lebih jernih dan sedikit lebih tenang.',
    },
    audience: {
      title: 'Untuk seluruh tim proyek',
      chips: ['PMO', 'Project Manager', 'Finance', 'Risk Officer', 'Tim pelaksana'],
    },
    cta: {
      title: 'Lihat dengan pasti posisi proyek Anda.',
      enter: 'Masuk Prismatix',
      note: 'Akun disediakan oleh administrator Anda.',
    },
    footer: {
      tagline: 'Kontribusi untuk komunitas manajemen proyek dunia.',
      rights: '© 2026 PRISMATIX. Seluruh hak cipta dilindungi.',
    },
  },
};

/* ------------------------------- primitives -------------------------------- */
function Wordmark({ small = false, bare = false }: { small?: boolean; bare?: boolean }) {
  // `bare` = the wordmark with no box, but keeping the signature white accent dot.
  if (bare) {
    return (
      <span className="relative inline-block font-brand text-2xl font-bold tracking-wide text-white">
        PRISMATIX
        <span className="absolute -right-2 top-0 h-2 w-2 rounded-full bg-white" />
      </span>
    );
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
  // Parallax targets: the aurora backdrop drifts slower than the page (depth), and the hero
  // copy gently fades + lifts as it scrolls away. Both are transform/opacity only.
  const auroraRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);
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
      const y = scroller.scrollTop;
      setScrolled(y > 48);
      const trigger = scroller.getBoundingClientRect().top + scroller.clientHeight * 0.9;
      scroller.querySelectorAll('.reveal:not(.in)').forEach((el) => {
        if (el.getBoundingClientRect().top < trigger) el.classList.add('in');
      });
      // Parallax + hero fade (skipped entirely for reduced-motion users).
      if (!reduced) {
        if (auroraRef.current) auroraRef.current.style.transform = `translate3d(0, ${y * 0.3}px, 0)`;
        if (heroRef.current) {
          const p = Math.min(1, y / 520);
          heroRef.current.style.opacity = String(1 - p * 0.85);
          heroRef.current.style.transform = `translate3d(0, ${y * 0.18}px, 0)`;
        }
      }
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
  }, [scroller, reduced]);

  const explore = () =>
    document.getElementById('features')?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });

  return (
    <div ref={setScroller} className="home-scroll relative isolate h-screen overflow-y-auto overflow-x-clip bg-[#05070e] text-slate-200 antialiased">
      <style>{`
        @keyframes pmx-float  { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-10px)} }

        /* Scroll reveal: fade + rise, now easing out of a soft blur (C). Directional and
           zoom variants (A) just change the starting transform; .reveal.in wins on entry. */
        .reveal { opacity:0; transform:translateY(18px); filter:blur(6px);
          transition:opacity .7s cubic-bezier(.2,.7,.2,1), transform .7s cubic-bezier(.2,.7,.2,1), filter .7s cubic-bezier(.2,.7,.2,1); }
        .reveal.in { opacity:1; transform:none; filter:none; }
        .reveal-left  { transform:translateX(-26px); }
        .reveal-right { transform:translateX(26px); }
        .reveal-zoom  { transform:scale(.955); }

        /* Accent underline draws in under the gradient word once the hero mounts (F). */
        .pmx-accent { position:relative; }
        .pmx-accent::after { content:''; position:absolute; left:0; right:0; bottom:-.08em; height:2px; border-radius:2px;
          background:linear-gradient(to right,#38bdf8,#818cf8,#a78bfa);
          transform:scaleX(0); transform-origin:left;
          animation:pmx-underline .8s cubic-bezier(.2,.7,.2,1) .45s forwards; }
        @keyframes pmx-underline { to { transform:scaleX(1); } }

        /* --- a few twinkling stars over the aurora photo (kept sparse on purpose) --- */
        .pmx-stars { position:absolute; inset:0; opacity:.85;
          background-repeat:no-repeat;
          background-image:
            radial-gradient(1.6px 1.6px at 8% 16%,  rgba(255,255,255,.95), transparent),
            radial-gradient(1.2px 1.2px at 17% 30%, rgba(255,255,255,.75), transparent),
            radial-gradient(1.4px 1.4px at 27% 12%, rgba(255,255,255,.85), transparent),
            radial-gradient(1px   1px   at 34% 24%, rgba(255,255,255,.65), transparent),
            radial-gradient(1.5px 1.5px at 63% 14%, rgba(255,255,255,.9),  transparent),
            radial-gradient(1.1px 1.1px at 72% 27%, rgba(255,255,255,.7),  transparent),
            radial-gradient(1.3px 1.3px at 83% 18%, rgba(255,255,255,.85), transparent),
            radial-gradient(1px   1px   at 91% 33%, rgba(255,255,255,.6),  transparent),
            radial-gradient(1.2px 1.2px at 47% 9%,  rgba(255,255,255,.8),  transparent),
            radial-gradient(1px   1px   at 55% 22%, rgba(255,255,255,.6),  transparent);
          animation:pmx-twinkle 6s ease-in-out infinite; }
        @keyframes pmx-twinkle { 0%,100%{opacity:.55} 50%{opacity:.95} }

        html { scroll-behavior: smooth; }
        @media (prefers-reduced-motion: reduce){
          .pmx-float, .pmx-stars { animation:none !important; }
          .reveal { opacity:1 !important; transform:none !important; filter:none !important; transition:none !important; }
          .pmx-accent::after { animation:none !important; transform:scaleX(1); }
          html { scroll-behavior:auto; }
        }
      `}</style>

      {/* ---------- aurora borealis backdrop ---------- */}
      {/* Fixed midnight base so overscroll + every section below the hero stays dark. */}
      <div className="pointer-events-none fixed inset-0 -z-20 bg-[#05070e]" />
      {/* A real aurora photo anchored to the top of the page — it scrolls away with the
          hero and fades into the midnight base, so the rest of the page stays calm/dark. */}
      <div ref={auroraRef} className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[118vh] overflow-hidden will-change-transform">
        <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: 'url(/aurora-bg.jpg)' }} />
        {/* a few twinkling stars layered over the sky */}
        <div className="pmx-stars" />
        {/* readability scrim: darken the nav band + hero copy, hard-fade into the base */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#05070e]/80 via-[#05070e]/35 to-[#05070e]" />
        <div className="absolute inset-0 bg-[radial-gradient(85%_55%_at_50%_40%,rgba(5,7,14,0.55),transparent_72%)]" />
      </div>

      {/* ---------- top nav ---------- */}
      {/* On scroll the bar becomes a translucent purple (blurred) instead of solid black. */}
      <header className={`fixed inset-x-0 top-0 z-30 transition-all duration-300 ${scrolled ? 'border-b border-white/10 backdrop-blur-xl' : ''}`}>
        {/* purple gradient wash across the top header */}
        <div className={`pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-violet-700/40 via-violet-900/15 to-transparent transition-opacity duration-300 ${scrolled ? 'opacity-100' : 'opacity-75'}`} />
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
          <div ref={heroRef} className="flex flex-col items-center will-change-transform">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-medium text-slate-300 backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-400" /> {t.hero.badge}
          </div>
          <h1 className="max-w-3xl text-5xl font-bold leading-[1.08] tracking-tight text-white sm:text-6xl">
            {t.hero.titlePre}
            <span className="pmx-accent bg-gradient-to-r from-sky-400 via-indigo-400 to-violet-400 bg-clip-text text-transparent">{t.hero.titleAccent}</span>.
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
                height={1000}
                loading="eager"
                decoding="async"
                alt="Prismatix Project Manager dashboard — a 3D portfolio-health speedometer, EVM KPIs, SPI trend and cost/schedule/status pies"
                className="block w-full"
              />
            </div>
          </div>
        </section>

        {/* ---------- why ---------- */}
        <section className="mx-auto max-w-3xl px-5 py-16 text-center sm:px-8">
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
        <section id="features" className="mx-auto max-w-6xl scroll-mt-24 px-5 py-16 sm:px-8">
          <Reveal className="mb-14 text-center">
            <SectionTitle>{t.features.title}</SectionTitle>
            <p className="mx-auto mt-4 max-w-2xl text-slate-400">{t.features.sub}</p>
          </Reveal>
          <div className="grid gap-6 md:grid-cols-2">
            {t.features.groups.map((g, gi) => (
              <Reveal key={g.name} className="reveal-zoom" delay={gi * 90}>
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

        {/* ---------- showcase: real product screenshots ---------- */}
        <section className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
          <Reveal className="mb-12 text-center">
            <SectionTitle>{t.showcase.title}</SectionTitle>
            <p className="mx-auto mt-4 max-w-2xl text-slate-400">{t.showcase.sub}</p>
          </Reveal>
          {/* One feature per row, shown full-width so each close-up reads clearly. */}
          <div className="mx-auto max-w-5xl space-y-10">
            {SHOWCASE.map((img, i) => (
              <Reveal key={img} className={i % 2 ? 'reveal-right' : 'reveal-left'} delay={i * 120}>
                <figure className="group relative overflow-hidden rounded-2xl border border-white/10 bg-slate-900/60 shadow-2xl ring-1 ring-white/10 transition duration-300 hover:border-white/20">
                  <div className="pointer-events-none absolute -inset-6 -z-10 rounded-[2rem] bg-gradient-to-tr from-brand-600/20 via-violet-600/15 to-indigo-600/20 opacity-0 blur-3xl transition-opacity duration-500 group-hover:opacity-100" />
                  <figcaption className="flex items-center gap-1.5 border-b border-white/10 bg-white/5 px-4 py-2.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
                    <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
                    <span className="h-2.5 w-2.5 rounded-full bg-green-400/70" />
                    <span className="ml-3 text-sm font-medium text-slate-200">{t.showcase.labels[i]}</span>
                  </figcaption>
                  <img
                    src={img}
                    loading="lazy"
                    decoding="async"
                    alt={t.showcase.labels[i]}
                    className="block w-full"
                  />
                </figure>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ---------- the language of EVM (abstract, glowing chips) ---------- */}
        <section className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
          <Reveal className="mb-12 text-center">
            <SectionTitle>{t.evm.title}</SectionTitle>
            <p className="mx-auto mt-4 max-w-2xl text-slate-400">{t.evm.sub}</p>
          </Reveal>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {t.evm.items.map(([k, desc], i) => (
              <Reveal key={k} className="reveal-zoom" delay={i * 70}>
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
          <div className="flex flex-wrap items-center justify-center gap-3">
            {t.principles.chips.map((c, i) => (
              <Reveal key={c} className="reveal-zoom" delay={i * 70}>
                <span className="rounded-full border border-white/10 bg-white/5 px-5 py-2 text-sm font-medium text-slate-200 backdrop-blur">
                  {c}
                </span>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ---------- community (heart) ---------- */}
        <section className="mx-auto max-w-3xl px-5 py-16 text-center sm:px-8">
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
        <section className="mx-auto max-w-4xl px-5 py-16 text-center sm:px-8">
          <Reveal className="reveal-zoom">
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
