import type { NextFunction, Request, Response } from 'express';
import { resolveHostWorkspace, type HostTenant } from '../lib/tenant/host.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      // The tenant this request's Host maps to (subdomain / custom domain), or null. Set by
      // attachHostTenant; null unless APP_BASE_DOMAIN is configured and the host matches a tenant.
      hostTenant?: HostTenant | null;
      // True when the Host is a workspace-shaped subdomain (`<label>.<base>`) that matches NO tenant
      // — the SPA renders a "workspace not found" page instead of the generic login.
      hostWorkspaceMissing?: boolean;
    }
  }
}

// Resolve the Host → tenant once per request (before auth), so login can pin the session to this
// workspace and requireAuth can reject a session for a different workspace on this domain. A no-op
// (null) when subdomain routing is off (APP_BASE_DOMAIN unset) — LAN-by-IP / bare base domain.
export async function attachHostTenant(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const { tenant, unknownWorkspace } = await resolveHostWorkspace(req.headers.host);
    req.hostTenant = tenant;
    req.hostWorkspaceMissing = unknownWorkspace;
    next();
  } catch (err) {
    next(err);
  }
}
