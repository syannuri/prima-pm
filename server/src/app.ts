import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env, isProd } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import authRoutes from './modules/auth/auth.routes.js';
import usersRoutes from './modules/users/users.routes.js';
import projectsRoutes from './modules/projects/projects.routes.js';
import rateCardRoutes from './modules/ratecard/ratecard.routes.js';
import portfolioRoutes from './modules/portfolio/portfolio.routes.js';
import notificationRoutes from './modules/notification/notification.routes.js';
import resourceRoutes from './modules/resource/resource.routes.js';
import myTimesheetRoutes from './modules/timesheet/timesheet.me.routes.js';

// Locate the built frontend (server/dist/app.js → ../../client/dist). Overridable
// via CLIENT_DIST_PATH for non-standard layouts.
const here = path.dirname(fileURLToPath(import.meta.url));
const clientDist = process.env.CLIENT_DIST_PATH
  ? path.resolve(process.env.CLIENT_DIST_PATH)
  : path.resolve(here, '../../client/dist');

export function createApp() {
  const app = express();

  // Serve the SPA same-origin in production, so the client's relative /api/v1 calls
  // need no proxy/CORS. CSP allows inline styles (the interactive Gantt positions
  // bars via style attributes) and data: images.
  const serveClient = isProd && fs.existsSync(path.join(clientDist, 'index.html'));

  app.use(
    helmet(
      serveClient
        ? {
            contentSecurityPolicy: {
              // useDefaults:false so we DON'T inherit `upgrade-insecure-requests`,
              // which would force assets over HTTPS and blank the page on plain-HTTP LAN.
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
              },
            },
            // No TLS in front of this LAN deploy → don't advertise HSTS / HTTPS upgrades,
            // and skip headers that only apply to "secure" origins (they'd just log
            // ignored-over-HTTP warnings in the browser console).
            strictTransportSecurity: false,
            crossOriginOpenerPolicy: false,
            originAgentCluster: false,
          }
        : undefined,
    ),
  );
  app.use(cors({ origin: env.corsOrigin, credentials: true }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'prima-pm', ts: new Date().toISOString() });
  });

  const api = express.Router();
  api.use('/auth', authRoutes);
  api.use('/users', usersRoutes);
  api.use('/projects', projectsRoutes); // includes nested /:projectId/charter and /cost
  api.use('/ratecards', rateCardRoutes);
  api.use('/portfolio', portfolioRoutes);
  api.use('/notifications', notificationRoutes);
  api.use('/resources', resourceRoutes);
  api.use('/me/timesheet', myTimesheetRoutes);
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
