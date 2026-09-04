import { describe, it, expect, afterEach } from 'vitest';
import { createRedactor, redactionEnabled } from './aiRedact.js';

const prev = process.env.AI_REDACT;
afterEach(() => { if (prev === undefined) delete process.env.AI_REDACT; else process.env.AI_REDACT = prev; });
const on = () => { process.env.AI_REDACT = '1'; };
const off = () => { delete process.env.AI_REDACT; };

describe('aiRedact', () => {
  it('is identity when disabled (zero behaviour change)', () => {
    off();
    expect(redactionEnabled()).toBe(false);
    const r = createRedactor();
    const s = 'contact john@acme.com key sk-ant-abcdefghijklmnopqrstuvwxyz012345';
    expect(r.redact(s)).toBe(s);
    expect(r.restore(s)).toBe(s);
    expect(r.size).toBe(0);
  });

  it('tokenises email + secret and round-trips via restore', () => {
    on();
    const r = createRedactor();
    const original = 'Owner jane.doe@corp.co.id holds key sk-ant-ABCDEFGHIJKLMNOPQRSTUVWXYZ12345.';
    const red = r.redact(original);
    expect(red).not.toContain('jane.doe@corp.co.id');
    expect(red).not.toContain('sk-ant-ABCDEFGHIJKLMNOPQRSTUVWXYZ12345');
    expect(red).toContain('«PII_EMAIL_1»');
    expect(red).toContain('«PII_SECRET_1»');
    expect(r.size).toBe(2);
    // The model's answer echoes the placeholder → restore brings the real value back.
    expect(r.restore(`Assigned to ${red}`)).toContain('jane.doe@corp.co.id');
    expect(r.restore(red)).toBe(original);
  });

  it('dedupes repeats to a stable token', () => {
    on();
    const r = createRedactor();
    const red = r.redact('a@x.com and again a@x.com then b@y.com');
    expect(red).toBe('«PII_EMAIL_1» and again «PII_EMAIL_1» then «PII_EMAIL_2»');
    expect(r.size).toBe(2);
  });

  it('redacts JWTs and private-key blocks but leaves budgets/numbers untouched', () => {
    on();
    const r = createRedactor();
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36';
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIBOwIBAAJB\n-----END RSA PRIVATE KEY-----';
    const red = r.redact(`token ${jwt}\n${pem}\nBudget Rp 1.500.000.000 EV 750000000 SPI 0.92`);
    expect(red).toContain('«PII_JWT_1»');
    expect(red).toContain('«PII_KEY_1»');
    expect(red).not.toContain(jwt);
    expect(red).not.toContain('BEGIN RSA PRIVATE KEY');
    // Financial data must survive — it's exactly what the AI has to reason over.
    expect(red).toContain('Rp 1.500.000.000');
    expect(red).toContain('EV 750000000');
    expect(red).toContain('SPI 0.92');
  });

  it('does not touch app markers (citations/charts)', () => {
    on();
    const r = createRedactor();
    const s = 'See [[cite:AI-1|Cost]] and [[chart:AI-1|evm]].';
    expect(r.redact(s)).toBe(s);
  });
});
