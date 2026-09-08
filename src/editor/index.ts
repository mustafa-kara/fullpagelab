import type { EditorDocument } from '../shared/types/editor';
import type { EditorDeps, EditorHandle } from './editor-core';

export type { EditorHandle } from './editor-core';

/** Loads the Fabric-backed editor on demand so it stays out of the result page's initial chunk. */
export async function createEditor(canvas: HTMLCanvasElement, doc: EditorDocument, deps: EditorDeps = {}): Promise<EditorHandle> {
  const { createEditorCore } = await import('./editor-core');
  return createEditorCore(canvas, doc, deps);
}
