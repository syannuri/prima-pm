import { describe, it, expect } from 'vitest';
import { changePasswordSchema } from '../auth.schemas.js';

const parse = (current: string, next: string) =>
  changePasswordSchema.safeParse({ currentPassword: current, newPassword: next });

describe('changePasswordSchema', () => {
  it('accepts a strong new password', () => {
    expect(parse('Password123!', 'Tr0ubadour-Xapiens-2026').success).toBe(true);
  });

  it('rejects the known-breached demo password', () => {
    const r = parse('whatever1', 'Password123!');
    expect(r.success).toBe(false);
  });

  it('rejects a new password equal to the current one', () => {
    expect(parse('SameOne12345', 'SameOne12345').success).toBe(false);
  });

  it('rejects too-short passwords', () => {
    expect(parse('x', 'Ab1cd').success).toBe(false);
  });

  it('requires both a letter and a number', () => {
    expect(parse('x', 'alllettersonly').success).toBe(false);
    expect(parse('x', '1234567890').success).toBe(false);
  });
});
