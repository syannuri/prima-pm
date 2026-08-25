import { describe, it, expect } from 'vitest';
import { computePredictive, type Predictive } from '../predictive.service.js';
import type { getProjectForecast } from '../../forecast/forecast.service.js';

type Forecast = Awaited<ReturnType<typeof getProjectForecast>>;

// Build just the fields computePredictive reads; cast to the full Forecast type (the rest is unused).
function fc(p: {
  hasData?: boolean; spi?: number; cpi?: number; tcpi?: number; vac?: number; bac?: number; varianceDays?: number;
}): Forecast {
  return {
    hasData: p.hasData ?? true,
    spi: p.spi ?? 1, cpi: p.cpi ?? 1, tcpi: p.tcpi ?? 1, vac: p.vac ?? 0, bac: p.bac ?? 1000,
    schedule: { varianceDays: p.varianceDays ?? 0 },
  } as unknown as Forecast;
}

const isHealthy = (r: Predictive) => r.slip?.level === 'LOW' && r.overrun?.level === 'LOW';

describe('computePredictive (Stage B heuristic)', () => {
  it('no data → both signals null', () => {
    const r = computePredictive(fc({ hasData: false }));
    expect(r.hasData).toBe(false);
    expect(r.slip).toBeNull();
    expect(r.overrun).toBeNull();
  });

  it('on-track project scores LOW on both', () => {
    const r = computePredictive(fc({ spi: 1.0, cpi: 1.0, varianceDays: 0, vac: 0 }));
    expect(isHealthy(r)).toBe(true);
    expect(r.slip!.score).toBe(0);
    expect(r.overrun!.score).toBe(0);
    expect(r.slip!.drivers[0]).toMatch(/on schedule/i);
  });

  it('behind schedule + late forecast → HIGH slip', () => {
    const r = computePredictive(fc({ spi: 0.75, varianceDays: 25 }));
    expect(r.slip!.level).toBe('HIGH');
    expect(r.slip!.drivers.some((d) => d.includes('SPI'))).toBe(true);
    expect(r.slip!.drivers.some((d) => /25 days late/.test(d))).toBe(true);
  });

  it('poor CPI + EAC over BAC → HIGH overrun', () => {
    const r = computePredictive(fc({ cpi: 0.78, vac: -250, bac: 1000, tcpi: 1.3 }));
    expect(r.overrun!.level).toBe('HIGH');
    expect(r.overrun!.drivers.some((d) => d.includes('CPI'))).toBe(true);
    expect(r.overrun!.drivers.some((d) => d.includes('VAC'))).toBe(true);
    expect(r.overrun!.drivers.some((d) => d.includes('TCPI'))).toBe(true);
  });

  it('mild drift lands MEDIUM, not HIGH', () => {
    const r = computePredictive(fc({ spi: 0.85, cpi: 0.85, varianceDays: 3, vac: -20, bac: 1000 }));
    expect(r.slip!.level).toBe('MEDIUM');
    expect(r.overrun!.level).toBe('MEDIUM');
  });
});
