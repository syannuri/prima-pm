import { AsyncLocalStorage } from 'node:async_hooks';

// Request-scoped tenant context (see docs/MULTITENANCY-POOLED-PLAN.md, Phase 3). The auth
// middleware opens a context for the active tenant (`tid` from the token); the Prisma tenant
// extension reads it to scope every query. Anything running OUTSIDE a context (cron, migrations,
// startup) either wraps its work in `runWithTenant` per tenant, or opts out with `runAsSystem`
// for a legitimately cross-tenant/global operation. When there is neither, the extension
// fail-closes (throws) rather than leaking across tenants.
interface TenantStore {
  tenantId?: string;
  // Explicit opt-out: run scoped models WITHOUT tenant filtering (platform/admin, cron fan-out,
  // system maintenance). Must be a conscious choice, never the default.
  bypass?: boolean;
}

const als = new AsyncLocalStorage<TenantStore>();

// Run `fn` with the active tenant bound to `tenantId`. The callback is `await`ed INSIDE the
// AsyncLocalStorage scope on purpose: Prisma promises are lazy (the query — and the extension
// callback — run at await time, not at creation), so we must keep the context open across the
// await or the extension would see no tenant and fail-closed. Callers still await the result.
export function runWithTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return als.run({ tenantId }, async () => await fn());
}

// Run `fn` with tenant scoping DISABLED — for genuinely cross-tenant/global work. Use sparingly.
export function runAsSystem<T>(fn: () => Promise<T>): Promise<T> {
  return als.run({ bypass: true }, async () => await fn());
}

// Bind the tenant for a SYNCHRONOUS entry point (Express middleware): runs `fn` — typically
// `() => next()` — inside the ALS scope and returns its result directly. Downstream async
// handlers started under this call inherit the context. Unlike runWithTenant this does NOT await,
// which is exactly what a middleware chain needs.
export function bindTenantContext<T>(tenantId: string, fn: () => T): T {
  return als.run({ tenantId }, fn);
}

// The current store, or undefined when called with no context established.
export function getTenantStore(): TenantStore | undefined {
  return als.getStore();
}

// Whether tenant enforcement is switched on (live env read so it can be toggled in tests /
// dark-launched per deploy). Mirrors env.multitenancy.enforce at boot.
export function multitenancyEnforced(): boolean {
  return process.env.MULTITENANCY_ENFORCE === 'true';
}
