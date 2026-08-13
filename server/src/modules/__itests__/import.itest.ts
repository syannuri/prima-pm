import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { signAccessToken } from '../../lib/jwt.js';

const app = createApp();
const api = (p: string) => `/api/v1${p}`;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

let adminToken: string;
let projectId: string;

async function xlsx(rows: (string | number | boolean)[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Tasks');
  ws.addRow(['WBS', 'Name', 'Plan Start', 'Plan End', 'Progress %', 'Milestone']);
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

beforeAll(async () => {
  const r = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'`;
  if (r.length) await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${r.map((x) => `"${x.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  const admin = await prisma.user.create({ data: { name: 'Imp Admin', email: 'imp-admin@corp.test', role: 'ADMIN', passwordHash: await hashPassword('Admin-Pass-1'), isActive: true } });
  adminToken = signAccessToken({ sub: admin.id, role: 'ADMIN', email: admin.email });
  const project = await prisma.project.create({ data: { code: 'IMP-1', name: 'Import Test', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE', pmUserId: admin.id } });
  projectId = project.id;
});

describe('Spreadsheet task import (T4.3)', () => {
  it('dry-run previews valid rows and reports invalid ones without writing', async () => {
    const buf = await xlsx([
      ['1', 'Design', '2026-01-01', '2026-01-10', 20, false],
      ['2', 'Build', '2026-01-11', '2026-01-20', 0, false],
      ['3', '', '2026-02-01', '2026-02-05', 0, false],      // missing name
      ['4', 'Backwards', '2026-03-10', '2026-03-01', 0, false], // end before start
    ]);
    const res = await request(app).post(api(`/projects/${projectId}/import/tasks`)).set(auth(adminToken)).attach('file', buf, 'tasks.xlsx');
    expect(res.status).toBe(200);
    expect(res.body.dryRun).toBe(true);
    expect(res.body.willImport).toBe(2);
    expect(res.body.errors.length).toBe(2);
    // Nothing written on a dry run.
    expect(await prisma.task.count({ where: { projectId } })).toBe(0);
  });

  it('refuses to commit when any row is invalid', async () => {
    const buf = await xlsx([
      ['1', 'Good', '2026-01-01', '2026-01-10', 0, false],
      ['2', '', '2026-01-11', '2026-01-20', 0, false], // invalid
    ]);
    const res = await request(app).post(api(`/projects/${projectId}/import/tasks?dryRun=false`)).set(auth(adminToken)).attach('file', buf, 'tasks.xlsx');
    expect(res.status).toBe(400);
    expect(await prisma.task.count({ where: { projectId } })).toBe(0);
  });

  it('commits all rows when the sheet is clean', async () => {
    const buf = await xlsx([
      ['1', 'Design', '2026-01-01', '2026-01-10', 20, false],
      ['2', 'Build', '2026-01-11', '2026-01-20', 0, false],
      ['3', 'Launch', '2026-01-21', '2026-01-21', 0, true],
    ]);
    const res = await request(app).post(api(`/projects/${projectId}/import/tasks?dryRun=false`)).set(auth(adminToken)).attach('file', buf, 'tasks.xlsx');
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(3);
    expect(await prisma.task.count({ where: { projectId } })).toBe(3);
    const milestone = await prisma.task.findFirst({ where: { projectId, name: 'Launch' } });
    expect(milestone?.isMilestone).toBe(true);
  });

  it('imports a Weight column: persists numbers, blank → auto (null), rejects a bad value', async () => {
    const proj = await prisma.project.create({ data: { code: 'IMP-W', name: 'Import Weights', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE', pmUserId: (await prisma.user.findFirstOrThrow({ where: { email: 'imp-admin@corp.test' } })).id } });
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Tasks');
    ws.addRow(['WBS', 'Name', 'Plan Start', 'Plan End', 'Progress %', 'Milestone', 'Weight']);
    [
      ['1', 'Heavy', '2026-01-01', '2026-01-10', 0, false, 60],
      ['2', 'Light', '2026-01-11', '2026-01-20', 0, false, 40],
      ['3', 'Auto', '2026-01-21', '2026-01-25', 0, false, ''], // blank → null
    ].forEach((r) => ws.addRow(r));
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const ok = await request(app).post(api(`/projects/${proj.id}/import/tasks?dryRun=false`)).set(auth(adminToken)).attach('file', buf, 'tasks.xlsx');
    expect(ok.status).toBe(201);
    expect(ok.body.created).toBe(3);
    expect((await prisma.task.findFirstOrThrow({ where: { projectId: proj.id, name: 'Heavy' } })).weight).toBe(60);
    expect((await prisma.task.findFirstOrThrow({ where: { projectId: proj.id, name: 'Light' } })).weight).toBe(40);
    expect((await prisma.task.findFirstOrThrow({ where: { projectId: proj.id, name: 'Auto' } })).weight).toBeNull();

    // A negative weight is a row error → all-or-nothing commit refused, nothing added beyond the 3.
    const wb2 = new ExcelJS.Workbook();
    const ws2 = wb2.addWorksheet('Tasks');
    ws2.addRow(['Name', 'Plan Start', 'Plan End', 'Weight']);
    ws2.addRow(['Bad', '2026-02-01', '2026-02-05', -5]);
    const bad = await request(app).post(api(`/projects/${proj.id}/import/tasks?dryRun=false`)).set(auth(adminToken)).attach('file', Buffer.from(await wb2.xlsx.writeBuffer()), 'tasks.xlsx');
    expect(bad.status).toBe(400);
    expect(await prisma.task.count({ where: { projectId: proj.id } })).toBe(3);
  });

  it('rejects a non-spreadsheet file', async () => {
    const res = await request(app).post(api(`/projects/${projectId}/import/tasks`)).set(auth(adminToken)).attach('file', Buffer.from('nope'), 'notes.txt');
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('applying a WBS template seeds its curated weights (milestones stay auto)', async () => {
    const adminId = (await prisma.user.findFirstOrThrow({ where: { email: 'imp-admin@corp.test' } })).id;
    const proj = await prisma.project.create({ data: { code: 'IMP-T', name: 'Template Weights', status: 'IN_PROGRESS', deliveryApproach: 'PREDICTIVE', pmUserId: adminId } });
    const res = await request(app).post(api(`/projects/${proj.id}/schedule/apply-template`)).set(auth(adminToken)).send({ templateId: 'generic-it', startDate: '2026-01-01' });
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
    // Build/Development carries the curated weight 35; the Kick-Off milestone stays auto (null).
    expect((await prisma.task.findFirstOrThrow({ where: { projectId: proj.id, name: 'Build / Development' } })).weight).toBe(35);
    expect((await prisma.task.findFirstOrThrow({ where: { projectId: proj.id, name: 'Kick-Off Meeting' } })).weight).toBeNull();
    // The work-package weights sum to ~100.
    const tasks = await prisma.task.findMany({ where: { projectId: proj.id } });
    const sum = tasks.reduce((s, t) => s + (t.weight ?? 0), 0);
    expect(sum).toBe(100);
  });
});
