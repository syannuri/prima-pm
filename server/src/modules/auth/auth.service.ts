import { randomUUID } from 'node:crypto';
import type { Role, User, TenantPlan } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../lib/jwt.js';
import { Unauthorized, Forbidden, Conflict, EmailNotVerified } from '../../lib/errors.js';
import { emailEnabled, sendMail } from '../../lib/mailer.js';
import { orgSignupAdminAlertMail } from '../../lib/mail/templates.js';
import { initialEmailVerifiedAt, issueActivationEmail } from './verification.service.js';
import { writeAudit } from '../../lib/audit.js';
import { logger } from '../../lib/observability.js';
import { verifyGoogleIdToken } from '../../lib/google.js';
import { isGuestSignupEnabled, isGoogleLoginEnabled, isOrgSignupEnabled } from '../settings/settings.service.js';
import { multitenancyEnforced, runWithTenant, runAsSystem } from '../../lib/tenant/context.js';
import { newTrialExpiry, isTrialExpired, trialDaysLeft } from '../../lib/tenant/trial.js';
import { planCapabilities, type PlanFeature } from '../../lib/tenant/plans.js';
import { seedGuestSampleProjects } from '../guest/guest-seed.service.js';
import { isIdentityBlocked } from './denylist.service.js';
import type { ChangePasswordInput, GuestRegisterInput, LoginInput, OrgSignupInput } from './auth.schemas.js';

// The membership a freshly-minted token should be pinned to: the caller's chosen tenant when it is
// one of their memberships, else their first (deterministic by createdAt). Undefined only if the
// user has no membership (pre-Phase-1 data / enforcement off). Carries the PER-TENANT role, which
// supersedes the global User.role once enforcement is on (Phase 4). Membership is a global model,
// so this read needs no tenant context.
async function resolveActiveMembership(userId: string, preferred?: string): Promise<{ tenantId: string; role: Role } | undefined> {
  const memberships = await prisma.membership.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    select: { tenantId: true, role: true, tenant: { select: { status: true } } },
  });
  // Never pin a session to a SUSPENDED workspace — a suspended tenant is locked out (requireAuth
  // 403s it), so issuing a token for it would half-log-someone-in. Prefer the user's ACTIVE tenants.
  const active = memberships.filter((m) => m.tenant.status === 'ACTIVE');
  if (preferred) {
    const chosen = active.find((m) => m.tenantId === preferred);
    if (chosen) return { tenantId: chosen.tenantId, role: chosen.role };
  }
  const first = active[0];
  return first ? { tenantId: first.tenantId, role: first.role } : undefined;
}

// A member of ONLY suspended workspace(s) — OR of no workspace at all — must be refused login outright
// (not handed a token that merely 401/403s on the next request — the client stays "logged in").
// Enforcement-gated, mirroring the requireAuth suspend check. SECURITY (ghost-admin fix): under
// enforcement every real account has a membership, so ZERO memberships means an orphaned row — e.g. an
// org-signup owner whose only tenant was later rejected/hard-deleted, leaving the User behind with its
// stale global role=ADMIN. Such an account must NOT authenticate on that leftover role. Guests always
// hold an ACTIVE personal membership (so they pass the ACTIVE check); platform admins may operate
// without a tenant membership, so they are exempted.
async function assertNotFullySuspended(user: { id: string; email: string; isPlatformAdmin: boolean }): Promise<void> {
  if (!multitenancyEnforced()) return;
  const memberships = await prisma.membership.findMany({ where: { userId: user.id }, select: { tenant: { select: { status: true } } } });
  if (memberships.some((m) => m.tenant.status === 'ACTIVE')) return;
  if (user.isPlatformAdmin) return;
  // Orphaned account: no workspace at all. Refuse — never fall back to the stale global role. This is
  // also an EARLY-WARNING signal: a live, non-guest account with zero memberships shouldn't exist under
  // enforcement, so a login attempt on one likely means an orphan slipped through (see ghost-admin fix).
  if (memberships.length === 0) {
    logger.warn({ event: 'security.ghost_login_blocked', userId: user.id, email: user.email }, 'blocked login: account attached to no workspace (possible orphaned/ghost account)');
    await alertPlatformAdminsOfGhostLogin(user.email);
    throw Forbidden('Your account is not attached to any workspace. Contact your administrator.');
  }
  // Has membership(s) but none ACTIVE. Tailor the message: a self-serve org owner whose only tenant is
  // still PENDING is awaiting approval (not a punitive suspend); everything else reads as suspended.
  if (memberships.every((m) => m.tenant.status === 'PENDING')) {
    throw Forbidden('Your workspace is awaiting administrator approval.');
  }
  throw Forbidden('Your workspace has been suspended. Contact your administrator.');
}

