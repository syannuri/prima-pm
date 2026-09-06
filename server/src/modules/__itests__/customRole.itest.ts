import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { signAccessToken } from '../../lib/jwt.js';
import { backfillDefaultTenant } from '../../lib/tenant/backfill.js';
import { wipeDb } from '../../test/tenancy.harness.js';

// Custom roles (Tier-3): an org-defined role maps a name onto a built-in base role. Enforcement always
// uses the base role (Membership.role), so these verify creation gating, assignment resolving to the base
// role + label, base-role sync on edit, detach on delete, and tenant isolation.
const app = createApp();
const api = (p: string) => `/api/v1${p}`;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

let prevFlag: string | undefined;
let adminA = '';
let pmA = '';
let adminB = '';
let memberId = '';

beforeAll(async () => {
  prevFlag = process.env.MULTITENANCY_ENFORCE;
  process.env.MULTITENANCY_ENFORCE = 'true';

  await wipeDb();
  await backfillDefaultTenant(prisma);
  const a = await prisma.tenant.create({ data: { slug: 'cra', name: 'CR A' } });
  const b = await prisma.tenant.create({ data: { slug: 'crb', name: 'CR B' } });

  const admin = await prisma.user.create({ data: { name: 'adm', email: 'adm@cra.test', role: 'ADMIN', passwordHash: await hashPassword('x'), isActive: true } });
  await prisma.membership.create({ data: { userId: admin.id, tenantId: a.id, role: 'ADMIN' } });
  adminA = signAccessToken({ sub: admin.id, role: 'ADMIN', email: admin.email, tv: 0, tid: a.id });

  const pm = await prisma.user.create({ data: { name: 'pm', email: 'pm@cra.test', role: 'PROJECT_MANAGER', passwordHash: await hashPassword('x'), isActive: true } });
  await prisma.membership.create({ data: { userId: pm.id, tenantId: a.id, role: 'PROJECT_MANAGER' } });
  pmA = signAccessToken({ sub: pm.id, role: 'PROJECT_MANAGER', email: pm.email, tv: 0, tid: a.id });

  // A plain member in tenant A to receive a custom role.
  const member = await prisma.user.create({ data: { name: 'mem', email: 'mem@cra.test', role: 'VIEWER', passwordHash: await hashPassword('x'), isActive: true } });
  await prisma.membership.create({ data: { userId: member.id, tenantId: a.id, role: 'TEAM_MEMBER' } });
  memberId = member.id;

  const badmin = await prisma.user.create({ data: { name: 'admb', email: 'adm@crb.test', role: 'ADMIN', passwordHash: await hashPassword('x'), isActive: true } });
  await prisma.membership.create({ data: { userId: badmin.id, tenantId: b.id, role: 'ADMIN' } });
  adminB = signAccessToken({ sub: badmin.id, role: 'ADMIN', email: badmin.email, tv: 0, tid: b.id });
});

afterAll(async () => {
  if (prevFlag === undefined) delete process.env.MULTITENANCY_ENFORCE; else process.env.MULTITENANCY_ENFORCE = prevFlag;
});

describe('custom roles', () => {
  let roleId = '';

  it('lets ADMIN create a custom role and blocks a non-admin', async () => {
    const ok = await request(app).post(api('/custom-roles')).set(bearer(adminA))
      .send({ name: 'Auditor', baseRole: 'VIEWER', description: 'Read-only oversight' });
    expect(ok.status).toBe(201);
    expect(ok.body.role.baseRole).toBe('VIEWER');
    roleId = ok.body.role.id;

    const denied = await request(app).post(api('/custom-roles')).set(bearer(pmA)).send({ name: 'X', baseRole: 'VIEWER' });
    expect(denied.status).toBe(403);
  });

  it('assigns a custom role to a member, resolving to its base role + label', async () => {
    const res = await request(app).patch(api(`/members/${memberId}`)).set(bearer(adminA)).send({ customRoleId: roleId });
    expect(res.status).toBe(200);
    expect(res.body.member.role).toBe('VIEWER'); // base role drives enforcement
    expect(res.body.member.customRoleId).toBe(roleId);

    const list = await request(app).get(api('/members')).set(bearer(adminA));
    const m = list.body.members.find((x: { id: string }) => x.id === memberId);
    expect(m.role).toBe('VIEWER');
    expect(m.customRoleName).toBe('Auditor');
  });

  it('syncs members to the new base role when the custom role is re-mapped', async () => {
    const upd = await request(app).put(api(`/custom-roles/${roleId}`)).set(bearer(adminA)).send({ baseRole: 'TEAM_MEMBER' });
    expect(upd.status).toBe(200);
    const list = await request(app).get(api('/members')).set(bearer(adminA));
    const m = list.body.members.find((x: { id: string }) => x.id === memberId);
    expect(m.role).toBe('TEAM_MEMBER');
    expect(m.customRoleName).toBe('Auditor');
  });

  it('detaches members (keeps base role) when the custom role is deleted', async () => {
    const del = await request(app).delete(api(`/custom-roles/${roleId}`)).set(bearer(adminA));
    expect(del.status).toBe(204);
    const list = await request(app).get(api('/members')).set(bearer(adminA));
    const m = list.body.members.find((x: { id: string }) => x.id === memberId);
    expect(m.role).toBe('TEAM_MEMBER'); // base role unchanged
    expect(m.customRoleId).toBeNull();
  });

  it('isolates custom roles per tenant', async () => {
    await request(app).post(api('/custom-roles')).set(bearer(adminA)).send({ name: 'Only A', baseRole: 'PMO' });
    const res = await request(app).get(api('/custom-roles')).set(bearer(adminB));
    expect(res.status).toBe(200);
    expect(res.body.roles).toEqual([]);
  });
});
