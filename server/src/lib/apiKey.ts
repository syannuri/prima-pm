import { randomBytes, createHash } from 'node:crypto';

// Public REST API keys (T3). The plaintext is shown ONCE at creation and never stored — we keep only
// its SHA-256, and resolve an incoming key by hashing it and looking up that hash (a unique index).

// `pk_live_` marks a Prismatix API key so requireAuth can tell a key from a JWT at a glance.
export const API_KEY_PREFIX = 'pk_live_';

export interface GeneratedApiKey {
  plaintext: string; // returned to the caller once, never persisted
  prefix: string;    // stored for display (identifies the key without revealing it)
  hashedKey: string; // stored (SHA-256 hex)
}

// 32 bytes of entropy, URL-safe. Collisions are astronomically unlikely; the unique index is the backstop.
export function generateApiKey(): GeneratedApiKey {
  const secret = randomBytes(32).toString('base64url');
  const plaintext = `${API_KEY_PREFIX}${secret}`;
  return {
    plaintext,
    // e.g. "pk_live_a1b2c3" — enough to recognise a key in a list, not enough to use it.
    prefix: plaintext.slice(0, API_KEY_PREFIX.length + 6),
    hashedKey: hashApiKey(plaintext),
  };
}

export function hashApiKey(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

// Cheap discriminator used by requireAuth to route a Bearer token to key-auth vs JWT-auth.
export function looksLikeApiKey(token: string): boolean {
  return token.startsWith(API_KEY_PREFIX);
}
