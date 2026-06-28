// =====================================================================
// Money utilities (IDR). Stored as Decimal(18,2) in DB; here we operate
// on JS numbers but ALWAYS round at boundaries to avoid float drift.
// Rounding: half-up to 2 decimals (banker's rounding intentionally NOT
// used — financial reports here expect arithmetic half-up).
// =====================================================================

export function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  // Scale, nudge against binary FP error, round half-up, unscale.
  const scaled = value * 100;
  const rounded = Math.round(scaled + (scaled >= 0 ? Number.EPSILON : -Number.EPSILON) * 100);
  return rounded / 100;
}

// Sum a list of money values with rounding applied to the result.
export function sumMoney(values: number[]): number {
  return round2(values.reduce((acc, v) => acc + (Number.isFinite(v) ? v : 0), 0));
}

// Safe percentage (0..1) multiply used for EMV / progress weighting.
export function pct(part: number, whole: number): number {
  if (!whole) return 0;
  return part / whole;
}

// Format helper for logs/exports (UI does its own Intl formatting).
export function formatIdr(value: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 2,
  }).format(round2(value));
}
