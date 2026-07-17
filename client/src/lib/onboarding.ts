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
      id: 'Panduan singkat ini menuntun Anda memulai proyek pertama — dari Charter hingga baseline dan pemantauan kinerja. Sekitar satu menit; bisa dilewati kapan saja.',
      en: 'This quick tour walks you through starting your first project — from Charter to baseline and performance tracking. About a minute; you can skip anytime.',
    },
  },
  {
    id: 'new-project',
    anchor: 'new-project',
    emoji: '➕',
    title: { id: 'Buat proyek pertama', en: 'Create your first project' },
    body: {
      id: 'Klik “+ New Project”, beri nama proyek, lalu tekan Create Project. Proyek ini sepenuhnya milik Anda.',
      en: 'Click “+ New Project”, give it a name, then press Create Project. This project is entirely yours.',
    },
  },
  {
    id: 'charter',
    anchor: 'charter-form',
    emoji: '📋',
    title: { id: 'Isi Project Charter', en: 'Fill in the Project Charter' },
    body: {
      id: 'Charter adalah fondasi proyek: deskripsi, tujuan, ruang lingkup, biaya, dan jadwal tingkat tinggi. Field bertanda * wajib diisi.',
      en: 'The Charter is your project’s foundation: description, goals, scope, cost, and high-level schedule. Fields marked * are required.',
    },
  },
  {
    id: 'commit',
    anchor: 'charter-commit',
    emoji: '🔒',
    title: { id: 'Commit Charter', en: 'Commit the Charter' },
    body: {
      id: 'Setelah lengkap, tekan Commit Charter untuk mengunci baseline dan membuka modul Jadwal, Biaya, dan Risiko.',
      en: 'Once complete, press Commit Charter to lock the baseline and unlock the Schedule, Cost, and Risk modules.',
    },
  },
  {
    id: 'schedule',
    anchor: 'tab-schedule',
    emoji: '🗂️',
    title: { id: 'Susun WBS & jadwal', en: 'Build the WBS & schedule' },
    body: {
      id: 'Buka “Schedule & WBS” untuk memecah pekerjaan menjadi tugas beserta tanggal rencananya.',
      en: 'Open “Schedule & WBS” to break the work into tasks with their planned dates.',
    },
  },
  {
    id: 'baseline',
    anchor: 'schedule-baseline',
    emoji: '📌',
    title: { id: 'Tangkap baseline jadwal', en: 'Capture the schedule baseline' },
    body: {
      id: 'Tekan “Set Baseline” untuk menyimpan tanggal rencana sebagai acuan — dasar pengukuran varian jadwal.',
      en: 'Press “Set Baseline” to save the plan dates as your reference — the basis for measuring schedule variance.',
    },
  },
  {
    id: 'lock',
    anchor: 'baseline-lock',
    emoji: '🧊',
    title: { id: 'Kunci baseline biaya', en: 'Lock the cost baseline' },
    body: {
      id: 'Di tab Cost, tekan “Lock baseline” untuk membekukan PMB/BAC. Setelah ini, perubahan lewat Change Request.',
      en: 'On the Cost tab, press “Lock baseline” to freeze the PMB/BAC. After this, changes go through a Change Request.',
    },
  },
  {
    id: 'monitor',
    anchor: 'tab-monitoring',
    emoji: '📈',
    title: { id: 'Pantau kinerja (EVM)', en: 'Track performance (EVM)' },
    body: {
      id: 'Di “Monitoring” buka EVM Trend untuk melihat CPI/SPI, kurva-S, dan prakiraan penyelesaian.',
      en: 'Under “Monitoring”, open EVM Trend to see CPI/SPI, the S-curve, and the completion forecast.',
    },
  },
  {
    id: 'finish',
    emoji: '🎉',
    title: { id: 'Anda siap!', en: 'You’re all set!' },
    body: {
      id: 'Itulah alur lengkap memulai proyek. Ulangi panduan ini kapan saja lewat ikon “?” di header.',
      en: 'That’s the full flow for starting a project. Replay this tour anytime from the “?” icon in the header.',
    },
  },
];

// localStorage keys, scoped per user so each guest is remembered independently on this device.
export const onboardedKey = (userId: string) => `prima_onboarded_${userId}`;
export const tourSessionKey = (userId: string) => `prima_tour_${userId}`;
