export function formatIdr(value: number | string | null | undefined): string {
  const n = value == null ? 0 : Number(value);
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(n);
}

// Compact IDR for tight spaces (KPIs, cards): "Rp 2,07 M" / "Rp 506 jt" / "Rp 12 rb".
// Indonesian scale suffixes (rb=ribu, jt=juta, M=miliar, T=triliun). Pair with the
// full formatIdr() in a title attribute so the exact figure stays available on hover.
export function formatIdrShort(value: number | string | null | undefined): string {
  const n = value == null ? 0 : Number(value);
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  const units: [number, string][] = [
    [1e12, 'T'],
    [1e9, 'M'],
    [1e6, 'jt'],
    [1e3, 'rb'],
  ];
  for (const [div, suffix] of units) {
    if (abs >= div) {
      const scaled = n / div;
      const a = Math.abs(scaled);
      const frac = a >= 100 ? 0 : a >= 10 ? 1 : 2;
      return `Rp ${scaled.toLocaleString('id-ID', { maximumFractionDigits: frac })} ${suffix}`;
    }
  }
  return `Rp ${n.toLocaleString('id-ID', { maximumFractionDigits: 0 })}`;
}

export function formatNum(value: number | string | null | undefined, digits = 2): string {
  const n = value == null ? 0 : Number(value);
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(n);
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateInput(value: string | Date | null | undefined): string {
  if (!value) return '';
  const d = typeof value === 'string' ? new Date(value) : value;
  return d.toISOString().slice(0, 10);
}
