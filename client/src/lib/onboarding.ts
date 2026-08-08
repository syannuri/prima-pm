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

// The full "start your first project" storyline: welcome → create → charter → commit →
// WBS/schedule → capture baseline → lock baseline → monitor (EVM) → done.
export const TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    emoji: '👋',
    title: { id: 'Selamat datang di Prismatix', en: 'Welcome to Prismatix' },
    body: {
      id: 'Dua contoh proyek — Predictive & Agile — sudah disiapkan untuk Anda. Panduan singkat ini menyorot fitur utamanya (±1 menit, bisa dilewati). Anda tetap bisa mengeklik apa pun selama tur berjalan.',
      en: 'Two sample projects — Predictive & Agile — are ready for you. This quick guide highlights the key features (~1 min, skippable). You can still click anything while the tour runs.',
    },
  },
  {
    id: 'explore-samples',
    anchor: 'sample-projects',
    emoji: '📂',
    title: { id: 'Jelajahi contoh proyek', en: 'Explore the sample projects' },
    body: {
      id: 'Klik salah satu contoh proyek untuk membuka Charter, WBS/Gantt, biaya & dasbor EVM-nya. Atau tekan “+ New Project” untuk membuat milik Anda sendiri.',
      en: 'Click a sample project to open its Charter, WBS/Gantt, cost & EVM dashboards. Or press “+ New Project” to create your own.',
    },
  },
  {
    id: 'charter',
    anchor: 'charter-form',
    emoji: '📋',
    title: { id: 'Isi Project Charter', en: 'Fill in the Project Charter' },
    body: {
      id: 'Fondasi proyek: deskripsi, tujuan, lingkup, biaya & jadwal. Field bertanda * wajib.',
      en: 'The project’s foundation: description, goals, scope, cost & schedule. * fields are required.',
    },
  },
  {
    id: 'commit',
    anchor: 'charter-commit',
    emoji: '🔒',
    title: { id: 'Commit Charter', en: 'Commit the Charter' },
    body: {
      id: 'Tekan Commit Charter untuk mengunci baseline & membuka modul Jadwal, Biaya, Risiko.',
      en: 'Press Commit Charter to lock the baseline & unlock the Schedule, Cost, and Risk modules.',
    },
  },
  {
    id: 'schedule',
    anchor: 'tab-schedule',
    emoji: '🗂️',
    title: { id: 'Susun WBS & jadwal', en: 'Build the WBS & schedule' },
    body: {
      id: 'Buka “Schedule & WBS”, pecah pekerjaan jadi tugas bertanggal.',
      en: 'Open “Schedule & WBS”, break the work into dated tasks.',
    },
  },
  {
    id: 'baseline',
    anchor: 'schedule-baseline',
    emoji: '📌',
    title: { id: 'Tangkap baseline jadwal', en: 'Capture the schedule baseline' },
    body: {
      id: 'Tekan “Set Baseline” untuk menyimpan tanggal rencana sebagai acuan varian jadwal.',
      en: 'Press “Set Baseline” to save the plan dates as your schedule-variance reference.',
    },
  },
  {
    id: 'lock',
    anchor: 'baseline-lock',
    emoji: '🧊',
    title: { id: 'Kunci baseline biaya', en: 'Lock the cost baseline' },
    body: {
      id: 'Di tab Cost, “Lock baseline” untuk membekukan PMB/BAC. Setelahnya lewat Change Request.',
      en: 'On the Cost tab, “Lock baseline” to freeze the PMB/BAC. Changes then go via a Change Request.',
    },
  },
  {
    id: 'monitor',
    anchor: 'tab-monitoring',
    emoji: '📈',
    title: { id: 'Pantau kinerja (EVM)', en: 'Track performance (EVM)' },
    body: {
      id: 'Di “Monitoring”, buka EVM Trend: CPI/SPI, kurva-S & prakiraan.',
      en: 'Under “Monitoring”, open EVM Trend: CPI/SPI, S-curve & forecast.',
    },
  },
  {
    id: 'finish',
    emoji: '🎉',
    title: { id: 'Anda siap!', en: 'You’re all set!' },
    body: {
      id: 'Itulah alur lengkapnya. Ulangi kapan saja lewat ikon kompas 🧭 di header.',
      en: 'That’s the whole flow. Replay anytime from the compass icon 🧭 in the header.',
    },
  },
];

// localStorage keys, scoped per user so each guest is remembered independently on this device.
export const onboardedKey = (userId: string) => `prima_onboarded_${userId}`;
export const tourSessionKey = (userId: string) => `prima_tour_${userId}`;
