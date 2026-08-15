import { describe, it, expect } from 'vitest';
import { describeActivity } from './activityDescribe';
import type { PlatformActivity } from '../api/types';

const ev = (over: Partial<PlatformActivity>): PlatformActivity => ({
  id: 'x', createdAt: '2026-01-01', action: 'UPDATE', entity: 'Tenant',
  actorName: 'Sy', targetName: 'Acme', before: null, after: null, ...over,
});

describe('describeActivity', () => {
  it('tenant lifecycle', () => {
    expect(describeActivity(ev({ action: 'CREATE' }))).toEqual({ text: 'created “Acme”', tone: 'good' });
    expect(describeActivity(ev({ action: 'DELETE' })).tone).toBe('bad');
    expect(describeActivity(ev({ action: 'IMPERSONATE' })).text).toBe('entered “Acme”');
  });
  it('approve / reject via after flags', () => {
    expect(describeActivity(ev({ after: { approved: true } }))).toEqual({ text: 'approved “Acme”', tone: 'good' });
    expect(describeActivity(ev({ after: { rejected: true } }))).toEqual({ text: 'rejected “Acme”', tone: 'bad' });
  });
  it('status + plan changes', () => {
    expect(describeActivity(ev({ before: { status: 'ACTIVE' }, after: { status: 'SUSPENDED' } }))).toEqual({ text: 'suspended “Acme”', tone: 'bad' });
    expect(describeActivity(ev({ before: { status: 'SUSPENDED' }, after: { status: 'ACTIVE' } })).tone).toBe('good');
    expect(describeActivity(ev({ before: { plan: 'FREE' }, after: { plan: 'PRO' } })).text).toContain('FREE→PRO');
  });
  it('guest + denylist', () => {
    expect(describeActivity(ev({ entity: 'User', targetName: 'g@x.com', after: { isActive: false } })).tone).toBe('bad');
    expect(describeActivity(ev({ entity: 'BlockedIdentity', action: 'CREATE', targetName: 'g@x.com' }))).toEqual({ text: 'blocked “g@x.com”', tone: 'bad' });
  });
});
