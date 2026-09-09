// @vitest-environment happy-dom

import { h, render } from 'preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorDocument } from '../../src/shared/types/editor';

const sendMessage = vi.fn(async () => ({ captureId: 'capture-1', createdNewRecord: true }));
const editorHandle = {
  setTool: vi.fn(),
  undo: vi.fn(),
  redo: vi.fn(),
  canUndo: () => true,
  canRedo: () => false,
  getDocument: () => ({ version: 1, captureId: 'capture-1', layers: [] }),
  setZoom: vi.fn(),
  getZoom: () => 1,
  fitZoom: () => 1,
  imageSize: () => ({ width: 100, height: 100 }),
  setStyle: vi.fn(),
  getStyle: () => ({ color: '#FF1493', strokeWidth: 4 }),
  toDataUrl: () => 'data:image/png;base64,AAAA',
  dispose: vi.fn(),
};

vi.mock('../../src/shared/messages', () => ({ sendMessage }));
vi.mock('../../src/shared/i18n', () => ({ t: (key: string) => key }));
vi.mock('../../src/editor/index', () => ({ createEditor: vi.fn(async () => editorHandle) }));

const doc: EditorDocument = { version: 1, captureId: 'capture-1', base: { ref: { store: 'idb', key: 'b1', mime: 'image/png', bytes: 3 }, size: { width: 400, height: 300 } }, canvas: { size: { width: 400, height: 300 }, background: '#fff', rotation: 0, scale: 1 }, layers: [], history: { undo: 0, redo: 0 }, updatedAt: '2026-09-08T00:00:00.000Z' };

describe('editor panel', () => {
  beforeEach(() => {
    document.body.innerHTML = '<main id="app"></main>';
    sendMessage.mockClear();
    editorHandle.setTool.mockClear();
    editorHandle.dispose.mockClear();
  });

  it('renders a toolbar with the core tools', async () => {
    const { EditorPanel } = await import('../../src/pages/result/editor-panel');
    render(h(EditorPanel, { doc, captureId: 'capture-1', onClose: () => undefined }), document.getElementById('app')!);
    await vi.waitFor(() => expect(document.querySelector('[data-testid="editor-toolbar"]')).not.toBeNull());
    for (const tool of ['arrow', 'rect', 'text', 'blur', 'redact']) {
      expect(document.querySelector(`[data-tool="${tool}"]`)).not.toBeNull();
    }
  });

  it('activates the tool the user clicks', async () => {
    const { EditorPanel } = await import('../../src/pages/result/editor-panel');
    render(h(EditorPanel, { doc, captureId: 'capture-1', onClose: () => undefined }), document.getElementById('app')!);
    await vi.waitFor(() => expect(document.querySelector('[data-testid="editor-toolbar"][data-ready="true"]')).not.toBeNull());
    document.querySelector<HTMLButtonElement>('[data-tool="arrow"]')?.click();
    await vi.waitFor(() => expect(editorHandle.setTool).toHaveBeenCalledWith('arrow'));
  });

  it('warns that blur is reversible when the blur tool is selected', async () => {
    const { EditorPanel } = await import('../../src/pages/result/editor-panel');
    render(h(EditorPanel, { doc, captureId: 'capture-1', onClose: () => undefined }), document.getElementById('app')!);
    await vi.waitFor(() => expect(document.querySelector('[data-testid="editor-toolbar"][data-ready="true"]')).not.toBeNull());
    document.querySelector<HTMLButtonElement>('[data-tool="blur"]')?.click();
    await vi.waitFor(() => expect(document.querySelector('[data-testid="editor-privacy-note"]')?.textContent).toContain('ui.editor.blurWarning'));
  });

  it('saves through the editor.save message', async () => {
    const { EditorPanel } = await import('../../src/pages/result/editor-panel');
    render(h(EditorPanel, { doc, captureId: 'capture-1', onClose: () => undefined }), document.getElementById('app')!);
    await vi.waitFor(() => expect(document.querySelector<HTMLButtonElement>('[data-testid="editor-save"]')?.disabled).toBe(false));
    document.querySelector<HTMLButtonElement>('[data-testid="editor-save"]')?.click();
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith('editor.save', expect.objectContaining({ captureId: 'capture-1' })));
  });

  it('flattens through the editor handle so the on-screen zoom is not baked in', async () => {
    const { EditorPanel } = await import('../../src/pages/result/editor-panel');
    render(h(EditorPanel, { doc, captureId: 'capture-1', onClose: () => undefined }), document.getElementById('app')!);
    await vi.waitFor(() => expect(document.querySelector<HTMLButtonElement>('[data-testid="editor-save"]')?.disabled).toBe(false));
    document.querySelector<HTMLButtonElement>('[data-testid="editor-save"]')?.click();
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith('editor.save', expect.objectContaining({ flattened: { dataUrl: 'data:image/png;base64,AAAA', mime: 'image/png' } })));
  });

  it('disposes the editor when it unmounts', async () => {
    const { EditorPanel } = await import('../../src/pages/result/editor-panel');
    const host = document.getElementById('app')!;
    render(h(EditorPanel, { doc, captureId: 'capture-1', onClose: () => undefined }), host);
    await vi.waitFor(() => expect(document.querySelector('[data-testid="editor-toolbar"][data-ready="true"]')).not.toBeNull());
    render(null, host);
    expect(editorHandle.dispose).toHaveBeenCalled();
  });
});
