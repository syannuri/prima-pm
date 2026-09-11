import { describe, it, expect } from 'vitest';
import { extractMoneyIDR, candidateValues, verifyCitedValues } from './citationCheck.js';

// #6 deterministic citation-value verification. Motivated by a real LAN case: Anett said the DRC saving
// was "Rp 423,5 Miliar" when the actual BAC−AC was ~423 Juta (a 1000× unit slip the LLM judge passed).
describe('extractMoneyIDR', () => {
  it('parses human-readable rupiah figures with a scale word', () => {
    expect(extractMoneyIDR('hemat Rp 423,5 Juta')).toEqual([423_500_000]);
    expect(extractMoneyIDR('anggaran Rp 3.089 Miliar')).toEqual([3_089_000_000]);
    expect(extractMoneyIDR('Rp 2.6655 Miliar aktual')).toEqual([2_665_500_000]);
    expect(extractMoneyIDR('Rp 1.234,5 Juta')).toEqual([1_234_500_000]);
  });
  it('ignores figures without a scale word (ambiguous grouping)', () => {
    expect(extractMoneyIDR('Rp 2.665.500.000')).toEqual([]);
    expect(extractMoneyIDR('progress 92,5% selesai')).toEqual([]);
  });
});

describe('candidateValues', () => {
  it('extracts money-magnitude numbers from tool JSON and their pairwise differences', () => {
    const ctx = '{"budgetAtCompletion":3089000000,"actualCost":2665500000,"spi":0.92}';
    const cands = candidateValues(ctx);
    expect(cands).toContain(3_089_000_000);
    expect(cands).toContain(2_665_500_000);
    expect(cands).toContain(423_500_000); // BAC − AC (the real saving)
    expect(cands).not.toContain(0.92); // below the money threshold
  });
});

describe('verifyCitedValues', () => {
  const ctx = '{"budgetAtCompletion":3089000000,"actualCost":2665500000}';

  it('flags a figure off by ~1000× from the real data (Miliar vs Juta)', () => {
    const res = verifyCitedValues('Proyek hemat Rp 423,5 Miliar dari anggaran.', ctx);
    expect(res.ok).toBe(false);
    expect(res.issues.length).toBe(1);
  });

  it('passes the correct figure (matches BAC − AC)', () => {
    expect(verifyCitedValues('Proyek hemat Rp 423,5 Juta.', ctx).ok).toBe(true);
  });

  it('passes figures that match real values directly', () => {
    expect(verifyCitedValues('Anggaran Rp 3,089 Miliar, aktual Rp 2,6655 Miliar.', ctx).ok).toBe(true);
  });

  it('does not flag when there is no context or no money figures', () => {
    expect(verifyCitedValues('Proyek hemat Rp 423,5 Miliar.', undefined).ok).toBe(true);
    expect(verifyCitedValues('Semua tugas selesai tepat waktu.', ctx).ok).toBe(true);
  });

  it('does not flag an unrelated figure that matches no real value at any scale', () => {
    expect(verifyCitedValues('Biaya lisensi Rp 77 Juta.', ctx).ok).toBe(true);
  });
});
