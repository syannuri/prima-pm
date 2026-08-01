// Client mirror of the server's APP_BASE_DOMAIN subdomain rule (server/src/lib/tenant/host.ts).
// On a workspace subdomain (`<slug>.<base>`, e.g. acme.prismatix.tech) the public root should go
// straight to the branded /login, not the generic marketing homepage. Driven by the build-time
// VITE_APP_BASE_DOMAIN (baked from the server's APP_BASE_DOMAIN — see scripts/build-prod.sh).
// Unset (LAN-by-IP / dev) → always false, so the apex + LAN behaviour is unchanged.
const RESERVED_SUBDOMAINS = new Set(['www', 'app', 'api', 'admin', 'mail', 'static', 'assets']);

export function isWorkspaceSubdomainHost(): boolean {
  const base = (import.meta.env.VITE_APP_BASE_DOMAIN as string | undefined)?.trim().toLowerCase();
  if (!base) return false;
  const host = (typeof window !== 'undefined' ? window.location.hostname : '').toLowerCase();
  if (!host || host === base || !host.endsWith(`.${base}`)) return false;
  const label = host.slice(0, -(base.length + 1));
  if (!label || label.includes('.')) return false; // only a single left-most label (no a.b.base)
  return !RESERVED_SUBDOMAINS.has(label);
}
