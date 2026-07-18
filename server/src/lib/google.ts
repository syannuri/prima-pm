import { OAuth2Client } from 'google-auth-library';
import { env } from '../config/env.js';

// A single reusable client. verifyIdToken fetches + caches Google's public signing keys and
// checks the token signature, issuer, expiry, and audience (our client ID) for us.
let client: OAuth2Client | null = null;
function getClient(): OAuth2Client {
  if (!client) client = new OAuth2Client(env.googleClientId);
  return client;
}

export interface GoogleIdentity {
  sub: string; // stable Google account id
  email: string;
  emailVerified: boolean;
  name: string;
}

// Verify a Google Identity Services ID token (the `credential` from the sign-in button) and
// return the identity claims. Throws if the token is invalid, expired, for the wrong audience,
// or missing an email. The caller must still enforce app policy (email_verified, role, etc.).
export async function verifyGoogleIdToken(credential: string): Promise<GoogleIdentity> {
  const ticket = await getClient().verifyIdToken({ idToken: credential, audience: env.googleClientId });
  const p = ticket.getPayload();
  if (!p || !p.sub || !p.email) throw new Error('Google token missing required claims');
  return {
    sub: p.sub,
    email: p.email.toLowerCase(),
    emailVerified: p.email_verified === true,
    name: p.name || p.email,
  };
}
