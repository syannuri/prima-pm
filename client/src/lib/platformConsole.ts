// The platform (super-admin) console lives on these routes. When a platform admin is on one of
// them, the app chrome swaps to the distinct indigo/violet "Control Plane" skin — so elevated,
// cross-tenant work never looks like ordinary tenant work. A platform admin doing normal tenant
// work (any other route) still sees the normal app: the identity switches by CONTEXT, not account.
export const PLATFORM_ROUTES = ['/admin/tenants', '/admin/guests', '/admin/settings'] as const;

export function isPlatformRoute(pathname: string): boolean {
  return PLATFORM_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`));
}
