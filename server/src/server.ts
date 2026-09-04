import { createApp } from './app.js';
import { env, isProd } from './config/env.js';
import { prisma } from './lib/prisma.js';
import { runAsSystem } from './lib/tenant/context.js';
import { pruneStaleMemories } from './modules/assistant/memory.service.js';
import { pruneExpiredRefreshTokens } from './modules/auth/auth.service.js';
import { runWeeklyAutoCaptureIfDueAllTenants } from './modules/evm/evm.portfolio.js';
import { deliverDueDeliveries } from './modules/webhook/webhook.service.js';
import { escalateOverdueApprovals } from './modules/approval/approval.service.js';
import { runTrialReminderSweep } from './modules/billing/trialReminders.js';
import { runDigestSweepIfDue } from './modules/notification/digest.service.js';
import { runProactiveSweepIfDue, finalizeDueBatches, runInstantTriggerSweepIfDue } from './modules/report/proactive.service.js';
import { measureDueOutcomes } from './modules/aiActions/aiActionOutcomes.service.js';
import { logger, release, initSentry } from './lib/observability.js';

// Initialise error tracking before anything else (no-op unless SENTRY_DSN is set).
initSentry();

// Defense-in-depth: a stray rejection should be logged, not take down the
// whole server for every user (the root cause is still fixed at the source).
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'unhandledRejection');
});

// An uncaught exception leaves the process in an undefined state — log it (structured, so it lands
// in the error tracker in Phase 2) then exit so systemd restarts a clean process. This just adds
// logging around Node's existing crash-on-uncaught behaviour; it does not keep a broken process up.
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaughtException — exiting');
  process.exit(1);
});

// Hardening: the pooled-multitenancy isolation net is env-gated (MULTITENANCY_ENFORCE). If a
// production deploy is missing the flag, the Prisma tenant-extension becomes a no-op and queries
// could cross tenants — a silent, config-only failure. Refuse to start in that case, unless
// single-tenant operation is an explicit, conscious choice (ALLOW_SINGLE_TENANT=true). Non-prod
// is unaffected so local/dev and the test suite can toggle enforcement freely.
function assertTenantIsolation(): void {
  if (isProd && !env.multitenancy.enforce && process.env.ALLOW_SINGLE_TENANT !== 'true') {
    throw new Error(
      'Refusing to start: MULTITENANCY_ENFORCE is not "true" in production — tenant isolation ' +
      'would be OFF, risking cross-tenant data exposure. Set MULTITENANCY_ENFORCE=true, or opt ' +
      'into single-tenant mode explicitly with ALLOW_SINGLE_TENANT=true.',
    );
  }
}

