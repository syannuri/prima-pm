// Is the browser on a tenant workspace front (a <slug>.<base> subdomain OR a customer custom domain)
// rather than the public marketing site? On a workspace host the logged-out root goes straight to the
// branded /login instead of the HomePage. Driven by the build-time VITE_APP_BASE_DOMAIN (baked from
// the server's APP_BASE_DOMAIN — see scripts/build-prod.sh); unset (LAN-by-IP / dev) → always false.
//
// The proxy (Caddy) only serves this app for the base domain, its subdomains, and custom domains a
// tenant actually owns — so ANY host that isn't the bare base / www / an IP is, by construction, a
// workspace. That covers custom domains without the client needing to know each one.
const RESERVED_SUBDOMAINS = new Set(['www', 'app', 'api', 'admin', 'mail', 'static', 'assets']);

export function isWorkspaceHost(): boolean {
  const base = (import.meta.env.VITE_APP_BASE_DOMAIN as string | undefined)?.trim().toLowerCase();
  if (!base) return false; // routing off (LAN/dev) → everything is the generic front door
  const host = (typeof window !== 'undefined' ? window.location.hostname : '').toLowerCase();
  if (!host) return false;
  // localhost, an IPv4/IPv6 literal → generic front door.
  if (host === 'localhost' || host.includes(':') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  // The bare base domain and its reserved subdomains are the public marketing front door.
  if (host === base) return false;
  if (host.endsWith(`.${base}`)) {
    const label = host.slice(0, -(base.length + 1));
    if (label && !label.includes('.') && RESERVED_SUBDOMAINS.has(label)) return false;
  }
  // Everything else that reached the SPA is a tenant workspace (subdomain or owned custom domain).
  return true;
}
