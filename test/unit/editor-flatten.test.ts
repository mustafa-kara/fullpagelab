import { describe, expect, it, vi } from 'vitest';
import { createAnnotation } from '../../src/lib/editor/annotation';
import { drawAnnotations, type FlattenContext } from '../../src/lib/editor/flatten';

function fakeContext() {
  const calls: string[] = [];
  const context = {
    calls,
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    lineCap: 'butt',
    font: '',
    textAlign: 'left',
    filter: 'none',
    imageSmoothingEnabled: true,
    save: () => calls.push('save'),
    restore: () => calls.push('restore'),
    beginPath: () => calls.push('beginPath'),
    closePath: () => calls.push('closePath'),
    moveTo: () => calls.push('moveTo'),
    lineTo: () => calls.push('lineTo'),
    stroke: () => calls.push('stroke'),
    fill: () => calls.push('fill'),
    fillRect: (...args: number[]) => calls.push(`fillRect:${args.join(',')}`),
    strokeRect: () => calls.push('strokeRect'),
    ellipse: () => calls.push('ellipse'),
    fillText: () => calls.push('fillText'),
    translate: () => calls.push('translate'),
    rotate: () => calls.push('rotate'),
    drawImage: () => calls.push('drawImage'),
  };
  return context as unknown as FlattenContext & { calls: string[] };
}

const rect = { x: 10, y: 20, width: 100, height: 50 };

