import { prisma } from '../../lib/prisma.js';
import { runAsSystem, runWithTenant } from '../../lib/tenant/context.js';
import { emailEnabled, sendMail } from '../../lib/mailer.js';
import { alertDigestMail, type DigestProject } from '../../lib/mail/templates.js';
import { getPortfolioAlertDetail } from './notification.service.js';
import { logger } from '../../lib/observability.js';

// The emailed alert digest. A best-effort sweep (mirrors the trial-reminder / auto-capture sweeps in
// server.ts): every hour it checks whether we're in the send window and mails each opted-in,
// verified, non-guest user their open-alert rollup. Dormant unless SMTP is configured.

// Keep the email compact — a digest is a nudge, not a report. The full list lives in-app.
const MAX_PROJECTS = 8;
const MAX_LINES_PER_PROJECT = 4;

// Read the schedule live from the env (like the mailer) so ops can retune without a rebuild and
// tests can pin it. Hour is server-local 0..23; weekday 0=Sun..6=Sat (weekly sends on this day).
function digestSchedule(): { hour: number; weekday: number } {
  const hour = Number(process.env.DIGEST_HOUR ?? 7);
  const weekday = Number(process.env.DIGEST_WEEKDAY ?? 1); // Monday
  return {
    hour: Number.isFinite(hour) ? hour : 7,
    weekday: Number.isFinite(weekday) ? weekday : 1,
  };
}

type Cadence = 'DAILY' | 'WEEKLY';

// Is this user due right now? The hourly sweep only fires at the configured hour; WEEKLY also gates on
// the weekday. The lastSent guard makes a same-window re-tick idempotent (no double email).
export function isDigestDue(
  cadence: Cadence,
  lastSentAt: Date | null,
  now: Date,
  sched = digestSchedule(),
): boolean {
  if (now.getHours() !== sched.hour) return false;
  if (cadence === 'WEEKLY' && now.getDay() !== sched.weekday) return false;
  if (lastSentAt) {
    const sinceMs = now.getTime() - lastSentAt.getTime();
    const guardMs = cadence === 'DAILY' ? 20 * 3600_000 : 6 * 24 * 3600_000;
    if (sinceMs < guardMs) return false;
  }
  return true;
}

// Turn a user's per-project alert detail into the compact shape the email template renders. Returns
// null when there's nothing to report (→ no email is sent, and the user is NOT stamped so they stay
// eligible next window). Runs inside the caller's tenant context.
export async function buildDigestProjects(
  userId: string,
  role: string,
  now: Date,
): Promise<{ projects: DigestProject[]; totalAlerts: number; totalHigh: number } | null> {
  const detail = await getPortfolioAlertDetail(userId, role, now);
  if (detail.length === 0) return null;

  let totalAlerts = 0;
  let totalHigh = 0;
  const projects: DigestProject[] = detail.slice(0, MAX_PROJECTS).map((d) => {
    totalAlerts += d.alerts.length;
    totalHigh += d.counts.HIGH;
    return {
      projectId: d.projectId,
      code: d.code,
      name: d.name,
      total: d.alerts.length,
      high: d.counts.HIGH,
      lines: d.alerts.slice(0, MAX_LINES_PER_PROJECT).map((a) => ({ message: a.message, tab: a.tab, entityId: a.entityId })),
    };
  });
  // Count alerts from any projects beyond the cap toward the headline total so it stays truthful.
  detail.slice(MAX_PROJECTS).forEach((d) => {
    totalAlerts += d.alerts.length;
    totalHigh += d.counts.HIGH;
  });
  return { projects, totalAlerts, totalHigh };
}

// Send one user's digest (best-effort). Returns whether an email went out. Stamps digestLastSentAt
// only on a successful hand-off, so a transient mail failure is retried next window and a zero-alert
// user is never stamped (kept eligible). Must run inside the user's tenant context.
async function sendDigestForUser(
  u: { id: string; name: string; email: string; digestFrequency: Cadence },
  role: string,
  now: Date,
): Promise<boolean> {
  const built = await buildDigestProjects(u.id, role, now);
  if (!built) return false; // nothing to report

  const mail = alertDigestMail({
    name: u.name,
    cadence: u.digestFrequency,
    projects: built.projects,
    totalAlerts: built.totalAlerts,
    totalHigh: built.totalHigh,
  });
  const { delivered } = await sendMail({ to: u.email, subject: mail.subject, html: mail.html, text: mail.text });
  if (!delivered) return false;
  await prisma.user.update({ where: { id: u.id }, data: { digestLastSentAt: now } });
  return true;
}

// Hourly sweep. Fans out over every ACTIVE corporate (non-personal) tenant — guest sandboxes are
// excluded by design, so guests never receive a digest. Within each tenant, opted-in + verified +
// active users who are due get their rollup, scoped by their tenant role (a global role sees all
// projects; a PM sees only theirs). A no-op (one cheap query) outside the send hour or when SMTP is
// off. NOTE: digestLastSentAt is per-user (global), so a user in several tenants gets the first
// tenant (in iteration order) that actually has alerts — acceptable for v1.
export async function runDigestSweepIfDue(now: Date = new Date()): Promise<{ sent: number }> {
  if (!emailEnabled()) return { sent: 0 }; // dormant until SMTP is configured
  const sched = digestSchedule();
  if (now.getHours() !== sched.hour) return { sent: 0 }; // cheapest exit: wrong hour

  const tenants = await runAsSystem(() =>
    prisma.tenant.findMany({ where: { status: 'ACTIVE', isPersonal: false }, select: { id: true } }),
  );

  let sent = 0;
  for (const t of tenants) {
    await runWithTenant(t.id, async () => {
      const members = await prisma.membership.findMany({
        where: {
          tenantId: t.id,
          user: { digestFrequency: { not: 'OFF' }, isActive: true, isGuest: false, emailVerifiedAt: { not: null }, email: { not: '' } },
        },
        select: {
          role: true,
          user: { select: { id: true, name: true, email: true, digestFrequency: true, digestLastSentAt: true } },
        },
      });
      for (const m of members) {
        const u = m.user;
        if (u.digestFrequency === 'OFF') continue; // guard (enum-narrowing)
        if (!isDigestDue(u.digestFrequency as Cadence, u.digestLastSentAt, now, sched)) continue;
        try {
          if (await sendDigestForUser({ id: u.id, name: u.name, email: u.email, digestFrequency: u.digestFrequency as Cadence }, m.role, now)) {
            sent++;
          }
        } catch (err) {
          logger.error({ err, userId: u.id }, '[digest] send failed');
        }
      }
    });
  }
  return { sent };
}
