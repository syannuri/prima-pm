import { Badge, Card } from '../components/ui';

// In-app user manual (Bahasa Indonesia). Static content — references the English UI labels.

const TOC: { id: string; label: string }[] = [
  { id: 'mulai', label: 'Mulai cepat' },
  { id: 'konsep', label: 'Konsep penting (EVM)' },
  { id: 'peran', label: 'Peran & hak akses' },
  { id: 'alur', label: 'Alur kerja proyek' },
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'charter', label: 'Charter' },
  { id: 'schedule', label: 'WBS & Schedule' },
  { id: 'cost', label: 'Cost & EVM' },
  { id: 'risk', label: 'Risk' },
  { id: 'change', label: 'Change Request' },
  { id: 'audit', label: 'Audit' },
  { id: 'lainnya', label: 'Resource, Export & lainnya' },
  { id: 'settings', label: 'Settings' },
  { id: 'faq', label: 'FAQ' },
];

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <Card className="scroll-mt-4">
      <h2 id={id} className="mb-3 text-lg font-semibold text-slate-800 dark:text-slate-100">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{children}</div>
    </Card>
  );
}

const Term = ({ children }: { children: React.ReactNode }) => (
  <span className="font-medium text-slate-800 dark:text-slate-100">{children}</span>
);

export default function ManualPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Manual Pengguna</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Panduan memakai <strong>Precise</strong> — aplikasi manajemen proyek end-to-end. Label menu di aplikasi memakai bahasa Inggris; panduan ini menjelaskannya dalam Bahasa Indonesia.
        </p>
      </div>

      {/* Daftar isi */}
      <Card>
        <div className="flex flex-wrap gap-2">
          {TOC.map((t) => (
            <a key={t.id} href={`#${t.id}`} className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 transition hover:border-brand-300 hover:text-brand-700 dark:border-slate-700 dark:text-slate-300 dark:hover:border-brand-700 dark:hover:text-brand-300">
              {t.label}
            </a>
          ))}
        </div>
      </Card>

      <Section id="mulai" title="🚀 Mulai cepat">
        <p>Precise membantu Anda merencanakan dan memantau proyek dari awal sampai selesai: <Term>Charter → WBS/Jadwal → Biaya → Risiko → Perubahan</Term>, dengan analisis kinerja <Term>Earned Value (EVM)</Term>.</p>
        <ol className="ml-5 list-decimal space-y-1">
          <li>Masuk dengan akun Anda. Tampilan default <Term>dark mode</Term> (bisa diganti di Settings).</li>
          <li>Dari <Term>Dashboard</Term>, lihat ringkasan portfolio atau buka satu proyek dari sidebar kiri.</li>
          <li>Proyek baru dibuat oleh <Term>Admin/PMO</Term> lewat tombol <Term>“+ New Project”</Term>.</li>
          <li>Di dalam proyek, kerjakan tiap tab berurutan: <Term>Charter → Schedule → Cost → Risk</Term>.</li>
        </ol>
      </Section>

      <Section id="konsep" title="📐 Konsep penting (EVM)">
        <p>Beberapa istilah inti yang dipakai di seluruh aplikasi:</p>
        <ul className="ml-5 list-disc space-y-1.5">
          <li><Term>BAC (PMB)</Term> — Budget at Completion / Performance Measurement Baseline = biaya langsung + tak langsung + cadangan kontingensi. <em>Tidak termasuk</em> management reserve (itu ditampilkan terpisah sebagai “Total Budget”).</li>
          <li><Term>EV (Earned Value)</Term> — nilai pekerjaan yang sudah diselesaikan = % progress × anggaran. Digerakkan oleh <em>progress</em>, bukan oleh pengeluaran.</li>
          <li><Term>AC (Actual Cost)</Term> — uang yang benar-benar dikeluarkan. <em>Diinput manual</em> di tab Cost.</li>
          <li><Term>PV (Planned Value)</Term> — nilai pekerjaan yang seharusnya selesai pada tanggal status, mengacu pada baseline jadwal.</li>
          <li><Term>CPI</Term> = EV ÷ AC. &gt; 1 hemat, &lt; 1 boros. Jika AC = 0, CPI tampil “—”.</li>
          <li><Term>SPI</Term> = EV ÷ PV. &gt; 1 lebih cepat dari jadwal, &lt; 1 terlambat.</li>
          <li><Term>Status date</Term> — tanggal acuan perhitungan EVM (bisa diubah di Dashboard). Tanggal sebelum proyek mulai akan menghasilkan “No data”.</li>
        </ul>
      </Section>

      <Section id="peran" title="👥 Peran & hak akses (RBAC)">
        <p>Apa yang bisa Anda lihat/ubah tergantung peran:</p>
        <div className="overflow-x-auto">
          <table className="prima-rows w-full text-sm">
            <thead><tr className="border-b text-left text-xs uppercase text-slate-400 dark:text-slate-500"><th className="py-2">Peran</th><th>Akses utama</th></tr></thead>
            <tbody>
              <tr className="border-b border-slate-100 dark:border-slate-800"><td className="py-2"><Badge color="coral">ADMIN</Badge></td><td>Akses penuh + kelola pengguna.</td></tr>
              <tr className="border-b border-slate-100 dark:border-slate-800"><td className="py-2"><Badge color="indigo">PMO</Badge></td><td>Lihat semua proyek, buat & tetapkan PM, setujui Change Request.</td></tr>
              <tr className="border-b border-slate-100 dark:border-slate-800"><td className="py-2"><Badge color="sky">PROJECT_MANAGER</Badge></td><td>Kelola proyek yang ditugaskan (Charter, WBS, Cost, Risk).</td></tr>
              <tr className="border-b border-slate-100 dark:border-slate-800"><td className="py-2"><Badge color="amber">FINANCE</Badge></td><td>Lihat & kelola biaya lintas proyek; audit domain biaya.</td></tr>
              <tr className="border-b border-slate-100 dark:border-slate-800"><td className="py-2"><Badge color="amber">RISK_OFFICER</Badge></td><td>Lihat & kelola risiko; audit domain risiko.</td></tr>
              <tr className="border-b border-slate-100 dark:border-slate-800"><td className="py-2"><Badge color="slate">TEAM_MEMBER</Badge></td><td>Anggota tim / PIC tugas.</td></tr>
              <tr><td className="py-2"><Badge color="slate">VIEWER</Badge></td><td>Hanya melihat.</td></tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="alur" title="🔄 Alur kerja proyek (end-to-end)">
        <ol className="ml-5 list-decimal space-y-1.5">
          <li><Term>Charter</Term> — isi piagam proyek, lalu <Term>Commit</Term> untuk mengunci baseline & membuka modul lain.</li>
          <li><Term>Schedule/WBS</Term> — susun rincian pekerjaan, atur tanggal & progress, lalu <Term>Set Baseline</Term>.</li>
          <li><Term>Cost</Term> — masukkan biaya langsung/tak langsung & rencana manpower; catat Actual Cost berkala.</li>
          <li><Term>Risk</Term> — daftarkan risiko; EMV otomatis mengisi cadangan kontingensi.</li>
          <li>Saat ada perubahan setelah commit → ajukan <Term>Change Request</Term> untuk disetujui PMO/Admin.</li>
          <li>Pantau kesehatan di <Term>Dashboard</Term> & ekspor laporan PDF/Excel kapan saja.</li>
        </ol>
      </Section>

      <Section id="dashboard" title="📊 Dashboard">
        <p>Tiga tampilan lewat tombol di kanan atas:</p>
        <ul className="ml-5 list-disc space-y-1">
          <li><Term>Portfolio EVM</Term> — KPI (Total BAC, EV, AC, CPI, SPI, % Complete), panel <Term>“Needs attention”</Term>, kesehatan jadwal, dan diagram status.</li>
          <li><Term>Utilization</Term> — heatmap beban vs kapasitas sumber daya; sel merah = over-alokasi.</li>
          <li><Term>Project Cards</Term> — kartu ringkas tiap proyek (progress, status, BAC).</li>
        </ul>
        <p>Atur <Term>Status date</Term> ke tanggal yang relevan agar CPI/SPI terisi. Warna merah hanya untuk hal yang benar-benar perlu perhatian.</p>
      </Section>

      <Section id="charter" title="📜 Charter">
        <p>Piagam proyek: deskripsi, tujuan, lingkup, kategori, PM, jadwal & biaya tingkat-tinggi. Klik <Term>Commit Charter</Term> untuk mengunci baseline — setelah ini perubahan harus lewat Change Request. Dokumen pendukung bisa dilampirkan.</p>
      </Section>

      <Section id="schedule" title="🗓️ WBS & Schedule">
        <ul className="ml-5 list-disc space-y-1">
          <li><Term>WBS</Term> — struktur rincian kerja (tugas & subtugas), nomor outline, %-progress, PIC, dan kamus WBS (deliverable, kriteria).</li>
          <li><Term>Gantt</Term> interaktif — geser bar untuk menjadwal ulang, tarik untuk membuat dependensi.</li>
          <li><Term>Set Baseline</Term> — simpan tanggal rencana sebagai acuan; kolom “Var” menampilkan selisih jadwal (tracking Gantt).</li>
          <li>Klik lingkaran centang untuk menandai tugas selesai (auto mengisi tanggal aktual).</li>
        </ul>
      </Section>

      <Section id="cost" title="💰 Cost & EVM">
        <ul className="ml-5 list-disc space-y-1">
          <li><Term>Direct Cost</Term> — material (qty × harga) dan manpower (rate × mandays); manpower bisa ditautkan ke resource & tugas.</li>
          <li><Term>Indirect Cost</Term> — transport, akomodasi, dll.</li>
          <li><Term>Actual Cost</Term> — catat pengeluaran nyata (tanggal + jumlah). Ini yang memunculkan CPI.</li>
          <li>Strip <Term>EVM</Term> menampilkan EV / AC / CV / CPI. Ingat: progress menggerakkan EV, AC diinput manual.</li>
        </ul>
      </Section>

      <Section id="risk" title="⚠️ Risk">
        <p>Daftarkan risiko dengan probabilitas & dampak. Aplikasi menghitung skor (P×I), menampilkan <Term>heatmap 5×5</Term>, dan <Term>EMV</Term> (Expected Monetary Value). Risiko terbuka yang ditandai “include in reserve” akan menambah cadangan kontingensi (dan ikut ke BAC).</p>
      </Section>

      <Section id="change" title="🔁 Change Request">
        <p>Setelah charter di-commit, perubahan diajukan sebagai Change Request: pilih magnitudo (MINOR/MAJOR), area dampak (biaya/jadwal/dll.), dan apakah <em>chargeable</em>. <Term>PMO/Admin</Term> menyetujui atau menolak; persetujuan membuka charter untuk revisi & menaikkan versi.</p>
      </Section>

      <Section id="audit" title="🧾 Audit">
        <p>Jejak tak-terubah (immutable) atas semua perubahan: siapa, apa, kapan. Bisa difilter per entitas/aksi. Cakupannya menyesuaikan peran (mis. Finance hanya melihat domain biaya).</p>
      </Section>

      <Section id="lainnya" title="🧰 Resource, Export, Notifikasi & Lampiran">
        <ul className="ml-5 list-disc space-y-1">
          <li><Term>Resource Pool</Term> (Admin/PMO/Finance) — master sumber daya & rate card; dipakai pada manpower dan tampilan Utilization.</li>
          <li><Term>Export</Term> — tombol Excel/PDF di header proyek untuk laporan lengkap.</li>
          <li><Term>Notifikasi</Term> — ikon lonceng 🔔 di topbar merangkum peringatan lintas proyek (tugas telat, risiko tinggi, over-budget).</li>
          <li><Term>Lampiran</Term> — unggah berkas pada charter atau tiap risiko.</li>
        </ul>
      </Section>

      <Section id="settings" title="⚙️ Settings">
        <p>Buka lewat ikon gear di topbar atau “Settings” di sidebar. Anda bisa: mengganti <Term>tema</Term> (gelap/terang), memilih <Term>bahasa</Term> sapaan (otomatis dari browser), dan <Term>mengganti password</Term> (min. 10 karakter, ada huruf & angka).</p>
      </Section>

      <Section id="faq" title="❓ FAQ">
        <p><Term>Kenapa CPI/SPI kosong (“—” / No data)?</Term> Karena Status date sebelum proyek mulai, atau Actual Cost masih 0. Pilih tanggal status yang lebih relevan & catat AC.</p>
        <p><Term>Kenapa angka tampil ringkas (mis. “Rp 2,07 M”)?</Term> Untuk ringkas; arahkan kursor (hover) untuk melihat nilai penuh.</p>
        <p><Term>Saya tidak bisa membuat proyek / mengubah sesuatu.</Term> Itu dibatasi peran (RBAC). Hubungi Admin/PMO bila perlu akses.</p>
        <p><Term>Lupa/ingin ganti password?</Term> Settings → Change password. Admin juga bisa mereset.</p>
      </Section>

      <p className="pb-2 text-center text-xs text-slate-400 dark:text-slate-500">Precise — rencanakan dengan jelas, deliver dengan percaya diri.</p>
    </div>
  );
}
