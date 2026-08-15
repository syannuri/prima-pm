// Tiny CSV helper — no dependency. `toCsv` is pure (unit-tested); `downloadCsv` triggers a browser
// download with a UTF-8 BOM so Excel opens non-ASCII correctly.
export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined): string => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
