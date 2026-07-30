import { describe, it, beforeAll, afterAll } from 'vitest';
import { createApp } from '../../app.js';
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

// The real gate — two CORPORATE tenants sharing the pooled DB must be isolated — is now
// IMPLEMENTED and enforced (Phase 3): the Prisma extension isolates at the query layer
// (`tenant-extension.itest.ts`) and the full auth→context→query stack is proven end-to-end over
// HTTP (`tenancy-http.itest.ts`). Those suites toggle MULTITENANCY_ENFORCE themselves; this file
// keeps the always-on guard for the guest-sandbox isolation that predates tenants.
