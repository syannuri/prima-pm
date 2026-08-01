import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// Control the Turnstile lib so the middleware is tested in isolation (no real siteverify call).
vi.mock('../../lib/turnstile.js', () => ({
  captchaEnabled: vi.fn(),
  verifyTurnstile: vi.fn(),
}));
import { captchaEnabled, verifyTurnstile } from '../../lib/turnstile.js';
import { verifyCaptcha } from '../captcha.js';

const run = async (body: unknown) => {
  const req = { body, ip: '1.2.3.4' } as unknown as Request;
  const next = vi.fn() as unknown as NextFunction & { mock: { calls: unknown[][] } };
  await verifyCaptcha(req, {} as Response, next);
  return next;
};

describe('verifyCaptcha middleware', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is a no-op when CAPTCHA is disabled (never calls siteverify)', async () => {
    vi.mocked(captchaEnabled).mockReturnValue(false);
    const next = await run({});
    expect(next).toHaveBeenCalledWith();
    expect(verifyTurnstile).not.toHaveBeenCalled();
  });

  it('passes a valid token through (with the client IP)', async () => {
    vi.mocked(captchaEnabled).mockReturnValue(true);
    vi.mocked(verifyTurnstile).mockResolvedValue(true);
    const next = await run({ captchaToken: 'good' });
    expect(verifyTurnstile).toHaveBeenCalledWith('good', '1.2.3.4');
    expect(next).toHaveBeenCalledWith();
  });

  it('rejects a missing token with 400 — WITHOUT hitting siteverify', async () => {
    vi.mocked(captchaEnabled).mockReturnValue(true);
    const next = await run({});
    expect(verifyTurnstile).not.toHaveBeenCalled();
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 400 });
  });

  it('rejects an invalid token with 400', async () => {
    vi.mocked(captchaEnabled).mockReturnValue(true);
    vi.mocked(verifyTurnstile).mockResolvedValue(false);
    const next = await run({ captchaToken: 'bad' });
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 400 });
  });
});
