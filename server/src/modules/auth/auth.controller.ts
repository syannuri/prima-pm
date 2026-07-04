import type { Request, Response } from 'express';
import * as authService from './auth.service.js';

export async function loginHandler(req: Request, res: Response): Promise<void> {
  const result = await authService.login(req.body);
  res.json(result);
}

export async function refreshHandler(req: Request, res: Response): Promise<void> {
  const result = await authService.refresh(req.body.refreshToken);
  res.json(result);
}

export async function meHandler(req: Request, res: Response): Promise<void> {
  const user = await authService.me(req.user!.id);
  res.json({ user });
}

export async function changePasswordHandler(req: Request, res: Response): Promise<void> {
  // Returns a fresh token pair: changing the password revokes other sessions, so the
  // caller needs new tokens to keep this one alive.
  const result = await authService.changePassword(req.user!.id, req.body);
  res.json(result);
}

export async function logoutHandler(req: Request, res: Response): Promise<void> {
  await authService.logoutAll(req.user!.id);
  res.json({ ok: true });
}