// Early-warning alert: a login was refused because the account belongs to NO workspace (an orphaned /
// "ghost" account — see the ghost-admin fix). Drops an in-app notification into every platform admin's
// inbox so the leftover account gets reviewed/cleaned up. Best-effort: never let alerting break login.
async function alertPlatformAdminsOfGhostLogin(email: string): Promise<void> {
  try {
    await runAsSystem(async () => {
      const admins = await prisma.user.findMany({ where: { isPlatformAdmin: true, isActive: true }, select: { id: true } });
      for (const admin of admins) {
        const home = await prisma.membership.findFirst({ where: { userId: admin.id }, orderBy: { createdAt: 'asc' }, select: { tenantId: true } });
        if (!home) continue; // an admin with no membership has no scoped inbox to write to
        await prisma.notification.create({
          data: { userId: admin.id, tenantId: home.tenantId, type: 'SECURITY_GHOST_LOGIN', title: 'Blocked login: account with no workspace', body: `A login was refused for “${email}” — the account is attached to no workspace (a possible orphaned/ghost account). Review it in the platform console.` },
        });
      }
    });
  } catch (err) {
    logger.error({ err }, '[security] failed to alert platform admins of ghost-login attempt');
  }
}

// Give a brand-new GUEST their OWN personal tenant — the tenant-native sandbox that replaces the
// legacy `personalOwnerId` isolation (so the Prisma extension isolates one guest from another and
// from the corporate portfolio). `Tenant`/`Membership` are GLOBAL models, so this is safe on the
// context-less public register / Google paths. Idempotent: slug `guest-<userId>` is the stable key,
// matching the backfill migration, so a retry (or a user backfilled then re-registering) is a no-op.
async function provisionPersonalTenant(user: User): Promise<string> {
  const slug = `guest-${user.id}`;
  const tenant = await prisma.tenant.upsert({
    where: { slug },
    create: { slug, name: `${user.name || user.email} (personal)`, isPersonal: true },
    update: {},
    select: { id: true },
  });
  await prisma.membership.upsert({
    where: { userId_tenantId: { userId: user.id, tenantId: tenant.id } },
    create: { userId: user.id, tenantId: tenant.id, role: 'GUEST' },
    update: {},
  });
  return tenant.id;
}

// Write an audit for a PUBLIC auth flow (login/register/google) — these run with NO request tenant
// context, so without help the audit lands null-tenant and is invisible in the (scoped)
// /admin/audit view. Resolve the user's active tenant and stamp the audit inside it. When
// enforcement is off, the extension is a no-op so the row stays null (unchanged single-tenant
// behaviour); when a user somehow has no membership, fall back to the plain (self-healing) write.
async function auditInUserTenant(userId: string, input: Parameters<typeof writeAudit>[0]): Promise<void> {
  const active = await resolveActiveMembership(userId);
  if (active) await runWithTenant(active.tenantId, () => writeAudit(input));
  else await writeAudit(input);
}

interface AuthResult {
  user: { id: string; name: string; email: string; role: Role; isPlatformAdmin: boolean };
  accessToken: string;
  refreshToken: string;
}

