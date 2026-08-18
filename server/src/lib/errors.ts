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
// Login blocked because the account's email isn't activated yet. Distinct code so the SPA can offer
// a "resend activation email" action instead of a generic error. Only thrown when email is armed.
export const EmailNotVerified = (msg = 'Please activate your account from the link we emailed you.') =>
  new AppError(403, msg, 'EMAIL_NOT_VERIFIED');
export const NotFound = (msg = 'Not found') =>
  new AppError(404, msg, 'NOT_FOUND');
export const Conflict = (msg = 'Conflict') =>
  new AppError(409, msg, 'CONFLICT');
export const PayloadTooLarge = (msg = 'Payload too large') =>
  new AppError(413, msg, 'PAYLOAD_TOO_LARGE');
export const TooManyRequests = (msg = 'Too many requests') =>
  new AppError(429, msg, 'TOO_MANY_REQUESTS');
export const PaymentRequired = (msg = 'Payment required') =>
  new AppError(402, msg, 'PAYMENT_REQUIRED');
