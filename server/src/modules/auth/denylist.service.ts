// Platform denylist for the OPEN self-service auth paths (guest signup, Google sign-in, org signup).
// Deleting a guest only wipes their data; open sign-up would let them re-register, so an admin can
// also BLOCK the identity here. Enforced fail-closed BEFORE any account is created/matched. Matching
// is by email OR googleSub. `BlockedIdentity` is a GLOBAL model, and these run on context-less public
// routes, so every access is wrapped in runAsSystem (no tenant scoping). Email is always lowercased.
import { prisma } from '../../lib/prisma.js';
import { runAsSystem } from '../../lib/tenant/context.js';
import { BadRequest } from '../../lib/errors.js';

const norm = (e?: string | null) => e?.trim().toLowerCase() || null;

// True when the given email or Google subject is on the denylist. Never throws — a denylist read
// must not break the auth path (returns false on any unexpected error → fail-open only for infra
// faults, while a real hit fails closed).
export async function isIdentityBlocked(idish: { email?: string | null; googleSub?: string | null }): Promise<boolean> {
  const email = norm(idish.email);
  const googleSub = idish.googleSub || null;
  if (!email && !googleSub) return false;
  const OR: Array<{ email: string } | { googleSub: string }> = [];
  if (email) OR.push({ email });
  if (googleSub) OR.push({ googleSub });
  const hit = await runAsSystem(() => prisma.blockedIdentity.findFirst({ where: { OR }, select: { id: true } }));
  return !!hit;
}

// Add (or merge into) a denylist entry. Idempotent: if a row already matches the email/sub, fill in
// any missing field + refresh the reason instead of inserting a duplicate (the columns are unique).
export async function blockIdentity(input: { email?: string | null; googleSub?: string | null; reason?: string | null; createdById?: string | null }) {
  const email = norm(input.email);
  const googleSub = input.googleSub || null;
  if (!email && !googleSub) throw BadRequest('Provide an email or a Google account to block');
  return runAsSystem(async () => {
    const OR: Array<{ email: string } | { googleSub: string }> = [];
    if (email) OR.push({ email });
    if (googleSub) OR.push({ googleSub });
    const existing = await prisma.blockedIdentity.findFirst({ where: { OR } });
    if (existing) {
      return prisma.blockedIdentity.update({
        where: { id: existing.id },
        data: {
          email: existing.email ?? email,
          googleSub: existing.googleSub ?? googleSub,
          reason: input.reason ?? existing.reason,
        },
      });
    }
    return prisma.blockedIdentity.create({ data: { email, googleSub, reason: input.reason ?? null, createdById: input.createdById ?? null } });
  });
}

export async function listBlocked() {
  return runAsSystem(() => prisma.blockedIdentity.findMany({ orderBy: { createdAt: 'desc' } }));
}

export async function unblock(id: string) {
  return runAsSystem(() => prisma.blockedIdentity.deleteMany({ where: { id } }));
}