describe('flatten renderer', () => {
  it('paints redaction fully opaque even when the annotation is translucent', () => {
    const context = fakeContext();
    const redact = { ...createAnnotation('redact', rect, { id: 'r1' }), opacity: 0.1 };
    drawAnnotations(context, [redact]);
    expect(context.calls).toContain('fillRect:10,20,100,50');
    expect(context.globalAlpha).toBe(1);
  });

  it('draws a rectangle outline', () => {
    const context = fakeContext();
    drawAnnotations(context, [createAnnotation('rect', rect, { id: 'a1' })]);
    expect(context.calls).toContain('strokeRect');
  });

  it('fills a highlight rather than stroking it', () => {
    const context = fakeContext();
    drawAnnotations(context, [createAnnotation('highlight', rect, { id: 'h1' })]);
    expect(context.calls).toContain('fillRect:10,20,100,50');
  });

  it('draws an ellipse for ellipse annotations', () => {
    const context = fakeContext();
    drawAnnotations(context, [createAnnotation('ellipse', rect, { id: 'e1' })]);
    expect(context.calls).toContain('ellipse');
  });

  it('strokes a line between the endpoints of a line annotation', () => {
    const context = fakeContext();
    drawAnnotations(context, [createAnnotation('line', rect, { id: 'l1' })]);
    expect(context.calls.filter((call) => call === 'lineTo').length).toBeGreaterThan(0);
    expect(context.calls).toContain('stroke');
  });

  it('draws an arrow head in addition to the shaft', () => {
    const context = fakeContext();
    drawAnnotations(context, [createAnnotation('arrow', rect, { id: 'a2' })]);
    expect(context.calls).toContain('fill');
  });

  it('draws freehand paths through every collected point', () => {
    const context = fakeContext();
    const freehand = createAnnotation('freehand', rect, { id: 'f1' });
    drawAnnotations(context, [{ ...freehand, type: 'freehand', points: [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 9, y: 2 }] } as typeof freehand]);
    expect(context.calls.filter((call) => call === 'lineTo')).toHaveLength(2);
  });

  it('renders text annotations', () => {
    const context = fakeContext();
    const text = createAnnotation('text', rect, { id: 't1', text: 'Merhaba' });
    drawAnnotations(context, [text]);
    expect(context.calls).toContain('fillText');
  });

  it('skips annotations that are hidden', () => {
    const context = fakeContext();
    drawAnnotations(context, [{ ...createAnnotation('rect', rect, { id: 'a3' }), visible: false }]);
    expect(context.calls).not.toContain('strokeRect');
  });

  it('draws layers in array order so later layers land on top', () => {
    const context = fakeContext();
    drawAnnotations(context, [createAnnotation('highlight', rect, { id: 'h2' }), createAnnotation('redact', rect, { id: 'r2' })]);
    expect(context.calls.filter((call) => call.startsWith('fillRect'))).toHaveLength(2);
  });

  it('restores the context state for every annotation it draws', () => {
    const context = fakeContext();
    drawAnnotations(context, [createAnnotation('rect', rect, { id: 'a4' }), createAnnotation('ellipse', rect, { id: 'e2' })]);
    expect(context.calls.filter((call) => call === 'save')).toHaveLength(2);
    expect(context.calls.filter((call) => call === 'restore')).toHaveLength(2);
  });

  it('applies rotation around the annotation center when set', () => {
    const context = fakeContext();
    drawAnnotations(context, [{ ...createAnnotation('rect', rect, { id: 'a5' }), rotationDeg: 45 }]);
    expect(context.calls).toContain('rotate');
  });

  it('draws a numbered marker badge with its label', () => {
    const context = fakeContext();
    drawAnnotations(context, [createAnnotation('marker', rect, { id: 'm1', number: 3 })]);
    expect(context.calls).toContain('ellipse');
    expect(context.calls).toContain('fillText');
  });

  it('falls back to the default marker colours when the style has no fill', () => {
    const context = fakeContext();
    const marker = createAnnotation('marker', rect, { id: 'm2', number: 1, style: { fill: 'none', fontWeight: undefined, fontSizePx: undefined, fontFamily: undefined } });
    drawAnnotations(context, [marker]);
    expect(context.calls).toContain('fillText');
  });

  it('falls back to the default text style when the style omits font fields', () => {
    const context = fakeContext();
    const text = createAnnotation('text', rect, { id: 't2', text: 'x', style: { fill: 'none', fontWeight: undefined, fontSizePx: undefined, fontFamily: undefined, textAlign: undefined } });
    drawAnnotations(context, [text]);
    expect(context.calls).toContain('fillText');
  });

  it('fills a rectangle as well as stroking it when the style has a fill', () => {
    const context = fakeContext();
    drawAnnotations(context, [createAnnotation('rect', rect, { id: 'a6', style: { fill: '#00FF00' } })]);
    expect(context.calls).toContain('fillRect:10,20,100,50');
    expect(context.calls).toContain('strokeRect');
  });

  it('fills an ellipse as well as stroking it when the style has a fill', () => {
    const context = fakeContext();
    drawAnnotations(context, [createAnnotation('ellipse', rect, { id: 'e3', style: { fill: '#00FF00' } })]);
    expect(context.calls).toContain('fill');
    expect(context.calls).toContain('stroke');
  });

  it('omits the arrow head when the style disables it', () => {
    const context = fakeContext();
    drawAnnotations(context, [createAnnotation('arrow', rect, { id: 'a7', style: { arrowHead: 'none' } })]);
    expect(context.calls).not.toContain('fill');
  });

  it('sizes the arrow head from the stroke width when no explicit size is set', () => {
    const context = fakeContext();
    drawAnnotations(context, [createAnnotation('arrow', rect, { id: 'a8', style: { arrowHeadSize: undefined } })]);
    expect(context.calls).toContain('fill');
  });

  it('draws nothing for a freehand annotation with no points', () => {
    const context = fakeContext();
    const freehand = createAnnotation('freehand', rect, { id: 'f2' });
    drawAnnotations(context, [{ ...freehand, type: 'freehand', points: [] } as typeof freehand]);
    expect(context.calls).not.toContain('beginPath');
  });

  it('skips annotation types the flatten pass does not paint itself', () => {
    const context = fakeContext();
    drawAnnotations(context, [
      createAnnotation('blur', rect, { id: 'b1' }),
      createAnnotation('pixelate', rect, { id: 'p1' }),
      createAnnotation('emoji', rect, { id: 'em1' }),
      createAnnotation('crop', rect, { id: 'c1' }),
    ]);
    expect(context.calls.filter((call) => call === 'save')).toHaveLength(4);
    expect(context.calls).not.toContain('fillText');
    expect(context.calls).not.toContain('strokeRect');
  });

  it('defaults the line cap when the style omits it', () => {
    const context = fakeContext();
    drawAnnotations(context, [createAnnotation('rect', rect, { id: 'a9', style: { lineCap: undefined } })]);
    expect(context.calls).toContain('strokeRect');
  });
});
