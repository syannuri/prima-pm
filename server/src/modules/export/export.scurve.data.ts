import { getProject } from '../projects/projects.service.js';
import { getProjectEvm } from '../agile/agile.service.js';
import { getProjectForecast } from '../forecast/forecast.service.js';
import { getTrend } from '../evm/evm.service.js';

// Data bundle for the S-Curve Excel export: project header + current EVM + forecast (which already
// carries the sCurve series) + captured EVM snapshots + the optional chart image (rendered client-side
// and POSTed as PNG bytes). Assembled from the same authoritative getters the Overview page uses.
export type ScurveVariant = 'progress' | 'cost' | 'combo';

export interface ScurveExport {
  project: { code: string; name: string; pm: string | null };
  statusDate: Date;
  mode: ScurveVariant;
  evm: Awaited<ReturnType<typeof getProjectEvm>>;
  forecast: Awaited<ReturnType<typeof getProjectForecast>>;
  snapshots: Awaited<ReturnType<typeof getTrend>>['snapshots'];
  chartPng: Buffer | null;
}

export async function gatherScurveExport(projectId: string, mode: ScurveVariant, statusDate: Date, chartPng: Buffer | null): Promise<ScurveExport> {
  const [project, evm, forecast, trend] = await Promise.all([
    getProject(projectId),
    getProjectEvm(projectId, undefined, statusDate),
    getProjectForecast(projectId, statusDate),
    getTrend(projectId, statusDate),
  ]);
  return {
    project: { code: project.code, name: project.name, pm: project.pm?.name ?? null },
    statusDate,
    mode,
    evm,
    forecast,
    snapshots: trend.snapshots,
    chartPng,
  };
}
