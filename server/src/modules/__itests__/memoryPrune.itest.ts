import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../../lib/prisma.js';
import { runWithTenant, runAsSystem } from '../../lib/tenant/context.js';
import { backfillDefaultTenant } from '../../lib/tenant/backfill.js';
import { wipeDb } from '../../test/tenancy.harness.js';
import { pruneStaleMemories } from '../assistant/memory.service.js';

// Anett memory prune sweep (#5): deactivate stale, never-used, non-pinned, non-EXPLICIT memories
// older than the TTL. Dormant unless AI_MEMORY_TTL_DAYS > 0; never touches curated (pinned/explicit)
// or actually-used memories.
const OLD = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000); // 100 days ago
const RECENT = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000); // yesterday

let prevFlag: string | undefined;
let prevTtl: string | undefined;
let tid = '';
const ids: Record<string, string> = {};

beforeAll(async () => {
  prevFlag = process.env.MULTITENANCY_ENFORCE; process.env.MULTITENANCY_ENFORCE = 'true';
  prevTtl = process.env.AI_MEMORY_TTL_DAYS;
  await wipeDb();
  await backfillDefaultTenant(prisma);
  const t = await prisma.tenant.create({ data: { slug: 'memp', name: 'Mem Prune' } });
  tid = t.id;
  const u = await prisma.user.create({ data: { name: 'u', email: 'u@memp.test', role: 'ADMIN', passwordHash: 'x', isActive: true } });
  await prisma.membership.create({ data: { userId: u.id, tenantId: tid, role: 'ADMIN' } });

  const mk = (data: Record<string, unknown>) => prisma.aiMemory.create({ data: { scope: 'USER', userId: u.id, kind: 'FACT', content: 'x', ...data } });
  await runWithTenant(tid, async () => {
    ids.stale = (await mk({ source: 'AUTO', pinned: false, useCount: 0, lastUsedAt: null, createdAt: OLD })).id;   // → pruned
    ids.pinned = (await mk({ source: 'AUTO', pinned: true, useCount: 0, lastUsedAt: null, createdAt: OLD })).id;   // kept (pinned)
    ids.explicit = (await mk({ source: 'EXPLICIT', pinned: false, useCount: 0, lastUsedAt: null, createdAt: OLD })).id; // kept (curated)
    ids.used = (await mk({ source: 'AUTO', pinned: false, useCount: 3, lastUsedAt: RECENT, createdAt: OLD })).id;  // kept (used)
    ids.recent = (await mk({ source: 'AUTO', pinned: false, useCount: 0, lastUsedAt: null, createdAt: RECENT })).id; // kept (fresh)
  });
});

afterAll(async () => {
  if (prevFlag === undefined) delete process.env.MULTITENANCY_ENFORCE; else process.env.MULTITENANCY_ENFORCE = prevFlag;
  if (prevTtl === undefined) delete process.env.AI_MEMORY_TTL_DAYS; else process.env.AI_MEMORY_TTL_DAYS = prevTtl;
});

const active = (id: string) => runAsSystem(() => prisma.aiMemory.findUnique({ where: { id }, select: { active: true } }).then((m) => m?.active));

describe('pruneStaleMemories (#5)', () => {
  it('is dormant when AI_MEMORY_TTL_DAYS is unset/0', async () => {
    delete process.env.AI_MEMORY_TTL_DAYS;
    const r = await runAsSystem(() => pruneStaleMemories());
    expect(r.deactivated).toBe(0);
  });

  it('deactivates only the stale, never-used, non-pinned, non-EXPLICIT, old memory', async () => {
    process.env.AI_MEMORY_TTL_DAYS = '30';
    const r = await runAsSystem(() => pruneStaleMemories());
    expect(r.deactivated).toBe(1);
    expect(await active(ids.stale)).toBe(false);
    expect(await active(ids.pinned)).toBe(true);
    expect(await active(ids.explicit)).toBe(true);
    expect(await active(ids.used)).toBe(true);
    expect(await active(ids.recent)).toBe(true);
  });
});
