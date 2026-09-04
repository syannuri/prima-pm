import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';

// /version — public deploy-identity probe so a backend-only deploy can be verified remotely (curl
// the SHA) without SSH. In the test run there is no dist/version.json, so it falls back to 'dev'.
const app = createApp();

describe('/version', () => {
  it('is public (no auth) and returns a version shape', async () => {
    const res = await request(app).get('/version');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('sha');
    expect(res.body).toHaveProperty('shortSha');
    expect(typeof res.body.sha).toBe('string');
    expect(res.body.sha.length).toBeGreaterThan(0);
  });
});