// Issue a fresh access token + a NEW tracked refresh token (a RefreshToken row keyed by
// the token's jti). Optionally records that it replaces a rotated-away token, and pins the
// token to an active tenant (`preferredTid`, used by switch-tenant; else the user's default).
async function issueTokenPair(user: User, opts: { replacesJti?: string; preferredTid?: string } = {}): Promise<AuthResult> {
  const jti = randomUUID();
  const { token: refreshToken, expiresAt } = signRefreshToken(user.id, user.tokenVersion, jti);
  await prisma.$transaction(async (tx) => {
    if (opts.replacesJti) {
      await tx.refreshToken.update({
        where: { id: opts.replacesJti },
        data: { revokedAt: new Date(), replacedById: jti },
      });
    }
    await tx.refreshToken.create({ data: { id: jti, userId: user.id, expiresAt } });
  });
  const active = await resolveActiveMembership(user.id, opts.preferredTid);
  // Under enforcement the EFFECTIVE role is the active tenant's membership role (Phase 4); with
  // enforcement off we keep the global User.role so single-tenant behaviour is unchanged.
  const effectiveRole = multitenancyEnforced() && active ? active.role : user.role;
  return {
    user: { id: user.id, name: user.name, email: user.email, role: effectiveRole, isPlatformAdmin: user.isPlatformAdmin },
    accessToken: signAccessToken({ sub: user.id, role: effectiveRole, email: user.email, tv: user.tokenVersion, tid: active?.tenantId }),
    refreshToken,
  };
}

// The active workspace's plan + trial state + feature capabilities — surfaced on /auth/me so the client
// can gate features, show the trial countdown, and render the upgrade wall. Null when there's no active
// tenant (enforcement off / single-tenant). Tenant is a GLOBAL model, so this read needs no context.
export interface ActiveWorkspace {
  plan: TenantPlan;
  trialEndsAt: Date | null;
  trialDaysLeft: number | null;
  trialExpired: boolean;
  capabilities: PlanFeature[];
}
export async function activeWorkspace(tid?: string): Promise<ActiveWorkspace | null> {
  if (!tid) return null;
  const t = await prisma.tenant.findUnique({ where: { id: tid }, select: { plan: true, trialEndsAt: true, isPersonal: true } });
  if (!t) return null;
  return {
    plan: t.plan,
    trialEndsAt: t.trialEndsAt,
    trialDaysLeft: trialDaysLeft(t.trialEndsAt),
    trialExpired: !t.isPersonal && isTrialExpired(t.plan, t.trialEndsAt),
    capabilities: planCapabilities(t.plan),
  };
}

// Delete refresh-token rows whose JWT has already expired. Safe because an expired token is
// rejected on verify anyway, so its row can no longer take part in reuse detection. Rows that
// are REVOKED but not yet expired are KEPT — they're still needed to catch replay of a leaked
// token inside its validity window. Returns the number of rows removed.
export async function pruneExpiredRefreshTokens(): Promise<number> {
  const { count } = await prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return count;
}

// Revoke EVERY session for a user: bump tokenVersion (kills all access + refresh tokens on
// next use) and mark all outstanding refresh-token rows revoked. Used on logout, password
// change/reset, and as the theft response when a rotated refresh token is replayed.
export async function revokeAllSessions(userId: string): Promise<void> {
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } }),
    prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
}

export async function login(input: LoginInput, opts: { hostTenantId?: string } = {}): Promise<AuthResult> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  // Constant-ish failure to avoid user enumeration.
  if (!user || !user.isActive) throw Unauthorized('Invalid credentials');

  const ok = await verifyPassword(input.password, user.passwordHash);
  if (!ok) throw Unauthorized('Invalid credentials');

  // HARD email-verification wall — only armed when SMTP is configured (else every account is born
  // verified, so this never fires). Checked AFTER the password so it can't be used to enumerate
  // accounts. The distinct code lets the SPA offer "resend activation email".
  if (emailEnabled() && !user.emailVerifiedAt) throw EmailNotVerified();

  await assertNotFullySuspended(user);
  // On a tenant's own domain (subdomain / custom domain), pin the session to THAT workspace — and
  // refuse a user who isn't a member of it (they'd otherwise land in a workspace this domain isn't).
  if (opts.hostTenantId) {
    const membership = await prisma.membership.findUnique({
      where: { userId_tenantId: { userId: user.id, tenantId: opts.hostTenantId } },
      select: { tenant: { select: { status: true } } },
    });
    if (!membership) throw Forbidden('You are not a member of this workspace.');
    if (membership.tenant.status === 'SUSPENDED') throw Forbidden('This workspace is suspended.');
  }
  await auditInUserTenant(user.id, { userId: user.id, entity: 'User', entityId: user.id, action: 'LOGIN' });
  return issueTokenPair(user, opts.hostTenantId ? { preferredTid: opts.hostTenantId } : {});
}

