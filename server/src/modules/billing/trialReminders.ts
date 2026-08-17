import { prisma } from '../../lib/prisma.js';
import { runAsSystem, runWithTenant } from '../../lib/tenant/context.js';
import { trialDaysLeft } from '../../lib/tenant/trial.js';

// Which reminder bucket a trial is in (each fires once as the deadline nears). null = too early.
function reminderBucket(daysLeft: number): '14' | '3' | '0' | null {
  if (daysLeft <= 0) return '0';
  if (daysLeft <= 3) return '3';
  if (daysLeft <= 14) return '14';
  return null;
}

function reminderCopy(bucket: '14' | '3' | '0', daysLeft: number): { title: string; body: string } {
  if (bucket === '0') {
    return { title: 'Your PRIMA trial has ended', body: 'Upgrade to a paid plan to regain access to your workspace — your data is safe and waiting.' };
  }
  return {
    title: `Your PRIMA trial ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
    body: 'Upgrade to keep your projects, reports and team access after the trial.',
  };
}

// Notify each ACTIVE corporate TRIAL workspace's admins as the 60-day trial nears its end (~14 / 3 / 0
// days left). In-app only (no email infra on this deployment). Deduped per admin per bucket via the
// notification `type`, so the frequent boot/interval sweep is idempotent. Returns how many were created.
export async function runTrialReminderSweep(): Promise<{ created: number }> {
  // Only corporate trials can expire/wall — personal tenants + paid plans are irrelevant.
  const tenants = await runAsSystem(() =>
    prisma.tenant.findMany({
      where: { plan: 'TRIAL', status: 'ACTIVE', isPersonal: false, trialEndsAt: { not: null } },
      select: { id: true, trialEndsAt: true },
    }),
  );
  let created = 0;
  for (const t of tenants) {
    const daysLeft = trialDaysLeft(t.trialEndsAt);
    if (daysLeft == null) continue;
    const bucket = reminderBucket(daysLeft);
    if (!bucket) continue;
    const type = `trial-reminder:${bucket}`;
    const admins = await prisma.membership.findMany({ where: { tenantId: t.id, role: 'ADMIN' }, select: { userId: true } });
    const { title, body } = reminderCopy(bucket, daysLeft);
    // Inside the tenant context so the (scoped) Notification rows are stamped + the dedup query is
    // scoped to this workspace (the same admin may run several tenants — one notice per workspace).
    await runWithTenant(t.id, async () => {
      for (const a of admins) {
        const existing = await prisma.notification.findFirst({ where: { userId: a.userId, type } });
        if (existing) continue;
        await prisma.notification.create({ data: { userId: a.userId, type, title, body } });
        created++;
      }
    });
  }
  return { created };
}
