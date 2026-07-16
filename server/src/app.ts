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

  app.use(
    helmet(
      serveClient
        ? {
            contentSecurityPolicy: {
              // useDefaults:false so we control every directive explicitly.
              useDefaults: false,
              directives: {
                defaultSrc: ["'self'"],
                // The hash whitelists the inline pre-paint theme script in
                // client/index.html (anti-FOUC) WITHOUT opening up 'unsafe-inline'.
                // If that <script> body changes, regenerate the hash (the browser
                // console reports the expected sha256 when it blocks it).
                scriptSrc: ["'self'", "'sha256-gJ9Qv9VU/346gdpDRI3qPE9+6RkSI+W4FxyEcgZFlyY='"],
                styleSrc: ["'self'", "'unsafe-inline'"],
                imgSrc: ["'self'", 'data:'],
                connectSrc: ["'self'"],
                objectSrc: ["'none'"],
                baseUri: ["'self'"],
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
            crossOriginOpenerPolicy: env.secure ? undefined : false,
            originAgentCluster: env.secure ? undefined : false,
          }
        : undefined,
    ),
  );
  app.use(cors({ origin: env.corsOrigin, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  // Populate req.cookies so cookie-based auth (prima_at) and the CSRF double-submit check
  // can read them.
  app.use(cookieParser);

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'prima-pm', ts: new Date().toISOString() });
  });

  const api = express.Router();
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
