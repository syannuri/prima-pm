import { prisma } from '../../lib/prisma.js';
import { writeAudit } from '../../lib/audit.js';
import { env } from '../../config/env.js';

const SINGLETON = 'singleton';

export interface AppSettings {
  guestSignupEnabled: boolean;
  googleLoginEnabled: boolean;
}

// Small in-process cache so the hot paths (login page /auth/providers, guest register, google
// login) don't hit the DB every request. The app runs as a single Node process, and the only
// writer is the admin PATCH below, which refreshes the cache — so it never goes stale.
let cache: AppSettings | null = null;

// Read the singleton settings row, creating it (seeded from the env flags) on first access so a
// deploy preserves the previously-configured behaviour. Idempotent via upsert (no create race).
export async function getAppSettings(): Promise<AppSettings> {
  if (cache) return cache;
  const row = await prisma.appSetting.upsert({
    where: { id: SINGLETON },
    create: {
      id: SINGLETON,
      guestSignupEnabled: env.guestSignupEnabled,
      // Default Google ON iff a client ID is configured — matches the pre-toggle behaviour.
      googleLoginEnabled: Boolean(env.googleClientId),
    },
    update: {},
  });
  cache = { guestSignupEnabled: row.guestSignupEnabled, googleLoginEnabled: row.googleLoginEnabled };
  return cache;
}

export async function updateAppSettings(patch: Partial<AppSettings>, actorId: string): Promise<AppSettings> {
  const current = await getAppSettings();
  const next: AppSettings = {
    guestSignupEnabled: patch.guestSignupEnabled ?? current.guestSignupEnabled,
    googleLoginEnabled: patch.googleLoginEnabled ?? current.googleLoginEnabled,
  };
  await prisma.appSetting.update({ where: { id: SINGLETON }, data: { ...next, updatedById: actorId } });
  cache = next;
  await writeAudit({ userId: actorId, entity: 'AppSetting', entityId: SINGLETON, action: 'UPDATE', before: current, after: next });
  return next;
}

// Google can only be truly enabled when a client ID is configured (needed to verify tokens and
// render the button). The admin toggle gates it ON TOP of that.
export function isGoogleConfigured(): boolean {
  return Boolean(env.googleClientId);
}

export async function isGuestSignupEnabled(): Promise<boolean> {
  return (await getAppSettings()).guestSignupEnabled;
}

export async function isGoogleLoginEnabled(): Promise<boolean> {
  return isGoogleConfigured() && (await getAppSettings()).googleLoginEnabled;
}

// Test-only: drop the cache so a fresh DB state is picked up between test files.
export function __resetSettingsCache(): void {
  cache = null;
}
