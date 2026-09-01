import { describe, it, expect } from 'vitest';
import { buildRiskSuggestPrompt } from '../riskSuggest.service.js';

// PURE prompt-builder: proves the system prompt (and therefore the generated risk language) follows
// the caller's app language, and that the grounding payload is language-independent.
const ctx = {
  charter: null,
  project: { code: 'RSK-1', name: 'Risk Project', approach: 'PREDICTIVE' },
  taskNames: ['Design', 'Build'],
  existingRiskTitles: ['Vendor delay'],
};

describe('buildRiskSuggestPrompt — language selection', () => {
  it('English by default and when lang="en"', () => {
    const def = buildRiskSuggestPrompt(ctx);
    const en = buildRiskSuggestPrompt(ctx, 'en');
    expect(def.system).toBe(en.system);
    expect(en.system).toContain('project-management English');
    expect(en.system).not.toContain('Bahasa Indonesia');
  });

  it('Indonesian when lang="id"', () => {
    const id = buildRiskSuggestPrompt(ctx, 'id');
    expect(id.system).toContain('Bahasa Indonesia');
    expect(id.system).not.toContain('project-management English');
  });

  it('user payload carries the grounding and is language-independent', () => {
    const en = buildRiskSuggestPrompt(ctx, 'en');
    const id = buildRiskSuggestPrompt(ctx, 'id');
    expect(en.user).toBe(id.user);
    const payload = JSON.parse(en.user);
    expect(payload.wbsTasks).toEqual(['Design', 'Build']);
    expect(payload.existingRiskTitles).toEqual(['Vendor delay']);
  });
});
