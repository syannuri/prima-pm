import { randomBytes, createHmac } from 'node:crypto';

// Outbound webhook signing (T3.3). Receivers verify each POST by recomputing the HMAC over
// `${timestamp}.${rawBody}` with the subscription's shared secret and comparing to the `v1=` value.
// Including the timestamp lets receivers reject replays. Mirrors the Stripe/GitHub signing shape.

export const WEBHOOK_SECRET_PREFIX = 'whsec_';

// Header names sent on every delivery.
export const SIGNATURE_HEADER = 'X-Prismatix-Signature'; // t=<unix>,v1=<hex>
export const EVENT_HEADER = 'X-Prismatix-Event';
export const DELIVERY_HEADER = 'X-Prismatix-Delivery';

export function generateWebhookSecret(): string {
  return `${WEBHOOK_SECRET_PREFIX}${randomBytes(24).toString('base64url')}`;
}

// Hex HMAC-SHA256 over the signed payload (timestamp-bound).
export function signWebhook(secret: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

// The full `X-Prismatix-Signature` header value for a body + secret at a given time.
export function signatureHeader(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)): string {
  return `t=${timestamp},v1=${signWebhook(secret, timestamp, body)}`;
}
