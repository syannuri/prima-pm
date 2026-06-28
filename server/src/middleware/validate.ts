import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny, infer as ZodInfer } from 'zod';

// Wraps async route handlers so thrown errors reach the error middleware.
export function asyncHandler<T extends (req: Request, res: Response, next: NextFunction) => Promise<unknown>>(
  fn: T,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

// Validates req.body against a Zod schema and replaces it with the parsed value.
export function validateBody<S extends ZodTypeAny>(schema: S) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const parsed = schema.parse(req.body) as ZodInfer<S>;
    req.body = parsed;
    next();
  };
}