// Self-service guest signup. The ONLY open-registration path — hard-codes role GUEST (a guest
// is sandboxed to their own personal projects) and is gated behind GUEST_SIGNUP_ENABLED so a
// deployment must opt in. Auto-logs in on success (returns a token pair like login).
export async function guestRegister(input: GuestRegisterInput): Promise<AuthResult | { verify: true; email: string }> {
  if (!(await isGuestSignupEnabled())) throw Forbidden('Guest signup is not enabled');
  if (await isIdentityBlocked({ email: input.email })) throw Forbidden('This email is blocked from signing up.');
  const existing = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (existing) throw Conflict('That email is already registered');
  const user = await prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      passwordHash: await hashPassword(input.password),
      role: 'GUEST', // dual-written until User.role is dropped (4c-drop)
      isGuest: true,
      emailVerifiedAt: initialEmailVerifiedAt(),
    },
  });
  const personalTid = await provisionPersonalTenant(user);
  await auditInUserTenant(user.id, { userId: user.id, entity: 'User', entityId: user.id, action: 'CREATE', after: { email: user.email, role: 'GUEST', self: true } });
  await seedGuestSampleProjects(user, personalTid); // best-effort demo projects so the sandbox isn't empty
  // Email armed ⇒ HARD wall: don't auto-login, email an activation link and tell the client to wait.
  if (emailEnabled()) {
    await issueActivationEmail(user);
    return { verify: true, email: user.email };
  }
  return issueTokenPair(user);
}

// A URL-safe, unique tenant slug derived from the org name (auto-suffixed on a clash). `Tenant` is a
// global model, so these lookups need no tenant context.
function slugifyOrg(name: string): string {
  const s = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return s.length >= 2 ? s : 'org';
}
async function uniqueTenantSlug(name: string): Promise<string> {
  const base = slugifyOrg(name);
  for (let i = 0; i < 50; i++) {
    const candidate = (i === 0 ? base : `${base}-${i + 1}`).slice(0, 40);
    if (!(await prisma.tenant.findUnique({ where: { slug: candidate }, select: { id: true } }))) return candidate;
  }
  return `${base}-${randomUUID().slice(0, 6)}`.slice(0, 40);
}

// Best-effort: drop an inbox notification for every platform admin that a new corporate workspace is
// awaiting approval (option C). The public signup route has no tenant context and platform admins are
// global, so this runs as SYSTEM and stamps each notification with the admin's OWN home tenant (their
// earliest membership) so it surfaces in that inbox. Never throws — a notification failure must not
// break signup. The client links `ORG_SIGNUP_PENDING` straight to the /admin/tenants approval queue.
async function notifyPlatformAdminsOfSignup(orgName: string): Promise<void> {
  try {
    await runAsSystem(async () => {
      const admins = await prisma.user.findMany({ where: { isPlatformAdmin: true, isActive: true }, select: { id: true, email: true } });
      for (const admin of admins) {
        const home = await prisma.membership.findFirst({ where: { userId: admin.id }, orderBy: { createdAt: 'asc' }, select: { tenantId: true } });
        if (!home) continue; // an admin with no membership has no scoped inbox to write to
        await prisma.notification.create({
          data: { userId: admin.id, tenantId: home.tenantId, type: 'ORG_SIGNUP_PENDING', title: 'New workspace request', body: `“${orgName}” is awaiting your approval.` },
        });
        // Best-effort email nudge on top of the in-app notification (no-op unless SMTP is configured).
        await sendMail({ to: admin.email, ...orgSignupAdminAlertMail({ orgName }) });
      }
    });
  } catch (err) {
    console.error('[notification] failed to alert platform admins of org signup', err);
  }
}

