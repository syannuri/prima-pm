import { appBaseUrl } from '../mailer.js';

// Pure email builders (no I/O) so they unit-test without SMTP. Each returns a subject + HTML + a plain
// text fallback (multipart/alternative). Copy is Indonesian to match the product UI.
export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
}

// Minimal branded HTML shell — inline styles only (email clients strip <style>/external CSS). The
// amethyst accent mirrors the app chrome. `cta` is an optional {label,url} primary button.
function layout(heading: string, paragraphs: string[], cta?: { label: string; url: string }): string {
  const body = paragraphs
    .map((p) => `<p style="margin:0 0 16px;color:#334155;font-size:15px;line-height:1.6">${p}</p>`)
    .join('');
  const button = cta
    ? `<p style="margin:24px 0"><a href="${cta.url}" style="background:#7c3aed;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;font-size:15px;display:inline-block">${cta.label}</a></p>`
    : '';
  const fallback = cta
    ? `<p style="margin:0 0 8px;color:#64748b;font-size:13px;line-height:1.6">Kalau tombol tidak berfungsi, salin tautan ini ke browser:<br><a href="${cta.url}" style="color:#7c3aed;word-break:break-all">${cta.url}</a></p>`
    : '';
  return `<!doctype html><html><body style="margin:0;background:#f1f5f9;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
      <tr><td style="background:#4c1d95;padding:18px 28px"><span style="color:#fff;font-size:18px;font-weight:700;letter-spacing:.3px">Prismatix</span></td></tr>
      <tr><td style="padding:28px">
        <h1 style="margin:0 0 16px;color:#0f172a;font-size:20px">${heading}</h1>
        ${body}${button}${fallback}
      </td></tr>
      <tr><td style="padding:16px 28px;border-top:1px solid #f1f5f9"><p style="margin:0;color:#94a3b8;font-size:12px">Prismatix — platform manajemen proyek. Email ini dikirim otomatis, mohon tidak membalas.</p></td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

function textBlock(lines: string[]): string {
  return lines.join('\n\n') + '\n\n— Prismatix';
}

// New account (guest / provisioned tenant admin / org owner): activate by confirming the email.
export function verifyEmailMail(opts: { name: string; token: string }): RenderedMail {
  const url = `${appBaseUrl()}/verify-email?token=${encodeURIComponent(opts.token)}`;
  return {
    subject: 'Aktivasi akun Prismatix kamu',
    html: layout(
      `Halo ${opts.name}, aktifkan akunmu`,
      [
        'Terima kasih sudah mendaftar di Prismatix. Satu langkah lagi: konfirmasi alamat email ini untuk mengaktifkan akun dan mulai masuk.',
        'Tautan aktivasi berlaku 24 jam.',
      ],
      { label: 'Aktifkan akun', url },
    ),
    text: textBlock([
      `Halo ${opts.name},`,
      'Aktifkan akun Prismatix-mu dengan membuka tautan berikut (berlaku 24 jam):',
      url,
      'Kalau kamu tidak merasa mendaftar, abaikan saja email ini.',
    ]),
  };
}

// Org signup approved by a platform admin: the workspace is live, the owner can sign in.
export function orgApprovedMail(opts: { name: string; orgName: string; loginUrl: string }): RenderedMail {
  return {
    subject: `Workspace “${opts.orgName}” sudah disetujui`,
    html: layout(
      `Selamat ${opts.name}!`,
      [
        `Permintaan workspace <strong>${opts.orgName}</strong> telah disetujui. Kamu sekarang bisa masuk sebagai admin dan mulai mengundang tim.`,
      ],
      { label: 'Masuk ke Prismatix', url: opts.loginUrl },
    ),
    text: textBlock([
      `Selamat ${opts.name}!`,
      `Workspace "${opts.orgName}" telah disetujui. Silakan masuk:`,
      opts.loginUrl,
    ]),
  };
}

// Emailed alert digest: a per-project rollup of a user's open alerts (overdue / due-soon / risk /
// budget) with the top few lines each, deep-linking into the affected tab. `cadence` tunes the copy.
export interface DigestProject {
  projectId: string;
  code: string;
  name: string;
  total: number;
  high: number;
  // The top alert lines to show inline (already trimmed by the caller), each with a deep-link tab.
  lines: { message: string; tab: string; entityId?: string }[];
}
export function alertDigestMail(opts: {
  name: string;
  cadence: 'DAILY' | 'WEEKLY';
  projects: DigestProject[];
  totalAlerts: number;
  totalHigh: number;
}): RenderedMail {
  const base = appBaseUrl();
  const when = opts.cadence === 'DAILY' ? 'harian' : 'mingguan';
  const projUrl = (p: DigestProject, tab?: string) =>
    `${base}/projects/${p.projectId}${tab ? `?tab=${encodeURIComponent(tab)}` : ''}`;

  // Per-project block: a heading link + up to N alert lines. Inline styles only (email-safe).
  const blocks = opts.projects
    .map((p) => {
      const items = p.lines
        .map(
          (l) =>
            `<li style="margin:0 0 6px;color:#334155;font-size:14px;line-height:1.5"><a href="${projUrl(p, l.tab)}${l.entityId ? `&focus=${encodeURIComponent(l.entityId)}` : ''}" style="color:#334155;text-decoration:none">${l.message}</a></li>`,
        )
        .join('');
      const more = p.total > p.lines.length ? `<li style="margin:2px 0 0;color:#94a3b8;font-size:13px;list-style:none">+ ${p.total - p.lines.length} lagi</li>` : '';
      const highChip = p.high > 0 ? `<span style="background:#fee2e2;color:#b91c1c;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;margin-left:8px">${p.high} tinggi</span>` : '';
      return `<div style="margin:0 0 20px">
        <p style="margin:0 0 8px;font-size:15px"><a href="${projUrl(p)}" style="color:#4c1d95;font-weight:700;text-decoration:none">${p.name}</a> <span style="color:#94a3b8;font-size:13px">(${p.code})</span>${highChip}</p>
        <ul style="margin:0;padding:0 0 0 18px">${items}${more}</ul>
      </div>`;
    })
    .join('');

  const heading = `Ringkasan peringatan ${when}`;
  const intro = `Halo ${opts.name}, ada <strong>${opts.totalAlerts}</strong> peringatan aktif di ${opts.projects.length} proyek${opts.totalHigh > 0 ? ` (<strong style="color:#b91c1c">${opts.totalHigh} prioritas tinggi</strong>)` : ''} yang perlu perhatianmu.`;
  const html = `<!doctype html><html><body style="margin:0;background:#f1f5f9;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
      <tr><td style="background:#4c1d95;padding:18px 28px"><span style="color:#fff;font-size:18px;font-weight:700;letter-spacing:.3px">Prismatix</span></td></tr>
      <tr><td style="padding:28px">
        <h1 style="margin:0 0 12px;color:#0f172a;font-size:20px">${heading}</h1>
        <p style="margin:0 0 20px;color:#334155;font-size:15px;line-height:1.6">${intro}</p>
        ${blocks}
        <p style="margin:24px 0 0"><a href="${base}/dashboard" style="background:#7c3aed;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;font-size:15px;display:inline-block">Buka dashboard</a></p>
      </td></tr>
      <tr><td style="padding:16px 28px;border-top:1px solid #f1f5f9"><p style="margin:0;color:#94a3b8;font-size:12px">Ringkasan ${when} otomatis. Atur frekuensi atau matikan di Pengaturan akun. Mohon tidak membalas email ini.</p></td></tr>
    </table>
  </td></tr></table>
</body></html>`;

  const textLines = opts.projects.map((p) => {
    const items = p.lines.map((l) => `  - ${l.message}`).join('\n');
    const more = p.total > p.lines.length ? `\n  + ${p.total - p.lines.length} lagi` : '';
    return `${p.name} (${p.code})${p.high > 0 ? ` — ${p.high} tinggi` : ''}\n${items}${more}`;
  });
  return {
    subject: `Ringkasan peringatan ${when}: ${opts.totalAlerts} perlu perhatian`,
    html,
    text: textBlock([
      `Halo ${opts.name},`,
      `${opts.totalAlerts} peringatan aktif di ${opts.projects.length} proyek${opts.totalHigh > 0 ? ` (${opts.totalHigh} prioritas tinggi)` : ''}:`,
      ...textLines,
      `Buka dashboard: ${base}/dashboard`,
    ]),
  };
}

// Heads-up to platform admins that a new corporate signup is awaiting review.
export function orgSignupAdminAlertMail(opts: { orgName: string }): RenderedMail {
  const url = `${appBaseUrl()}/admin/tenants`;
  return {
    subject: `Permintaan workspace baru: ${opts.orgName}`,
    html: layout(
      'Ada workspace menunggu persetujuan',
      [`Organisasi <strong>${opts.orgName}</strong> baru saja mendaftar dan menunggu review di konsol platform.`],
      { label: 'Buka antrean persetujuan', url },
    ),
    text: textBlock([`Organisasi "${opts.orgName}" menunggu persetujuan.`, `Review di: ${url}`]),
  };
}

// --- Approval workflow (transactional) --------------------------------------
// `phrase` is a lowercase Indonesian noun-phrase for the item under approval, e.g.
// `permintaan perubahan "…"`, `penguncian baseline biaya`, `penutupan proyek`. `where` is the
// project context, e.g. `pada proyek "Nama" (KODE)`. Callers assemble both.
const capFirst = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// An approver has a new item awaiting their decision → deep-links to the approvals inbox (focused).
export function approvalPendingMail(opts: { phrase: string; where: string; stepName: string; url: string }): RenderedMail {
  return {
    subject: `Persetujuan diperlukan: ${capFirst(opts.phrase)}`,
    html: layout(
      'Ada yang menunggu persetujuanmu',
      [`${capFirst(opts.phrase)} ${opts.where} menunggu keputusanmu (langkah "${opts.stepName}").`],
      { label: 'Tinjau & putuskan', url: opts.url },
    ),
    text: textBlock([`${capFirst(opts.phrase)} ${opts.where} menunggu keputusanmu (langkah "${opts.stepName}").`, `Tinjau & putuskan: ${opts.url}`]),
  };
}

// The requester's item was decided (approved/rejected) → deep-links to the entity's project tab.
export function approvalDecidedMail(opts: { phrase: string; where: string; outcome: 'APPROVED' | 'REJECTED'; url: string }): RenderedMail {
  const verb = opts.outcome === 'APPROVED' ? 'disetujui' : 'ditolak';
  return {
    subject: `${capFirst(opts.phrase)} ${verb}`,
    html: layout(
      opts.outcome === 'APPROVED' ? 'Permintaanmu disetujui' : 'Permintaanmu ditolak',
      [`${capFirst(opts.phrase)} ${opts.where} telah <strong>${verb}</strong>.`],
      { label: 'Lihat detail', url: opts.url },
    ),
    text: textBlock([`${capFirst(opts.phrase)} ${opts.where} telah ${verb}.`, `Lihat detail: ${opts.url}`]),
  };
}

// The requester's item was submitted and is now awaiting approval → deep-links to the entity.
export function approvalUnderReviewMail(opts: { phrase: string; where: string; url: string }): RenderedMail {
  return {
    subject: `${capFirst(opts.phrase)} sedang ditinjau`,
    html: layout(
      'Permintaanmu sedang ditinjau',
      [`${capFirst(opts.phrase)} ${opts.where} telah dikirim dan sedang menunggu persetujuan. Kamu akan diberi tahu begitu ada keputusan.`],
      { label: 'Lihat status', url: opts.url },
    ),
    text: textBlock([`${capFirst(opts.phrase)} ${opts.where} sedang menunggu persetujuan.`, `Lihat status: ${opts.url}`]),
  };
}

// A change request was decided → tell the requesting PM. On approval that opened the baseline, the
// copy reminds them to re-baseline & re-lock on Cost once the change is applied. Deep-links to the
// CR's target tab.
export function crDecidedMail(opts: { title: string; where: string; outcome: 'APPROVED' | 'REJECTED'; baselineOpened: boolean; url: string }): RenderedMail {
  const approved = opts.outcome === 'APPROVED';
  const verb = approved ? 'disetujui' : 'ditolak';
  const paras = [`Permintaan perubahan "<strong>${opts.title}</strong>" ${opts.where} telah <strong>${verb}</strong>.`];
  if (opts.baselineOpened) {
    paras.push('Baseline biaya & jadwal telah <strong>dibuka</strong> agar perubahan bisa diterapkan. Setelah selesai, lakukan <strong>re-baseline lalu kunci kembali</strong> di tab Cost agar EVM/variansi kembali terukur.');
  }
  return {
    subject: `Permintaan perubahan "${opts.title}" ${verb}`,
    html: layout(
      approved ? 'Permintaan perubahanmu disetujui' : 'Permintaan perubahanmu ditolak',
      paras,
      { label: approved && opts.baselineOpened ? 'Terapkan & kunci baseline' : 'Lihat detail', url: opts.url },
    ),
    text: textBlock([
      `Permintaan perubahan "${opts.title}" ${opts.where} telah ${verb}.`,
      ...(opts.baselineOpened ? ['Baseline dibuka — terapkan perubahan lalu re-baseline & kunci kembali di tab Cost.'] : []),
      `Buka: ${opts.url}`,
    ]),
  };
}

// An approval blew its SLA deadline → notify the escalation target(s); links to the inbox (focused).
export function approvalOverdueMail(opts: { phrase: string; where: string; stepName: string; url: string }): RenderedMail {
  return {
    subject: `Persetujuan melewati tenggat: ${capFirst(opts.phrase)}`,
    html: layout(
      'Persetujuan melewati tenggat',
      [`${capFirst(opts.phrase)} ${opts.where} sudah melewati tenggat pada langkah "${opts.stepName}" dan perlu segera ditangani.`],
      { label: 'Tinjau sekarang', url: opts.url },
    ),
    text: textBlock([`${capFirst(opts.phrase)} ${opts.where} melewati tenggat (langkah "${opts.stepName}").`, `Tinjau: ${opts.url}`]),
  };
}
