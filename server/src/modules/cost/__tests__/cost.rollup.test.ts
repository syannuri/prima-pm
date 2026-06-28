import { describe, it, expect } from 'vitest';
import { computeBaseline } from '../cost.rollup.js';

describe('cost roll-up — end-to-end composition', () => {
  const directLines = [
    { amount: 4_500_000 }, // material: technology on-prem
    { amount: 10_000_000 }, // material: software license
    { manpowerCost: 24_000_000 }, // manpower: PM
    { manpowerCost: 6_000_000 }, // manpower: personnel
  ];
  const indirectLines = [{ amount: 2_000_000 }, { amount: 3_500_000 }, { amount: 1_000_000 }];
  const risks = [
    { kind: 'THREAT' as const, emv: 30_000_000, residualEmv: 18_000_000, includeInReserve: true },
    { kind: 'THREAT' as const, emv: 5_000_000, residualEmv: 5_000_000, includeInReserve: true },
  ];

  it('rolls direct + indirect + contingency into baseline & BAC', () => {
    const r = computeBaseline({
      directLines,
      indirectLines,
      risks,
      managementReserve: 3_000_000,
    });

    expect(r.directTotal).toBe(44_500_000);
    expect(r.indirectTotal).toBe(6_500_000);
    expect(r.contingencyReserve).toBe(23_000_000); // 18M + 5M
    expect(r.costBaseline).toBe(74_000_000); // 44.5 + 6.5 + 23
    expect(r.budgetAtCompletion).toBe(77_000_000); // + 3M mgmt reserve
  });

  it('contingency is zero when there are no risks', () => {
    const r = computeBaseline({ directLines, indirectLines, risks: [] });
    expect(r.contingencyReserve).toBe(0);
    expect(r.costBaseline).toBe(51_000_000); // 44.5 + 6.5
    expect(r.budgetAtCompletion).toBe(51_000_000);
  });

  it('exposes the contingency breakdown for transparency', () => {
    const r = computeBaseline({ directLines, indirectLines, risks });
    expect(r.contingencyBreakdown.threatReserve).toBe(23_000_000);
    expect(r.contingencyBreakdown.confidenceFactor).toBe(1);
  });
});
