import { describe, it, expect } from 'vitest';
import { smoothPath, areaPath, type Pt } from './smoothPath';

// Parse a smoothPath string into cubic Bézier segments so we can sample the curve and assert
// properties (endpoint interpolation, no overshoot) rather than just string-match.
function segments(d: string): { p0: Pt; c1: Pt; c2: Pt; p1: Pt }[] {
  const nums = (s: string) => s.trim().split(/[ ,]+/).map(Number);
  const [mx, my] = nums(d.slice(1, d.indexOf('C') === -1 ? undefined : d.indexOf('C')));
  let cur: Pt = { x: mx, y: my };
  const segs: { p0: Pt; c1: Pt; c2: Pt; p1: Pt }[] = [];
  const re = /C([-\d.,\s]+?)(?=C|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) {
    const [c1x, c1y, c2x, c2y, x, y] = nums(m[1]);
    segs.push({ p0: cur, c1: { x: c1x, y: c1y }, c2: { x: c2x, y: c2y }, p1: { x, y } });
    cur = { x, y };
  }
  return segs;
}
const bez = (a: number, b: number, c: number, e: number, t: number) => {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * e;
};

describe('smoothPath', () => {
  it('handles degenerate inputs', () => {
    expect(smoothPath([])).toBe('');
    expect(smoothPath([{ x: 1, y: 2 }])).toBe('M1.0,2.0');
    expect(smoothPath([{ x: 0, y: 0 }, { x: 10, y: 5 }])).toBe('M0.0,0.0 L10.0,5.0');
  });

  it('interpolates every data point (curve passes exactly through them)', () => {
    const pts: Pt[] = [{ x: 0, y: 0 }, { x: 10, y: 3 }, { x: 20, y: 9 }, { x: 30, y: 12 }];
    const d = smoothPath(pts);
    expect(d.startsWith('M0.0,0.0')).toBe(true);
    const segs = segments(d);
    expect(segs).toHaveLength(pts.length - 1);
    // each segment's endpoint is the next data point
    segs.forEach((s, i) => {
      expect(s.p1.x).toBeCloseTo(pts[i + 1].x, 1);
      expect(s.p1.y).toBeCloseTo(pts[i + 1].y, 1);
    });
  });

  it('never overshoots monotone data (Fritsch–Carlson)', () => {
    // strictly increasing y — a smoothed cost/EV curve must not dip below or bulge above
    const pts: Pt[] = [0, 2, 5, 5, 20, 40, 58, 70, 100].map((v, i) => ({ x: i * 12, y: v }));
    const segs = segments(smoothPath(pts));
    segs.forEach((s, i) => {
      const lo = Math.min(pts[i].y, pts[i + 1].y) - 1e-6;
      const hi = Math.max(pts[i].y, pts[i + 1].y) + 1e-6;
      for (let t = 0; t <= 1; t += 0.05) {
        const y = bez(s.p0.y, s.c1.y, s.c2.y, s.p1.y, t);
        expect(y).toBeGreaterThanOrEqual(lo);
        expect(y).toBeLessThanOrEqual(hi);
      }
    });
  });
});

describe('areaPath', () => {
  it('closes a smoothed top down to the baseline', () => {
    const pts: Pt[] = [{ x: 0, y: 8 }, { x: 10, y: 4 }, { x: 20, y: 2 }];
    const d = areaPath(pts, 100);
    expect(d.startsWith('M0.0,8.0')).toBe(true);
    expect(d).toContain('L20.0,100.0'); // down to baseline at last x
    expect(d).toContain('L0.0,100.0');  // back along baseline to first x
    expect(d.trimEnd().endsWith('Z')).toBe(true);
  });
  it('returns empty for < 2 points', () => {
    expect(areaPath([{ x: 1, y: 1 }], 10)).toBe('');
  });
});
