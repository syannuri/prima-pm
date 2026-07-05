import { createApp } from './app.js';
import { env } from './config/env.js';
import { prisma } from './lib/prisma.js';
import { pruneExpiredRefreshTokens } from './modules/auth/auth.service.js';

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

  const shutdown = async (signal: string) => {
    console.log(`[prima-pm] ${signal} received, shutting down...`);
    clearInterval(pruneTimer);
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
