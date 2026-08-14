import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';

// Observability Phase 1 — liveness vs readiness split + request correlation id. (Structured logging
// and the 500-path captureError are exercised implicitly; Sentry capture arrives in Phase 2.)
const app = createApp();

describe('observability (Phase 1)', () => {
  it('/health is a plain liveness probe', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('/health/ready pings the database (200 + db:up when reachable)', async () => {
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ready', db: 'up' });
  });

  it('assigns an X-Request-Id correlation header on every response', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('echoes a caller-supplied X-Request-Id (distributed correlation)', async () => {
    const res = await request(app).get('/health').set('X-Request-Id', 'corr-test-123');
    expect(res.headers['x-request-id']).toBe('corr-test-123');
  });
});