// Self-serve ORGANIZATION signup (option C — manual approval): anyone may REQUEST a new CORPORATE
// tenant and become its owner ADMIN, but the tenant lands in PENDING and the owner is NOT logged in.
// A platform admin approves (→ ACTIVE) or rejects (→ REJECTED) from the console; the owner can only
// sign in once approved. Gated by the deployment-level orgSignupEnabled toggle. Distinct from guest
// signup (a sandboxed personal tenant that auto-logs in).
export async function registerOrg(input: OrgSignupInput, country: string | null = null): Promise<{ pending: true; orgName: string; slug: string }> {
  if (!(await isOrgSignupEnabled())) throw Forbidden('Organization signup is not enabled');
  if (await isIdentityBlocked({ email: input.email })) throw Forbidden('This email is blocked from signing up.');
  const existing = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (existing) throw Conflict('That email is already registered');
  const slug = await uniqueTenantSlug(input.orgName);
  const owner = await prisma.user.create({
    data: {
      name: input.ownerName,
      email: input.email,
      passwordHash: await hashPassword(input.password),
      // SECURITY (ghost-admin fix): do NOT grant a privileged global role before approval. The
      // per-tenant OWNER role lives on the Membership (ADMIN, below); this global User.role is only a
      // fallback used when there's no active membership — precisely the orphaned/rejected case — so it
      // must stay non-privileged. It's promoted to ADMIN on approval (platform.routes /approve).
      role: 'VIEWER', // dual-written until User.role is dropped (4c-drop)
      isGuest: false,
      emailVerifiedAt: initialEmailVerifiedAt(),
      ...(country ? { country } : {}),
    },
  });
  // New corporate orgs start a 60-day TRIAL with the full PRO experience (plan=TRIAL grants the PRO
  // feature set + quotas; trialEndsAt gates it). Once the trial ends they hit the upgrade wall until
  // they buy PRO/ENTERPRISE. Personal (guest) tenants are exempt from plan/trial gating.
  const tenant = await prisma.tenant.create({ data: { name: input.orgName, slug, isPersonal: false, status: 'PENDING', plan: 'TRIAL', trialEndsAt: newTrialExpiry() } });
  await prisma.membership.create({ data: { userId: owner.id, tenantId: tenant.id, role: 'ADMIN' } });
  await auditInUserTenant(owner.id, { userId: owner.id, entity: 'Tenant', entityId: tenant.id, action: 'CREATE', after: { name: input.orgName, slug, self: true, status: 'PENDING' } });
  // Email armed ⇒ have the owner confirm their address (login later needs BOTH a verified email and an
  // ACTIVE — approved — workspace). Best-effort; a mail failure won't block the pending response.
  if (emailEnabled()) await issueActivationEmail(owner);
  // Alert platform admins there's a signup to review (best-effort; won't block the response).
  await notifyPlatformAdminsOfSignup(input.orgName);
  // No token pair: the owner must wait for approval (a PENDING tenant is locked out of login).
  // `slug` lets the client show the workspace address (<slug>.<base>) the org just got.
  return { pending: true, orgName: input.orgName, slug };
}

