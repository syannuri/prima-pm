import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { AppError } from '../lib/errors.js';
import { isProd } from '../config/env.js';

// 404 fallthrough
export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
}

// Central error mapper.
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: { code: err.code ?? 'ERROR', message: err.message, details: err.details },
    });
    return;
  }

  // Multer upload errors (e.g. file too large) -> 400.
  if (err instanceof Error && err.name === 'MulterError') {
    res.status(400).json({
      error: { code: 'UPLOAD_ERROR', message: err.message },
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: err.flatten() },
    });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      // Don't leak internal column names (err.meta.target) to the client — log for
      // debugging, return a generic conflict. App code pre-checks uniqueness with a
      // friendly Conflict() message; this is just the race-condition backstop.
      console.warn('[error] P2002 unique violation', err.meta);
      res.status(409).json({
        error: { code: 'CONFLICT', message: 'That value is already in use' },
      });
      return;
    }
    if (err.code === 'P2025') {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Record not found' } });
      return;
    }
  }

  console.error('[error] unhandled', err);
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: isProd ? 'Internal server error' : String((err as Error)?.message ?? err),
    },
  });
}
