import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { signAccessToken } from '../../lib/jwt.js';
import { runWithTenant } from '../../lib/tenant/context.js';
import { backfillDefaultTenant } from '../../lib/tenant/backfill.js';
import { wipeDb } from '../../test/tenancy.harness.js';

// Custom fields (Tier-3): tenant-level ADMIN definitions + per-project values. These verify role gating
// (only ADMIN defines), type/option validation, required enforcement, value round-trip, and tenant
// isolation of definitions.
const app = createApp();
const api = (p: string) => `/api/v1${p}`;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

let prevFlag: string | undefined;
let adminA = '';
let pmA = '';
let adminB = '';
let projectId = '';
let tidA = '';
let tidB = '';

beforeAll(async () => {
  prevFlag = process.env.MULTITENANCY_ENFORCE;
  process.env.MULTITENANCY_ENFORCE = 'true';

  await wipeDb();
  await backfillDefaultTenant(prisma);
  const a = await prisma.tenant.create({ data: { slug: 'cfa', name: 'CF A' } });
  const b = await prisma.tenant.create({ data: { slug: 'cfb', name: 'CF B' } });
  tidA = a.id; tidB = b.id;

  const admin = await prisma.user.create({ data: { name: 'adm', email: 'adm@cfa.test', role: 'ADMIN', passwordHash: await hashPassword('x'), isActive: true } });
  await prisma.membership.create({ data: { userId: admin.id, tenantId: tidA, role: 'ADMIN' } });
  adminA = signAccessToken({ sub: admin.id, role: 'ADMIN', email: admin.email, tv: 0, tid: tidA });

  const pm = await prisma.user.create({ data: { name: 'pm', email: 'pm@cfa.test', role: 'PROJECT_MANAGER', passwordHash: await hashPassword('x'), isActive: true } });
  await prisma.membership.create({ data: { userId: pm.id, tenantId: tidA, role: 'PROJECT_MANAGER' } });
  pmA = signAccessToken({ sub: pm.id, role: 'PROJECT_MANAGER', email: pm.email, tv: 0, tid: tidA });

  const badmin = await prisma.user.create({ data: { name: 'admb', email: 'adm@cfb.test', role: 'ADMIN', passwordHash: await hashPassword('x'), isActive: true } });
  await prisma.membership.create({ data: { userId: badmin.id, tenantId: tidB, role: 'ADMIN' } });
  adminB = signAccessToken({ sub: badmin.id, role: 'ADMIN', email: badmin.email, tv: 0, tid: tidB });

  await runWithTenant(tidA, async () => {
    const p = await prisma.project.create({ data: { code: 'CF-1', name: 'CF Project', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE', pmUserId: pm.id, tenantId: tidA } });
    projectId = p.id;
  });
});

afterAll(async () => {
  if (prevFlag === undefined) delete process.env.MULTITENANCY_ENFORCE; else process.env.MULTITENANCY_ENFORCE = prevFlag;
});

describe('custom field definitions', () => {
  let selectDefId = '';
  let textDefId = '';

  it('lets an ADMIN create a select definition and rejects a non-admin', async () => {
    const ok = await request(app).post(api('/custom-fields/defs')).set(bearer(adminA))
      .send({ entity: 'project', label: 'Business Unit', type: 'select', options: ['Retail', 'Wholesale'], required: true });
    expect(ok.status).toBe(201);
    expect(ok.body.def.key).toBe('business_unit');
    expect(ok.body.def.options).toEqual(['Retail', 'Wholesale']);
    selectDefId = ok.body.def.id;

    const denied = await request(app).post(api('/custom-fields/defs')).set(bearer(pmA))
      .send({ entity: 'project', label: 'Sneaky', type: 'text' });
    expect(denied.status).toBe(403);
  });

  it('rejects a select definition with no options', async () => {
    const res = await request(app).post(api('/custom-fields/defs')).set(bearer(adminA))
      .send({ entity: 'project', label: 'Empty Select', type: 'select', options: [] });
    expect(res.status).toBe(400);
  });

  it('lists active definitions for any member', async () => {
    const t = await request(app).post(api('/custom-fields/defs')).set(bearer(adminA))
      .send({ entity: 'project', label: 'Client Ref', type: 'text' });
    textDefId = t.body.def.id;
    const res = await request(app).get(api('/custom-fields/defs?entity=project')).set(bearer(pmA));
    expect(res.status).toBe(200);
    const keys = res.body.defs.map((d: { key: string }) => d.key);
    expect(keys).toContain('business_unit');
    expect(keys).toContain('client_ref');
  });

  it('validates values against the definition and round-trips them', async () => {
    // invalid select option -> 400
    const bad = await request(app).put(api(`/projects/${projectId}/custom-fields`)).set(bearer(pmA))
      .send({ values: [{ defId: selectDefId, value: 'Nope' }] });
    expect(bad.status).toBe(400);

    // required field cleared -> 400
    const missing = await request(app).put(api(`/projects/${projectId}/custom-fields`)).set(bearer(pmA))
      .send({ values: [{ defId: selectDefId, value: '' }] });
    expect(missing.status).toBe(400);

    // valid set -> 200 and value persists
    const ok = await request(app).put(api(`/projects/${projectId}/custom-fields`)).set(bearer(pmA))
      .send({ values: [{ defId: selectDefId, value: 'Retail' }, { defId: textDefId, value: 'ACME-42' }] });
    expect(ok.status).toBe(200);

    const got = await request(app).get(api(`/projects/${projectId}/custom-fields`)).set(bearer(pmA));
    expect(got.status).toBe(200);
    const byKey = Object.fromEntries(got.body.fields.map((f: { key: string; value: string | null }) => [f.key, f.value]));
    expect(byKey.business_unit).toBe('Retail');
    expect(byKey.client_ref).toBe('ACME-42');
  });

  it('isolates definitions per tenant', async () => {
    const res = await request(app).get(api('/custom-fields/defs?entity=project')).set(bearer(adminB));
    expect(res.status).toBe(200);
    expect(res.body.defs).toEqual([]); // tenant B has none of tenant A's definitions
  });
});
