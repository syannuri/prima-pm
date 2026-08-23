import { appBaseUrl } from '../mailer.js';

// Pure email builders (no I/O) so they unit-test without SMTP. Each returns a subject + HTML + a plain
// text fallback (multipart/alternative). Copy is English — Prismatix serves a global audience.
export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
}

// The dark brand header band carrying the same boxed "PRISMATIX" wordmark as the login page — a
// bordered lockup with a brand accent dot. Rendered as pure inline HTML/CSS (no <img>) so it never
// depends on image loading and can't be blocked by an email client. White on the dark violet band.
function headerBand(): string {
  return `<tr><td style="background:#4c1d95;padding:18px 28px">
        <span style="display:inline-block;border:3px solid #ffffff;border-radius:6px;padding:6px 13px;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:19px;font-weight:800;letter-spacing:3px;line-height:1;color:#ffffff">PRISMATIX<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#c4b5fd;margin-left:3px;vertical-align:top"></span></span>
      </td></tr>`;
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
    ? `<p style="margin:0 0 8px;color:#64748b;font-size:13px;line-height:1.6">If the button doesn't work, copy this link into your browser:<br><a href="${cta.url}" style="color:#7c3aed;word-break:break-all">${cta.url}</a></p>`
    : '';
  return `<!doctype html><html><body style="margin:0;background:#f1f5f9;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
      ${headerBand()}
      <tr><td style="padding:28px">
        <h1 style="margin:0 0 16px;color:#0f172a;font-size:20px">${heading}</h1>
        ${body}${button}${fallback}
      </td></tr>
      <tr><td style="padding:16px 28px;border-top:1px solid #f1f5f9"><p style="margin:0;color:#94a3b8;font-size:12px">Prismatix — project management platform. This is an automated message; please don't reply.</p></td></tr>
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
    subject: 'Activate your Prismatix account',
    html: layout(
      `Hi ${opts.name}, activate your account`,
      [
        'Thanks for signing up to Prismatix. One more step — confirm this email address to activate your account and sign in.',
        'This activation link is valid for 24 hours.',
      ],
      { label: 'Activate account', url },
    ),
    text: textBlock([
      `Hi ${opts.name},`,
      'Activate your Prismatix account by opening this link (valid for 24 hours):',
      url,
      "If you didn't sign up, you can ignore this email.",
    ]),
  };
}

// Org signup approved by a platform admin: the workspace is live, the owner can sign in.
export function orgApprovedMail(opts: { name: string; orgName: string; loginUrl: string }): RenderedMail {
  return {
    subject: `Workspace “${opts.orgName}” approved`,
    html: layout(
      `Congratulations, ${opts.name}!`,
      [
        `Your workspace request <strong>${opts.orgName}</strong> has been approved. You can now sign in as an admin and start inviting your team.`,
      ],
      { label: 'Sign in to Prismatix', url: opts.loginUrl },
    ),
    text: textBlock([
      `Congratulations, ${opts.name}!`,
      `Workspace "${opts.orgName}" has been approved. Sign in:`,
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
  const when = opts.cadence === 'DAILY' ? 'daily' : 'weekly';
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
      const more = p.total > p.lines.length ? `<li style="margin:2px 0 0;color:#94a3b8;font-size:13px;list-style:none">+ ${p.total - p.lines.length} more</li>` : '';
      const highChip = p.high > 0 ? `<span style="background:#fee2e2;color:#b91c1c;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;margin-left:8px">${p.high} high</span>` : '';
      return `<div style="margin:0 0 20px">
        <p style="margin:0 0 8px;font-size:15px"><a href="${projUrl(p)}" style="color:#4c1d95;font-weight:700;text-decoration:none">${p.name}</a> <span style="color:#94a3b8;font-size:13px">(${p.code})</span>${highChip}</p>
        <ul style="margin:0;padding:0 0 0 18px">${items}${more}</ul>
      </div>`;
    })
    .join('');

  const heading = `${when === 'daily' ? 'Daily' : 'Weekly'} alert digest`;
  const projWord = opts.projects.length === 1 ? 'project' : 'projects';
  const intro = `Hi ${opts.name}, there are <strong>${opts.totalAlerts}</strong> active alerts across ${opts.projects.length} ${projWord}${opts.totalHigh > 0 ? ` (<strong style="color:#b91c1c">${opts.totalHigh} high priority</strong>)` : ''} that need your attention.`;
  const html = `<!doctype html><html><body style="margin:0;background:#f1f5f9;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
      ${headerBand()}
      <tr><td style="padding:28px">
        <h1 style="margin:0 0 12px;color:#0f172a;font-size:20px">${heading}</h1>
        <p style="margin:0 0 20px;color:#334155;font-size:15px;line-height:1.6">${intro}</p>
        ${blocks}
        <p style="margin:24px 0 0"><a href="${base}/dashboard" style="background:#7c3aed;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;font-size:15px;display:inline-block">Open dashboard</a></p>
      </td></tr>
      <tr><td style="padding:16px 28px;border-top:1px solid #f1f5f9"><p style="margin:0;color:#94a3b8;font-size:12px">Automatic ${when} summary. Manage the frequency or turn it off in account settings. Please don't reply.</p></td></tr>
    </table>
  </td></tr></table>
</body></html>`;

  const textLines = opts.projects.map((p) => {
    const items = p.lines.map((l) => `  - ${l.message}`).join('\n');
    const more = p.total > p.lines.length ? `\n  + ${p.total - p.lines.length} more` : '';
    return `${p.name} (${p.code})${p.high > 0 ? ` — ${p.high} high` : ''}\n${items}${more}`;
  });
  return {
    subject: `${when === 'daily' ? 'Daily' : 'Weekly'} alert digest: ${opts.totalAlerts} need attention`,
    html,
    text: textBlock([
      `Hi ${opts.name},`,
      `${opts.totalAlerts} active alerts across ${opts.projects.length} ${projWord}${opts.totalHigh > 0 ? ` (${opts.totalHigh} high priority)` : ''}:`,
      ...textLines,
      `Open dashboard: ${base}/dashboard`,
    ]),
  };
}

// Heads-up to platform admins that a new corporate signup is awaiting review.
export function orgSignupAdminAlertMail(opts: { orgName: string }): RenderedMail {
  const url = `${appBaseUrl()}/admin/tenants`;
  return {
    subject: `New workspace request: ${opts.orgName}`,
    html: layout(
      'A workspace is awaiting approval',
      [`Organization <strong>${opts.orgName}</strong> just signed up and is awaiting review in the platform console.`],
      { label: 'Open the approval queue', url },
    ),
    text: textBlock([`Organization "${opts.orgName}" is awaiting approval.`, `Review at: ${url}`]),
  };
}

// --- Approval workflow (transactional) --------------------------------------
// `phrase` is a lowercase English noun-phrase for the item under approval, e.g. `change request "…"`,
// `a cost baseline lock`, `a project closure`. `where` is the project context, e.g. `on "Name" (CODE)`.
// Callers assemble both.
const capFirst = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// An approver has a new item awaiting their decision → deep-links to the approvals inbox (focused).
export function approvalPendingMail(opts: { phrase: string; where: string; stepName: string; url: string }): RenderedMail {
  return {
    subject: `Approval needed: ${capFirst(opts.phrase)}`,
    html: layout(
      'Something needs your approval',
      [`${capFirst(opts.phrase)} ${opts.where} needs your decision (step "${opts.stepName}").`],
      { label: 'Review & decide', url: opts.url },
    ),
    text: textBlock([`${capFirst(opts.phrase)} ${opts.where} needs your decision (step "${opts.stepName}").`, `Review & decide: ${opts.url}`]),
  };
}

// The requester's item was decided (approved/rejected) → deep-links to the entity's project tab.
export function approvalDecidedMail(opts: { phrase: string; where: string; outcome: 'APPROVED' | 'REJECTED'; url: string }): RenderedMail {
  const verb = opts.outcome === 'APPROVED' ? 'approved' : 'rejected';
  return {
    subject: `${capFirst(opts.phrase)} ${verb}`,
    html: layout(
      opts.outcome === 'APPROVED' ? 'Your request was approved' : 'Your request was rejected',
      [`${capFirst(opts.phrase)} ${opts.where} was <strong>${verb}</strong>.`],
      { label: 'View details', url: opts.url },
    ),
    text: textBlock([`${capFirst(opts.phrase)} ${opts.where} was ${verb}.`, `View details: ${opts.url}`]),
  };
}

// The requester's item was submitted and is now awaiting approval → deep-links to the entity.
export function approvalUnderReviewMail(opts: { phrase: string; where: string; url: string }): RenderedMail {
  return {
    subject: `${capFirst(opts.phrase)} is under review`,
    html: layout(
      'Your request is under review',
      [`${capFirst(opts.phrase)} ${opts.where} has been submitted and is awaiting approval. You'll be notified once it's decided.`],
      { label: 'View status', url: opts.url },
    ),
    text: textBlock([`${capFirst(opts.phrase)} ${opts.where} is awaiting approval.`, `View status: ${opts.url}`]),
  };
}

// A change request was submitted and awaits an approver's decision (legacy single-decider path, used
// when no approval workflow is configured). Deep-links to the project's Change Req tab.
export function crSubmittedMail(opts: { title: string; where: string; url: string }): RenderedMail {
  return {
    subject: `Change request awaits your decision: ${opts.title}`,
    html: layout(
      'A change request needs your approval',
      [`Change request "<strong>${opts.title}</strong>" ${opts.where} has been submitted and awaits your decision.`],
      { label: 'Review the change request', url: opts.url },
    ),
    text: textBlock([`Change request "${opts.title}" ${opts.where} awaits your decision.`, `Review: ${opts.url}`]),
  };
}

// A change request was decided → tell the requesting PM. On approval that opened the baseline, the
// copy reminds them to re-baseline & re-lock on Cost once the change is applied. Deep-links to the
// CR's target tab.
export function crDecidedMail(opts: { title: string; where: string; outcome: 'APPROVED' | 'REJECTED'; baselineOpened: boolean; url: string }): RenderedMail {
  const approved = opts.outcome === 'APPROVED';
  const verb = approved ? 'approved' : 'rejected';
  const paras = [`Change request "<strong>${opts.title}</strong>" ${opts.where} was <strong>${verb}</strong>.`];
  if (opts.baselineOpened) {
    paras.push("The cost &amp; schedule baseline has been <strong>opened</strong> so the change can be applied. When you're done, <strong>re-baseline and lock it again</strong> on the Cost tab so EVM &amp; variance stay meaningful.");
  }
  return {
    subject: `Change request "${opts.title}" ${verb}`,
    html: layout(
      approved ? 'Your change request was approved' : 'Your change request was rejected',
      paras,
      { label: approved && opts.baselineOpened ? 'Apply & lock baseline' : 'View details', url: opts.url },
    ),
    text: textBlock([
      `Change request "${opts.title}" ${opts.where} was ${verb}.`,
      ...(opts.baselineOpened ? ['The baseline was opened — apply the change, then re-baseline & lock it again on the Cost tab.'] : []),
      `Open: ${opts.url}`,
    ]),
  };
}

// An approval blew its SLA deadline → notify the escalation target(s); links to the inbox (focused).
export function approvalOverdueMail(opts: { phrase: string; where: string; stepName: string; url: string }): RenderedMail {
  return {
    subject: `Approval overdue: ${capFirst(opts.phrase)}`,
    html: layout(
      'Approval overdue',
      [`${capFirst(opts.phrase)} ${opts.where} has passed its deadline at step "${opts.stepName}" and needs attention.`],
      { label: 'Review now', url: opts.url },
    ),
    text: textBlock([`${capFirst(opts.phrase)} ${opts.where} is past its deadline (step "${opts.stepName}").`, `Review: ${opts.url}`]),
  };
}
