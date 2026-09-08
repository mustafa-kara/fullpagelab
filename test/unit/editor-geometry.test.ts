import { describe, expect, it } from 'vitest';
import { constrainRect, normalizeRect, padRect } from '../../src/lib/editor/geometry';

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
