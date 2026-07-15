import type { Request, Response } from 'express';
import * as authService from './auth.service.js';
import { setAuthCookies, clearAuthCookies, RT_COOKIE } from '../../lib/cookies.js';
import { Unauthorized } from '../../lib/errors.js';

export async function loginHandler(req: Request, res: Response): Promise<void> {
  const result = await authService.login(req.body);
  // Set the httpOnly auth cookies for the browser SPA; the body still carries the tokens
  // for Bearer/automation clients (backward compatible).
  setAuthCookies(res, result);
  res.json(result);
}

export async function guestRegisterHandler(req: Request, res: Response): Promise<void> {
  const result = await authService.guestRegister(req.body);
  setAuthCookies(res, result); // auto-login on signup
  res.status(201).json(result);
}

export async function refreshHandler(req: Request, res: Response): Promise<void> {
  // The refresh token comes from the httpOnly cookie (browser) or the JSON body (legacy /
  // automation clients). Either establishes a fresh, rotated pair.
  const presented = req.cookies?.[RT_COOKIE] ?? req.body?.refreshToken;
  if (!presented) throw Unauthorized('Missing refresh token');
  const result = await authService.refresh(presented);
  setAuthCookies(res, result);
  res.json(result);
}

export async function meHandler(req: Request, res: Response): Promise<void> {
  const user = await authService.me(req.user!.id);
  res.json({ user });
}

export async function changePasswordHandler(req: Request, res: Response): Promise<void> {
  // Returns a fresh token pair: changing the password revokes other sessions, so the
  // caller needs new tokens to keep this one alive. Refresh the cookies too.
  const result = await authService.changePassword(req.user!.id, req.body);
  setAuthCookies(res, result);
  res.json(result);
}

export async function logoutHandler(req: Request, res: Response): Promise<void> {
  await authService.logoutAll(req.user!.id);
  clearAuthCookies(res);
  res.json({ ok: true });
}