// "Sign in with Google" — the open, sandboxed jalur: any Google account may sign in, and a
// first-time user is auto-provisioned as a GUEST (same sandbox as guest signup). SECURITY: to
// stop a Google-email collision from hijacking a staff account, Google only ever manages GUEST
// accounts — if the verified email already belongs to a NON-guest (staff) user, we refuse and
// tell them to use their password. Existing accounts match by the stable Google `sub` first,
// then (first link) by email. Gated by GOOGLE_CLIENT_ID.
export async function loginWithGoogle(credential: string): Promise<AuthResult> {
  if (!(await isGoogleLoginEnabled())) throw Forbidden('Google sign-in is not enabled');

  let identity;
  try {
    identity = await verifyGoogleIdToken(credential);
  } catch {
    throw Unauthorized('Invalid Google token');
  }
  if (!identity.emailVerified) throw Unauthorized('Your Google account email is not verified');

  // Platform denylist: refuse a blocked email/Google account BEFORE matching or auto-provisioning, so
  // deleting-then-blocking a guest truly keeps them out (open Google sign-in would otherwise re-create them).
  if (await isIdentityBlocked({ email: identity.email, googleSub: identity.sub })) throw Forbidden('This account has been blocked. Contact the administrator.');

  // 1) Already linked to this Google identity → that account.
  const bySub = await prisma.user.findUnique({ where: { googleSub: identity.sub } });
  if (bySub) {
    if (!bySub.isActive) throw Unauthorized('This account is deactivated');
    await auditInUserTenant(bySub.id, { userId: bySub.id, entity: 'User', entityId: bySub.id, action: 'LOGIN', after: { via: 'google' } });
    return issueTokenPair(bySub);
  }

  // 2) An account with this email exists but isn't linked yet.
  const byEmail = await prisma.user.findUnique({ where: { email: identity.email } });
  if (byEmail) {
    // Google manages only GUEST accounts — never let it authenticate into a staff account.
    if (!byEmail.isGuest) throw Forbidden('This email belongs to a staff account — sign in with your password.');
    if (!byEmail.isActive) throw Unauthorized('This account is deactivated');
    const linked = await prisma.user.update({ where: { id: byEmail.id }, data: { googleSub: identity.sub } });
    await auditInUserTenant(linked.id, { userId: linked.id, entity: 'User', entityId: linked.id, action: 'LOGIN', after: { via: 'google', linked: true } });
    return issueTokenPair(linked);
  }

  // 3) First-time Google user → provision a sandboxed GUEST (no local password).
  const created = await prisma.user.create({
    data: { name: identity.name, email: identity.email, googleSub: identity.sub, passwordHash: null, role: 'GUEST', isGuest: true, emailVerifiedAt: new Date() },
  });
  const personalTid = await provisionPersonalTenant(created);
  await auditInUserTenant(created.id, { userId: created.id, entity: 'User', entityId: created.id, action: 'CREATE', after: { email: created.email, role: 'GUEST', via: 'google', self: true } });
  await seedGuestSampleProjects(created, personalTid); // best-effort demo projects so the sandbox isn't empty
  return issueTokenPair(created);
}

// Rotating refresh: verify the presented token, then swap it for a brand-new pair. The old
// token is revoked, so a client must always use the newest one. Replaying an already-revoked
// token means it leaked (a legit client never reuses a rotated token) → revoke the whole
// session family. Tokens minted before rotation shipped have no jti — those are accepted once
// and upgraded to a tracked, rotating token (no forced logout on deploy).
export async function refresh(refreshToken: string): Promise<AuthResult> {
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw Unauthorized('Invalid or expired refresh token');
  }
  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || !user.isActive) throw Unauthorized('User no longer active');
  // Reject refresh tokens minted before the user's sessions were revoked.
  if ((payload.tv ?? 0) !== user.tokenVersion) throw Unauthorized('Session has been revoked');
  // If their workspace was suspended mid-session, end it here rather than minting a tenant-less
  // token that would 401-loop against requireAuth's fail-closed enforcement.
  await assertNotFullySuspended(user);

  if (payload.jti) {
    const stored = await prisma.refreshToken.findUnique({ where: { id: payload.jti } });
    if (!stored || stored.userId !== user.id || stored.expiresAt.getTime() < Date.now()) {
      throw Unauthorized('Invalid or expired refresh token');
    }
    if (stored.revokedAt) {
      // Reuse of a rotated/revoked token → treat as theft and kill every session.
      await revokeAllSessions(user.id);
      throw Unauthorized('Session has been revoked');
    }
    return issueTokenPair(user, { replacesJti: payload.jti });
  }

  // Legacy (pre-rotation) token: nothing to rotate away, just mint a tracked pair.
  return issueTokenPair(user);
}

// Changing the password revokes every other outstanding session (tokenVersion bump + refresh
// rows revoked) and returns a fresh token pair so the CALLER's current session continues.
export async function changePassword(userId: string, input: ChangePasswordInput): Promise<AuthResult> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw Unauthorized();

  const ok = await verifyPassword(input.currentPassword, user.passwordHash);
  if (!ok) throw Unauthorized('Current password is incorrect');

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(input.newPassword), tokenVersion: { increment: 1 } },
  });
  // Revoke all previously-issued refresh tokens (other sessions), then mint a fresh one below.
  await prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  await writeAudit({ userId, entity: 'User', entityId: userId, action: 'PASSWORD_CHANGE' });
  return issueTokenPair(updated);
}

