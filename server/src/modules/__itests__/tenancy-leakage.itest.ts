import { describe, it, beforeAll, afterAll } from 'vitest';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { seedGuestOrg, expectIsolated, wipeDb, type OrgFixture } from '../../test/tenancy.harness.js';

// Cross-tenant leakage suite — the merge gate for the pooled-multitenancy migration
// (see docs/MULTITENANCY-POOLED-PLAN.md, Phase 0). Two isolated orgs, and neither may see
// nor touch the other's data.
//
// Post-3d: guest sandboxes are isolated by their PERSONAL TENANT (the Prisma extension), not by the
// removed personalOwnerId filters — so this runs enforcement-ON, and it is now the extension alone
// that must keep org A and B apart.
const app = createApp();

let a: OrgFixture;
let b: OrgFixture;
let prevFlag: string | undefined;

beforeAll(async () => {
  prevFlag = process.env.MULTITENANCY_ENFORCE;
  process.env.MULTITENANCY_ENFORCE = 'true';
  await wipeDb();
  a = await seedGuestOrg('A');
  b = await seedGuestOrg('B');
});

afterAll(async () => {
  if (prevFlag === undefined) delete process.env.MULTITENANCY_ENFORCE;
  else process.env.MULTITENANCY_ENFORCE = prevFlag;
  await prisma.$disconnect();
});

// Two guest orgs, each its own personal tenant — the extension must keep them isolated.
describe('cross-tenant leakage — guest sandboxes (tenant-isolated, enforced)', () => {
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
