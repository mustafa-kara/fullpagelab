import { describe, expect, it } from 'vitest';
import { constrainRect, normalizeRect, padRect, scaledRect } from '../../src/lib/editor/geometry';

describe('editor geometry', () => {
  it('normalizes a rectangle dragged up and to the left', () => {
    expect(normalizeRect({ x: 100, y: 80 }, { x: 40, y: 20 })).toEqual({ x: 40, y: 20, width: 60, height: 60 });
  });

  it('keeps a zero-size drag at a minimum of one pixel', () => {
    expect(normalizeRect({ x: 10, y: 10 }, { x: 10, y: 10 })).toEqual({ x: 10, y: 10, width: 1, height: 1 });
  });

  it('locks the aspect ratio to a square when shift is held', () => {
    expect(constrainRect({ x: 0, y: 0, width: 80, height: 30 }, { lockAspect: true })).toEqual({ x: 0, y: 0, width: 80, height: 80 });
  });

  it('grows from the center when alt is held', () => {
    expect(constrainRect({ x: 50, y: 50, width: 20, height: 10 }, { fromCenter: true })).toEqual({ x: 30, y: 40, width: 40, height: 20 });
  });

  it('pads a rectangle for hit testing without going negative', () => {
    expect(padRect({ x: 2, y: 2, width: 10, height: 10 }, 6)).toEqual({ x: 0, y: 0, width: 18, height: 18 });
  });
});

describe('scaledRect', () => {
  it('reports the size a resized object actually occupies', () => {
    // Fabric records a resize in scaleX/scaleY and leaves width/height alone,
    // so reading the raw dimensions reports the original size.
    expect(scaledRect({ left: 10, top: 20, width: 100, height: 50, scaleX: 2, scaleY: 3 })).toEqual({ x: 10, y: 20, width: 200, height: 150 });
  });

  it('treats a missing scale as 1', () => {
    expect(scaledRect({ left: 0, top: 0, width: 40, height: 25 })).toEqual({ x: 0, y: 0, width: 40, height: 25 });
  });

  it('reports a positive size for a mirrored object', () => {
    expect(scaledRect({ left: 5, top: 5, width: 30, height: 30, scaleX: -2, scaleY: 1 })).toEqual({ x: 5, y: 5, width: 60, height: 30 });
  });
});
