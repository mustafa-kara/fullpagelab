import { describe, expect, it } from 'vitest';
import { ANNOTATION_STROKE, createAnnotation, defaultStyleFor } from '../../src/lib/editor/annotation';

const rect = { x: 10, y: 20, width: 100, height: 50 };

describe('annotation factory', () => {
  it('gives every annotation an id, timestamp and visible/unlocked defaults', () => {
    const annotation = createAnnotation('rect', rect, { id: 'a1', now: '2026-09-08T00:00:00.000Z' });
    expect(annotation).toMatchObject({ id: 'a1', type: 'rect', rect, visible: true, locked: false, opacity: 1, rotationDeg: 0, createdAt: '2026-09-08T00:00:00.000Z' });
  });

  it('uses the red stroke and width 3 for rectangles', () => {
    expect(defaultStyleFor('rect')).toMatchObject({ stroke: ANNOTATION_STROKE, strokeWidth: 3, fill: 'none' });
  });

  it('uses a thicker stroke and an end arrow head for arrows', () => {
    expect(defaultStyleFor('arrow')).toMatchObject({ stroke: ANNOTATION_STROKE, strokeWidth: 4, arrowHead: 'end' });
  });

  it('makes highlights a translucent yellow fill', () => {
    expect(defaultStyleFor('highlight')).toMatchObject({ fill: '#FFEB3B' });
  });

  it('stores the drag endpoints on arrows and lines', () => {
    const arrow = createAnnotation('arrow', rect, { id: 'a2', from: { x: 10, y: 20 }, to: { x: 110, y: 70 } });
    expect(arrow).toMatchObject({ type: 'arrow', from: { x: 10, y: 20 }, to: { x: 110, y: 70 } });
  });

  it('seeds text annotations with empty auto-sizing text', () => {
    expect(createAnnotation('text', rect, { id: 'a3' })).toMatchObject({ type: 'text', text: '', autoSize: true });
  });

  it('applies the documented blur radius and pixelate block size', () => {
    expect(createAnnotation('blur', rect, { id: 'a4' })).toMatchObject({ radiusPx: 16 });
    expect(createAnnotation('pixelate', rect, { id: 'a5' })).toMatchObject({ blockPx: 12 });
  });

  it('defaults redaction to opaque black', () => {
    expect(createAnnotation('redact', rect, { id: 'a6' })).toMatchObject({ color: '#000000' });
  });

  it('numbers markers from the supplied sequence value', () => {
    expect(createAnnotation('marker', rect, { id: 'a7', number: 3 })).toMatchObject({ number: 3, shape: 'circle' });
  });

  it('generates an id and timestamp when none are supplied', () => {
    const annotation = createAnnotation('ellipse', rect, {});
    expect(annotation.id).toMatch(/\S/);
    expect(Number.isNaN(Date.parse(annotation.createdAt))).toBe(false);
  });

  it('lets the caller override individual style fields', () => {
    const annotation = createAnnotation('rect', rect, { id: 'a8', style: { stroke: '#0000FF' } });
    expect(annotation.style).toMatchObject({ stroke: '#0000FF', strokeWidth: 3 });
  });
});
