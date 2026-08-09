import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env, isProd } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { cookieParser } from './lib/cookies.js';
import { csrfGuard } from './middleware/csrf.js';
import { asyncHandler } from './middleware/validate.js';
import { attachHostTenant } from './middleware/hostTenant.js';
import { prisma } from './lib/prisma.js';
import { runAsSystem } from './lib/tenant/context.js';
import { normalizeHost } from './lib/tenant/host.js';
import { captchaEnabled } from './lib/turnstile.js';
import authRoutes from './modules/auth/auth.routes.js';
import usersRoutes from './modules/users/users.routes.js';
import projectsRoutes from './modules/projects/projects.routes.js';
import rateCardRoutes from './modules/ratecard/ratecard.routes.js';
import portfolioRoutes from './modules/portfolio/portfolio.routes.js';
import notificationRoutes from './modules/notification/notification.routes.js';
import resourceRoutes from './modules/resource/resource.routes.js';
import myTimesheetRoutes from './modules/timesheet/timesheet.me.routes.js';
import bookmarkRoutes from './modules/bookmark/bookmark.routes.js';
import adminAuditRoutes from './modules/audit/adminAudit.routes.js';
import adminSettingsRoutes from './modules/settings/settings.routes.js';
import messagesRoutes from './modules/messages/messages.routes.js';
import membersRoutes from './modules/members/members.routes.js';
import apiKeyRoutes from './modules/apikey/apikey.routes.js';
import webhookRoutes from './modules/webhook/webhook.routes.js';
import platformRoutes from './modules/platform/platform.routes.js';
import billingRoutes from './modules/billing/billing.routes.js';
import { lemonsqueezyWebhook } from './modules/billing/lemonsqueezy.webhook.js';

// Locate the built frontend (server/dist/app.js → ../../client/dist). Overridable
// via CLIENT_DIST_PATH for non-standard layouts.
const here = path.dirname(fileURLToPath(import.meta.url));
const clientDist = process.env.CLIENT_DIST_PATH
  ? path.resolve(process.env.CLIENT_DIST_PATH)
  : path.resolve(here, '../../client/dist');