async function main() {
  assertTenantIsolation();
  const app = createApp();
  // Bind IPv4 wildcard by default. An IPv6 dualstack bind (Node's default) can miss
  // externally-bridged IPv4 clients on some VM NICs; 0.0.0.0 matches what works.
  const host = process.env.HOST ?? '0.0.0.0';
  const server = app.listen(env.port, host, () => {
    logger.info({ host, port: env.port, env: env.nodeEnv, release }, 'API listening');
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

  // Anett memory prune (improvement #5): deactivate stale, never-used, non-pinned auto/feedback
  // memories. Dormant unless AI_MEMORY_TTL_DAYS > 0. Daily; cross-tenant maintenance ⇒ runAsSystem.
  const memoryPrune = async () => {
    try {
      const r = await runAsSystem(() => pruneStaleMemories());
      if (r.deactivated > 0) console.log(`[prima-pm] pruned ${r.deactivated} stale Anett memor(ies)`);
    } catch (err) {
      console.error('[prima-pm] Anett memory prune failed', err);
    }
  };
  void memoryPrune();
  const memoryPruneTimer = setInterval(() => void memoryPrune(), PRUNE_INTERVAL_MS);
  memoryPruneTimer.unref();

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

  // Trial-reminder sweep (Phase 6 subscription plans): notify a corporate TRIAL workspace's admins as
  // the 60-day trial nears its end (~14 / 3 / 0 days). In-app only, deduped per bucket → idempotent.
  // Check on boot then every 12h; a no-op (one cheap query) when there are no trials due.
  const TRIAL_REMINDER_SWEEP_MS = 12 * 60 * 60 * 1000;
  const sweepTrialReminders = async () => {
    try {
      const r = await runTrialReminderSweep();
      if (r.created > 0) console.log(`[prima-pm] sent ${r.created} trial reminder(s)`);
    } catch (err) {
      console.error('[prima-pm] trial reminder sweep failed', err);
    }
  };
  void sweepTrialReminders();
  const trialReminderTimer = setInterval(() => void sweepTrialReminders(), TRIAL_REMINDER_SWEEP_MS);
  trialReminderTimer.unref();

  // Alert-digest sweep: mail each opted-in user their open-alert rollup at the configured send hour
  // (DIGEST_HOUR, default 07:00 server-local; WEEKLY on DIGEST_WEEKDAY). Checked hourly so the send
  // hour is hit within the window; a cheap no-op outside that hour or when SMTP is unconfigured.
  const DIGEST_SWEEP_MS = 60 * 60 * 1000;
  const sweepDigests = async () => {
    try {
      const r = await runDigestSweepIfDue();
      if (r.sent > 0) console.log(`[prima-pm] sent ${r.sent} alert digest(s)`);
    } catch (err) {
      console.error('[prima-pm] alert digest sweep failed', err);
    }
  };
  void sweepDigests();
  const digestTimer = setInterval(() => void sweepDigests(), DIGEST_SWEEP_MS);
  digestTimer.unref();

  // Proactive-AI sweep: once a week (PROACTIVE_WEEKDAY/HOUR, falling back to the digest schedule)
  // auto-draft a status narrative + predictive flags for each active project in an opted-in tenant.
  // Checked hourly; a cheap no-op outside the window, when the AI key is unset, or with no opted-in
  // tenant. Dormant-by-default like the rest of the AI stack.
  const PROACTIVE_SWEEP_MS = 60 * 60 * 1000;
  const sweepProactive = async () => {
    try {
      const r = await runProactiveSweepIfDue();
      if (r.drafted > 0) console.log(`[prima-pm] drafted ${r.drafted} proactive AI briefing(s)`);
    } catch (err) {
      console.error('[prima-pm] proactive AI sweep failed', err);
    }
  };
  void sweepProactive();
  const proactiveTimer = setInterval(() => void sweepProactive(), PROACTIVE_SWEEP_MS);
  proactiveTimer.unref();

  // Proactive-batch finaliser (#Batch): when PROACTIVE_BATCH mode is on, the sweep submits one org-wide
  // Message Batch; this drains completed batches into AiBriefings. Every 10 min; a cheap no-op (one
  // indexed query) when there are no in-flight batches. unref() so it never keeps the process alive.
  const BATCH_FINALIZE_MS = 10 * 60 * 1000;
  const finalizeBatches = async () => {
    try {
      const r = await finalizeDueBatches();
      if (r.drafted > 0) console.log(`[prima-pm] finalised ${r.drafted} batched proactive briefing(s)`);
    } catch (err) {
      console.error('[prima-pm] proactive batch finalise failed', err);
    }
  };
  void finalizeBatches();
  const batchFinalizeTimer = setInterval(() => void finalizeBatches(), BATCH_FINALIZE_MS);
  batchFinalizeTimer.unref();

  // Real-time trigger briefings (#6): watch each project's predictive signal and draft an instant
  // briefing the moment it goes HIGH — not just at the weekly window. Dormant unless PROACTIVE_INSTANT.
  // Every 2h; the deterministic scan is cheap, only an actual HIGH project spends (cheap model), and
  // it's deduped to one instant briefing per project per day.
  const INSTANT_SWEEP_MS = Number(process.env.PROACTIVE_INSTANT_MS ?? 2 * 60 * 60 * 1000);
  const sweepInstant = async () => {
    try {
      const r = await runInstantTriggerSweepIfDue();
      if (r.drafted > 0) console.log(`[prima-pm] instant-triggered ${r.drafted} proactive briefing(s)`);
    } catch (err) {
      console.error('[prima-pm] instant trigger sweep failed', err);
    }
  };
  void sweepInstant();
  const instantTimer = setInterval(() => void sweepInstant(), INSTANT_SWEEP_MS);
  instantTimer.unref();

  // AI outcome-learning sweep: resolve applied Stage-C action proposals whose measurement horizon
  // has elapsed (baseline SPI vs SPI now → IMPROVED/UNCHANGED/WORSENED). Deterministic, no LLM/spend;
  // a cheap indexed no-op when nothing is due. Every 6h.
  const OUTCOME_SWEEP_MS = Number(process.env.AI_OUTCOME_SWEEP_MS ?? 6 * 60 * 60 * 1000);
  const sweepOutcomes = async () => {
    try {
      const r = await measureDueOutcomes(new Date());
      if (r.measured > 0) console.log(`[prima-pm] measured ${r.measured} AI action outcome(s)`);
    } catch (err) {
      console.error('[prima-pm] AI outcome sweep failed', err);
    }
  };
  void sweepOutcomes();
  const outcomeTimer = setInterval(() => void sweepOutcomes(), OUTCOME_SWEEP_MS);
  outcomeTimer.unref();

  const shutdown = async (signal: string) => {
    console.log(`[prima-pm] ${signal} received, shutting down...`);
    clearInterval(pruneTimer);
    clearInterval(memoryPruneTimer);
    clearInterval(autoCaptureTimer);
    clearInterval(webhookTimer);
    clearInterval(approvalSlaTimer);
    clearInterval(trialReminderTimer);
    clearInterval(digestTimer);
    clearInterval(proactiveTimer);
    clearInterval(batchFinalizeTimer);
    clearInterval(instantTimer);
    clearInterval(outcomeTimer);
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
