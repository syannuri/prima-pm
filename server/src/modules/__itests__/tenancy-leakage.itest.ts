import { describe, it, beforeAll, afterAll } from 'vitest';
import { createApp } from '../../app.js';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { seedGuestOrg, expectIsolated, wipeDb, type OrgFixture } from '../../test/tenancy.harness.js';

// Cross-tenant leakage suite — the merge gate for the pooled-multitenancy migration
// (see docs/MULTITENANCY-POOLED-PLAN.md, Phase 0). Two isolated orgs, and neither may see
// nor touch the other's data.
const app = createApp();

let a: OrgFixture;
let b: OrgFixture;

beforeAll(async () => {
  await wipeDb();
  a = await seedGuestOrg('A');
  b = await seedGuestOrg('B');
});

afterAll(async () => {
  await prisma.$disconnect();
});

// Guest sandboxes are the ONE isolation mechanism that exists today (personalOwnerId), so
// these run GREEN now and guard against regressing that isolation as we migrate.
describe('cross-tenant leakage — guest sandboxes (enforced today)', () => {
  it('org A cannot see or touch org B', async () => {
    await expectIsolated(app, a, b);
  });

  it('org B cannot see or touch org A', async () => {
    await expectIsolated(app, b, a);
  });
});

// The real gate: two CORPORATE orgs sharing the pooled DB must be isolated too. Today the app
// is single-tenant (ADMIN/PMO see every project), so this is RED — it only becomes meaningful
// once MULTITENANCY_ENFORCE turns on the Prisma-extension tenant scoping (Phase 3). Gated so
// it does not break CI while enforcement is off; flip the flag in staging to arm the gate.
describe.skipIf(!env.multitenancy.enforce)('cross-tenant leakage — corporate tenants (Phase 3 gate)', () => {
  it('is armed once MULTITENANCY_ENFORCE is on', () => {
    // Placeholder: replaced with two-corporate-tenant fixtures + expectIsolated when the
    // Tenant model + context land (Phases 1–3). Kept skipped until then so the flag has a home.
    throw new Error('corporate-tenant isolation not implemented yet (Phases 1–3)');
  });
});
