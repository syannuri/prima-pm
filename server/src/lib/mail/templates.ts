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
