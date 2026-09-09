import type { Point } from '../../shared/types/primitives';

export interface ArrowHeadGeometry {
  /** Corner points of the head triangle, in image coordinates. */
  points: [Point, Point, Point];
  /** Where the shaft should stop so it does not poke through the head. */
  shaftEnd: Point;
}

/**
 * Triangle for the head of an arrow, plus the shortened shaft end.
 *
 * Fabric has no arrow primitive, so an arrow is a line drawn to `shaftEnd` with
 * this triangle grouped on top. Keeping the maths here means the shape is
 * covered by unit tests rather than only by a browser run.
 */
export function arrowHeadGeometry(from: Point, to: Point, size: number): ArrowHeadGeometry {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  // A zero-length drag has no direction to point in; treat it as pointing right
  // so the caller still gets a well-formed triangle instead of NaN coordinates.
  const ux = length === 0 ? 1 : dx / length;
  const uy = length === 0 ? 0 : dy / length;
  const head = Math.max(1, Math.min(size, length === 0 ? size : length));
  const baseX = to.x - ux * head;
  const baseY = to.y - uy * head;
  const halfWidth = head / 2;
  return {
    points: [
      { x: to.x, y: to.y },
      { x: baseX - uy * halfWidth, y: baseY + ux * halfWidth },
      { x: baseX + uy * halfWidth, y: baseY - ux * halfWidth },
    ],
    shaftEnd: { x: baseX, y: baseY },
  };
}

/** Angle of the segment in degrees, measured clockwise from the positive x axis. */
export function angleDegrees(from: Point, to: Point): number {
  return Math.atan2(to.y - from.y, to.x - from.x) * (180 / Math.PI);
}
