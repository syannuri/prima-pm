import type { PortfolioHealth } from '../api/types';

// Single source of truth for the RAG (Red / Amber / Green) visual language. Every gauge, chip,
// pie and chart should read colours from here so the whole app's status system is ONE designed
// family. Each status also carries a distinct SHAPE so status is never conveyed by colour alone —
// ~8% of men can't reliably tell red/amber/green apart (see RagGlyph).
export type RagShape = 'circle' | 'diamond' | 'triangle' | 'ring';

export const RAG: Record<PortfolioHealth, { solid: string; text: string; grad: [string, string]; label: string; shape: RagShape }> = {
  GREEN:   { solid: '#22c55e', text: '#16a34a', grad: ['#15803d', '#4ade80'], label: 'On track', shape: 'circle' },
  AMBER:   { solid: '#f59e0b', text: '#d97706', grad: ['#b45309', '#fbbf24'], label: 'At risk',  shape: 'diamond' },
  RED:     { solid: '#ef4444', text: '#dc2626', grad: ['#b91c1c', '#fb7185'], label: 'Behind',    shape: 'triangle' },
  NO_DATA: { solid: '#94a3b8', text: '#64748b', grad: ['#94a3b8', '#cbd5e1'], label: 'No data',   shape: 'ring' },
};
