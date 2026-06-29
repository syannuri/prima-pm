import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Prisma client so these tests exercise the authz logic with no DB.
vi.mock('../../lib/prisma.js', () => ({
  prisma: { project: { findUnique: vi.fn() } },
}));

import { prisma } from '../../lib/prisma.js';
import { requireRole, requireProjectAccess } from '../rbac.js';

const findUnique = prisma.project.findUnique as unknown as ReturnType<typeof vi.fn>;

// Minimal Express req/res/next doubles.
const mkReq = (over: any = {}) => ({ params: {}, ...over });
const res: any = {};

beforeEach(() => {
  findUnique.mockReset();
});

describe('requireRole', () => {
  it('throws 401 when unauthenticated', () => {
    const next = vi.fn();
    expect(() => requireRole('ADMIN')(mkReq() as any, res, next)).toThrow();
    expect(next).not.toHaveBeenCalled();
  });

  it('throws 403 when the role is not allowed', () => {
    const next = vi.fn();
    expect(() =>
      requireRole('ADMIN', 'PMO')(mkReq({ user: { id: 'u1', role: 'VIEWER' } }) as any, res, next),
    ).toThrow();
  });

  it('calls next() when the role is allowed', () => {
    const next = vi.fn();
    requireRole('ADMIN', 'PMO')(mkReq({ user: { id: 'u1', role: 'PMO' } }) as any, res, next);
    expect(next).toHaveBeenCalledWith();
  });
});

describe('requireProjectAccess', () => {
  // It is async and deliberately forwards every error via next(err) (NEVER throws),
  // because Express v4 doesn't catch rejected-promise middleware.
  const run = async (reqOver: any, opts = {}) => {
    const next = vi.fn();
    await requireProjectAccess(opts)(mkReq(reqOver) as any, res, next);
    return next;
  };
  const errOf = (next: ReturnType<typeof vi.fn>) => next.mock.calls[0][0];

  it('401 when unauthenticated', async () => {
    const next = await run({ params: { id: 'p1' } });
    expect(errOf(next)?.statusCode).toBe(401);
  });

  it('404 when the project id is missing from the route', async () => {
    const next = await run({ user: { id: 'u1', role: 'ADMIN' }, params: {} });
    expect(errOf(next)?.statusCode).toBe(404);
  });

  it('404 when the project does not exist', async () => {
    findUnique.mockResolvedValue(null);
    const next = await run({ user: { id: 'u1', role: 'ADMIN' }, params: { id: 'p1' } });
    expect(errOf(next)?.statusCode).toBe(404);
  });

  it('404 when the project is soft-deleted (S1 regression)', async () => {
    findUnique.mockResolvedValue({ id: 'p1', pmUserId: 'pm', status: 'IN_PROGRESS', deletedAt: new Date() });
    const next = await run({ user: { id: 'u1', role: 'ADMIN' }, params: { id: 'p1' } });
    expect(errOf(next)?.statusCode).toBe(404);
  });

  it('forwards the DB error via next(err) instead of crashing (Q-B async-reject regression)', async () => {
    const boom = new Error('db down');
    findUnique.mockRejectedValue(boom);
    // Must resolve (not reject) — the internal try/catch keeps it off the unhandled-rejection path.
    const next = vi.fn();
    await expect(
      requireProjectAccess()(mkReq({ user: { id: 'u1', role: 'ADMIN' }, params: { id: 'p1' } }) as any, res, next),
    ).resolves.toBeUndefined();
    expect(next).toHaveBeenCalledWith(boom);
  });

  it('global roles (ADMIN/PMO) pass even when not the owner', async () => {
    findUnique.mockResolvedValue({ id: 'p1', pmUserId: 'someoneElse', status: 'IN_PROGRESS', deletedAt: null });
    const next = await run({ user: { id: 'u1', role: 'PMO' }, params: { id: 'p1' } });
    expect(next).toHaveBeenCalledWith();
  });

  it('owner passes', async () => {
    findUnique.mockResolvedValue({ id: 'p1', pmUserId: 'u1', status: 'IN_PROGRESS', deletedAt: null });
    const next = await run({ user: { id: 'u1', role: 'PROJECT_MANAGER' }, params: { id: 'p1' } });
    expect(next).toHaveBeenCalledWith();
  });

  it('non-owner non-global is forbidden (403)', async () => {
    findUnique.mockResolvedValue({ id: 'p1', pmUserId: 'other', status: 'IN_PROGRESS', deletedAt: null });
    const next = await run({ user: { id: 'u1', role: 'PROJECT_MANAGER' }, params: { id: 'p1' } });
    expect(errOf(next)?.statusCode).toBe(403);
  });

  it('a functional role in allowRoles bypasses ownership', async () => {
    findUnique.mockResolvedValue({ id: 'p1', pmUserId: 'other', status: 'IN_PROGRESS', deletedAt: null });
    const next = await run(
      { user: { id: 'u1', role: 'FINANCE' }, params: { id: 'p1' } },
      { allowRoles: ['FINANCE'] },
    );
    expect(next).toHaveBeenCalledWith();
  });

  it('VIEWER cannot write even on an accessible project (403)', async () => {
    findUnique.mockResolvedValue({ id: 'p1', pmUserId: 'u1', status: 'IN_PROGRESS', deletedAt: null });
    const next = await run(
      { user: { id: 'u1', role: 'VIEWER' }, params: { id: 'p1' } },
      { write: true, allowRoles: ['VIEWER'] },
    );
    expect(errOf(next)?.statusCode).toBe(403);
  });
});
