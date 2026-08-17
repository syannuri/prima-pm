import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { signAccessToken, verifyAccessToken } from '../../lib/jwt.js';
import { runAsSystem } from '../../lib/tenant/context.js';
import { backfillDefaultTenant } from '../../lib/tenant/backfill.js';
import { wipeDb } from '../../test/tenancy.harness.js';

// Phase 6 — subdomain / custom-domain routing. APP_BASE_DOMAIN set → Host maps to a tenant. Runs
// enforcement-ON (host scoping is a multi-tenant concern).
const app = createApp();
const api = (p: string) => `/api/v1${p}`;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

let prevFlag: string | undefined;
let prevBase: string | undefined;
let acme = '', beta = '', platformToken = '', aliceTokenAcme = '', bobTokenBeta = '';
const PW = 'Host-Pass-1';

beforeAll(async () => {
  prevFlag = process.env.MULTITENANCY_ENFORCE;
  prevBase = process.env.APP_BASE_DOMAIN;
  process.env.MULTITENANCY_ENFORCE = 'true';
  process.env.APP_BASE_DOMAIN = 'prima.test';
  await wipeDb();
  const { tenantId: defaultTid } = await backfillDefaultTenant(prisma);

  const platform = await prisma.user.create({ data: { name: 'plat', email: 'plat@host.test', role: 'ADMIN', isPlatformAdmin: true, passwordHash: await hashPassword(PW), isActive: true } });
  await prisma.membership.create({ data: { userId: platform.id, tenantId: defaultTid, role: 'ADMIN' } });
  platformToken = signAccessToken({ sub: platform.id, role: 'ADMIN', email: platform.email, tv: 0, tid: defaultTid });

  // ENTERPRISE: custom domains are an Enterprise-only feature (gated in the platform PATCH).
  const at = await prisma.tenant.create({ data: { slug: 'acme', name: 'Acme', plan: 'ENTERPRISE' } });
  const bt = await prisma.tenant.create({ data: { slug: 'beta', name: 'Beta', plan: 'ENTERPRISE' } });
  acme = at.id; beta = bt.id;
  const alice = await prisma.user.create({ data: { name: 'Alice', email: 'alice@host.test', role: 'ADMIN', passwordHash: await hashPassword(PW), isActive: true } });
  const bob = await prisma.user.create({ data: { name: 'Bob', email: 'bob@host.test', role: 'ADMIN', passwordHash: await hashPassword(PW), isActive: true } });
  await prisma.membership.create({ data: { userId: alice.id, tenantId: acme, role: 'ADMIN' } });
  await prisma.membership.create({ data: { userId: bob.id, tenantId: beta, role: 'ADMIN' } });
  aliceTokenAcme = signAccessToken({ sub: alice.id, role: 'ADMIN', email: alice.email, tv: 0, tid: acme });
  bobTokenBeta = signAccessToken({ sub: bob.id, role: 'ADMIN', email: bob.email, tv: 0, tid: beta });
});

afterAll(async () => {
  if (prevFlag === undefined) delete process.env.MULTITENANCY_ENFORCE; else process.env.MULTITENANCY_ENFORCE = prevFlag;
  if (prevBase === undefined) delete process.env.APP_BASE_DOMAIN; else process.env.APP_BASE_DOMAIN = prevBase;
});

describe('Host → tenant resolution (/auth/providers.workspace)', () => {
  const ws = (host: string) => request(app).get(api('/auth/providers')).set('Host', host);
  it('a <slug>.base subdomain resolves to that tenant', async () => {
    expect((await ws('acme.prima.test')).body.workspace).toMatchObject({ slug: 'acme', name: 'Acme' });
  });
  it('the bare base domain and reserved subdomains resolve to no workspace', async () => {
    expect((await ws('prima.test')).body.workspace).toBeNull();
    expect((await ws('www.prima.test')).body.workspace).toBeNull();
    expect((await ws('deep.acme.prima.test')).body.workspace).toBeNull(); // only one label under base
  });
  it('an unknown subdomain resolves to no workspace', async () => {
    expect((await ws('nope.prima.test')).body.workspace).toBeNull();
  });
  it('workspaceNotFound is true ONLY for a workspace-shaped subdomain with no tenant', async () => {
    // Unknown <label>.base → the SPA shows a "workspace not found" page.
    expect((await ws('nope.prima.test')).body.workspaceNotFound).toBe(true);
    // A real workspace, the bare base, reserved subs and deeper hosts are the generic front door.
    expect((await ws('acme.prima.test')).body.workspaceNotFound).toBe(false);
    expect((await ws('prima.test')).body.workspaceNotFound).toBe(false);
    expect((await ws('www.prima.test')).body.workspaceNotFound).toBe(false);
    expect((await ws('deep.acme.prima.test')).body.workspaceNotFound).toBe(false);
  });
});

