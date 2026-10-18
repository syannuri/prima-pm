import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { runWithTenant } from '../../lib/tenant/context.js';
import { backfillDefaultTenant } from '../../lib/tenant/backfill.js';
import { wipeDb } from '../../test/tenancy.harness.js';
import { recordFollowupClick, getFollowupStats } from '../assistant/followup.service.js';

// Follow-up chip click telemetry (#4): record is best-effort + tenant-scoped; the stats read is
// ADMIN/PMO-only and broken down by kind + origin.
let prevFlag: string | undefined;
let tidA = ''; let tidB = '';

beforeAll(async () => {
  prevFlag = process.env.MULTITENANCY_ENFORCE; process.env.MULTITENANCY_ENFORCE = 'true';
  await wipeDb();
  await backfillDefaultTenant(prisma);
  const a = await prisma.tenant.create({ data: { slug: 'fu-a', name: 'FU A' } }); tidA = a.id;
  const b = await prisma.tenant.create({ data: { slug: 'fu-b', name: 'FU B' } }); tidB = b.id;
});

afterAll(async () => {
  if (prevFlag === undefined) delete process.env.MULTITENANCY_ENFORCE; else process.env.MULTITENANCY_ENFORCE = prevFlag;
});

describe('follow-up click telemetry', () => {
  it('records clicks scoped to the tenant and rolls them up by kind + origin', async () => {
    await runWithTenant(tidA, async () => {
      await recordFollowupClick({ kind: 'question', origin: 'model', userId: 'u1' });
      await recordFollowupClick({ kind: 'question', origin: 'derived' });
      await recordFollowupClick({ kind: 'nav', origin: 'nav_cite' });
    });
    const stats = await runWithTenant(tidA, () => getFollowupStats({ role: 'ADMIN' }));
    expect(stats.total).toBe(3);
    expect(stats.byKind).toEqual({ question: 2, nav: 1 });
    expect(stats.byOrigin).toEqual({ model: 1, derived: 1, nav_cite: 1 });
    // Tenant isolation: B sees none.
    const other = await runWithTenant(tidB, () => getFollowupStats({ role: 'ADMIN' }));
    expect(other.total).toBe(0);
  });

  it('coerces unknown kind/origin to safe defaults (never throws into the UI)', async () => {
    await runWithTenant(tidB, async () => {
      await recordFollowupClick({ kind: 'bogus', origin: 'whatever' });
    });
    const stats = await runWithTenant(tidB, () => getFollowupStats({ role: 'ADMIN' }));
    expect(stats.total).toBe(1);
    expect(stats.byKind).toEqual({ question: 1 });   // bogus kind → 'question'
    expect(stats.byOrigin).toEqual({ static: 1 });   // unknown origin → 'static'
  });

  it('is ADMIN/PMO-only', async () => {
    await expect(runWithTenant(tidA, () => getFollowupStats({ role: 'VIEWER' }))).rejects.toThrow();
  });
});
