import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';

const app = createApp();
const api = (p: string) => `/api/v1${p}`;

describe('Public API docs (T3.4)', () => {
  it('serves the OpenAPI spec publicly (no auth) with the expected shape', async () => {
    const res = await request(app).get(api('/openapi.json'));
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.1.0');
    expect(res.body.info?.title).toMatch(/Prismatix/);
    expect(res.body.components?.securitySchemes?.apiKey?.scheme).toBe('bearer');
    expect(Object.keys(res.body.paths ?? {}).length).toBeGreaterThan(0);
    // Outbound webhook events are documented under the 3.1 `webhooks` section.
    expect(res.body.webhooks?.['project.created']).toBeTruthy();
    expect(res.body.webhooks?.['baseline.locked']).toBeTruthy();
  });

  it('serves the rendered reference page', async () => {
    const res = await request(app).get(api('/docs'));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
    expect(res.text).toMatch(/redoc/i);
  });

  it('documents only real endpoints (each documented GET exists → 401 unauth, not 404)', async () => {
    const spec = (await request(app).get(api('/openapi.json'))).body;
    const getPaths = Object.entries(spec.paths as Record<string, Record<string, unknown>>)
      .filter(([, ops]) => 'get' in ops)
      .map(([p]) => p);
    expect(getPaths.length).toBeGreaterThan(0);
    for (const p of getPaths) {
      const res = await request(app).get(api(p)); // no auth
      expect(res.status, `documented path ${p} should exist`).not.toBe(404);
      expect(res.status).toBe(401); // route exists but requires authentication
    }
  });
});
