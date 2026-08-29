import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { hashPassword } from '../../lib/password.js';
import { signAccessToken } from '../../lib/jwt.js';

// Regression: a saved dashboard layout must survive logout→login. The client sets `user` straight
// from the /auth/login response (only a full page reload hits /auth/me), so the login payload must
// carry dashboardLayout / dashboardDefaultView — otherwise the dashboard reverts to default.
const app = createApp();
const api = (p: string) => `/api/v1${p}`;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

const EMAIL = 'dash-prefs@corp.test';
const PW = 'Dash-Pass-1';
let token = '';

beforeAll(async () => {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'`;
  if (tables.length) await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((x) => `"${x.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);

  const u = await prisma.user.create({ data: { name: 'Dash User', email: EMAIL, role: 'ADMIN', passwordHash: await hashPassword(PW), isActive: true } });
  token = signAccessToken({ sub: u.id, role: 'ADMIN', email: u.email });
});

describe('dashboard layout survives re-login', () => {
  it('login response carries the saved dashboardLayout + dashboardDefaultView', async () => {
    const layout = ['portfolioSummary', 'attention', 'pendingApprovals'];
    const saved = await request(app).patch(api('/auth/preferences')).set(bearer(token)).send({ dashboardLayout: layout, dashboardDefaultView: 'resources' });
    expect(saved.status).toBe(200);

    // A fresh login (as the client does) must return the persisted prefs, not defaults.
    const login = await request(app).post(api('/auth/login')).send({ email: EMAIL, password: PW });
    expect(login.status).toBe(200);
    expect(login.body.user.dashboardLayout).toEqual(layout);
    expect(login.body.user.dashboardDefaultView).toBe('resources');
  });
});
