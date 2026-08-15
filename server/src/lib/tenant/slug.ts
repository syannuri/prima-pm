import { prisma } from '../prisma.js';
import { RESERVED_SUBDOMAINS } from './host.js';
import { BadRequest, Conflict } from '../errors.js';

// A tenant slug IS its <slug>.<base-domain> subdomain label. Same rules as a DNS label: 2–40 chars,
// lowercase letters/digits/single-hyphens, not reserved, unique across tenants. Shared by org signup,
// the tenant self-service /workspace route, and the platform console.
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export function isValidSlugShape(slug: string): boolean {
  return slug.length >= 2 && slug.length <= 40 && SLUG_RE.test(slug);
}

// Normalize + fully validate a proposed slug (format, reserved, uniqueness). Throws on any problem;
// returns the normalized slug. `excludeTenantId` lets a tenant keep its own current slug on edit.
export async function assertValidSlug(raw: string, excludeTenantId?: string): Promise<string> {
  const slug = raw.trim().toLowerCase();
  if (!isValidSlugShape(slug)) throw BadRequest('Subdomain must be 2–40 characters: lowercase letters, digits and single hyphens.');
  if (RESERVED_SUBDOMAINS.has(slug)) throw BadRequest(`“${slug}” is reserved — pick another.`);
  const clash = await prisma.tenant.findUnique({ where: { slug }, select: { id: true } });
  if (clash && clash.id !== excludeTenantId) throw Conflict('That subdomain is already taken.');
  return slug;
}
