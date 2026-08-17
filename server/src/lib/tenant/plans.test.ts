import { describe, it, expect } from 'vitest';
import { PLAN_LIMITS, planLimits, planAllows, planCapabilities } from './plans.js';

describe('plan feature tiering', () => {
  it('TRIAL mirrors PRO (limits + features)', () => {
    expect(planLimits('TRIAL').maxProjects).toBe(planLimits('PRO').maxProjects);
    expect(planLimits('TRIAL').maxMembers).toBe(planLimits('PRO').maxMembers);
    expect(planLimits('TRIAL').storageMb).toBe(planLimits('PRO').storageMb);
    expect(planCapabilities('TRIAL').sort()).toEqual(planCapabilities('PRO').sort());
  });

  it('TRIAL/PRO include the full PM product but NOT enterprise features', () => {
    for (const plan of ['TRIAL', 'PRO'] as const) {
      expect(planAllows(plan, 'portfolio')).toBe(true);
      expect(planAllows(plan, 'forecasting')).toBe(true);
      expect(planAllows(plan, 'ai')).toBe(true);
      expect(planAllows(plan, 'integrations')).toBe(true);
      expect(planAllows(plan, 'sso')).toBe(false);
      expect(planAllows(plan, 'customDomain')).toBe(false);
      expect(planAllows(plan, 'auditRetention')).toBe(false);
    }
  });

  it('ENTERPRISE unlocks sso/customDomain/auditRetention + unlimited quotas', () => {
    expect(planAllows('ENTERPRISE', 'sso')).toBe(true);
    expect(planAllows('ENTERPRISE', 'customDomain')).toBe(true);
    expect(planAllows('ENTERPRISE', 'auditRetention')).toBe(true);
    expect(planLimits('ENTERPRISE').maxProjects).toBeNull();
    expect(planLimits('ENTERPRISE').maxMembers).toBeNull();
    expect(planLimits('ENTERPRISE').storageMb).toBeNull();
  });

  it('planCapabilities lists exactly the plan feature set', () => {
    expect(new Set(planCapabilities('ENTERPRISE'))).toEqual(PLAN_LIMITS.ENTERPRISE.features);
    expect(planCapabilities('ENTERPRISE')).toContain('sso');
    expect(planCapabilities('TRIAL')).not.toContain('sso');
  });
});
