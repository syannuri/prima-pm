import { Badge, Card } from '../components/ui';
import { useLang, type Lang } from '../context/LanguageContext';

// Bilingual in-app user manual (ID/EN). Content is data-driven so both languages
// share one render tree. Follows the global language (Settings / browser) and has
// an inline ID/EN switch. References the English UI labels in either language.

type Block =
  | { type: 'p'; text: string }
  | { type: 'steps'; items: string[] }
  | { type: 'bullets'; items: string[] }
  | { type: 'roles'; rows: { role: string; color: string; desc: string }[] }
  | { type: 'faq'; rows: { q: string; a: string }[] };

type Sec = { id: string; nav: string; heading: string; blocks: Block[] };
type Doc = { title: string; intro: string; switchLabel: string; sections: Sec[] };

const ROLE_COLOR: Record<string, string> = {
  ADMIN: 'coral', PMO: 'indigo', PROJECT_MANAGER: 'sky', FINANCE: 'amber', RISK_OFFICER: 'amber', TEAM_MEMBER: 'slate', VIEWER: 'slate',
};

// Bold the "Term — definition" lead (split on em dash) for a consistent glossary look.
function Lead({ text }: { text: string }) {
  const i = text.indexOf(' — ');
  if (i === -1) return <>{text}</>;
  return (
    <>
      <span className="font-medium text-slate-800 dark:text-slate-100">{text.slice(0, i)}</span>
      {text.slice(i)}
    </>
  );
}

