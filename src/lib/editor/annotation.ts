import { createId, nowIso } from '../../shared/ids';
import type { Annotation, AnnotationStyle, AnnotationType } from '../../shared/types/editor';
import type { Point, Rect } from '../../shared/types/primitives';

const shapeStroke = '#FF3B30';

const styles: Record<AnnotationType, AnnotationStyle> = {
  arrow: { stroke: shapeStroke, strokeWidth: 4, fill: 'none', lineCap: 'round', arrowHead: 'end', arrowHeadSize: 12 },
  line: { stroke: shapeStroke, strokeWidth: 3, fill: 'none', lineCap: 'round', arrowHead: 'none' },
  rect: { stroke: shapeStroke, strokeWidth: 3, fill: 'none', cornerRadius: 0 },
  ellipse: { stroke: shapeStroke, strokeWidth: 3, fill: 'none' },
  freehand: { stroke: shapeStroke, strokeWidth: 4, fill: 'none', lineCap: 'round' },
  text: { stroke: 'none', strokeWidth: 0, fill: '#111111', fontFamily: 'Inter', fontSizePx: 24, fontWeight: 600, textAlign: 'left', textBackground: 'none' },
  highlight: { stroke: 'none', strokeWidth: 0, fill: '#FFEB3B' },
  marker: { stroke: 'none', strokeWidth: 0, fill: shapeStroke, fontFamily: 'Inter', fontSizePx: 16, fontWeight: 600 },
  emoji: { stroke: 'none', strokeWidth: 0, fill: 'none' },
  image: { stroke: 'none', strokeWidth: 0, fill: 'none' },
  blur: { stroke: 'none', strokeWidth: 0, fill: 'none' },
  pixelate: { stroke: 'none', strokeWidth: 0, fill: 'none' },
  redact: { stroke: 'none', strokeWidth: 0, fill: '#000000' },
  crop: { stroke: '#FFFFFF', strokeWidth: 1, fill: 'none' },
};

export function defaultStyleFor(type: AnnotationType): AnnotationStyle {
  return { ...styles[type] };
}

export interface CreateAnnotationOptions {
  id?: string;
  now?: string;
  style?: Partial<AnnotationStyle>;
  from?: Point;
  to?: Point;
  number?: number;
  emoji?: string;
  text?: string;
}

/** Builds a fully-formed Annotation of `type`; variant fields fall back to the documented defaults. */
export function createAnnotation(type: AnnotationType, rect: Rect, options: CreateAnnotationOptions): Annotation {
  const base = {
    id: options.id ?? createId(),
    type,
    rect,
    rotationDeg: 0,
    opacity: 1,
    locked: false,
    visible: true,
    style: { ...defaultStyleFor(type), ...options.style },
    createdAt: options.now ?? nowIso(),
  };
  const from = options.from ?? { x: rect.x, y: rect.y };
  const to = options.to ?? { x: rect.x + rect.width, y: rect.y + rect.height };
  switch (type) {
    case 'arrow':
    case 'line':
      return { ...base, type, from, to } as Annotation;
    case 'freehand':
      return { ...base, type, points: [from, to], smoothing: 0.5 } as Annotation;
    case 'text':
      return { ...base, type, text: options.text ?? '', autoSize: true } as Annotation;
    case 'marker':
      return { ...base, type, number: options.number ?? 1, shape: 'circle' } as Annotation;
    case 'emoji':
      return { ...base, type, emoji: options.emoji ?? '\u2b50' } as Annotation;
    case 'blur':
      return { ...base, type, radiusPx: 16 } as Annotation;
    case 'pixelate':
      return { ...base, type, blockPx: 12 } as Annotation;
    case 'redact':
      return { ...base, type, color: '#000000' } as Annotation;
    default:
      return { ...base, type } as Annotation;
  }
}
