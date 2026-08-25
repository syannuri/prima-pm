import { getProjectForecast } from '../forecast/forecast.service.js';

// Stage B — predictive slip/overrun signals. DETERMINISTIC heuristic over the existing EVM/forecast
// figures (SPI/CPI/TCPI/VAC/variance) — NOT machine learning. It turns the current cost & schedule
// performance into a forward-looking risk level + the drivers behind it. Always available (no AI key
// needed); the AI narration of the same picture lives in the Fase 2 EVM explainer.

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';
export interface RiskSignal { level: RiskLevel; score: number; drivers: string[] }
export interface Predictive {
  hasData: boolean;
  slip: RiskSignal | null;     // risk of finishing late
  overrun: RiskSignal | null;  // risk of finishing over budget
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const r0 = (n: number) => Math.round(n);
// Thresholds tuned so a healthy project (SPI/CPI ≈ 1, no variance) scores ~0 = LOW, and a clearly
// troubled one (SPI/CPI ≈ 0.8, weeks late / EAC well over BAC) lands HIGH.
function levelOf(score: number): RiskLevel {
  if (score >= 55) return 'HIGH';
  if (score >= 25) return 'MEDIUM';
  return 'LOW';
}
const idr = (n: number) => `Rp ${r0(Math.abs(n)).toLocaleString('id-ID')}`;

type Forecast = Awaited<ReturnType<typeof getProjectForecast>>;

// PURE: compute the two risk signals from a forecast snapshot. Unit-testable without a DB.
export function computePredictive(f: Forecast): Predictive {
  if (!f.hasData) return { hasData: false, slip: null, overrun: null };

  // --- Schedule slip: SPI below 1 + forecast finishing past the plan. ---
  const spi = f.spi ?? 1;
  const varianceDays = f.schedule.varianceDays ?? 0; // + = late
  const slipFromSpi = spi > 0 ? clamp((1 - spi) * 200, 0, 60) : 60; // SPI 0.7→60, 0.9→20, ≥1→0
  const slipFromDays = clamp(varianceDays * 2, 0, 40);              // 20d late → 40
  const slipScore = r0(clamp(slipFromSpi + slipFromDays, 0, 100));
  const slipDrivers: string[] = [];
  if (spi < 0.95) slipDrivers.push(`SPI ${spi.toFixed(2)} — behind schedule`);
  if (varianceDays > 0) slipDrivers.push(`Forecast finish ${varianceDays} days late`);
  if (slipDrivers.length === 0) slipDrivers.push('On schedule');

  // --- Cost overrun: CPI below 1 + EAC above BAC (negative VAC), TCPI as a supporting cue. ---
  const cpi = f.cpi ?? 1;
  const vac = f.vac ?? 0; // BAC − EAC; negative = projected over budget
  const bac = f.bac ?? 0;
  const tcpi = f.tcpi ?? 1;
  const overrunFromCpi = cpi > 0 ? clamp((1 - cpi) * 200, 0, 60) : 60;
  const vacPct = bac > 0 && vac < 0 ? -vac / bac : 0;
  const overrunFromVac = clamp(vacPct * 200, 0, 40); // EAC 20% over BAC → 40
  const overrunScore = r0(clamp(overrunFromCpi + overrunFromVac, 0, 100));
  const overrunDrivers: string[] = [];
  if (cpi < 0.98) overrunDrivers.push(`CPI ${cpi.toFixed(2)} — over budget`);
  if (vac < 0) overrunDrivers.push(`EAC above BAC (VAC −${idr(vac)})`);
  if (tcpi > 1.05) overrunDrivers.push(`TCPI ${tcpi.toFixed(2)} — needs higher efficiency`);
  if (overrunDrivers.length === 0) overrunDrivers.push('On budget');

  return {
    hasData: true,
    slip: { level: levelOf(slipScore), score: slipScore, drivers: slipDrivers },
    overrun: { level: levelOf(overrunScore), score: overrunScore, drivers: overrunDrivers },
  };
}

export async function getProjectPredictive(projectId: string, asOf: Date = new Date()): Promise<Predictive> {
  const forecast = await getProjectForecast(projectId, asOf);
  return computePredictive(forecast);
}
