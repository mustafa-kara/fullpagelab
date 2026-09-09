import type { Point, Rect } from '../../shared/types/primitives';

export interface RectConstraints { lockAspect?: boolean; fromCenter?: boolean }

/** Builds a positive-size rect from two drag points, regardless of drag direction. */
export function normalizeRect(start: Point, end: Point): Rect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.max(1, Math.abs(end.x - start.x)),
    height: Math.max(1, Math.abs(end.y - start.y)),
  };
}

export function constrainRect(rect: Rect, { lockAspect = false, fromCenter = false }: RectConstraints): Rect {
  let { x, y, width, height } = rect;
  if (lockAspect) {
    const side = Math.max(width, height);
    width = side;
    height = side;
  }
  if (fromCenter) {
    width *= 2;
    height *= 2;
    x -= width / 2;
    y -= height / 2;
  }
  return { x, y, width, height };
}

/** Expands a rect by `padding` on every side, clamped so it never starts before the origin. */
export function padRect(rect: Rect, padding: number): Rect {
  const x = Math.max(0, rect.x - padding);
  const y = Math.max(0, rect.y - padding);
  return {
    x,
    y,
    width: rect.width + (rect.x - x) + padding,
    height: rect.height + (rect.y - y) + padding,
  };
}

export interface ObjectBounds {
  left: number;
  top: number;
  width: number;
  height: number;
  scaleX?: number;
  scaleY?: number;
}

/**
 * Rect an object occupies after its scale is applied.
 *
 * Fabric keeps a resize in `scaleX`/`scaleY` rather than changing `width` and
 * `height`, so reading those alone reports the size the object was created at
 * and every model update after a resize would be wrong.
 */
export function scaledRect(object: ObjectBounds): Rect {
  return {
    x: object.left,
    y: object.top,
    width: Math.abs(object.width * (object.scaleX ?? 1)),
    height: Math.abs(object.height * (object.scaleY ?? 1)),
  };
}
