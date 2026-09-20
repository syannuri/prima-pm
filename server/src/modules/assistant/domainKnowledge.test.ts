import { describe, it, expect } from 'vitest';
import { findDomainTopic, domainIndex, resolvePersonasForCategory, DOMAIN_KNOWLEDGE, DOMAIN_DISCLAIMER_EN, DOMAIN_DISCLAIMER_ID } from './domainKnowledge.js';

// Retrieval + content sanity for the domain-expertise knowledge base (grounds domain_guidance) and
// the deterministic charter-category → persona mapping that activates a persona.
describe('domainKnowledge', () => {
  it('matches common technical topics to the right persona entry', () => {
    expect(findDomainTopic('zero trust segmentation')?.id).toBe('cybersecurity-infrastructure');
    expect(findDomainTopic('sd-wan network topology')?.id).toBe('network-architecture');
    expect(findDomainTopic('disaster recovery RPO RTO')?.id).toBe('server-infrastructure');
    expect(findDomainTopic('secure sdlc ci/cd testing')?.id).toBe('sdlc');
    expect(findDomainTopic('ITIL change management incident')?.id).toBe('it-infrastructure');
    expect(findDomainTopic('benefits realization program governance')?.id).toBe('program-management');
    expect(findDomainTopic('nist csf vulnerability management')?.id).toBe('cybersecurity');
  });

  it('returns null for an unrelated query (so the caller offers the index, not a guess)', () => {
    expect(findDomainTopic('zzzznotarealtopic')).toBeNull();
  });

  it('every entry carries a persona, ≥1 standard, ≥1 alias and ≥2 guidance points', () => {
    for (const e of DOMAIN_KNOWLEDGE) {
      expect(e.persona.length).toBeGreaterThan(0);
      expect(e.personaEn.length).toBeGreaterThan(0);
      expect(e.standards.length).toBeGreaterThan(0);
      expect(e.aliases.length).toBeGreaterThan(0);
      expect(e.guidance.length).toBeGreaterThanOrEqual(2);
      expect(e.expertiseAreas.length).toBeGreaterThan(0);
    }
  });

  it('exposes a non-empty index and both advisory disclaimers', () => {
    expect(domainIndex().length).toBeGreaterThan(0);
    expect(DOMAIN_DISCLAIMER_EN).toMatch(/advisory/i);
    expect(DOMAIN_DISCLAIMER_ID).toMatch(/advisory/i);
  });

  it('covers all seven personas the feature promises', () => {
    const ids = new Set(DOMAIN_KNOWLEDGE.map((e) => e.id));
    for (const id of ['program-management', 'network-architecture', 'it-infrastructure', 'server-infrastructure', 'cybersecurity', 'cybersecurity-infrastructure', 'sdlc']) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it('maps each ProjectCategory to the expected persona ids (deterministic activation)', () => {
    const idsFor = (c: string | null | undefined) => resolvePersonasForCategory(c).map((e) => e.id);
    expect(idsFor('NETWORK_INFRA')).toEqual(['network-architecture', 'it-infrastructure']);
    expect(idsFor('SERVER_INFRA')).toEqual(['server-infrastructure', 'it-infrastructure']);
    expect(idsFor('CLOUD_INFRA')).toEqual(['server-infrastructure', 'it-infrastructure']);
    expect(idsFor('DATACENTER')).toEqual(['server-infrastructure', 'it-infrastructure']);
    expect(idsFor('CYBERSECURITY_INFRA')).toEqual(['cybersecurity-infrastructure', 'cybersecurity']);
    expect(idsFor('APP_DEV')).toEqual(['sdlc']);
    expect(idsFor('ENTERPRISE_APP')).toEqual(['sdlc']);
    expect(idsFor('SYSTEM_INTEGRATION')).toEqual(['it-infrastructure', 'sdlc']);
    expect(idsFor('DIGITAL_TRANSFORMATION')).toEqual(['program-management']);
    expect(idsFor('DATA_ANALYTICS')).toEqual(['sdlc']);
    expect(idsFor('AI_ML')).toEqual(['sdlc']);
  });

  it('returns [] for OTHER / null / unknown categories (PM/Program only — no forced persona)', () => {
    expect(resolvePersonasForCategory('OTHER')).toEqual([]);
    expect(resolvePersonasForCategory(null)).toEqual([]);
    expect(resolvePersonasForCategory(undefined)).toEqual([]);
    expect(resolvePersonasForCategory('SOMETHING_NEW')).toEqual([]);
  });
});