const DOC: Record<Lang, Doc> = {
  id: {
    title: 'Manual Pengguna',
    intro: 'Panduan memakai Prismatix — aplikasi manajemen proyek end-to-end. Label menu di aplikasi memakai bahasa Inggris; panduan ini menjelaskannya dalam Bahasa Indonesia.',
    switchLabel: 'Bahasa',
    sections: [
      { id: 'mulai', nav: 'Mulai cepat', heading: '🚀 Mulai cepat', blocks: [
        { type: 'p', text: 'Prismatix membantu Anda merencanakan & memantau proyek dari awal sampai selesai: Charter → WBS/Jadwal → Biaya → Risiko → Perubahan, dengan analisis kinerja Earned Value (EVM).' },
        { type: 'steps', items: [
          'Masuk dengan akun Anda. Tampilan default dark mode (bisa diganti di Settings).',
          'Dari Dashboard, lihat ringkasan portfolio atau buka satu proyek dari sidebar kiri.',
          'Proyek baru dibuat oleh Admin/PMO lewat tombol “+ New Project”.',
          'Di dalam proyek, tab teratas dikelompokkan per domain pengelolaan: Inisiasi · Jadwal · Biaya · Risiko · Kualitas · Kinerja · Penutupan · Audit. Urutan tahapan proyek sendiri berjalan lewat status proyek & panduan “Next steps”, bukan lewat urutan tab.',
        ] },
      ] },
      { id: 'konsep', nav: 'Konsep penting (EVM)', heading: '📐 Konsep penting (EVM)', blocks: [
        { type: 'p', text: 'Beberapa istilah inti yang dipakai di seluruh aplikasi:' },
        { type: 'bullets', items: [
          'BAC (PMB) — Budget at Completion = biaya langsung + tak langsung + cadangan kontingensi. Tidak termasuk management reserve (ditampilkan terpisah sebagai “Total Budget”).',
          'EV (Earned Value) — nilai pekerjaan yang sudah selesai = % progress × anggaran. Digerakkan oleh progress, bukan pengeluaran.',
          'AC (Actual Cost) — uang yang benar-benar dikeluarkan. Diinput manual di tab Cost.',
          'PV (Planned Value) — nilai pekerjaan yang seharusnya selesai pada tanggal status, mengacu baseline jadwal.',
          'CPI — EV ÷ AC. > 1 hemat, < 1 boros. Jika AC = 0, CPI tampil “—”.',
          'SPI — EV ÷ PV. > 1 lebih cepat dari jadwal, < 1 terlambat.',
          'Status date — tanggal acuan perhitungan EVM (diubah di Dashboard). Tanggal sebelum proyek mulai menghasilkan “No data”.',
        ] },
      ] },
      { id: 'peran', nav: 'Peran & hak akses', heading: '👥 Peran & hak akses (RBAC)', blocks: [
        { type: 'p', text: 'Apa yang bisa Anda lihat/ubah tergantung peran:' },
        { type: 'roles', rows: [
          { role: 'ADMIN', color: ROLE_COLOR.ADMIN, desc: 'Akses penuh + kelola pengguna.' },
          { role: 'PMO', color: ROLE_COLOR.PMO, desc: 'Lihat semua proyek, buat & tetapkan PM, setujui Change Request.' },
          { role: 'PROJECT_MANAGER', color: ROLE_COLOR.PROJECT_MANAGER, desc: 'Kelola proyek yang ditugaskan (Charter, WBS, Cost, Risk).' },
          { role: 'FINANCE', color: ROLE_COLOR.FINANCE, desc: 'Lihat & kelola biaya lintas proyek; audit domain biaya.' },
          { role: 'RISK_OFFICER', color: ROLE_COLOR.RISK_OFFICER, desc: 'Lihat & kelola risiko; audit domain risiko.' },
          { role: 'TEAM_MEMBER', color: ROLE_COLOR.TEAM_MEMBER, desc: 'Anggota tim / PIC tugas.' },
          { role: 'VIEWER', color: ROLE_COLOR.VIEWER, desc: 'Hanya melihat.' },
        ] },
      ] },
      { id: 'alur', nav: 'Alur kerja proyek', heading: '🔄 Alur kerja proyek (end-to-end)', blocks: [
        { type: 'p', text: 'Tab teratas dikelompokkan per DOMAIN pengelolaan (Inisiasi · Jadwal · Biaya · Risiko · Kualitas · Kinerja · Penutupan · Audit), bukan per tahap. Alasannya: satu tab seperti Jadwal atau Biaya memuat baseline SEKALIGUS aktual/tracking-nya, jadi tak bisa dikotak ke satu “fase”. Tahapan proyek justru berjalan lewat status (Draft → Chartered → In-progress → Closed) dan dituntun panduan Next-steps. Alur end-to-end:' },
        { type: 'steps', items: [
          'Inisiasi — di tab Inisiasi: isi Charter (piagam proyek) lalu Commit untuk mengunci baseline & membuka modul lain (Draft → Chartered), dan daftarkan Stakeholders & Requirements.',
          'Susun baseline — di tab Jadwal susun Schedule/WBS lalu Capture Schedule Baseline; di tab Biaya isi Cost + rencana manpower & Procurement, lalu Lock Cost Baseline (urutan benar: capture schedule dulu, baru lock cost). Daftarkan Risk di tab Risiko. PMO/Admin lalu Activate proyek (Chartered → In-progress) setelah baseline lengkap.',
          'Jalankan & kendalikan — update progress (tab Jadwal) & Actual Cost (tab Biaya, bisa auto-post dari timesheet), catat effort di Timesheet (tab Kinerja), kelola Issues & RAID di tab Risiko, jalankan UAT di tab Kualitas, dan ajukan Change Request di tab Kinerja bila ada perubahan setelah commit.',
          'Pantau kinerja — di tab Kinerja: Forecast & EVM Trend, dilengkapi Dashboard & menu Reports (PDF/Excel).',
          'Tutup — di tab Penutupan: catat Acceptance Sign-off & Lessons Learned, lalu Close project.',
          'Panduan "🧭 Next steps" di tiap proyek menuntun langkah berikutnya sesuai tahap lifecycle.',
        ] },
      ] },
      { id: 'dashboard', nav: 'Dashboard', heading: '📊 Dashboard', blocks: [
        { type: 'p', text: 'Tiga tampilan lewat tombol di kanan atas:' },
        { type: 'bullets', items: [
          'Portfolio EVM — KPI (Total BAC, EV, AC, CPI, SPI, % Complete), panel “Needs attention”, kesehatan jadwal, & diagram status.',
          'Utilization — heatmap beban vs kapasitas sumber daya; sel merah = over-alokasi.',
          'Project Cards — kartu ringkas tiap proyek (progress, status, BAC).',
        ] },
        { type: 'p', text: 'Atur Status date ke tanggal yang relevan agar CPI/SPI terisi. Warna merah hanya untuk hal yang benar-benar perlu perhatian.' },
      ] },
      { id: 'charter', nav: 'Charter', heading: '📜 Charter', blocks: [
        { type: 'p', text: 'Piagam proyek: deskripsi, tujuan, lingkup, kategori, PM, jadwal & biaya tingkat-tinggi. Klik Commit Charter untuk mengunci baseline — setelah ini perubahan harus lewat Change Request. Dokumen pendukung bisa dilampirkan.' },
      ] },
      { id: 'schedule', nav: 'WBS & Schedule', heading: '🗓️ WBS & Schedule', blocks: [
        { type: 'bullets', items: [
          'WBS — struktur rincian kerja (tugas & subtugas), nomor outline, %-progress, PIC, kamus WBS (deliverable, kriteria).',
          'Timeline Gantt — bar jadwal per tugas dengan penanda "Today" & bar baseline (bayangan); skala Hari/Minggu/Bulan.',
          'Kolom Budget — Direct Cost yang tertaut ke tiap tugas (tugas ringkasan = jumlah subtugas); nilai yang sama dipakai sebagai bobot EVM.',
          'Ring "Overall progress" (kanan atas) — total %-complete proyek, sama dengan angka di Dashboard/Reports.',
          'Set Baseline — simpan tanggal rencana sebagai acuan; kolom "Var" menampilkan selisih jadwal.',
          'Klik lingkaran centang untuk menandai tugas selesai (otomatis mengisi tanggal aktual).',
        ] },
      ] },
      { id: 'cost', nav: 'Cost & EVM', heading: '💰 Cost & EVM', blocks: [
        { type: 'bullets', items: [
          'Direct Cost — material (qty × harga) & manpower (rate × mandays); manpower bisa ditautkan ke resource & tugas.',
          'Indirect Cost — transport, akomodasi, dll.',
          'Actual Cost — catat pengeluaran nyata (tanggal + jumlah). Ini yang memunculkan CPI.',
          'Strip EVM — menampilkan EV / AC / CV / CPI. Ingat: progress menggerakkan EV, AC diinput manual.',
        ] },
      ] },
      { id: 'risk', nav: 'Risk', heading: '⚠️ Risk', blocks: [
        { type: 'p', text: 'Daftarkan risiko dengan probabilitas & dampak. Aplikasi menghitung skor (P×I), menampilkan heatmap 5×5, dan EMV (Expected Monetary Value). Risiko terbuka yang ditandai “include in reserve” menambah cadangan kontingensi (dan ikut ke BAC).' },
      ] },
      { id: 'change', nav: 'Change Request', heading: '🔁 Change Request', blocks: [
        { type: 'p', text: 'Setelah charter di-commit, perubahan diajukan sebagai Change Request: pilih magnitudo (MINOR/MAJOR), area dampak (biaya/jadwal/dll.), & apakah chargeable. PMO/Admin menyetujui atau menolak; persetujuan membuka charter untuk revisi & menaikkan versi.' },
      ] },
      { id: 'forecast', nav: 'Forecast & EVM Trend', heading: '🔮 Forecast & EVM Trend', blocks: [
        { type: 'bullets', items: [
          'Forecast — proyeksi biaya & tanggal selesai: skenario EAC (optimistis/likely/pesimistis), ETC, VAC, TCPI, kurva-S, dan perkiraan tanggal selesai dari SPI.',
          'EVM Trend — rekam "status" berkala (Capture status) untuk melihat CPI/SPI & EV dari waktu ke waktu (grafik tren + tabel snapshot).',
        ] },
      ] },
      { id: 'closeout', nav: 'Closing', heading: '🏁 Closing (Acceptance & Lessons)', blocks: [
        { type: 'bullets', items: [
          'Acceptance Sign-off — persetujuan formal deliverable dari sponsor/customer (pihak, keputusan Accepted / Accepted-with-conditions / Rejected, nama penandatangan, tanggal).',
          'Lessons Learned — catatan Went-well / Went-wrong / Rekomendasi untuk proyek berikutnya.',
          'Keduanya muncul sebagai checklist (advisory) saat menutup proyek, dan masuk ke laporan.',
        ] },
      ] },
      { id: 'reports', nav: 'Reports', heading: '📈 Reports', blocks: [
        { type: 'p', text: 'Menu Reports (PM & PMO) menghasilkan Status Report satu proyek — Mingguan atau Bulanan — berisi RAG health, %-complete (per jumlah task DAN per bobot nilai), SPI/CPI, task selesai vs sisa, kurva-S EVM, dan forecast. Bisa diunduh sebagai PDF profesional.' },
      ] },
      { id: 'more2', nav: 'Issues · Agile · Timesheet', heading: '🧩 Issues, Agile & Timesheet', blocks: [
        { type: 'bullets', items: [
          'Issues — log masalah aktif (kategori, dampak, owner, status, resolusi).',
          'Agile/Sprint — untuk proyek Agile/Hybrid: backlog & sprint; EVM berbasis story point.',
          'Timesheet — catat man-day aktual per baris manpower (efisiensi = earned ÷ consumed); "My Timesheet" (semua peran) untuk mencatat effort sendiri lintas proyek.',
          'Lifecycle & Baseline Lock (PMO/Admin) — Activate / Put on hold / Resume / Close; kunci-buka baseline mengatur kapan cost/WBS boleh diubah (perubahan resmi lewat Change Request).',
        ] },
      ] },
      { id: 'audit', nav: 'Audit', heading: '🧾 Audit', blocks: [
        { type: 'p', text: 'Jejak tak-terubah (immutable) atas semua perubahan: siapa, apa, kapan. Bisa difilter per entitas/aksi. Cakupannya menyesuaikan peran (mis. Finance hanya melihat domain biaya).' },
      ] },
      { id: 'lainnya', nav: 'Resource, Export & lainnya', heading: '🧰 Resource, Export, Notifikasi & Lampiran', blocks: [
        { type: 'bullets', items: [
          'Resource Pool (Admin/PMO/Finance) — master sumber daya & rate card; dipakai pada manpower & tampilan Utilization.',
          'Export — tombol Excel/PDF di header proyek untuk laporan lengkap.',
          'Notifikasi — ikon lonceng 🔔 di topbar merangkum peringatan lintas proyek (tugas telat, risiko tinggi, over-budget).',
          'Lampiran — unggah berkas pada charter atau tiap risiko.',
        ] },
      ] },
      { id: 'settings', nav: 'Settings', heading: '⚙️ Settings', blocks: [
        { type: 'p', text: 'Buka lewat ikon gear di topbar atau “Settings” di sidebar. Anda bisa mengganti tema (gelap/terang), memilih bahasa, dan mengganti password (min. 10 karakter, ada huruf & angka).' },
      ] },
      { id: 'faq', nav: 'FAQ', heading: '❓ FAQ', blocks: [
        { type: 'faq', rows: [
          { q: 'Kenapa CPI/SPI kosong (“—” / No data)?', a: 'Status date sebelum proyek mulai, atau Actual Cost masih 0. Pilih tanggal status yang relevan & catat AC.' },
          { q: 'Kenapa angka tampil ringkas (mis. “Rp 2,07 M”)?', a: 'Untuk ringkas; arahkan kursor (hover) untuk melihat nilai penuh.' },
          { q: 'Saya tidak bisa membuat proyek / mengubah sesuatu.', a: 'Itu dibatasi peran (RBAC). Hubungi Admin/PMO bila perlu akses.' },
          { q: 'Ingin ganti password?', a: 'Settings → Change password. Admin juga bisa mereset.' },
        ] },
      ] },
    ],
  },
  en: {
    title: 'User Manual',
    intro: 'A guide to using Prismatix — an end-to-end project management app. This manual is in English and refers to the in-app labels directly.',
    switchLabel: 'Language',
    sections: [
      { id: 'mulai', nav: 'Quick start', heading: '🚀 Quick start', blocks: [
        { type: 'p', text: 'Prismatix helps you plan & track projects from start to finish: Charter → WBS/Schedule → Cost → Risk → Change, with Earned Value (EVM) performance analysis.' },
        { type: 'steps', items: [
          'Sign in with your account. The default theme is dark mode (changeable in Settings).',
          'From the Dashboard, review the portfolio or open a project from the left sidebar.',
          'New projects are created by Admin/PMO via the “+ New Project” button.',
          'Inside a project, the top tabs are grouped by management domain: Initiation · Schedule · Cost · Risk · Quality · Performance · Closure · Audit. The project’s stage sequence runs via the project status & the “Next steps” guide, not the tab order.',
        ] },
      ] },
      { id: 'konsep', nav: 'Key concepts (EVM)', heading: '📐 Key concepts (EVM)', blocks: [
        { type: 'p', text: 'Core terms used throughout the app:' },
        { type: 'bullets', items: [
          'BAC (PMB) — Budget at Completion = direct + indirect + contingency reserve. Excludes management reserve (shown separately as “Total Budget”).',
          'EV (Earned Value) — value of work completed = % progress × budget. Driven by progress, not spending.',
          'AC (Actual Cost) — money actually spent. Entered manually on the Cost tab.',
          'PV (Planned Value) — value of work that should be done by the status date, against the schedule baseline.',
          'CPI — EV ÷ AC. > 1 under budget, < 1 over budget. With AC = 0, CPI shows “—”.',
          'SPI — EV ÷ PV. > 1 ahead of schedule, < 1 behind.',
          'Status date — the reference date for EVM (set on the Dashboard). A date before the project starts yields “No data”.',
        ] },
      ] },
      { id: 'peran', nav: 'Roles & access', heading: '👥 Roles & access (RBAC)', blocks: [
        { type: 'p', text: 'What you can see/change depends on your role:' },
        { type: 'roles', rows: [
          { role: 'ADMIN', color: ROLE_COLOR.ADMIN, desc: 'Full access + user management.' },
          { role: 'PMO', color: ROLE_COLOR.PMO, desc: 'See all projects, create & assign PMs, approve Change Requests.' },
          { role: 'PROJECT_MANAGER', color: ROLE_COLOR.PROJECT_MANAGER, desc: 'Manage assigned projects (Charter, WBS, Cost, Risk).' },
          { role: 'FINANCE', color: ROLE_COLOR.FINANCE, desc: 'View & manage costs across projects; cost-domain audit.' },
          { role: 'RISK_OFFICER', color: ROLE_COLOR.RISK_OFFICER, desc: 'View & manage risks; risk-domain audit.' },
          { role: 'TEAM_MEMBER', color: ROLE_COLOR.TEAM_MEMBER, desc: 'Team member / task PIC.' },
          { role: 'VIEWER', color: ROLE_COLOR.VIEWER, desc: 'Read-only.' },
        ] },
      ] },
      { id: 'alur', nav: 'Project workflow', heading: '🔄 Project workflow (end-to-end)', blocks: [
        { type: 'p', text: 'The top tabs are grouped by MANAGEMENT DOMAIN (Initiation · Schedule · Cost · Risk · Quality · Performance · Closure · Audit), not by phase. Why: a tab like Schedule or Cost holds BOTH its baseline AND its actuals/tracking, so it can’t be boxed into one “phase”. The stage sequence instead runs via the project status (Draft → Chartered → In-progress → Closed), guided by Next-steps. End-to-end flow:' },
        { type: 'steps', items: [
          'Initiation — on the Initiation tab: fill in the Charter, then Commit to lock the baseline & unlock the other modules (Draft → Chartered), and register Stakeholders & Requirements.',
          'Set the baseline — on the Schedule tab build the Schedule/WBS then Capture the Schedule Baseline; on the Cost tab enter Cost + planned manpower & Procurement, then Lock the Cost Baseline (correct order: capture the schedule baseline first, then lock cost). Register Risk under the Risk tab. PMO/Admin then Activate the project (Chartered → In-progress) once the baseline is complete.',
          'Deliver & control — update progress (Schedule tab) & Actual Cost (Cost tab, optionally auto-posted from timesheets), log effort in Timesheet (Performance tab), manage Issues & RAID under Risk, run UAT under Quality, and raise a Change Request under Performance for any change after commit.',
          'Track performance — on the Performance tab: Forecast & EVM Trend, complemented by the Dashboard & the Reports menu (PDF/Excel).',
          'Close — on the Closure tab: record the Acceptance Sign-off & Lessons Learned, then Close the project.',
          'The "🧭 Next steps" guide on each project points to the next action for its lifecycle stage.',
        ] },
      ] },
      { id: 'dashboard', nav: 'Dashboard', heading: '📊 Dashboard', blocks: [
        { type: 'p', text: 'Three views via the buttons at the top right:' },
        { type: 'bullets', items: [
          'Portfolio EVM — KPIs (Total BAC, EV, AC, CPI, SPI, % Complete), the “Needs attention” panel, schedule health & status charts.',
          'Utilization — resource load vs capacity heatmap; red cells = over-allocation.',
          'Project Cards — a compact card per project (progress, status, BAC).',
        ] },
        { type: 'p', text: 'Set the Status date to a relevant date so CPI/SPI populate. Red is reserved for things that genuinely need attention.' },
      ] },
      { id: 'charter', nav: 'Charter', heading: '📜 Charter', blocks: [
        { type: 'p', text: 'The project charter: description, goals, scope, category, PM, high-level schedule & cost. Click Commit Charter to lock the baseline — after this, changes must go through a Change Request. Supporting documents can be attached.' },
      ] },
      { id: 'schedule', nav: 'WBS & Schedule', heading: '🗓️ WBS & Schedule', blocks: [
        { type: 'bullets', items: [
          'WBS — the work breakdown (tasks & subtasks), outline numbering, % progress, PIC, WBS dictionary (deliverable, criteria).',
          'Gantt timeline — a schedule bar per task with a "Today" marker & a baseline (ghost) bar; Day/Week/Month scale.',
          'Budget column — the Direct Cost linked to each task (summary tasks = Σ subtasks); the same weight EVM uses.',
          '"Overall progress" ring (top-right) — the project total % complete, matching the Dashboard/Reports figure.',
          'Set Baseline — capture the plan dates as a reference; the "Var" column shows schedule variance.',
          'Click the check circle to mark a task complete (auto-stamps actual dates).',
        ] },
      ] },
      { id: 'cost', nav: 'Cost & EVM', heading: '💰 Cost & EVM', blocks: [
        { type: 'bullets', items: [
          'Direct Cost — material (qty × price) & manpower (rate × mandays); manpower can link to a resource & task.',
          'Indirect Cost — transport, accommodation, etc.',
          'Actual Cost — record real spend (date + amount). This is what produces CPI.',
          'EVM strip — shows EV / AC / CV / CPI. Remember: progress drives EV, AC is entered manually.',
        ] },
      ] },
      { id: 'risk', nav: 'Risk', heading: '⚠️ Risk', blocks: [
        { type: 'p', text: 'Register risks with probability & impact. The app computes the score (P×I), shows a 5×5 heatmap, and EMV (Expected Monetary Value). Open risks flagged “include in reserve” add to the contingency reserve (and into BAC).' },
      ] },
      { id: 'change', nav: 'Change Request', heading: '🔁 Change Request', blocks: [
        { type: 'p', text: 'After the charter is committed, changes are raised as a Change Request: pick magnitude (MINOR/MAJOR), impact areas (cost/schedule/etc.), and whether it is chargeable. PMO/Admin approve or reject; approval unlocks the charter for revision & bumps the version.' },
      ] },
      { id: 'forecast', nav: 'Forecast & EVM Trend', heading: '🔮 Forecast & EVM Trend', blocks: [
        { type: 'bullets', items: [
          'Forecast — cost & date projection: EAC scenarios (optimistic/likely/pessimistic), ETC, VAC, TCPI, an S-curve, and a forecast finish date from SPI.',
          'EVM Trend — capture periodic "status" snapshots to see CPI/SPI & EV over time (trend chart + snapshot table).',
        ] },
      ] },
      { id: 'closeout', nav: 'Closing', heading: '🏁 Closing (Acceptance & Lessons)', blocks: [
        { type: 'bullets', items: [
          'Acceptance Sign-off — formal deliverable acceptance from the sponsor/customer (party, decision Accepted / Accepted-with-conditions / Rejected, signer name, date).',
          'Lessons Learned — Went-well / Went-wrong / Recommendation notes for future projects.',
          'Both appear as an (advisory) checklist when closing the project, and flow into the reports.',
        ] },
      ] },
      { id: 'reports', nav: 'Reports', heading: '📈 Reports', blocks: [
        { type: 'p', text: 'The Reports menu (PM & PMO) produces a single-project Status Report — Weekly or Monthly — with RAG health, % complete (by task count AND by weighted value), SPI/CPI, tasks done vs remaining, the EVM S-curve, and the forecast. Downloadable as a professional PDF.' },
      ] },
      { id: 'more2', nav: 'Issues · Agile · Timesheet', heading: '🧩 Issues, Agile & Timesheet', blocks: [
        { type: 'bullets', items: [
          'Issues — log active problems (category, impact, owner, status, resolution).',
          'Agile/Sprint — for Agile/Hybrid projects: backlog & sprints; story-point-based EVM.',
          'Timesheet — record actual man-days per manpower line (efficiency = earned ÷ consumed); "My Timesheet" (all roles) to log your own effort across projects.',
          'Lifecycle & Baseline Lock (PMO/Admin) — Activate / Put on hold / Resume / Close; locking-unlocking the baseline governs when cost/WBS can change (formal changes via a Change Request).',
        ] },
      ] },
      { id: 'audit', nav: 'Audit', heading: '🧾 Audit', blocks: [
        { type: 'p', text: 'An immutable trail of every change: who, what, when. Filterable by entity/action. Scope adapts to your role (e.g. Finance only sees the cost domain).' },
      ] },
      { id: 'lainnya', nav: 'Resource, Export & more', heading: '🧰 Resource, Export, Notifications & Attachments', blocks: [
        { type: 'bullets', items: [
          'Resource Pool (Admin/PMO/Finance) — the master resource list & rate cards; used for manpower & the Utilization view.',
          'Export — Excel/PDF buttons in the project header for a full report.',
          'Notifications — the 🔔 bell in the topbar summarises portfolio alerts (overdue tasks, high risks, over-budget).',
          'Attachments — upload files on the charter or on each risk.',
        ] },
      ] },
      { id: 'settings', nav: 'Settings', heading: '⚙️ Settings', blocks: [
        { type: 'p', text: 'Open it via the gear icon in the topbar or “Settings” in the sidebar. You can switch theme (dark/light), choose the language, and change your password (min. 10 chars with a letter & number).' },
      ] },
      { id: 'faq', nav: 'FAQ', heading: '❓ FAQ', blocks: [
        { type: 'faq', rows: [
          { q: 'Why are CPI/SPI empty (“—” / No data)?', a: 'The status date is before the project starts, or Actual Cost is still 0. Pick a relevant status date & record AC.' },
          { q: 'Why are numbers abbreviated (e.g. “Rp 2,07 M”)?', a: 'For compactness; hover to see the full value.' },
          { q: 'I can’t create a project / change something.', a: 'That is limited by your role (RBAC). Contact an Admin/PMO if you need access.' },
          { q: 'Want to change your password?', a: 'Settings → Change password. An Admin can also reset it.' },
        ] },
      ] },
    ],
  },
};

