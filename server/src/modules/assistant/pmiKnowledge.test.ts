import { describe, it, expect } from 'vitest';
import { findPmiTopic, pmiIndex, PMI_KNOWLEDGE, PMI_DISCLAIMER_EN, PMI_DISCLAIMER_ID } from './pmiKnowledge.js';

// Retrieval + content sanity for the PMI advisory knowledge base (grounds pmi_guidance).
describe('pmiKnowledge', () => {
  it('matches common PM topics to a relevant entry', () => {
    expect(findPmiTopic('earned value SPI')?.id).toBe('measurement-evm');
    expect(findPmiTopic('risk response strategy')?.id).toBe('uncertainty-risk');
    expect(findPmiTopic('integrated change control')?.id).toBe('integrated-change-control');
    expect(findPmiTopic('pmbok 7 principles')?.id).toBe('principles');
  });

  it('returns null for an unrelated query (so the caller offers the index, not a guess)', () => {
    expect(findPmiTopic('zzzznotarealtopic')).toBeNull();
  });

  it('every entry carries a standard label + at least one guidance point', () => {
    for (const e of PMI_KNOWLEDGE) {
      expect(e.standard.length).toBeGreaterThan(0);
      expect(e.guidance.length).toBeGreaterThan(0);
    }
  });

  it('exposes a non-empty index and both disclaimers', () => {
    expect(pmiIndex().length).toBeGreaterThan(0);
    expect(PMI_DISCLAIMER_EN).toMatch(/advisory/i);
    expect(PMI_DISCLAIMER_ID).toMatch(/advisory/i);
  });

  it('covers PMBOK 7, PMBOK 6 and the practice standards (extensive KB)', () => {
    const ids = new Set(PMI_KNOWLEDGE.map((e) => e.id));
    for (const id of ['principles', 'performance-domains', 'process-groups', 'knowledge-areas', 'measurement-evm', 'uncertainty-risk', 'integrated-change-control', 'advise-from-metrics']) {
      expect(ids.has(id)).toBe(true);
    }
    expect(PMI_KNOWLEDGE.length).toBeGreaterThanOrEqual(15);
  });
});