describe('login pins the session to the host workspace', () => {
  it('a member logging in on their subdomain gets a token pinned to that tenant', async () => {
    const res = await request(app).post(api('/auth/login')).set('Host', 'acme.prima.test').send({ email: 'alice@host.test', password: PW });
    expect(res.status).toBe(200);
    expect(verifyAccessToken(res.body.accessToken).tid).toBe(acme);
  });
  it('a NON-member is refused on that subdomain (403)', async () => {
    const res = await request(app).post(api('/auth/login')).set('Host', 'acme.prima.test').send({ email: 'bob@host.test', password: PW });
    expect(res.status).toBe(403);
  });
  it('on the bare base domain login pins to the user default tenant (no host restriction)', async () => {
    const res = await request(app).post(api('/auth/login')).set('Host', 'prima.test').send({ email: 'bob@host.test', password: PW });
    expect(res.status).toBe(200);
    expect(verifyAccessToken(res.body.accessToken).tid).toBe(beta);
  });
});

describe('a session may only be used on ITS workspace domain', () => {
  it("rejects tenant B's token on tenant A's subdomain (403), allows its own", async () => {
    expect((await request(app).get(api('/projects')).set('Host', 'acme.prima.test').set(bearer(bobTokenBeta))).status).toBe(403);
    expect((await request(app).get(api('/projects')).set('Host', 'acme.prima.test').set(bearer(aliceTokenAcme))).status).toBe(200);
    // On the bare base domain there is no host tenant → no domain restriction.
    expect((await request(app).get(api('/projects')).set('Host', 'prima.test').set(bearer(bobTokenBeta))).status).toBe(200);
  });
});

describe('custom domain mapping', () => {
  it('a platform admin maps a custom domain, and that host resolves to the tenant', async () => {
    expect((await request(app).patch(api(`/admin/tenants/${acme}`)).set(bearer(platformToken)).send({ customDomain: 'pm.acme.example' })).status).toBe(200);
    expect((await request(app).get(api('/auth/providers')).set('Host', 'pm.acme.example')).body.workspace).toMatchObject({ slug: 'acme' });
    // Reject a bad domain and a duplicate mapping.
    expect((await request(app).patch(api(`/admin/tenants/${beta}`)).set(bearer(platformToken)).send({ customDomain: 'not a domain' })).status).toBe(400);
    expect((await request(app).patch(api(`/admin/tenants/${beta}`)).set(bearer(platformToken)).send({ customDomain: 'pm.acme.example' })).status).toBe(409);
    // Clearing it (empty string) removes the mapping.
    expect((await request(app).patch(api(`/admin/tenants/${acme}`)).set(bearer(platformToken)).send({ customDomain: '' })).status).toBe(200);
    expect((await request(app).get(api('/auth/providers')).set('Host', 'pm.acme.example')).body.workspace).toBeNull();
  });

  it('custom domains are ENTERPRISE-only: refused on a lower plan, allowed when the same PATCH upgrades', async () => {
    const trialco = await prisma.tenant.create({ data: { slug: 'trialco', name: 'Trial Co' } }); // defaults TRIAL
    // TRIAL/PRO can't set a custom domain.
    expect((await request(app).patch(api(`/admin/tenants/${trialco.id}`)).set(bearer(platformToken)).send({ customDomain: 'pm.trialco.example' })).status).toBe(403);
    // Upgrading to ENTERPRISE in the SAME PATCH lets it through (effective plan is the new one).
    expect((await request(app).patch(api(`/admin/tenants/${trialco.id}`)).set(bearer(platformToken)).send({ plan: 'ENTERPRISE', customDomain: 'pm.trialco.example' })).status).toBe(200);
  });
});

describe('Caddy on-demand TLS gate (/_internal/tls-check)', () => {
  const check = (domain: string) => request(app).get(`/_internal/tls-check?domain=${encodeURIComponent(domain)}`);
  beforeAll(async () => {
    await prisma.tenant.update({ where: { id: beta }, data: { customDomain: 'pm.beta.example', status: 'ACTIVE' } });
    await runAsSystem(() => prisma.tenant.create({ data: { slug: 'susp', name: 'Susp', customDomain: 'pm.susp.example', status: 'SUSPENDED' } }));
  });
  it('allows (200) a domain an ACTIVE tenant owns — normalising case & port', async () => {
    expect((await check('pm.beta.example')).status).toBe(200);
    expect((await check('PM.Beta.Example:443')).status).toBe(200);
  });
  it('denies (404) an unknown domain — so a stranger cannot trigger cert issuance', async () => {
    expect((await check('random.nobody.example')).status).toBe(404);
  });
  it("denies (404) a SUSPENDED tenant's domain", async () => {
    expect((await check('pm.susp.example')).status).toBe(404);
  });
  it('400 on a missing domain', async () => {
    expect((await check('')).status).toBe(400);
  });
});
