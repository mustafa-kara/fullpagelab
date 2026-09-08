import { describe, expect, it } from 'vitest';
import { createAnnotation } from '../../src/lib/editor/annotation';
import { addLayer, createDocument, moveLayer, nextMarkerNumber, removeLayer, updateLayer } from '../../src/lib/editor/document';
import type { BlobRef } from '../../src/shared/types/primitives';

const ref: BlobRef = { store: 'idb', key: 'blob-1', mime: 'image/png', bytes: 10 };
const size = { width: 800, height: 1200 };
const rect = { x: 0, y: 0, width: 10, height: 10 };

function doc() {
  return createDocument({ captureId: 'capture-1', base: { ref, size }, now: '2026-09-08T00:00:00.000Z' });
}

describe('editor document', () => {
  it('creates an empty version 1 document sized to the base image', () => {
    expect(doc()).toMatchObject({ version: 1, captureId: 'capture-1', canvas: { size, rotation: 0, scale: 1 }, layers: [] });
  });

  it('appends a layer without mutating the original document', () => {
    const original = doc();
    const next = addLayer(original, createAnnotation('rect', rect, { id: 'a1' }));
    expect(next.layers).toHaveLength(1);
    expect(original.layers).toHaveLength(0);
  });

  it('patches an existing layer by id', () => {
    const next = updateLayer(addLayer(doc(), createAnnotation('rect', rect, { id: 'a1' })), 'a1', { opacity: 0.5 });
    expect(next.layers[0]).toMatchObject({ id: 'a1', opacity: 0.5 });
  });

  it('leaves the document alone when patching an unknown id', () => {
    const before = addLayer(doc(), createAnnotation('rect', rect, { id: 'a1' }));
    expect(updateLayer(before, 'missing', { opacity: 0.2 }).layers).toEqual(before.layers);
  });

  it('removes a layer by id', () => {
    const next = removeLayer(addLayer(doc(), createAnnotation('rect', rect, { id: 'a1' })), 'a1');
    expect(next.layers).toHaveLength(0);
  });

  it('reorders a layer to a new index', () => {
    let next = doc();
    for (const id of ['a', 'b', 'c']) next = addLayer(next, createAnnotation('rect', rect, { id }));
    expect(moveLayer(next, 'a', 2).layers.map((layer) => layer.id)).toEqual(['b', 'c', 'a']);
  });

  it('numbers the first marker 1 and later markers one above the highest', () => {
    expect(nextMarkerNumber([])).toBe(1);
    const withMarkers = [createAnnotation('marker', rect, { id: 'm1', number: 1 }), createAnnotation('marker', rect, { id: 'm2', number: 7 })];
    expect(nextMarkerNumber(withMarkers)).toBe(8);
  });

  it('refreshes updatedAt whenever layers change', () => {
    const next = addLayer(doc(), createAnnotation('rect', rect, { id: 'a1' }), '2026-09-09T00:00:00.000Z');
    expect(next.updatedAt).toBe('2026-09-09T00:00:00.000Z');
  });

  it('reports pending redactions', () => {
    const withRedact = addLayer(doc(), createAnnotation('redact', rect, { id: 'r1' }));
    expect(withRedact.layers.filter((layer) => layer.type === 'redact')).toHaveLength(1);
  });
});
