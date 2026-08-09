import type { Lang } from '../context/LanguageContext';

// A single onboarding step. `anchor` is a `data-tour="<anchor>"` attribute placed on a real UI
// element; when that element is on screen the tour spotlights it, otherwise the step falls back to
// a centered card that still explains what to do. Copy is bilingual (follows the app language).
export type TourStep = {
  id: string;
  anchor?: string; // omitted → a centered welcome/finish card
  emoji: string;
  title: Record<Lang, string>;
  body: Record<Lang, string>;
};

// The full guided walkthrough of the whole app, in PM-lifecycle order so a guest learns the
// product as a workflow, not a menu:
//   welcome → portfolio dashboard → open a sample → create a project →
//   charter → commit → WBS/schedule → schedule baseline → cost & baseline lock →
//   risk → monitoring (EVM) → reports → search → replay → done.
// Steps 5–11 live inside a project; their anchors only spotlight once the guest has opened one, so
// until then they show as centered cards that still narrate the step. The tour is non-blocking, so
// the guest can follow along by actually clicking through the app.
export const TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    emoji: '👋',
    title: { id: 'Selamat datang di Prismatix', en: 'Welcome to Prismatix' },
    body: {
      id: 'Dua contoh proyek — Predictive & Agile — sudah disiapkan untuk Anda. Panduan ini menelusuri seluruh alur kerja: membuat proyek, menyusun jadwal & biaya, hingga memantau kinerja lewat EVM (±2 menit, bisa dilewati kapan saja). Selama tur berjalan Anda tetap bebas mengeklik apa pun.',
      en: 'Two sample projects — Predictive & Agile — are ready for you. This guide walks the whole workflow: creating a project, building its schedule & cost, and tracking performance with EVM (~2 min, skippable anytime). You can still click anything while the tour runs.',
    },
  },
  {
    id: 'dashboard-views',
    anchor: 'portfolio-views',
    emoji: '🧭',
    title: { id: 'Dasbor portofolio', en: 'Your portfolio dashboard' },
    body: {
      id: 'Ganti sudut pandang di sini: Proyek Saya (kesehatan & progres), Forecast (prakiraan biaya/jadwal), Utilisasi (beban tim), dan Kartu Proyek. Ini pusat kendali seluruh proyek Anda.',
      en: 'Switch views here: My Projects (health & progress), Forecast (cost/schedule outlook), Utilization (team load), and Project Cards. This is the command center for all your projects.',
    },
  },
  {
    id: 'explore-samples',
    anchor: 'sample-projects',
    emoji: '📂',
    title: { id: 'Buka contoh proyek', en: 'Open a sample project' },
    body: {
      id: 'Klik salah satu kartu untuk masuk ke ruang kerjanya — Charter, WBS/Gantt, biaya, risiko, dan dasbor EVM. Contoh ini sudah berisi data agar Anda bisa langsung menjelajah.',
      en: 'Click a card to enter its workspace — Charter, WBS/Gantt, cost, risk, and EVM dashboards. These samples come pre-filled so you can explore right away.',
    },
  },
  {
    id: 'new-project',
    anchor: 'new-project',
    emoji: '➕',
    title: { id: 'Buat proyek Anda sendiri', en: 'Create your own project' },
    body: {
      id: 'Tekan “+ New Project”, isi nama & kode, lalu pilih pendekatan: Predictive (WBS/Gantt) atau Agile (sprint & backlog). Prismatix menyesuaikan modul sesuai pilihan Anda.',
      en: 'Press “+ New Project”, enter a name & code, then pick an approach: Predictive (WBS/Gantt) or Agile (sprints & backlog). Prismatix tailors the modules to your choice.',
    },
  },
  {
    id: 'charter',
    anchor: 'charter-form',
    emoji: '📋',
    title: { id: 'Isi Project Charter', en: 'Fill in the Project Charter' },
    body: {
      id: 'Fondasi proyek: deskripsi, tujuan, lingkup, sponsor, biaya & jadwal. Field bertanda * wajib diisi. Charter yang rapi membuat baseline dan laporan Anda akurat.',
      en: 'The project’s foundation: description, goals, scope, sponsor, cost & schedule. Fields marked * are required. A solid charter keeps your baseline and reports accurate.',
    },
  },
  {
    id: 'commit',
    anchor: 'charter-commit',
    emoji: '🔒',
    title: { id: 'Commit Charter', en: 'Commit the Charter' },
    body: {
      id: 'Tekan Commit Charter untuk mengesahkannya dan membuka modul Jadwal, Biaya, Risiko, hingga Monitoring. Setelah di-commit, perubahan besar ditelusuri secara resmi.',
      en: 'Press Commit Charter to approve it and unlock the Schedule, Cost, Risk, and Monitoring modules. Once committed, major changes are tracked formally.',
    },
  },
  {
    id: 'schedule',
    anchor: 'tab-schedule',
    emoji: '🗂️',
    title: { id: 'Susun WBS & jadwal', en: 'Build the WBS & schedule' },
    body: {
      id: 'Di “Schedule & WBS”, pecah pekerjaan menjadi tugas bertanggal. Gantt bertingkat menampilkan baseline, rencana, dan aktual sekaligus — lengkap dengan jalur kritis.',
      en: 'Under “Schedule & WBS”, break the work into dated tasks. The layered Gantt shows baseline, plan, and actual at once — complete with the critical path.',
    },
  },
  {
    id: 'baseline',
    anchor: 'schedule-baseline',
    emoji: '📌',
    title: { id: 'Tetapkan baseline jadwal', en: 'Set the schedule baseline' },
    body: {
      id: 'Tekan “Set Baseline” untuk menyimpan tanggal rencana sebagai acuan. Semua varian jadwal (lebih cepat/lambat) dihitung terhadap baseline ini.',
      en: 'Press “Set Baseline” to save the plan dates as your reference. All schedule variance (ahead/behind) is measured against this baseline.',
    },
  },
  {
    id: 'cost',
    anchor: 'baseline-lock',
    emoji: '💰',
    title: { id: 'Biaya & kunci baseline', en: 'Cost & lock the baseline' },
    body: {
      id: 'Di tab Cost, susun anggaran per komponen (BAC), lalu “Lock baseline” untuk membekukan PMB. Setelah terkunci, perubahan anggaran melewati Change Request agar terkendali.',
      en: 'On the Cost tab, build the per-component budget (BAC), then “Lock baseline” to freeze the PMB. Once locked, budget changes go through a Change Request so they stay controlled.',
    },
  },
  {
    id: 'risk',
    anchor: 'tab-risk',
    emoji: '⚠️',
    title: { id: 'Kelola risiko & isu', en: 'Manage risk & issues' },
    body: {
      id: 'Buka “Risk” untuk mencatat risiko beserta probabilitas, dampak, dan strategi respons. RAID dan Issues membantu melacak asumsi, isu terbuka, dan tindak lanjut.',
      en: 'Open “Risk” to log risks with their probability, impact, and response strategy. RAID and Issues help you track assumptions, open issues, and follow-ups.',
    },
  },
  {
    id: 'monitor',
    anchor: 'tab-monitoring',
    emoji: '📈',
    title: { id: 'Pantau kinerja (EVM)', en: 'Track performance (EVM)' },
    body: {
      id: 'Di “Monitoring”, buka EVM Trend: CPI/SPI, kurva-S, dan prakiraan (EAC). Health & Forecast merangkum apakah proyek sesuai anggaran dan jadwal — sekali lihat.',
      en: 'Under “Monitoring”, open EVM Trend: CPI/SPI, S-curve, and forecast (EAC). Health & Forecast summarize whether the project is on budget and on schedule — at a glance.',
    },
  },
  {
    id: 'reports',
    anchor: 'nav-reports',
    emoji: '📑',
    title: { id: 'Laporan siap-presentasi', en: 'Presentation-ready reports' },
    body: {
      id: 'Menu “My Reports” menghasilkan laporan eksekutif & proyek (harian/mingguan/bulanan) dalam PDF korporat — siap dibagikan ke sponsor atau stakeholder.',
      en: 'The “My Reports” menu produces executive & project reports (daily/weekly/monthly) as corporate PDFs — ready to share with sponsors or stakeholders.',
    },
  },
  {
    id: 'search',
    anchor: 'search',
    emoji: '🔎',
    title: { id: 'Cari & lompat cepat', en: 'Search & jump' },
    body: {
      id: 'Tekan ⌘K / Ctrl-K kapan saja untuk melompat ke proyek, tugas, atau halaman mana pun tanpa menelusuri menu.',
      en: 'Press ⌘K / Ctrl-K anytime to jump to any project, task, or page without hunting through menus.',
    },
  },
  {
    id: 'replay',
    anchor: 'tour-replay',
    emoji: '🧭',
    title: { id: 'Ulangi panduan kapan saja', en: 'Replay this guide anytime' },
    body: {
      id: 'Ikon kompas 🧭 di header selalu tersedia — klik untuk memutar ulang panduan ini kapan pun Anda butuh penyegaran.',
      en: 'The compass icon 🧭 in the header is always there — click it to replay this guide whenever you need a refresher.',
    },
  },
  {
    id: 'finish',
    emoji: '🎉',
    title: { id: 'Anda siap!', en: 'You’re all set!' },
    body: {
      id: 'Itulah alur lengkap Prismatix: buat → rencanakan → kunci baseline → pantau → laporkan. Selamat mencoba, dan ingat ikon kompas 🧭 bila butuh panduan lagi.',
      en: 'That’s the full Prismatix flow: create → plan → lock the baseline → monitor → report. Enjoy — and remember the compass 🧭 if you ever need the guide again.',
    },
  },
];

// localStorage keys, scoped per user so each guest is remembered independently on this device.
export const onboardedKey = (userId: string) => `prima_onboarded_${userId}`;
export const tourSessionKey = (userId: string) => `prima_tour_${userId}`;
