import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { runWithTenant } from '../../lib/tenant/context.js';
import { runWeeklyAutoCaptureIfDueAllTenants } from '../../modules/evm/evm.portfolio.js';
import { wipeDb } from '../../test/tenancy.harness.js';

// Regression guard for the soak finding: under enforcement the weekly EVM auto-capture scheduler
// runs OUTSIDE any request, so it must fan out per tenant inside runWithTenant — otherwise its
// AppSetting/Project/EvmSnapshot queries fail-closed. Flag toggled for this file only (serial run).
let prevFlag: string | undefined;
let tenantA = '';

beforeAll(async () => {
  prevFlag = process.env.MULTITENANCY_ENFORCE;
  process.env.MULTITENANCY_ENFORCE = 'true';
  await wipeDb();
  const [ta] = await Promise.all([
    prisma.tenant.create({ data: { slug: 'cron-a', name: 'Org A' } }),
    prisma.tenant.create({ data: { slug: 'cron-b', name: 'Org B' } }),
  ]);
  tenantA = ta.id;
});

afterAll(async () => {
  if (prevFlag === undefined) delete process.env.MULTITENANCY_ENFORCE;
  else process.env.MULTITENANCY_ENFORCE = prevFlag;
  await prisma.$disconnect();
});

describe('weekly auto-capture under enforcement', () => {
  it('does not fail-closed when no tenant has settings (was the soak bug)', async () => {
    const res = await runWeeklyAutoCaptureIfDueAllTenants(new Date());
    expect(res.ran).toBe(false); // no AppSetting anywhere → nothing due, and crucially NO throw
  });

  it('runs scoped for a tenant whose auto-capture is enabled today', async () => {
    const now = new Date();
    // Enable auto-capture for tenant A only (stamped tenantId=A by the extension).
    await runWithTenant(tenantA, () =>
      prisma.appSetting.create({ data: { id: 'singleton', evmAutoCaptureEnabled: true, evmAutoCaptureWeekday: now.getUTCDay() } }),
    );

    const res = await runWeeklyAutoCaptureIfDueAllTenants(now);
    expect(res.ran).toBe(true); // A was due (no projects → total 0, but it ran)

    // lastRunAt was stamped on A's settings (scoped read).
    const a = await runWithTenant(tenantA, () => prisma.appSetting.findUnique({ where: { id: 'singleton' } }));
    expect(a?.evmAutoCaptureLastRunAt).toBeTruthy();
  });
});
