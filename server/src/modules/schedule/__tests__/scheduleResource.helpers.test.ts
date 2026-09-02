import { describe, it, expect } from 'vitest';
import {
  parseHiResources,
  mergeResourcePool,
  type RegisterResourceRow,
} from '../scheduleResource.helpers.js';

describe('parseHiResources', () => {
  it('returns [] for empty/blank/nullish input', () => {
    expect(parseHiResources('')).toEqual([]);
    expect(parseHiResources('   \n  ')).toEqual([]);
    expect(parseHiResources(null)).toEqual([]);
    expect(parseHiResources(undefined)).toEqual([]);
  });

  it('parses bullet lines, capturing a leading quantity and stripping list markers', () => {
    const out = parseHiResources('- 1 Project Manager (full-time)\n- 2 Backend engineers\n* QA Engineer\n1. DevOps');
    expect(out).toEqual([
      { label: 'Project Manager', qty: 1 },
      { label: 'Backend engineers', qty: 2 },
      { label: 'QA Engineer', qty: 1 },
      { label: 'DevOps', qty: 1 },
    ]);
  });

  it('drops a trailing parenthetical qualifier from the label', () => {
    expect(parseHiResources('- Vendor CCTV (procurement)')).toEqual([{ label: 'Vendor CCTV', qty: 1 }]);
  });

  it('supports "x3" / "3×" quantity forms and skips too-short lines', () => {
    const out = parseHiResources('x3 Testers\n3× Analysts\n-\na');
    expect(out).toEqual([
      { label: 'Testers', qty: 3 },
      { label: 'Analysts', qty: 3 },
    ]);
  });
});

const reg = (over: Partial<RegisterResourceRow> = {}): RegisterResourceRow => ({
  id: 'id-x', name: 'Someone', roleTitle: 'Engineer', capacityPerDay: 1, ...over,
});

describe('mergeResourcePool', () => {
  it('register rows come first with ids + sequential refs', () => {
    const pool = mergeResourcePool(
      [reg({ id: 'a', name: 'Andi', roleTitle: 'Backend Engineer', capacityPerDay: 1 })],
      [],
    );
    expect(pool).toEqual([
      { ref: 'r1', label: 'Andi · Backend Engineer', capacityPerDay: 1, resourceId: 'a' },
    ]);
  });

  it('narrative roles supplement only what the register does not already cover', () => {
    const pool = mergeResourcePool(
      [reg({ id: 'a', name: 'Andi', roleTitle: 'Backend Engineer', capacityPerDay: 1 })],
      [
        { label: 'Backend Engineer', qty: 2 }, // duplicate of the register role → skipped
        { label: 'QA', qty: 2 },               // new → added with capacity from qty
      ],
    );
    expect(pool).toEqual([
      { ref: 'r1', label: 'Andi · Backend Engineer', capacityPerDay: 1, resourceId: 'a' },
      { ref: 'r2', label: 'QA', capacityPerDay: 2 },
    ]);
  });

  it('clamps capacity to a sane range and defaults non-positive to 1', () => {
    const pool = mergeResourcePool(
      [reg({ id: 'a', name: 'Z', roleTitle: null, capacityPerDay: 0 })],
      [{ label: 'Huge Crew', qty: 999 }],
    );
    expect(pool[0]).toEqual({ ref: 'r1', label: 'Z', capacityPerDay: 1, resourceId: 'a' });
    expect(pool[1].capacityPerDay).toBe(50); // clamped max
  });

  it('uses name alone as the label when the register row has no roleTitle', () => {
    const pool = mergeResourcePool([reg({ id: 'a', name: 'Solo', roleTitle: null, capacityPerDay: 1 })], []);
    expect(pool[0].label).toBe('Solo');
  });
});
