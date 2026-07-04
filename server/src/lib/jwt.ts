import jwt, { type SignOptions, type VerifyOptions } from 'jsonwebtoken';
import type { Role } from '@prisma/client';
import { env } from '../config/env.js';

export interface AccessTokenPayload {
  sub: string; // user id
  role: Role;
  email: string;
  tv?: number; // token version — see User.tokenVersion (optional for backward compat)
}

export interface RefreshTokenPayload {
  sub: string;
  tokenType: 'refresh';
  tv?: number;
}

// Pin the algorithm on verify: never accept a token signed with anything other than the
// HMAC we sign with (defense-in-depth against alg-confusion / "alg:none" attacks).
const VERIFY_OPTS: VerifyOptions = { algorithms: ['HS256'] };

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.jwt.accessSecret, {
    expiresIn: env.jwt.accessTtl,
    algorithm: 'HS256',
  } as SignOptions);
}

export function signRefreshToken(userId: string, tokenVersion = 0): string {
  return jwt.sign({ sub: userId, tokenType: 'refresh', tv: tokenVersion }, env.jwt.refreshSecret, {
    expiresIn: env.jwt.refreshTtl,
    algorithm: 'HS256',
  } as SignOptions);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.jwt.accessSecret, VERIFY_OPTS) as unknown as AccessTokenPayload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return jwt.verify(token, env.jwt.refreshSecret, VERIFY_OPTS) as unknown as RefreshTokenPayload;
}
