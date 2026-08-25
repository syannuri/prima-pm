// Anett's "how do I…" knowledge base — a curated, GROUNDED guide to this app's real workflows and
// navigation. Anett uses it (via the get_process_guide tool) to tell a user WHAT to do and WHICH menu
// to open, without inventing screens. Menu labels here MUST match the real UI (project tab names:
// Overview/Charter/Schedule[shown "Timeline"]/Cost/Change Req/Risk/Forecast/Closeout…; top-level
// routes: /reports, /approvals, /settings, /notifications, /manual, dashboard "/").
//
// `route` is set ONLY for a fixed, id-less destination (a top-level page) so the client can render a
// real, clickable in-app nav button. Project-scoped steps are id-dependent → menu-path text only.

export interface GuideEntry {
  id: string;
  title: string;                         // Indonesian, user-facing
  aliases: string[];                     // ID + EN keywords for fuzzy matching
  summary: string;
  prerequisites?: string[];
  steps: string[];                       // ordered; each step names the real menu/label
  menuPath: string;                      // compact "A → B → C"
  route?: { label: string; path: string }; // id-less clickable destination only
  related?: string[];                    // other entry ids
}

export const PROCESS_GUIDE: GuideEntry[] = [
  {
    id: 'create-project',
    title: 'Membuat proyek baru',
    aliases: ['buat proyek', 'bikin proyek', 'proyek baru', 'new project', 'create project', 'tambah proyek'],
    summary: 'Membuat proyek baru dari Dashboard, lalu melengkapi charter-nya.',
    steps: [
      'Buka Dashboard (halaman utama).',
      'Klik tombol "New project" / "Proyek baru".',
      'Isi kode, nama, pendekatan (Predictive/Agile), dan PM.',
      'Simpan — proyek terbuat dengan status DRAFT; lanjut isi Charter.',
    ],
    menuPath: 'Dashboard → New project',
    route: { label: 'Buka Dashboard', path: '/' },
    related: ['commit-charter'],
  },
  {
    id: 'commit-charter',
    title: 'Mengisi & mengunci Project Charter',
    aliases: ['charter', 'piagam proyek', 'commit charter', 'kunci charter', 'lock charter', 'inisiasi'],
    summary: 'Charter harus di-commit (dikunci) dulu agar tab-tab lain (Cost, Schedule, Risk, CR) terbuka.',
    prerequisites: ['Proyek sudah dibuat (DRAFT)'],
    steps: [
      'Buka proyek → tab Charter.',
      'Isi deskripsi, tujuan, ruang lingkup (scope), biaya & jadwal high-level, deliverables, PM.',
      'Klik "Commit charter" untuk mengunci — ini membuka tab lain (Cost/Schedule/Risk/Change Req).',
    ],
    menuPath: 'Proyek → tab Charter → Commit charter',
    related: ['build-schedule', 'manage-cost', 'lock-baseline'],
  },
  {
    id: 'build-schedule',
    title: 'Menyusun jadwal / WBS (Gantt)',
    aliases: ['jadwal', 'schedule', 'timeline', 'wbs', 'gantt', 'task', 'tugas', 'susun jadwal'],
    summary: 'Menyusun WBS + tugas + dependensi di tab Schedule (di menu tampil sebagai "Timeline").',
    prerequisites: ['Charter sudah di-commit'],
    steps: [
      'Buka proyek → tab Schedule (label menu "Timeline").',
      'Tambah fase & work package (WBS), isi tanggal plan mulai/selesai.',
      'Atur dependensi antar-tugas (predecessor) bila perlu; gunakan "Tidy schedule" untuk merapikan.',
      'Opsional: set bobot (⚖ Weights) untuk progress berbobot.',
    ],
    menuPath: 'Proyek → tab Timeline (Schedule) → Gantt',
    related: ['set-weights', 'track-progress', 'lock-baseline'],
  },
  {
    id: 'manage-cost',
    title: 'Mengisi anggaran biaya',
    aliases: ['biaya', 'cost', 'anggaran', 'budget', 'rab', 'cost item', 'manpower', 'material'],
    summary: 'Memasukkan komponen biaya (manpower/material/indirect) di tab Cost, dasar dari BAC.',
    prerequisites: ['Charter sudah di-commit'],
    steps: [
      'Buka proyek → tab Cost.',
      'Tambah item biaya langsung (manpower/material) dan tidak langsung (indirect).',
      'Nilai total menjadi BAC (Budget At Completion) untuk EVM.',
    ],
    menuPath: 'Proyek → tab Cost',
    related: ['lock-baseline'],
  },
  {
    id: 'lock-baseline',
    title: 'Membuat baseline biaya & jadwal (Lock)',
    aliases: ['baseline', 'lock baseline', 'kunci baseline', 'baseline cost', 'baseline jadwal', 'baseline schedule', 'pmb', 'commit baseline', 'membuat baseline'],
    summary: 'Mengunci baseline — di aplikasi ini biaya + jadwal dikunci BERSAMA (combined) sebagai titik acuan EVM.',
    prerequisites: ['Charter di-commit', 'Jadwal/WBS sudah tersusun', 'Item biaya sudah diisi (BAC terbentuk)'],
    steps: [
      'Buka proyek → tab Cost.',
      'Buka bagian Baseline.',
      'Klik "Lock baseline" — ini membekukan jadwal DAN biaya bersama (combined) sebagai baseline (B1, B2, …).',
      'Setelah terkunci, EVM (PV/EV/AC, SPI/CPI) dihitung terhadap baseline ini.',
      'Catatan: bila governance mengaktifkan approval, lock/unlock baseline bisa lewat persetujuan dulu.',
    ],
    menuPath: 'Proyek → tab Cost → Baseline → Lock baseline',
    related: ['build-schedule', 'manage-cost', 'rebaseline-after-cr', 'forecast-evm'],
  },
  {
    id: 'set-weights',
    title: 'Mengatur bobot progress (weighted)',
    aliases: ['bobot', 'weight', 'weighted progress', 'bobot progress', 'weights'],
    summary: 'Memberi bobot per fase/work-package agar % proyek merefleksikan besar pekerjaan.',
    prerequisites: ['Jadwal/WBS sudah ada'],
    steps: [
      'Buka proyek → tab Schedule (Timeline).',
      'Klik "⚖ Weights", set bobot per fase (normalize ke 100).',
      'Bobot disnapshot saat baseline dikunci (EVM membeku terhadapnya).',
    ],
    menuPath: 'Proyek → tab Timeline → ⚖ Weights',
    related: ['build-schedule', 'lock-baseline'],
  },
  {
    id: 'track-progress',
    title: 'Mengupdate progress tugas',
    aliases: ['progress', 'update progress', 'kemajuan', 'persen selesai', 'progress tugas', 'aktual'],
    summary: 'Mengisi % penyelesaian tugas; menggerakkan EV dan menandai aktual.',
    prerequisites: ['Jadwal sudah ada'],
    steps: [
      'Buka proyek → tab Schedule (Timeline) atau Overview.',
      'Set % progress pada tiap tugas; aktual (mulai/selesai) tercatat otomatis.',
      'Gunakan "Progress steps" untuk sub-deliverable bila tugas besar.',
    ],
    menuPath: 'Proyek → tab Timeline → set progress',
    related: ['forecast-evm'],
  },
  {
    id: 'raise-change-request',
    title: 'Membuat Change Request (CR)',
    aliases: ['change request', 'cr', 'perubahan', 'ubah baseline', 'buat cr', 'bikin cr', 'permintaan perubahan'],
    summary: 'Mengajukan perubahan resmi (scope/biaya/jadwal) melalui kontrol perubahan.',
    prerequisites: ['Charter sudah di-commit (terkunci)'],
    steps: [
      'Buka proyek → tab Change Req.',
      'Klik "New change request".',
      'Isi judul, deskripsi, area dampak (Charter/Cost/Schedule/…), chargeable + nilai bila ada.',
      'Submit — CR masuk alur persetujuan (approval).',
    ],
    menuPath: 'Proyek → tab Change Req → New change request',
    related: ['approve-change-request', 'rebaseline-after-cr'],
  },
  {
    id: 'approve-change-request',
    title: 'Menyetujui / menolak approval',
    aliases: ['approval', 'approve', 'setujui', 'tolak', 'persetujuan', 'inbox approval', 'menyetujui cr'],
    summary: 'Meninjau item yang menunggu keputusan Anda (CR, lock/unlock baseline, closure, aksi AI).',
    prerequisites: ['Anda adalah approver pada workflow terkait'],
    steps: [
      'Buka halaman My approvals (/approvals).',
      'Tinjau item, isi komentar opsional.',
      'Klik Approve atau Reject; menyetujui CR dampak biaya/jadwal akan membuka baseline untuk disunting.',
    ],
    menuPath: 'Sidebar → Approvals',
    route: { label: 'Buka Approvals', path: '/approvals' },
    related: ['raise-change-request', 'rebaseline-after-cr'],
  },
  {
    id: 'rebaseline-after-cr',
    title: 'Re-baseline setelah CR disetujui',
    aliases: ['rebaseline', 're-baseline', 'baseline ulang', 'unlock baseline', 'buka baseline', 'ubah setelah cr'],
    summary: 'Setelah CR biaya/jadwal disetujui, baseline terbuka — sunting perubahan lalu kunci ulang.',
    prerequisites: ['CR dampak Cost/Schedule sudah disetujui'],
    steps: [
      'Persetujuan CR membuka (unlock) baseline; banner "re-baseline & lock" muncul di tab Cost.',
      'Terapkan perubahan pada jadwal/biaya sesuai CR.',
      'Buka tab Cost → Baseline → Lock lagi untuk membekukan baseline versi baru (B2, B3, …).',
    ],
    menuPath: 'Proyek → tab Cost → Baseline → Lock (ulang)',
    related: ['lock-baseline', 'approve-change-request'],
  },
  {
    id: 'manage-risks',
    title: 'Mengelola risiko',
    aliases: ['risiko', 'risk', 'register risiko', 'mitigasi', 'emv', 'raid'],
    summary: 'Mendaftar & menilai risiko (probabilitas × dampak, EMV) + strategi respons.',
    prerequisites: ['Charter sudah di-commit'],
    steps: [
      'Buka proyek → tab Risk (atau RAID untuk pandangan gabungan).',
      'Tambah risiko: judul, probabilitas & dampak (1-5), strategi respons (mitigate/avoid/…).',
      'EMV & contingency reserve ikut ter-refresh ke baseline biaya.',
    ],
    menuPath: 'Proyek → tab Risk',
    related: ['forecast-evm'],
  },
  {
    id: 'forecast-evm',
    title: 'Melihat EVM & forecast',
    aliases: ['evm', 'forecast', 'eac', 'spi', 'cpi', 'kesehatan', 'health', 's-curve', 'prediksi'],
    summary: 'Membaca kinerja (EVM) dan proyeksi selesai/biaya (forecast/EAC).',
    prerequisites: ['Baseline sudah dikunci', 'Ada progress + actual cost'],
    steps: [
      'Buka proyek → tab Forecast (EAC & perkiraan selesai), Health (ringkas), atau EVM Trend (tren).',
      'Overview juga menampilkan kartu Prediction (sinyal slip/overrun).',
    ],
    menuPath: 'Proyek → tab Forecast / Health / EVM Trend',
    related: ['lock-baseline', 'track-progress'],
  },
  {
    id: 'close-project',
    title: 'Menutup proyek (closeout)',
    aliases: ['tutup proyek', 'close project', 'closeout', 'penutupan', 'selesai proyek', 'lessons learned'],
    summary: 'Menutup proyek melalui tab Closeout (bisa lewat approval bila diaktifkan).',
    prerequisites: ['Pekerjaan selesai / siap ditutup'],
    steps: [
      'Buka proyek → tab Closeout.',
      'Lengkapi checklist penutupan, lessons learned, sign-off.',
      'Ajukan penutupan — bila governance mewajibkan approval, status CLOSED berlaku setelah disetujui.',
    ],
    menuPath: 'Proyek → tab Closeout',
    related: ['approve-change-request'],
  },
  {
    id: 'reports',
    title: 'Membuat laporan',
    aliases: ['laporan', 'report', 'reporting', 'pdf', 'executive', 'portfolio report'],
    summary: 'Pusat laporan: eksekutif, proyek, portofolio; cadence harian/mingguan/bulanan + PDF.',
    steps: [
      'Buka Reporting Hub (/reports).',
      'Pilih tampilan (Executive/Project/Portfolio/Analytics) + cadence.',
      'Ekspor PDF korporat bila perlu.',
    ],
    menuPath: 'Sidebar → Reports',
    route: { label: 'Buka Reports', path: '/reports' },
  },
  {
    id: 'ai-settings',
    title: 'Mengaktifkan fitur AI (termasuk aksi AI)',
    aliases: ['ai', 'aktifkan ai', 'anett', 'ai settings', 'enable ai', 'usul aksi', 'ai actions', 'governance'],
    summary: 'Opt-in AI per-workspace di Settings → Governance (butuh peran ADMIN).',
    prerequisites: ['Peran ADMIN', 'Kunci AI sudah dikonfigurasi di server'],
    steps: [
      'Buka Settings → bagian Governance.',
      'Nyalakan "AI Status Narrative" untuk fitur AI umum + asisten Anett.',
      'Nyalakan "Izinkan AI mengusulkan aksi" untuk Stage C (usulan aksi lewat approval).',
    ],
    menuPath: 'Settings → Governance',
    route: { label: 'Buka Settings', path: '/settings' },
  },
];

// Fuzzy match a free-text topic to the best guide entry (word-overlap over id/title/aliases). Returns
// null when nothing plausibly matches, so the caller can offer the topic list instead of guessing.
export function findGuide(query: string): GuideEntry | null {
  const q = query.toLowerCase();
  let best: GuideEntry | null = null;
  let bestScore = 0;
  for (const e of PROCESS_GUIDE) {
    const hay = [e.id.replace(/-/g, ' '), e.title.toLowerCase(), ...e.aliases.map((a) => a.toLowerCase())];
    let score = 0;
    for (const h of hay) if (h && q.includes(h)) score += h.length; // longer phrase match = stronger
    if (score > bestScore) { bestScore = score; best = e; }
  }
  return bestScore > 0 ? best : null;
}

// Compact index (titles) for the system prompt so the model knows what it can guide on.
export function guideIndex(): string {
  return PROCESS_GUIDE.map((e) => e.title).join('; ');
}
