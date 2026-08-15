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

// Group a raw digit string as IDR for display *inside a text input* ("Rp 1.500.000").
// Returns '' for empty so placeholders still show. Pair with a digits-only onChange
// (`e.target.value.replace(/\D/g, '')`) so the stored value stays Number()-parseable.
export function formatIdrInput(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  return `Rp ${Number(digits).toLocaleString('id-ID')}`;
}

export function formatNum(value: number | string | null | undefined, digits = 2): string {
  const n = value == null ? 0 : Number(value);
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(n);
}

// Human-readable byte size: 0 → "0 B", 1536 → "1.5 KB", up to TB. Compact (≤1 decimal).
export function formatBytes(bytes: number | null | undefined): string {
  const n = bytes == null ? 0 : Number(bytes);
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

// Compact relative time: "just now", "5m ago", "3h ago", "2d ago"; falls back to a date past ~7d.
export function timeAgo(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 45) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days <= 7) return `${days}d ago`;
  return formatDate(d);
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatDateInput(value: string | Date | null | undefined): string {
  if (!value) return '';
  const d = typeof value === 'string' ? new Date(value) : value;
  return d.toISOString().slice(0, 10);
}
