// Central typed application errors -> mapped to HTTP status by error middleware.
export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const BadRequest = (msg = 'Bad request', details?: unknown) =>
  new AppError(400, msg, 'BAD_REQUEST', details);
export const Unauthorized = (msg = 'Unauthorized') =>
  new AppError(401, msg, 'UNAUTHORIZED');
export const Forbidden = (msg = 'Forbidden') =>
  new AppError(403, msg, 'FORBIDDEN');
export const NotFound = (msg = 'Not found') =>
  new AppError(404, msg, 'NOT_FOUND');
export const Conflict = (msg = 'Conflict') =>
  new AppError(409, msg, 'CONFLICT');
