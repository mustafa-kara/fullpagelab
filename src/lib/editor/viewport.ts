import type { Size } from '../../shared/types/primitives';

/** Chromium refuses to allocate a canvas with a side longer than this. */
export const CANVAS_MAX_SIDE = 16_384;

/** …and rejects anything past this total area even when both sides fit. */
export const CANVAS_MAX_AREA = 268_435_456;

export interface FittedCanvas extends Size {
  /** Scale applied to the source image; 1 means it was used at natural size. */
  zoom: number;
}

export interface FitOptions {
  maxSide?: number;
  maxArea?: number;
}

/**
 * Picks canvas dimensions that stay inside the browser's limits.
 *
 * A full-page capture is routinely taller than `CANVAS_MAX_SIDE` — a long
 * article easily reaches 17,000 px. Allocating a canvas that size silently
 * yields a blank surface, so the editor must render the image scaled down and
 * let the caller apply `zoom` to keep annotation coordinates in image space.
 */
export function fitCanvasToLimits(image: Size, { maxSide = CANVAS_MAX_SIDE, maxArea = CANVAS_MAX_AREA }: FitOptions = {}): FittedCanvas {
  const width = Math.max(1, image.width);
  const height = Math.max(1, image.height);
  const sideZoom = Math.min(1, maxSide / width, maxSide / height);
  const areaZoom = Math.min(1, Math.sqrt(maxArea / (width * height)));
  const zoom = Math.min(sideZoom, areaZoom);
  return {
    width: Math.max(1, Math.floor(width * zoom)),
    height: Math.max(1, Math.floor(height * zoom)),
    zoom,
  };
}
