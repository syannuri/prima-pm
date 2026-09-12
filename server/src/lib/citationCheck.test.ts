import { describe, it, expect } from 'vitest';
import { extractMoneyIDR, candidateValues, verifyCitedValues, normalizeRupiahText, formatIdrHuman } from './citationCheck.js';

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

// Reported LAN/VPS case: Anett answered "Rp 5.096 miliar" — a period-as-decimal that an Indonesian reader
// parses as 5096 miliar ≈ Rp 5 triliun (a 1000× optical slip). Normalize to Indonesian locale at the source.
describe('normalizeRupiahText', () => {
  it('rewrites period-decimal scale figures to Indonesian comma format (rounded ≤2 decimals)', () => {
    expect(normalizeRupiahText('Total Rp 5.096 miliar')).toBe('Total Rp 5,1 miliar');
    expect(normalizeRupiahText('BAC Rp 4.941731 miliar')).toBe('BAC Rp 4,94 miliar');
    expect(normalizeRupiahText('Rp 154.55 juta')).toBe('Rp 154,55 juta');
  });
  it('handles figures without an Rp prefix', () => {
    expect(normalizeRupiahText('totalnya 5.096 miliar saja')).toBe('totalnya 5,1 miliar saja');
  });
  it('leaves already-correct Indonesian figures unchanged', () => {
    expect(normalizeRupiahText('Rp 154,55 juta')).toBe('Rp 154,55 juta');
    expect(normalizeRupiahText('Rp 1.234,5 juta')).toBe('Rp 1.234,5 juta');
  });
  it('leaves bare grouped figures (no scale word) and non-money prose alone', () => {
    expect(normalizeRupiahText('Rp 5.096.281.028')).toBe('Rp 5.096.281.028');
    expect(normalizeRupiahText('progres 92,5% selesai')).toBe('progres 92,5% selesai');
  });
  it('normalizes every figure in a multi-figure answer', () => {
    expect(normalizeRupiahText('IOS Rp 4.941731 miliar dan PRJ Rp 154.55 juta, total Rp 5.096 miliar'))
      .toBe('IOS Rp 4,94 miliar dan PRJ Rp 154,55 juta, total Rp 5,1 miliar');
  });
});

// The deterministic scale-word conversion the model must NOT do by hand. Reported LAN case: totalBacIdr
// 6_796_500_200 (Rp 6,8 miliar) was hand-rendered by the model as "6.796,5 miliar" = Rp 6,8 triliun (1000×).
describe('formatIdrHuman', () => {
  it('renders raw IDR as the correct Indonesian scale-word string', () => {
    expect(formatIdrHuman(6_796_500_200)).toBe('Rp 6,8 miliar');   // the reported case — miliar, NOT triliun
    expect(formatIdrHuman(4_789_000_000)).toBe('Rp 4,79 miliar');
    expect(formatIdrHuman(154_550_000)).toBe('Rp 154,55 juta');
    expect(formatIdrHuman(5_096_281_028)).toBe('Rp 5,1 miliar');
    expect(formatIdrHuman(6_796_500_200_000)).toBe('Rp 6,8 triliun');
    expect(formatIdrHuman(250_000)).toBe('Rp 250.000');            // below juta → grouped rupiah
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

  it('includes pairwise sums (portfolio rollups across projects)', () => {
    const cands = candidateValues('[{"bac":4940000000},{"bac":154600000}]');
    expect(cands).toContain(5_094_600_000); // Σ BAC = the portfolio total
  });

  it('includes the full rollup sum of 3+ money values', () => {
    // Asset Mgmt 700jt + DC Phase1 1miliar + DRC 3,089miliar → Σ = 4,789 miliar
    const cands = candidateValues('[{"bac":700000000},{"bac":1000000000},{"bac":3089000000}]');
    expect(cands).toContain(4_789_000_000);
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

  // Regression: Anett reported a correct portfolio total, then under user pushback "corrected" every
  // figure ×1000 to Triliun on a turn that made NO tool call — so it had no tool context and the guard
  // was skipped. The previous answer's figures are now used as reference to catch the flip.
  it('flags a ×1000 flip against the previous answer even with no tool context this turn', () => {
    const prior = 'Total portofolio Rp 5,096 Miliar; Network Rp 4,94 Miliar.';
    const flipped = 'Anda betul — maksud saya Rp 5,096 Triliun; Network Rp 4,94 Triliun.';
    const res = verifyCitedValues(flipped, undefined, prior);
    expect(res.ok).toBe(false);
    expect(res.issues.length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag when the follow-up restates the same figures as the previous answer', () => {
    const prior = 'Total portofolio Rp 5,096 Miliar.';
    expect(verifyCitedValues('Benar, totalnya Rp 5,096 Miliar.', undefined, prior).ok).toBe(true);
  });

  it('validates (and flags a flip of) a portfolio total as the sum of per-project values', () => {
    const portfolio = '[{"bac":4940000000},{"bac":154600000}]';
    expect(verifyCitedValues('Total BAC Rp 5,0946 Miliar.', portfolio).ok).toBe(true);   // sum of the two BACs
    expect(verifyCitedValues('Total BAC Rp 5,0946 Triliun.', portfolio).ok).toBe(false); // ×1000 off the sum
  });

  // The reported case: total of THREE projects flipped to Triliun (pairwise sums alone would miss it).
  it('flags a ×1000 flip of a 3-project total (full rollup sum)', () => {
    const three = '[{"bac":700000000},{"bac":1000000000},{"bac":3089000000}]';
    expect(verifyCitedValues('TOTAL Rp 4,789 Miliar.', three).ok).toBe(true);   // Σ of the three BACs
    expect(verifyCitedValues('TOTAL Rp 4,789 Triliun.', three).ok).toBe(false); // ×1000 off the Σ
  });
});