export function createApp() {
  const app = express();

  // Behind a reverse proxy (nginx) we must trust its X-Forwarded-* headers so req.ip is
  // the real client — the auth rate limiter keys on it. Only enable when TRUST_PROXY is
  // set: trusting a spoofable header on a direct bind would defeat the limiter.
  if (env.trustProxy !== undefined) {
    const hops = Number(env.trustProxy);
    app.set('trust proxy', Number.isNaN(hops) ? env.trustProxy : hops);
  }

  // Serve the SPA same-origin in production, so the client's relative /api/v1 calls
  // need no proxy/CORS. CSP allows inline styles (the interactive Gantt positions
  // bars via style attributes) and data: images.
  const serveClient = isProd && fs.existsSync(path.join(clientDist, 'index.html'));

  // Third-party iframe origins for the CSP frame-src (GIS button/one-tap + Turnstile challenge),
  // each included only when that feature is enabled. Omitted entirely when empty so frame-src falls
  // back to default-src 'self'.
  const cspFrameSrc: string[] = [
    ...(env.googleClientId ? ['https://accounts.google.com/gsi/'] : []),
    ...(captchaEnabled() ? ['https://challenges.cloudflare.com'] : []),
  ];

  app.use(
    helmet(
      serveClient
        ? {
            contentSecurityPolicy: {
              // useDefaults:false so we control every directive explicitly.
              useDefaults: false,
              directives: {
                defaultSrc: ["'self'"],
                // Hashes whitelist the two inline scripts in the built index.html WITHOUT opening
                // 'unsafe-inline': (1) the pre-paint theme script (anti-FOUC), (2) the prerender's
                // #root-clear snippet (wipes the prerendered landing on non-landing routes). Both
                // are fixed strings so their hashes are stable. If either <script> body changes,
                // regenerate the hash (the browser console reports the expected sha256 when blocked).
                scriptSrc: ["'self'",
                  "'sha256-gJ9Qv9VU/346gdpDRI3qPE9+6RkSI+W4FxyEcgZFlyY='", // pre-paint theme script
                  "'sha256-hlEddLEYaHG6RXY0nLDhaOX/rz/CKjL/h5Z3HrkkRd0='", // prerender #root-clear script
                  // Cloudflare Web Analytics beacon (auto-injected when the site is CF-proxied).
                  'https://static.cloudflareinsights.com',
                  // Google Identity Services (the "Sign in with Google" button) — only when enabled.
                  ...(env.googleClientId ? ['https://accounts.google.com/gsi/client'] : []),
                  // Cloudflare Turnstile CAPTCHA widget script — only when enabled.
                  ...(captchaEnabled() ? ['https://challenges.cloudflare.com'] : [])],
                styleSrc: ["'self'", "'unsafe-inline'",
                  ...(env.googleClientId ? ['https://accounts.google.com/gsi/style'] : [])],
                imgSrc: ["'self'", 'data:'],
                connectSrc: ["'self'",
                  'https://cloudflareinsights.com', // Web Analytics beacon POST target
                  ...(env.googleClientId ? ['https://accounts.google.com/gsi/'] : [])],
                // Third-party iframes: GIS button/one-tap, and Turnstile's challenge — each only when enabled.
                ...(cspFrameSrc.length ? { frameSrc: cspFrameSrc } : {}),
                objectSrc: ["'none'"],
                baseUri: ["'self'"],
                // Clickjacking (CWE-1021): only same-origin pages may frame the app. This is the
                // modern CSP control browsers prioritise over the legacy X-Frame-Options: SAMEORIGIN
                // (which helmet still sets as a fallback for older UAs). 'self' matches that policy.
                frameAncestors: ["'self'"],
                // Restrict where forms may submit — the SPA only posts to its own /api/v1 origin.
                formAction: ["'self'"],
                // Force sub-resources to HTTPS only when we're actually on HTTPS —
                // on a plain-http LAN this directive would blank the page.
                ...(env.secure ? { upgradeInsecureRequests: [] } : {}),
              },
            },
            // HSTS + secure-origin-only headers are advertised only when SECURE=true
            // (served over HTTPS behind a TLS proxy). On plain-http LAN they'd just log
            // ignored-over-HTTP warnings.
            strictTransportSecurity: env.secure
              ? { maxAge: 31536000, includeSubDomains: true, preload: true }
              : false,
            // 'same-origin-allow-popups' (not helmet's default 'same-origin') so the Google
            // Sign-In popup keeps its window.opener link and can postMessage the credential back —
            // COOP 'same-origin' severs that and breaks GIS ("Cannot read properties of null
            // (reading 'postMessage')" → blank after 2FA). Still isolates from cross-origin openers.
            crossOriginOpenerPolicy: env.secure ? { policy: 'same-origin-allow-popups' } : false,
            originAgentCluster: env.secure ? undefined : false,
          }
        : undefined,
    ),
  );
  // Permissions-Policy: deny powerful browser features the app never uses (helmet doesn't set
  // this one). Belt-and-suspenders alongside the CSP.
  app.use((_req, res, next) => {
    res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=(), payment=(), usb=()');
    next();
  });
  // Defence-in-depth: never serve dot-paths (/.git, /.env, …). The SPA fallback would otherwise
  // return index.html (200) for them — harmless (no real file is exposed) but noisy to scanners.
  // Return a clean 404 instead. ACME's /.well-known is served by nginx, never reaches the app.
  app.use((req, res, next) => {
    if (/\/\./.test(req.path)) return res.status(404).type('txt').send('Not found');
    next();
  });
  app.use(cors({ origin: env.corsOrigin, credentials: true }));
  // Lemon Squeezy webhook — mounted BEFORE express.json() so the handler gets the raw body to
  // verify the HMAC signature, and outside /api/v1 so no CSRF/cookie guard blocks this
  // server-to-server call. It authenticates itself via the X-Signature header.
  app.post('/webhooks/lemonsqueezy', express.raw({ type: '*/*' }), asyncHandler(lemonsqueezyWebhook));
  app.use(express.json({ limit: '1mb' }));
  // Populate req.cookies so cookie-based auth (prima_at) and the CSRF double-submit check
  // can read them.
  app.use(cookieParser);

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'prima-pm', ts: new Date().toISOString() });
  });

  // Caddy on-demand TLS gate (custom-domain automation). Caddy calls this BEFORE it asks Let's
  // Encrypt for a cert for an incoming hostname — 200 = a tenant owns this custom domain (issue it),
  // anything else = deny (stops a stranger pointing a domain at us and exhausting the LE rate limit).
  // Loopback-only: Caddy probes 127.0.0.1:4000 directly (no X-Forwarded-For → req.ip is loopback),
  // whereas real visitors arrive proxied with a forwarded client IP and are refused here.
  app.get('/_internal/tls-check', asyncHandler(async (req, res) => {
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.ip ?? '')) return res.sendStatus(403);
    const domain = normalizeHost(String(req.query.domain ?? ''));
    if (!domain) return res.sendStatus(400);
    const owner = await runAsSystem(() =>
      prisma.tenant.findFirst({ where: { customDomain: domain, status: 'ACTIVE' }, select: { id: true } }),
    );
    return res.sendStatus(owner ? 200 : 404);
  }));

  const api = express.Router();
  // Resolve Host → tenant (subdomain / custom domain) before auth, so login can pin the session to
  // this workspace and requireAuth can reject a session for a different workspace on this domain.
  api.use(attachHostTenant);
  // CSRF double-submit guard on all mutating API requests (skips Bearer-authed calls and
  // login — see middleware/csrf.ts).
  api.use(csrfGuard);
  api.use('/auth', authRoutes);
  api.use('/users', usersRoutes);
  api.use('/projects', projectsRoutes); // includes nested /:projectId/charter and /cost
  api.use('/ratecards', rateCardRoutes);
  api.use('/portfolio', portfolioRoutes);
  api.use('/notifications', notificationRoutes);
  api.use('/resources', resourceRoutes);
  api.use('/me/timesheet', myTimesheetRoutes);
  api.use('/bookmarks', bookmarkRoutes);
  api.use('/admin/audit', adminAuditRoutes);
  api.use('/admin/settings', adminSettingsRoutes);
  api.use('/messages', messagesRoutes);
  api.use('/members', membersRoutes);
  api.use('/api-keys', apiKeyRoutes);
  api.use('/webhooks', webhookRoutes);
  api.use('/billing', billingRoutes);
  api.use('/admin/tenants', platformRoutes);
  app.use('/api/v1', api);

  if (serveClient) {
    app.use(express.static(clientDist));
    // SPA fallback: any non-API GET serves index.html so client-side routes work
    // on refresh/deep-link. API paths fall through to the JSON 404 handler.
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      res.sendFile(path.join(clientDist, 'index.html'));
    });
    console.log(`[prima-pm] serving client from ${clientDist}`);
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
