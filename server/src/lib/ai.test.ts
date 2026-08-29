import { describe, it, expect } from 'vitest';
import { aiNotEnabledError } from './ai.js';
import { bindTenantContext } from './tenant/context.js';

// The AI gate message must be honest about who can act on it: a guest's personal sandbox can never
// opt in, so it gets a sandbox-specific message; corporate tenants (and no-context) keep the
// actionable "not enabled for this workspace" that points an admin at Settings.
describe('aiNotEnabledError', () => {
  it('gives a guest-sandbox message when the active tenant is personal', () => {
    bindTenantContext('t-guest', true, () => {
      const e = aiNotEnabledError();
      expect(e.statusCode).toBe(403);
      expect(e.message).toContain('sandbox');
      expect(e.message).not.toContain('belum diaktifkan');
    });
  });

  it('gives the generic (actionable) message for a corporate tenant', () => {
    bindTenantContext('t-corp', false, () => {
      expect(aiNotEnabledError().message).toBe('Fitur AI belum diaktifkan untuk workspace ini.');
    });
  });

  it('defaults to the generic message with no tenant context', () => {
    expect(aiNotEnabledError().message).toBe('Fitur AI belum diaktifkan untuk workspace ini.');
  });
});
