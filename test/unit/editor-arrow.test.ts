import { describe, expect, it } from 'vitest';
import { angleDegrees, arrowHeadGeometry } from '../../src/lib/editor/arrow';

describe('arrowHeadGeometry', () => {
  it('points the head at the drag end', () => {
    const { points } = arrowHeadGeometry({ x: 0, y: 0 }, { x: 100, y: 0 }, 20);
    expect(points[0]).toEqual({ x: 100, y: 0 });
  });

  it('stops the shaft short so it does not poke through the head', () => {
    const { shaftEnd } = arrowHeadGeometry({ x: 0, y: 0 }, { x: 100, y: 0 }, 20);
    expect(shaftEnd.x).toBeCloseTo(80, 5);
    expect(shaftEnd.y).toBeCloseTo(0, 5);
  });

  it('spreads the base corners across the arrow, perpendicular to it', () => {
    const { points } = arrowHeadGeometry({ x: 0, y: 0 }, { x: 100, y: 0 }, 20);
    expect(points[1].y).toBeCloseTo(10, 5);
    expect(points[2].y).toBeCloseTo(-10, 5);
  });

  it('follows a diagonal drag', () => {
    const { points, shaftEnd } = arrowHeadGeometry({ x: 0, y: 0 }, { x: 30, y: 40 }, 10);
    expect(points[0]).toEqual({ x: 30, y: 40 });
    expect(Math.hypot(30 - shaftEnd.x, 40 - shaftEnd.y)).toBeCloseTo(10, 5);
  });

  it('never makes a head longer than the arrow itself', () => {
    const { shaftEnd } = arrowHeadGeometry({ x: 0, y: 0 }, { x: 6, y: 0 }, 40);
    expect(shaftEnd.x).toBeGreaterThanOrEqual(0);
  });

  it('produces finite points for a zero-length drag', () => {
    const { points, shaftEnd } = arrowHeadGeometry({ x: 5, y: 5 }, { x: 5, y: 5 }, 12);
    for (const point of [...points, shaftEnd]) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
    }
  });
});

describe('angleDegrees', () => {
  it('reports 0 for a rightward segment and 90 for a downward one', () => {
    expect(angleDegrees({ x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(0, 5);
    expect(angleDegrees({ x: 0, y: 0 }, { x: 0, y: 10 })).toBeCloseTo(90, 5);
  });

  it('reports a negative angle for an upward segment', () => {
    expect(angleDegrees({ x: 0, y: 0 }, { x: 0, y: -10 })).toBeCloseTo(-90, 5);
  });
});
