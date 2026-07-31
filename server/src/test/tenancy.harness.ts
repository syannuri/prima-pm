// Cross-tenant leakage test harness — Phase 0 (see docs/MULTITENANCY-POOLED-PLAN.md).
//
// The gate for the whole migration is one question: can org A see or touch org B's data?
// This harness seeds two isolated orgs (each an owner + a project + a child Risk) and hands
// back authenticated request helpers plus a reusable matrix of "A cannot reach B" assertions
// across list / read / mutate endpoints.
//
// TODAY the only isolation mechanism is the guest sandbox (`personalOwnerId`), so an "org"
// here is a GUEST user and its personal project — that isolation is real and enforced
// (see middleware/rbac.ts), so `expectIsolated` passes GREEN and this suite guards against
// regressing it during the migration. Once the `Tenant` model lands (Phase 1+), an org
// becomes a real tenant and the SAME assertions extend to corporate projects — where they
// are RED today (single-tenant: ADMIN/PMO see everything) and become the enforced gate the
// moment MULTITENANCY_ENFORCE turns on the Prisma-extension scoping (Phase 3).
import request from 'supertest';
import { expect } from 'vitest';
import type { Express } from 'express';
import { prisma } from '../lib/prisma.js';
import { hashPassword } from '../lib/password.js';
import { signAccessToken } from '../lib/jwt.js';
import { runWithTenant } from '../lib/tenant/context.js';

const PW = 'Tenancy-Harness-1';
export const apiPath = (path: string) => `/api/v1${path}`;

export interface OrgFixture {
  label: string;
  userId: string;
  token: string;
  auth: { Authorization: string };
  projectId: string;
  riskId: string;
}

// TRUNCATE every table in the (guarded) test DB so each run is deterministic. Mirrors the
// wipe other itests do; RESTART IDENTITY CASCADE clears FKs in one statement.
export async function wipeDb(): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'`;
  if (rows.length) {
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`,
    );
  }
}

// Seed one isolated org: a guest with their OWN personal tenant (the tenant-native sandbox that
// replaced personalOwnerId) + a project + one Risk, all stamped to that tenant. The token pins `tid`
// to the personal tenant, so under enforcement the Prisma extension is what isolates one org from
// the other. (personalOwnerId is still SET on the project — it's kept until the column drop — but it
// is no longer what filters; the leakage suite runs enforcement-ON to prove tenant scoping isolates.)
export async function seedGuestOrg(label: string): Promise<OrgFixture> {
  const user = await prisma.user.create({
    data: {
      name: `Org ${label}`,
      email: `org-${label.toLowerCase()}@tenancy.test`,
      role: 'GUEST',
      passwordHash: await hashPassword(PW),
      isActive: true,
    },
  });
  const tenant = await prisma.tenant.create({ data: { slug: `guest-${user.id}`, name: `Org ${label} (personal)`, isPersonal: true } });
  await prisma.membership.create({ data: { userId: user.id, tenantId: tenant.id, role: 'GUEST' } });

  const { project, risk } = await runWithTenant(tenant.id, async () => {
    const project = await prisma.project.create({
      data: {
        code: `PRJ-T${label}-0001`,
        name: `Org ${label} project`,
        status: 'IN_PROGRESS',
        deliveryApproach: 'PREDICTIVE',
        personalOwnerId: user.id,
        pmUserId: user.id,
      },
    });
    const risk = await prisma.risk.create({
      data: {
        projectId: project.id,
        code: `R-${label}-01`,
        title: `Org ${label} secret risk`,
        probabilityScore: 3,
        impactScore: 3,
        riskScore: 9,
        severity: 'MEDIUM',
        probabilityPct: '0.5000',
        impactCostIdr: '1000000.00',
        emv: '500000.00',
      },
    });
    return { project, risk };
  });
  const token = signAccessToken({ sub: user.id, role: 'GUEST', email: user.email, tv: 0, tid: tenant.id });
  return {
    label,
    userId: user.id,
    token,
    auth: { Authorization: `Bearer ${token}` },
    projectId: project.id,
    riskId: risk.id,
  };
}

// The reusable leakage matrix: assert `intruder` can neither SEE nor TOUCH `victim`'s data.
// A denied cross-org request is a 403 (Forbidden) or 404 (Not found) — never a 2xx, and the
// victim's rows must never appear in a list response.
export async function expectIsolated(app: Express, intruder: OrgFixture, victim: OrgFixture): Promise<void> {
  // 1. LIST projects — the victim's project must not leak into the intruder's list.
  const list = await request(app).get(apiPath('/projects')).set(intruder.auth);
  expect(list.status).toBe(200);
  const ids: string[] = (list.body.projects ?? list.body ?? []).map((p: { id: string }) => p.id);
  expect(ids).not.toContain(victim.projectId);

  // 2. READ the victim's project directly — denied.
  const read = await request(app).get(apiPath(`/projects/${victim.projectId}`)).set(intruder.auth);
  expect([403, 404]).toContain(read.status);

  // 3. READ a nested child (risk register) of the victim — denied.
  const readChild = await request(app).get(apiPath(`/projects/${victim.projectId}/risk`)).set(intruder.auth);
  expect([403, 404]).toContain(readChild.status);

  // 4. MUTATE the victim (create a risk in their project) — denied.
  const mutate = await request(app)
    .post(apiPath(`/projects/${victim.projectId}/risk`))
    .set(intruder.auth)
    .send({ title: 'injected', probabilityScore: 1, impactScore: 1, probabilityPct: 0.1, impactCostIdr: 1 });
  expect([403, 404]).toContain(mutate.status);
}
