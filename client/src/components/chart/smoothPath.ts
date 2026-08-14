// Monotone cubic interpolation (Fritsch–Carlson) → an SVG path that renders the S-curves as
// genuine smooth curves instead of jagged straight segments, WITHOUT the overshoot a naive
// Catmull-Rom spline would introduce. Overshoot matters here: an EV/AC/cost curve must never
// bulge above or dip below the real data points, or the chart would imply progress/cost that
// never happened. Points must be sorted by x ascending.

export type Pt = { x: number; y: number };

export function smoothPath(points: Pt[]): string {
  const n = points.length;
  if (n === 0) return '';
  const M = (p: Pt) => `M${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  if (n === 1) return M(points[0]);
  if (n === 2) return `${M(points[0])} L${points[1].x.toFixed(1)},${points[1].y.toFixed(1)}`;

  // Secant slopes between successive points.
  const dx: number[] = [], dy: number[] = [], m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = points[i + 1].x - points[i].x || 1e-6;
    dy[i] = points[i + 1].y - points[i].y;
    m[i] = dy[i] / dx[i];
  }
  // Tangents at each point: average of adjacent secants, flattened at local extrema.
  const t: number[] = new Array(n);
  t[0] = m[0];
  t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  // Fritsch–Carlson monotonicity clamp so segments never overshoot the data.
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      t[i] = tau * a * m[i];
      t[i + 1] = tau * b * m[i];
    }
  }
  // Emit cubic Bézier segments from the Hermite tangents.
  let d = M(points[0]);
  for (let i = 0; i < n - 1; i++) {
    const c1x = points[i].x + dx[i] / 3, c1y = points[i].y + (t[i] * dx[i]) / 3;
    const c2x = points[i + 1].x - dx[i] / 3, c2y = points[i + 1].y - (t[i + 1] * dx[i]) / 3;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${points[i + 1].x.toFixed(1)},${points[i + 1].y.toFixed(1)}`;
  }
  return d;
}

// Close a smoothed top edge down to a baseline y and back → an area-fill path under the curve.
export function areaPath(points: Pt[], baselineY: number): string {
  if (points.length < 2) return '';
  return `${smoothPath(points)} L${points[points.length - 1].x.toFixed(1)},${baselineY.toFixed(1)} L${points[0].x.toFixed(1)},${baselineY.toFixed(1)} Z`;
}
