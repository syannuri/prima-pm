// Gather a portfolio-wide snapshot (summary + rolled-up EVM trend) for export.
// Role-scoping is handled inside the reused services (a PM sees only owned projects).
import { getPortfolioSummary } from '../portfolio/portfolio.service.js';
import { getPortfolioEvmTrend } from '../evm/evm.portfolio.js';

export async function gatherPortfolioExport(userId: string, role: string, statusDate: Date) {
  const [summary, trend] = await Promise.all([
    getPortfolioSummary(userId, role, statusDate),
    getPortfolioEvmTrend(userId, role),
  ]);
  return { summary, trend, statusDate, generatedAt: new Date() };
}

export type PortfolioExport = Awaited<ReturnType<typeof gatherPortfolioExport>>;
