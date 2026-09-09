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

export interface FitToViewportOptions {
  /** Never enlarge past this; a small capture should not fill a wide stage. */
  maxZoom?: number;
  minZoom?: number;
}

/**
 * Zoom that shows the whole capture inside the visible stage.
 *
 * The editor opens on the image at its natural size, so a 1,920px capture in a
 * ~1,100px stage arrives already cropped and cannot be zoomed out. This picks
 * the scale that fits the width and height, and never enlarges past 1 so a
 * small capture stays sharp.
 */
export function fitZoomToViewport(image: Size, viewport: Size, { maxZoom = 1, minZoom = 0.05 }: FitToViewportOptions = {}): number {
  if (image.width <= 0 || image.height <= 0 || viewport.width <= 0 || viewport.height <= 0) return maxZoom;
  const zoom = Math.min(viewport.width / image.width, viewport.height / image.height);
  return Math.min(maxZoom, Math.max(minZoom, zoom));
}

/**
 * Zoom the editor should open a capture at.
 *
 * Fitting a full-page capture by height alone lands around 6%, where the image
 * is a thumbnail and a stroke is thinner than a pixel. A full-page screenshot
 * is read by scrolling, so the width is what has to fit; the height is allowed
 * to overflow into the stage's scroll.
 */
export function initialZoomFor(image: Size, viewport: Size, { maxZoom = 1, minZoom = MIN_WORKABLE_ZOOM }: FitToViewportOptions = {}): number {
  if (image.width <= 0 || viewport.width <= 0) return maxZoom;
  const byWidth = viewport.width / image.width;
  const fitted = fitZoomToViewport(image, viewport, { maxZoom, minZoom: 0 });
  // Prefer showing the whole capture, but never below the point where editing
  // stops being practical; fall back to fitting the width alone.
  const zoom = fitted >= minZoom ? fitted : byWidth;
  return Math.min(maxZoom, Math.max(minZoom, zoom));
}

/** Below this the capture is a thumbnail and annotations are sub-pixel. */
export const MIN_WORKABLE_ZOOM = 0.25;

/** Clamps a user-chosen zoom to the range the editor's controls allow. */
export function clampZoom(zoom: number, { minZoom = 0.05, maxZoom = 4 }: FitToViewportOptions = {}): number {
  if (!Number.isFinite(zoom)) return minZoom;
  return Math.min(maxZoom, Math.max(minZoom, zoom));
}
