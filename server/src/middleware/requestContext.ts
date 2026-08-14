import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import { logger } from '../lib/observability.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      // Correlation id for this request — echoed as X-Request-Id and attached to every log line.
      id?: string;
      // Request-scoped child logger (carries reqId). Use req.log in handlers for correlated logs.
      log?: Logger;
    }
  }
}

// Health/readiness/internal probes fire every few seconds — don't spam the request log with them.
const SKIP_LOG = /^\/(health|_internal)\b/;

// Assigns a correlation id + a request-scoped logger, and logs one structured line per request on
// completion (method, path, status, duration, tenant/user when authenticated). Mount EARLY so every
// request is covered; user/tenant are read at 'finish' (after auth middleware has populated req.user).
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const id = (req.headers['x-request-id'] as string | undefined) || randomUUID();
  req.id = id;
  req.log = logger.child({ reqId: id });
  res.setHeader('X-Request-Id', id);

  if (!SKIP_LOG.test(req.path)) {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Math.round(Number(process.hrtime.bigint() - start) / 1e6);
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
      req.log?.[level](
        {
          method: req.method,
          path: req.originalUrl.split('?')[0],
          status: res.statusCode,
          ms,
          tenantId: req.user?.tid,
          userId: req.user?.id,
        },
        'request',
      );
    });
  }
  next();
}
