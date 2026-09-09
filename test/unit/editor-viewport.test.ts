import { describe, expect, it } from 'vitest';
import { CANVAS_MAX_AREA, CANVAS_MAX_SIDE, fitCanvasToLimits } from '../../src/lib/editor/viewport';

describe('editor viewport fitting', () => {
  it('leaves an image that already fits at its natural size', () => {
    expect(fitCanvasToLimits({ width: 1920, height: 1080 })).toEqual({ width: 1920, height: 1080, zoom: 1 });
  });

  it('scales a full-page capture taller than the canvas limit down to fit', () => {
    // A 1920x17123 capture is what a long article produces; the browser silently
    // fails to allocate a canvas past CANVAS_MAX_SIDE, leaving a blank editor.
    const fitted = fitCanvasToLimits({ width: 1920, height: 17_123 });
    expect(fitted.height).toBeLessThanOrEqual(CANVAS_MAX_SIDE);
    expect(fitted.zoom).toBeCloseTo(CANVAS_MAX_SIDE / 17_123, 5);
    expect(fitted.width).toBe(Math.round(1920 * fitted.zoom));
  });

  it('scales an image wider than the limit down to fit', () => {
    const fitted = fitCanvasToLimits({ width: 20_000, height: 800 });
    expect(fitted.width).toBeLessThanOrEqual(CANVAS_MAX_SIDE);
    expect(fitted.zoom).toBeCloseTo(CANVAS_MAX_SIDE / 20_000, 5);
  });

  it('uses the tighter of the two axes when both exceed the limit', () => {
    const fitted = fitCanvasToLimits({ width: 20_000, height: 40_000 });
    expect(fitted.width).toBeLessThanOrEqual(CANVAS_MAX_SIDE);
    expect(fitted.height).toBeLessThanOrEqual(CANVAS_MAX_SIDE);
    expect(fitted.zoom).toBeCloseTo(CANVAS_MAX_SIDE / 40_000, 5);
  });

  it('keeps the total pixel area within the browser budget', () => {
    // 16384x16384 would fit each side but blows past the ~268M pixel area cap.
    const fitted = fitCanvasToLimits({ width: 16_000, height: 16_000 });
    expect(fitted.width * fitted.height).toBeLessThanOrEqual(268_435_456);
  });

  it('never returns a zero or negative dimension for a tiny image', () => {
    const fitted = fitCanvasToLimits({ width: 1, height: 1 });
    expect(fitted.width).toBeGreaterThanOrEqual(1);
    expect(fitted.height).toBeGreaterThanOrEqual(1);
  });

  it('never scales up, only down', () => {
    expect(fitCanvasToLimits({ width: 100, height: 100 }).zoom).toBe(1);
  });

  it('accepts an explicit limit so callers can honour a probed device maximum', () => {
    const fitted = fitCanvasToLimits({ width: 8000, height: 8000 }, { maxSide: 4000 });
    expect(fitted.height).toBeLessThanOrEqual(4000);
    expect(fitted.zoom).toBeCloseTo(0.5, 5);
  });

  it('leaves room for the retina backing store when a scale factor is applied', () => {
    // Fabric allocates width * devicePixelRatio internally, so a canvas that
    // just fits at ratio 1 overflows the browser limit at ratio 2. Passing the
    // divided limits keeps the real allocation inside the cap.
    const fitted = fitCanvasToLimits({ width: 1920, height: 17_123 }, { maxSide: CANVAS_MAX_SIDE / 2, maxArea: CANVAS_MAX_AREA / 4 });
    expect(fitted.height * 2).toBeLessThanOrEqual(CANVAS_MAX_SIDE);
    expect(fitted.width * 2 * fitted.height * 2).toBeLessThanOrEqual(CANVAS_MAX_AREA);
  });
});
