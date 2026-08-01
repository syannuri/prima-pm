import { prisma } from '../prisma.js';
import { runAsSystem } from './context.js';

// Subdomain / custom-domain routing (Phase 6). A request's Host maps to a tenant two ways:
//   1. custom domain  — Host exactly equals Tenant.customDomain (e.g. pm.acmecorp.com)
//   2. subdomain      — Host is <slug>.<APP_BASE_DOMAIN> (e.g. acme.prismatix.tech)
// Resolution is OFF unless APP_BASE_DOMAIN is set (so LAN-by-IP and the bare base domain are
// unaffected). The bare base domain, www/app/api/admin/mail, IPs and localhost resolve to NO tenant.
const RESERVED_SUBDOMAINS = new Set(['www', 'app', 'api', 'admin', 'mail', 'static', 'assets']);

export function appBaseDomain(): string | null {
  const d = (process.env.APP_BASE_DOMAIN || '').trim().toLowerCase();
  return d || null;
}

// Normalise a Host header to a bare hostname (strip port, lowercase). Returns '' for junk.
export function normalizeHost(host: string | undefined): string {
  if (!host) return '';
  return host.split(',')[0].trim().toLowerCase().replace(/:\d+$/, '');
}

// The subdomain label if `host` is exactly one level under the base domain, else null.
export function subdomainOf(host: string, base: string): string | null {
  if (host === base || !host.endsWith(`.${base}`)) return null;
  const label = host.slice(0, -(base.length + 1));
  if (!label || label.includes('.')) return null; // only a single left-most label (no a.b.base)
  return label;
}

export interface HostTenant {
  id: string;
  slug: string;
  name: string;
  status: 'ACTIVE' | 'SUSPENDED';
}

// Resolve the tenant a Host maps to (or null). Tenant is a GLOBAL model, so read as system (this runs
// before auth / any tenant context).
export async function resolveTenantFromHost(rawHost: string | undefined): Promise<HostTenant | null> {
  const base = appBaseDomain();
  if (!base) return null;
  const host = normalizeHost(rawHost);
  if (!host || host === base) return null;

  return runAsSystem(async () => {
    // 1) Exact custom-domain match.
    const byCustom = await prisma.tenant.findUnique({
      where: { customDomain: host },
      select: { id: true, slug: true, name: true, status: true },
    });
    if (byCustom) return byCustom as HostTenant;

    // 2) <slug>.<base> subdomain.
    const label = subdomainOf(host, base);
    if (!label || RESERVED_SUBDOMAINS.has(label)) return null;
    const bySlug = await prisma.tenant.findUnique({
      where: { slug: label },
      select: { id: true, slug: true, name: true, status: true },
    });
    return (bySlug as HostTenant) ?? null;
  });
}

export interface HostWorkspace {
  tenant: HostTenant | null;
  // The Host LOOKS like a workspace URL (a non-reserved `<label>.<base>` subdomain) but no tenant
  // owns that slug — so the SPA shows a "workspace not found" page instead of the generic login. The
  // bare base domain, reserved subs, IPs and localhost are NOT "unknown workspaces" (they're the
  // normal generic front door), so this stays false for them.
  unknownWorkspace: boolean;
}

// Classify a Host: the tenant it maps to (if any) plus whether it's an unknown-workspace subdomain.
export async function resolveHostWorkspace(rawHost: string | undefined): Promise<HostWorkspace> {
  const base = appBaseDomain();
  if (!base) return { tenant: null, unknownWorkspace: false };

  const tenant = await resolveTenantFromHost(rawHost);
  if (tenant) return { tenant, unknownWorkspace: false };

  const label = subdomainOf(normalizeHost(rawHost), base);
  const unknownWorkspace = !!label && !RESERVED_SUBDOMAINS.has(label);
  return { tenant: null, unknownWorkspace };
}
