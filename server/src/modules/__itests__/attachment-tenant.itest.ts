import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { signAccessToken } from '../../lib/jwt.js';
import { runWithTenant, runAsSystem } from '../../lib/tenant/context.js';
import { UPLOAD_DIR } from '../attachment/attachment.service.js';
import { wipeDb } from '../../test/tenancy.harness.js';

// Per-tenant upload namespacing + storage quota (Phase 5). Enforcement ON.
const app = createApp();
const api = (p: string) => `/api/v1${p}`;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

let prevFlag: string | undefined;
let prevQuota: string | undefined;
let tid = '', token = '', projectId = '';

beforeAll(async () => {
  prevFlag = process.env.MULTITENANCY_ENFORCE;
  prevQuota = process.env.TENANT_STORAGE_QUOTA_MB;
  process.env.MULTITENANCY_ENFORCE = 'true';
  delete process.env.TENANT_STORAGE_QUOTA_MB; // default 1 GB
  await wipeDb();
  const tenant = await prisma.tenant.create({ data: { slug: 'atc', name: 'Att Corp' } });
  tid = tenant.id;
  const admin = await prisma.user.create({ data: { name: 'A', email: 'att-admin@atc.test', role: 'ADMIN', passwordHash: await hashPassword('x'), isActive: true } });
  await prisma.membership.create({ data: { userId: admin.id, tenantId: tid, role: 'ADMIN' } });
  token = signAccessToken({ sub: admin.id, role: 'ADMIN', email: admin.email, tv: 0, tid });
  const proj = await runWithTenant(tid, () => prisma.project.create({ data: { code: 'PRJ-ATC-1', name: 'P', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE', pmUserId: admin.id } }));
  projectId = proj.id;
});

afterAll(async () => {
  if (prevFlag === undefined) delete process.env.MULTITENANCY_ENFORCE; else process.env.MULTITENANCY_ENFORCE = prevFlag;
  if (prevQuota === undefined) delete process.env.TENANT_STORAGE_QUOTA_MB; else process.env.TENANT_STORAGE_QUOTA_MB = prevQuota;
  try { fs.rmSync(path.join(UPLOAD_DIR, tid), { recursive: true, force: true }); } catch { /* */ }
});

const upload = (buf: Buffer, name = 'doc.png') =>
  request(app).post(api(`/projects/${projectId}/attachments`)).set(bearer(token))
    .field('ownerType', 'PROJECT').field('ownerId', projectId)
    .attach('file', buf, { filename: name, contentType: 'image/png' });

describe('uploads are namespaced by tenant', () => {
  it('stores the file under uploads/<tenantId>/ and serves it back', async () => {
    const res = await upload(Buffer.from('a tiny png payload'));
    expect(res.status).toBe(201);
    const att = await runAsSystem(() => prisma.attachment.findUniqueOrThrow({ where: { id: res.body.attachment.id }, select: { storageKey: true, tenantId: true } }));
    expect(att.tenantId).toBe(tid);
    // The file lives in the tenant subdir, NOT the flat root.
    expect(fs.existsSync(path.join(UPLOAD_DIR, tid, att.storageKey))).toBe(true);
    expect(fs.existsSync(path.join(UPLOAD_DIR, att.storageKey))).toBe(false);
    // And it downloads.
    const dl = await request(app).get(api(`/projects/${projectId}/attachments/${res.body.attachment.id}/download`)).set(bearer(token));
    expect(dl.status).toBe(200);
  });
});

describe('per-tenant storage quota', () => {
  it('rejects an upload that would exceed the tenant quota (413), and cleans up the rejected file', async () => {
    process.env.TENANT_STORAGE_QUOTA_MB = '1'; // 1 MB quota
    const before = fs.existsSync(path.join(UPLOAD_DIR, tid)) ? fs.readdirSync(path.join(UPLOAD_DIR, tid)).length : 0;
    const res = await upload(Buffer.alloc(2 * 1024 * 1024, 1), 'big.png'); // 2 MB > 1 MB quota
    expect(res.status).toBe(413);
    // No stray file left behind from the rejected upload.
    const after = fs.existsSync(path.join(UPLOAD_DIR, tid)) ? fs.readdirSync(path.join(UPLOAD_DIR, tid)).length : 0;
    expect(after).toBe(before);
    delete process.env.TENANT_STORAGE_QUOTA_MB;
  });
});
