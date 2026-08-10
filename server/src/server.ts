import { createApp } from './app.js';
import { env } from './config/env.js';
import { prisma } from './lib/prisma.js';
import { pruneExpiredRefreshTokens } from './modules/auth/auth.service.js';
import { runWeeklyAutoCaptureIfDueAllTenants } from './modules/evm/evm.portfolio.js';
import { deliverDueDeliveries } from './modules/webhook/webhook.service.js';
import { escalateOverdueApprovals } from './modules/approval/approval.service.js';

// Defense-in-depth: a stray rejection should be logged, not take down the
// whole server for every user (the root cause is still fixed at the source).
process.on('unhandledRejection', (reason) => {
  console.error('[prima-pm] unhandledRejection', reason);
});

async function main() {
  const app = createApp();
  // Bind IPv4 wildcard by default. An IPv6 dualstack bind (Node's default) can miss
  // externally-bridged IPv4 clients on some VM NICs; 0.0.0.0 matches what works.
  const host = process.env.HOST ?? '0.0.0.0';
  const server = app.listen(env.port, host, () => {
    console.log(`[prima-pm] API listening on http://${host}:${env.port} (${env.nodeEnv})`);
  });

  // Drop expired refresh-token rows so the table can't grow unbounded. Runs once at boot
  // (catches up after downtime) then daily; failures are logged, never fatal. unref() so the
  // timer never keeps the process alive on its own.
  const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
  const prune = async () => {
    try {
      const removed = await pruneExpiredRefreshTokens();
      if (removed > 0) console.log(`[prima-pm] pruned ${removed} expired refresh token(s)`);
    } catch (err) {
      console.error('[prima-pm] refresh-token prune failed', err);
    }
  };
  void prune();
  const pruneTimer = setInterval(() => void prune(), PRUNE_INTERVAL_MS);
  pruneTimer.unref();

  // Weekly EVM auto-capture (opt-in via AppSetting). Check on boot then every 6h; the helper
  // only actually captures when it's enabled, today matches the configured weekday, and it
  // hasn't already run today — so this frequent tick is cheap and idempotent.
  const AUTO_CAPTURE_CHECK_MS = 6 * 60 * 60 * 1000;
  const autoCapture = async () => {
    try {
      const r = await runWeeklyAutoCaptureIfDueAllTenants();
      if (r.ran) console.log(`[prima-pm] weekly EVM auto-capture: ${r.captured}/${r.total} project(s)${r.failed ? ` (${r.failed} skipped)` : ''}`);
    } catch (err) {
      console.error('[prima-pm] weekly EVM auto-capture failed', err);
    }
  };
  void autoCapture();
  const autoCaptureTimer = setInterval(() => void autoCapture(), AUTO_CAPTURE_CHECK_MS);
  autoCaptureTimer.unref();

  // Outbound webhook retry sweep (T3.3): deliveries are attempted immediately on emit; this drains
  // any PENDING ones whose backoff has elapsed. Every 60s; a no-op (one cheap query) when idle.
  const WEBHOOK_SWEEP_MS = 60 * 1000;
  const sweepWebhooks = async () => {
    try {
      const n = await deliverDueDeliveries();
      if (n > 0) console.log(`[prima-pm] delivered ${n} pending webhook(s)`);
    } catch (err) {
      console.error('[prima-pm] webhook delivery sweep failed', err);
    }
  };
  void sweepWebhooks();
  const webhookTimer = setInterval(() => void sweepWebhooks(), WEBHOOK_SWEEP_MS);
  webhookTimer.unref();

  // Approval SLA escalation sweep (Phase 2b): notify escalation targets for any approval step that
  // has blown its deadline. Every 5 min; a no-op (one cheap indexed query) when nothing is overdue.
  const APPROVAL_SLA_SWEEP_MS = 5 * 60 * 1000;
  const sweepApprovals = async () => {
    try {
      const r = await escalateOverdueApprovals();
      if (r.escalated > 0) console.log(`[prima-pm] escalated ${r.escalated} overdue approval(s)`);
    } catch (err) {
      console.error('[prima-pm] approval SLA sweep failed', err);
    }
  };
  void sweepApprovals();
  const approvalSlaTimer = setInterval(() => void sweepApprovals(), APPROVAL_SLA_SWEEP_MS);
  approvalSlaTimer.unref();

  const shutdown = async (signal: string) => {
    console.log(`[prima-pm] ${signal} received, shutting down...`);
    clearInterval(pruneTimer);
    clearInterval(autoCaptureTimer);
    clearInterval(webhookTimer);
    clearInterval(approvalSlaTimer);
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[prima-pm] fatal startup error', err);
  process.exit(1);
});
