import { describe, expect, it } from 'vitest';
import { toFabricOptions } from '../../src/editor/fabric-bridge';
import { ANNOTATION_STROKE, createAnnotation } from '../../src/lib/editor/annotation';

const rect = { x: 10, y: 20, width: 100, height: 50 };

describe('fabric bridge', () => {
  it('maps annotation geometry onto fabric positioning options', () => {
    expect(toFabricOptions(createAnnotation('rect', rect, { id: 'a1' }))).toMatchObject({ left: 10, top: 20, width: 100, height: 50, angle: 0, opacity: 1 });
  });

  it('carries the stroke style across', () => {
    expect(toFabricOptions(createAnnotation('rect', rect, { id: 'a2' }))).toMatchObject({ stroke: ANNOTATION_STROKE, strokeWidth: 3 });
  });

  it('maps a none fill to a transparent fabric fill', () => {
    expect(toFabricOptions(createAnnotation('rect', rect, { id: 'a3' })).fill).toBe('');
  });

  it('marks locked annotations as unselectable', () => {
    const locked = { ...createAnnotation('rect', rect, { id: 'a4' }), locked: true };
    expect(toFabricOptions(locked)).toMatchObject({ selectable: false, evented: false });
  });

  it('carries the annotation id so canvas objects can be traced back', () => {
    expect(toFabricOptions(createAnnotation('rect', rect, { id: 'a5' }))).toMatchObject({ ssxId: 'a5' });
  });

  it('passes the rotation through as an angle', () => {
    const rotated = { ...createAnnotation('rect', rect, { id: 'a6' }), rotationDeg: 30 };
    expect(toFabricOptions(rotated).angle).toBe(30);
  });
});