function renderBlock(b: Block, i: number) {
  switch (b.type) {
    case 'p':
      return <p key={i}>{b.text}</p>;
    case 'steps':
      return <ol key={i} className="ml-5 list-decimal space-y-1.5">{b.items.map((t, j) => <li key={j}><Lead text={t} /></li>)}</ol>;
    case 'bullets':
      return <ul key={i} className="ml-5 list-disc space-y-1.5">{b.items.map((t, j) => <li key={j}><Lead text={t} /></li>)}</ul>;
    case 'roles':
      return (
        <div key={i} className="overflow-x-auto">
          <table className="prima-rows w-full text-sm">
            <tbody>
              {b.rows.map((r, j) => (
                <tr key={j} className={j < b.rows.length - 1 ? 'border-b border-slate-100 dark:border-slate-800' : ''}>
                  <td className="py-2 pr-3 align-top"><Badge color={r.color}>{r.role}</Badge></td>
                  <td className="py-2">{r.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'faq':
      return (
        <div key={i} className="space-y-2">
          {b.rows.map((r, j) => (
            <p key={j}><span className="font-medium text-slate-800 dark:text-slate-100">{r.q}</span> {r.a}</p>
          ))}
        </div>
      );
  }
}

export default function ManualPage() {
  const { lang, setLang } = useLang();
  const doc = DOC[lang];
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">{doc.title}</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">{doc.intro}</p>
        </div>
        {/* Inline language switch (also changes the app-wide greeting language). */}
        <div className="inline-flex shrink-0 rounded-lg bg-slate-200/70 p-0.5 dark:bg-slate-700/60" aria-label={doc.switchLabel}>
          {(['id', 'en'] as Lang[]).map((l) => (
            <button
              key={l}
              onClick={() => setLang(l)}
              aria-pressed={lang === l}
              className={`rounded-md px-3 py-1 text-sm font-medium transition ${
                lang === l ? 'bg-white text-slate-800 shadow-sm dark:bg-slate-900 dark:text-white' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              {l === 'id' ? 'Indonesia' : 'English'}
            </button>
          ))}
        </div>
      </div>

      {/* Table of contents */}
      <Card>
        <div className="flex flex-wrap gap-2">
          {doc.sections.map((s) => (
            <a key={s.id} href={`#${s.id}`} className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 transition hover:border-brand-300 hover:text-brand-700 dark:border-slate-700 dark:text-slate-300 dark:hover:border-brand-700 dark:hover:text-brand-300">
              {s.nav}
            </a>
          ))}
        </div>
      </Card>

      {doc.sections.map((s) => (
        <Card key={s.id} className="scroll-mt-4">
          <h2 id={s.id} className="mb-3 text-lg font-semibold text-slate-800 dark:text-slate-100">{s.heading}</h2>
          <div className="space-y-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            {s.blocks.map(renderBlock)}
          </div>
        </Card>
      ))}

      <p className="pb-2 text-center text-xs text-slate-500 dark:text-slate-400">Prismatix — plan with clarity, deliver with confidence.</p>
    </div>
  );
}
