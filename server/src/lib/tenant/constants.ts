// Pooled-multitenancy foundations — Phase 0 (see docs/MULTITENANCY-POOLED-PLAN.md).
//
// The DEFAULT tenant is the single organization that will own EVERY row of data that
// exists today, the moment the `Tenant` model lands (Phase 1). The Phase-1 seed migration
// creates exactly one `Tenant` with this slug and a `Membership` per existing user; the
// Phase-2 backfill stamps this tenant's id onto every tenant-owned row. Nothing else may
// assume a hard-coded tenant id — code reads the active tenant from request context
// (Phase 3). These constants exist ONLY so the one-off backfill has a stable anchor.
//
// `slug` is the immutable machine key (used for the future subdomain/host mapping and the
// idempotent backfill lookup); `name` is the human label and may be renamed later.
export const DEFAULT_TENANT_SLUG = 'default';
export const DEFAULT_TENANT_NAME = 'PRIMA';
