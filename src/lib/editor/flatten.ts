import type { Annotation } from '../../shared/types/editor';
import type { Rect } from '../../shared/types/primitives';

/** The subset of CanvasRenderingContext2D the flatten pass uses. */
export interface FlattenContext {
  globalAlpha: number;
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  lineCap: CanvasLineCap;
  font: string;
  textAlign: CanvasTextAlign;
  save(): void;
  restore(): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  fill(): void;
  fillRect(x: number, y: number, width: number, height: number): void;
  strokeRect(x: number, y: number, width: number, height: number): void;
  ellipse(x: number, y: number, radiusX: number, radiusY: number, rotation: number, start: number, end: number): void;
  fillText(text: string, x: number, y: number): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
}

function centerOf(rect: Rect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function applyTransform(context: FlattenContext, annotation: Annotation): void {
  if (!annotation.rotationDeg) return;
  const center = centerOf(annotation.rect);
  context.translate(center.x, center.y);
  context.rotate((annotation.rotationDeg * Math.PI) / 180);
  context.translate(-center.x, -center.y);
}

function drawArrowHead(context: FlattenContext, from: { x: number; y: number }, to: { x: number; y: number }, size: number): void {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const spread = Math.PI / 7;
  context.beginPath();
  context.moveTo(to.x, to.y);
  context.lineTo(to.x - size * Math.cos(angle - spread), to.y - size * Math.sin(angle - spread));
  context.lineTo(to.x - size * Math.cos(angle + spread), to.y - size * Math.sin(angle + spread));
  context.closePath();
  context.fill();
}

function drawOne(context: FlattenContext, annotation: Annotation): void {
  const { rect, style } = annotation;
  context.strokeStyle = style.stroke;
  context.lineWidth = style.strokeWidth;
  context.lineCap = style.lineCap ?? 'butt';
  if (style.fill !== 'none') context.fillStyle = style.fill;

  switch (annotation.type) {
    case 'redact':
      // Privacy guarantee: redaction is always fully opaque, whatever the layer opacity says.
      context.globalAlpha = 1;
      context.fillStyle = annotation.color;
      context.fillRect(rect.x, rect.y, rect.width, rect.height);
      return;
    case 'highlight':
      context.fillRect(rect.x, rect.y, rect.width, rect.height);
      return;
    case 'rect':
      if (style.fill !== 'none') context.fillRect(rect.x, rect.y, rect.width, rect.height);
      context.strokeRect(rect.x, rect.y, rect.width, rect.height);
      return;
    case 'ellipse': {
      const center = centerOf(rect);
      context.beginPath();
      context.ellipse(center.x, center.y, rect.width / 2, rect.height / 2, 0, 0, Math.PI * 2);
      if (style.fill !== 'none') context.fill();
      context.stroke();
      return;
    }
    case 'line':
    case 'arrow':
      context.beginPath();
      context.moveTo(annotation.from.x, annotation.from.y);
      context.lineTo(annotation.to.x, annotation.to.y);
      context.stroke();
      if (annotation.type === 'arrow' && style.arrowHead !== 'none') {
        context.fillStyle = style.stroke;
        drawArrowHead(context, annotation.from, annotation.to, style.arrowHeadSize ?? style.strokeWidth * 3);
      }
      return;
    case 'freehand': {
      const [first, ...rest] = annotation.points;
      if (!first) return;
      context.beginPath();
      context.moveTo(first.x, first.y);
      for (const point of rest) context.lineTo(point.x, point.y);
      context.stroke();
      return;
    }
    case 'text':
      context.fillStyle = style.fill === 'none' ? '#111111' : style.fill;
      context.font = `${style.fontWeight ?? 400} ${style.fontSizePx ?? 24}px ${style.fontFamily ?? 'Inter'}`;
      context.textAlign = style.textAlign ?? 'left';
      context.fillText(annotation.text, rect.x, rect.y + (style.fontSizePx ?? 24));
      return;
    case 'marker': {
      const center = centerOf(rect);
      context.fillStyle = style.fill === 'none' ? '#FF3B30' : style.fill;
      context.beginPath();
      context.ellipse(center.x, center.y, rect.width / 2, rect.height / 2, 0, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = '#FFFFFF';
      context.font = `${style.fontWeight ?? 600} ${style.fontSizePx ?? 16}px ${style.fontFamily ?? 'Inter'}`;
      context.textAlign = 'center';
      context.fillText(String(annotation.number), center.x, center.y + (style.fontSizePx ?? 16) / 3);
      return;
    }
    default:
      return;
  }
}

/**
 * Draws every visible annotation onto `context` in array order. Blur and pixelate
 * are handled by the caller because they need to sample the base image first.
 */
export function drawAnnotations(context: FlattenContext, layers: readonly Annotation[]): void {
  for (const annotation of layers) {
    if (!annotation.visible) continue;
    context.save();
    context.globalAlpha = annotation.opacity;
    applyTransform(context, annotation);
    drawOne(context, annotation);
    context.restore();
  }
}
