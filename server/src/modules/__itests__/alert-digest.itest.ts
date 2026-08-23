import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { runWithTenant } from '../../lib/tenant/context.js';
import { __setMailSink, type MailMessage } from '../../lib/mailer.js';
import { runDigestSweepIfDue, isDigestDue } from '../notification/digest.service.js';

// Alert-digest email sweep. A best-effort, opt-in, dormant-unless-SMTP-configured sweep that mails
// each verified, active, non-guest, opted-in user their open-alert rollup at the configured send hour.
// We arm the mailer (SMTP_HOST + MAIL_FROM) and pin DIGEST_HOUR/WEEKDAY to `NOW` so the window is hit
// deterministically regardless of the test runner's timezone, then route every send to a sink.

const DAY = 86_400_000;
// A Monday-ish fixed instant; we derive DIGEST_HOUR/WEEKDAY from it so daily + weekly both fire.
const NOW = new Date('2026-09-07T09:00:00');
let captured: MailMessage[] = [];
let corpTenantId = '';
let guestTenantId = '';
let seq = 0;

async function wipe() {
  const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'`;
  if (rows.length) await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
}

// Create an opted-in (or off) user + their membership in the given tenant. Verified + active by default.
async function seedUser(
  tenantId: string,
  opts: { freq: 'OFF' | 'DAILY' | 'WEEKLY'; role?: string; verified?: boolean; active?: boolean; isGuest?: boolean; lastSentAt?: Date | null },
) {
  seq += 1;
  const user = await prisma.user.create({
    data: {
      name: `U${seq}`,
      email: `u${seq}@digest.test`,
      passwordHash: await hashPassword('x'),
      role: (opts.role ?? 'PROJECT_MANAGER') as never,
      isGuest: opts.isGuest ?? false,
      isActive: opts.active ?? true,
      emailVerifiedAt: (opts.verified ?? true) ? new Date('2026-01-01') : null,
      digestFrequency: opts.freq as never,
      digestLastSentAt: opts.lastSentAt ?? null,
    },
  });
  await prisma.membership.create({ data: { userId: user.id, tenantId, role: (opts.role ?? 'PROJECT_MANAGER') as never } });
  return user;
}

