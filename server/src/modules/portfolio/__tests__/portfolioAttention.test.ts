import { describe, it, expect } from 'vitest';
import { scoreProjects, type SignalRow } from '../portfolioAttention.service.js';

// Pure scoring/ranking. The DB gathering + AI narration are covered by portfolioAttention.itest.
const base = (over: Partial<SignalRow>): SignalRow => ({
  projectId: 'p', code: 'P', name: 'P', health: 'NO_DATA', costHealth: 'NO_DATA', spi: 1, cpi: 1,
  finishVarianceDays: null, overdue: 0, dueSoon: 0, highRisks: 0, openCRs: 0, resourceOverBy: 0, ...over,
});

describe('scoreProjects', () => {
  it('drops projects with no attention signals', () => {
    expect(scoreProjects([base({ projectId: 'healthy', health: 'GREEN', costHealth: 'GREEN' })])).toHaveLength(0);
  });

  it('scores and explains a troubled project', () => {
    const [it0] = scoreProjects([base({ projectId: 'bad', code: 'BAD', health: 'RED', spi: 0.7, overdue: 3, highRisks: 2 })]);
    expect(it0.code).toBe('BAD');
    expect(it0.score).toBe(40 + 3 * 6 + 2 * 8); // schedule RED + overdue + risks
    const kinds = it0.reasons.map((r) => r.kind).sort();
    expect(kinds).toEqual(['overdue', 'risks', 'schedule']);
  });

  it('ranks by score descending and caps at 8', () => {
    const rows = Array.from({ length: 12 }, (_, i) => base({ projectId: `p${i}`, code: `P${i}`, overdue: i + 1 }));
    const ranked = scoreProjects(rows);
    expect(ranked).toHaveLength(8);
    expect(ranked[0].score).toBe(60); // top = overdue capped at 10 × 6
    for (let i = 1; i < ranked.length; i++) expect(ranked[i - 1].score).toBeGreaterThanOrEqual(ranked[i].score);
  });

  it('caps a signal contribution (overdue capped at 10)', () => {
    const [a] = scoreProjects([base({ overdue: 50 })]);
    const [b] = scoreProjects([base({ overdue: 10 })]);
    expect(a.score).toBe(b.score); // 50 and 10 both clamp to 10×6
  });

  it('adds a resource reason from over-allocation', () => {
    const [it0] = scoreProjects([base({ resourceOverBy: 12 })]);
    expect(it0.reasons.some((r) => r.kind === 'resource')).toBe(true);
    expect(it0.score).toBe(12);
  });
});
