import { describe, it, expect } from 'vitest';
import { isValidSlugShape } from './slug.js';

describe('isValidSlugShape', () => {
  it('accepts valid DNS-label subdomains', () => {
    for (const s of ['acme', 'acme-corp', 'a1', 'globex-2026', 'x'.repeat(40)]) expect(isValidSlugShape(s)).toBe(true);
  });
  it('rejects too short/long, bad chars, and leading/trailing hyphens', () => {
    for (const s of ['a', 'x'.repeat(41), 'Acme', 'ac_me', 'ac me', '-acme', 'acme-', 'acme.corp', '']) expect(isValidSlugShape(s)).toBe(false);
  });
});