// Log out everywhere: bump tokenVersion and revoke every outstanding refresh token so all
// currently-issued tokens for this user stop working on the next request.
export async function logoutAll(userId: string): Promise<void> {
  await revokeAllSessions(userId);
  await writeAudit({ userId, entity: 'User', entityId: userId, action: 'LOGOUT' });
}

// The tenants this user belongs to (for a tenant switcher). Tenant/Membership are global models.
export async function listMyTenants(userId: string) {
  const memberships = await prisma.membership.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    select: { role: true, tenant: { select: { id: true, name: true, slug: true, status: true, plan: true, subscriptionStatus: true } } },
  });
  return memberships
    .filter((m) => m.tenant.status === 'ACTIVE')
    .map((m) => ({ id: m.tenant.id, name: m.tenant.name, slug: m.tenant.slug, role: m.role, plan: m.tenant.plan, subscriptionStatus: m.tenant.subscriptionStatus }));
}

// Re-mint the token pair pinned to a DIFFERENT tenant the user is a member of. Rejects a tenant
// the user has no membership in (so a token can never be forged onto another org).
export async function switchTenant(userId: string, tenantId: string): Promise<AuthResult> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.isActive) throw Unauthorized();
  const membership = await prisma.membership.findUnique({
    where: { userId_tenantId: { userId, tenantId } },
    select: { id: true, tenant: { select: { status: true } } },
  });
  if (!membership) throw Forbidden('You are not a member of that tenant');
  if (membership.tenant.status === 'SUSPENDED') throw Forbidden('That workspace is suspended.');
  await writeAudit({ userId, entity: 'User', entityId: userId, action: 'LOGIN', after: { switchedTenant: tenantId } });
  return issueTokenPair(user, { preferredTid: tenantId });
}

export async function me(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true, isActive: true, isPlatformAdmin: true, isGuest: true, digestFrequency: true, dashboardLayout: true, dashboardDefaultView: true, notificationPrefs: true, createdAt: true },
  });
  if (!user) throw Unauthorized();
  return user;
}

interface NotificationPrefs { email?: { approvals?: boolean } }

// Self-service account preferences (the caller updates only their own row): emailed alert-digest
// cadence + desktop dashboard layout/default-view + per-category channel prefs. All fields optional
// (partial update); returns the saved values so the client can reflect them immediately.
export async function updatePreferences(userId: string, input: {
  digestFrequency?: 'OFF' | 'DAILY' | 'WEEKLY';
  dashboardLayout?: string[];
  dashboardDefaultView?: 'portfolio' | 'forecast' | 'resources' | 'cards';
  notificationPrefs?: NotificationPrefs;
}) {
  // Deep-merge notificationPrefs so a partial patch (e.g. just email.approvals) doesn't wipe siblings.
  let mergedPrefs: NotificationPrefs | undefined;
  if (input.notificationPrefs !== undefined) {
    const existing = await prisma.user.findUnique({ where: { id: userId }, select: { notificationPrefs: true } });
    const cur = (existing?.notificationPrefs ?? {}) as NotificationPrefs;
    mergedPrefs = { ...cur, ...input.notificationPrefs, email: { ...cur.email, ...input.notificationPrefs.email } };
  }
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(input.digestFrequency !== undefined ? { digestFrequency: input.digestFrequency } : {}),
      ...(input.dashboardLayout !== undefined ? { dashboardLayout: input.dashboardLayout } : {}),
      ...(input.dashboardDefaultView !== undefined ? { dashboardDefaultView: input.dashboardDefaultView } : {}),
      ...(mergedPrefs !== undefined ? { notificationPrefs: mergedPrefs as object } : {}),
    },
    select: { digestFrequency: true, dashboardLayout: true, dashboardDefaultView: true, notificationPrefs: true },
  });
  return user;
}