// Give a user an overdue task so getPortfolioAlertDetail yields ≥1 alert (project scoped to them).
async function seedOverdueProject(tenantId: string, pmUserId: string) {
  seq += 1;
  await runWithTenant(tenantId, async () => {
    const p = await prisma.project.create({
      data: { code: `PRJ-DG-${String(seq).padStart(4, '0')}`, name: `DG ${seq}`, status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE', pmUserId },
    });
    await prisma.task.create({
      data: {
        projectId: p.id, wbsCode: '1', name: 'Late task',
        planStart: new Date(NOW.getTime() - 10 * DAY), planEnd: new Date(NOW.getTime() - 5 * DAY),
        progressPct: 0, isMilestone: false,
      },
    });
  });
}

describe('alert-digest email sweep', () => {
  beforeAll(async () => {
    process.env.SMTP_HOST = 'smtp.test';
    process.env.MAIL_FROM = 'Prismatix <no-reply@test>';
    // Pin the send window to NOW so both DAILY and WEEKLY are "due" (TZ-independent).
    process.env.DIGEST_HOUR = String(NOW.getHours());
    process.env.DIGEST_WEEKDAY = String(NOW.getDay());
    __setMailSink((m) => captured.push(m));
  });
  afterAll(() => {
    __setMailSink(null);
    delete process.env.SMTP_HOST;
    delete process.env.MAIL_FROM;
    delete process.env.DIGEST_HOUR;
    delete process.env.DIGEST_WEEKDAY;
  });

  beforeEach(async () => {
    captured = [];
    await wipe();
    const corp = await prisma.tenant.create({ data: { slug: `corp-${Date.now()}-${seq}`, name: 'Corp', isPersonal: false, status: 'ACTIVE' } });
    corpTenantId = corp.id;
    const guest = await prisma.tenant.create({ data: { slug: `guest-${Date.now()}-${seq}`, name: 'Guest', isPersonal: true, status: 'ACTIVE' } });
    guestTenantId = guest.id;
  });

  it('mails a DAILY opted-in user with alerts, and stamps digestLastSentAt', async () => {
    const u = await seedUser(corpTenantId, { freq: 'DAILY' });
    await seedOverdueProject(corpTenantId, u.id);

    const { sent } = await runDigestSweepIfDue(NOW);
    expect(sent).toBe(1);
    expect(captured).toHaveLength(1);
    expect(captured[0].to).toBe(u.email);
    expect(captured[0].subject).toContain('Daily');
    const after = await prisma.user.findUnique({ where: { id: u.id } });
    expect(after?.digestLastSentAt?.getTime()).toBe(NOW.getTime());
  });

  it('skips OFF, guest, inactive and unverified users', async () => {
    const off = await seedUser(corpTenantId, { freq: 'OFF' });
    const guest = await seedUser(guestTenantId, { freq: 'DAILY', isGuest: true, role: 'GUEST' });
    const inactive = await seedUser(corpTenantId, { freq: 'DAILY', active: false });
    const unverified = await seedUser(corpTenantId, { freq: 'DAILY', verified: false });
    await seedOverdueProject(corpTenantId, off.id);
    await seedOverdueProject(guestTenantId, guest.id);
    await seedOverdueProject(corpTenantId, inactive.id);
    await seedOverdueProject(corpTenantId, unverified.id);

    const { sent } = await runDigestSweepIfDue(NOW);
    expect(sent).toBe(0);
    expect(captured).toHaveLength(0);
  });

  it('does not email (or stamp) a user with zero alerts', async () => {
    const u = await seedUser(corpTenantId, { freq: 'DAILY' });
    // no project → no alerts
    const { sent } = await runDigestSweepIfDue(NOW);
    expect(sent).toBe(0);
    expect(captured).toHaveLength(0);
    const after = await prisma.user.findUnique({ where: { id: u.id } });
    expect(after?.digestLastSentAt).toBeNull();
  });

  it('sends nothing outside the configured send hour', async () => {
    const u = await seedUser(corpTenantId, { freq: 'DAILY' });
    await seedOverdueProject(corpTenantId, u.id);
    const offHour = new Date(NOW.getTime());
    offHour.setHours((NOW.getHours() + 1) % 24);
    const { sent } = await runDigestSweepIfDue(offHour);
    expect(sent).toBe(0);
    expect(captured).toHaveLength(0);
  });

  it('WEEKLY sends on the configured weekday but not on other days', async () => {
    const u = await seedUser(corpTenantId, { freq: 'WEEKLY' });
    await seedOverdueProject(corpTenantId, u.id);

    // Wrong weekday (same hour): nothing.
    const otherDay = new Date(NOW.getTime() + DAY); // +1 day, same hour
    expect((await runDigestSweepIfDue(otherDay)).sent).toBe(0);
    expect(captured).toHaveLength(0);

    // Right weekday: sends.
    const { sent } = await runDigestSweepIfDue(NOW);
    expect(sent).toBe(1);
    expect(captured[0].subject).toContain('Weekly');
  });

  it('is idempotent within a window via the lastSent guard', async () => {
    const u = await seedUser(corpTenantId, { freq: 'DAILY' });
    await seedOverdueProject(corpTenantId, u.id);
    expect((await runDigestSweepIfDue(NOW)).sent).toBe(1);
    // Second tick in the same window: the guard suppresses a duplicate.
    expect((await runDigestSweepIfDue(NOW)).sent).toBe(0);
    expect(captured).toHaveLength(1);
  });

  it('isDigestDue: hour/weekday/guard rules', () => {
    const sched = { hour: 7, weekday: 1 };
    const mon7 = new Date('2026-09-07T07:00:00'); // set below via setHours to be TZ-safe
    mon7.setHours(7);
    expect(isDigestDue('DAILY', null, mon7, sched)).toBe(true);
    const off = new Date(mon7); off.setHours(8);
    expect(isDigestDue('DAILY', null, off, sched)).toBe(false);
    // Guard: sent 2h ago (daily) → not due.
    expect(isDigestDue('DAILY', new Date(mon7.getTime() - 2 * 3600_000), mon7, sched)).toBe(false);
    // Guard: sent >20h ago → due again.
    expect(isDigestDue('DAILY', new Date(mon7.getTime() - 21 * 3600_000), mon7, sched)).toBe(true);
  });
});
