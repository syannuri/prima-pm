import webpush from 'web-push';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';

// Web-push (browser push notifications) via VAPID. Enabled only when the VAPID keypair is set in
// the environment; otherwise every operation is a no-op and the client hides the enable control.

let pushEnabled = false;

export function configurePush(): void {
  const { publicKey, privateKey, subject } = env.vapid;
  if (!publicKey || !privateKey) { pushEnabled = false; return; }
  try {
    webpush.setVapidDetails(subject || 'https://prismatix.tech', publicKey, privateKey);
    pushEnabled = true;
  } catch {
    pushEnabled = false;
  }
}

export function isPushEnabled(): boolean { return pushEnabled; }
export function getPublicKey(): string { return env.vapid.publicKey; }

export interface BrowserSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

// Store (or rebind) a device's subscription. endpoint is unique, so the same browser re-subscribing
// — or a different user signing in on it — just updates the owner + keys.
export async function saveSubscription(userId: string, sub: BrowserSubscription) {
  await prisma.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    create: { userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    update: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
  });
  return { ok: true };
}

export async function deleteSubscription(userId: string, endpoint: string) {
  await prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
  return { ok: true };
}

export interface PushPayload {
  title: string;
  body: string;
  conversationId?: string;
  url?: string;
}

// Send a push to every subscription of the given users. Expired subscriptions (404/410) are pruned.
export async function sendPushToUsers(userIds: string[], payload: PushPayload): Promise<void> {
  if (!pushEnabled || userIds.length === 0) return;
  const subs = await prisma.pushSubscription.findMany({ where: { userId: { in: userIds } } });
  if (subs.length === 0) return;
  const data = JSON.stringify(payload);
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, data, { TTL: 3600 });
      } catch (err: unknown) {
        const status = (err as { statusCode?: number })?.statusCode;
        if (status === 404 || status === 410) {
          await prisma.pushSubscription.deleteMany({ where: { endpoint: s.endpoint } }).catch(() => {});
        }
      }
    }),
  );
}

// Configure on import (env is already loaded via config/env.ts → dotenv).
configurePush();
