import { nowIso } from '../../shared/ids';
import type { Annotation, EditorDocument } from '../../shared/types/editor';
import type { BlobRef, Size } from '../../shared/types/primitives';

export interface CreateDocumentInput {
  captureId: string;
  base: { ref: BlobRef; size: Size };
  now?: string;
  background?: string;
}

export function createDocument({ captureId, base, now = nowIso(), background = '#ffffff' }: CreateDocumentInput): EditorDocument {
  return {
    version: 1,
    captureId,
    base,
    canvas: { size: base.size, background, rotation: 0, scale: 1 },
    layers: [],
    history: { undo: 0, redo: 0 },
    updatedAt: now,
  };
}

function withLayers(doc: EditorDocument, layers: Annotation[], now: string): EditorDocument {
  return { ...doc, layers, updatedAt: now };
}

export function addLayer(doc: EditorDocument, annotation: Annotation, now = nowIso()): EditorDocument {
  return withLayers(doc, [...doc.layers, annotation], now);
}

export function updateLayer(doc: EditorDocument, id: string, patch: Partial<Annotation>, now = nowIso()): EditorDocument {
  if (!doc.layers.some((layer) => layer.id === id)) return doc;
  return withLayers(doc, doc.layers.map((layer) => layer.id === id ? { ...layer, ...patch } as Annotation : layer), now);
}

export function removeLayer(doc: EditorDocument, id: string, now = nowIso()): EditorDocument {
  return withLayers(doc, doc.layers.filter((layer) => layer.id !== id), now);
}

export function moveLayer(doc: EditorDocument, id: string, toIndex: number, now = nowIso()): EditorDocument {
  const from = doc.layers.findIndex((layer) => layer.id === id);
  if (from < 0) return doc;
  const layers = [...doc.layers];
  const [moved] = layers.splice(from, 1);
  if (moved) layers.splice(Math.max(0, Math.min(layers.length, toIndex)), 0, moved);
  return withLayers(doc, layers, now);
}

/** Markers auto-increment from the highest existing number; deleting one never renumbers the rest. */
export function nextMarkerNumber(layers: readonly Annotation[]): number {
  return layers.reduce((highest, layer) => layer.type === 'marker' ? Math.max(highest, layer.number) : highest, 0) + 1;
}
