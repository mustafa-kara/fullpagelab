import { describe, expect, it, vi } from 'vitest';
import { createEditorService } from '../../src/background/editor/service';
import type { CaptureRecord } from '../../src/shared/types/history';
import type { EditorDocument } from '../../src/shared/types/editor';

const ref = { store: 'idb', key: 'blob-1', mime: 'image/png', bytes: 3 } as const;

function record(id: string, overrides: Partial<CaptureRecord> = {}): CaptureRecord {
  return {
    id, createdAt: '2026-09-08T00:00:00.000Z', updatedAt: '2026-09-08T00:00:00.000Z',
    url: 'https://example.com/', domain: 'example.com', title: 'Example', mode: 'fullPage', backend: 'visibleTab',
    request: {} as CaptureRecord['request'], size: { width: 800, height: 600 }, cssSize: { width: 800, height: 600 },
    dpr: 1, zoom: 1, viewport: { width: 800, height: 600 },
    files: [{ id: 'f1', role: 'full', ref, format: 'png', createdAt: '2026-09-08T00:00:00.000Z' }],
    thumbnail: { store: 'idb', key: 'thumb-1', mime: 'image/webp', bytes: 3 },
    tags: [], starred: false, warnings: [], durationMs: 10, appVersion: '0.1.0', source: { trigger: 'popup' },
    ...overrides,
  };
}

function doc(captureId: string): EditorDocument {
  return { version: 1, captureId, base: { ref, size: { width: 800, height: 600 } }, canvas: { size: { width: 800, height: 600 }, background: '#fff', rotation: 0, scale: 1 }, layers: [], history: { undo: 0, redo: 0 }, updatedAt: '2026-09-08T00:00:00.000Z' };
}

function deps(overrides: Record<string, unknown> = {}) {
  const records = new Map<string, CaptureRecord>([['capture-1', record('capture-1')]]);
  const docs = new Map<string, EditorDocument>();
  return {
    records,
    docs,
    history: {
      get: vi.fn(async (id: string) => records.get(id)),
      put: vi.fn(async (next: CaptureRecord) => { records.set(next.id, next); return next; }),
      replaceFile: vi.fn(async (id: string, file) => { const found = records.get(id)!; const next = { ...found, files: [...found.files.filter((existing) => existing.role !== file.role), file] }; records.set(id, next); return next; }),
      update: vi.fn(async (id: string, patch) => { const next = { ...records.get(id)!, ...patch }; records.set(id, next); return next; }),
    },
    putBlob: vi.fn(async () => ({ ...ref, key: 'blob-edited' })),
    saveDoc: vi.fn(async (next: EditorDocument) => { docs.set(next.captureId, next); }),
    loadDoc: vi.fn(async (id: string) => docs.get(id) ?? null),
    makeThumbnail: vi.fn(async () => ({ ...ref, key: 'thumb-new', mime: 'image/webp' })),
    createId: vi.fn(() => 'capture-2'),
    now: () => '2026-09-09T00:00:00.000Z',
    ...overrides,
  };
}

const flattened = { dataUrl: 'data:image/png;base64,AAAA', mime: 'image/png' };

describe('editor service', () => {
  it('clones the record and links editedFrom when saving as new', async () => {
    const dependencies = deps();
    const service = createEditorService(dependencies as never);
    const result = await service.save({ captureId: 'capture-1', doc: doc('capture-1'), flattened, saveAsNew: true });

    expect(result).toEqual({ captureId: 'capture-2', createdNewRecord: true });
    expect(dependencies.records.get('capture-2')?.source.editedFrom).toBe('capture-1');
    expect(dependencies.records.get('capture-1')?.files.some((file) => file.role === 'edited')).toBe(false);
  });

  it('writes the edited file onto the same record when not saving as new', async () => {
    const dependencies = deps();
    const service = createEditorService(dependencies as never);
    const result = await service.save({ captureId: 'capture-1', doc: doc('capture-1'), flattened, saveAsNew: false });

    expect(result).toEqual({ captureId: 'capture-1', createdNewRecord: false });
    expect(dependencies.history.replaceFile).toHaveBeenCalledWith('capture-1', expect.objectContaining({ role: 'edited' }));
  });

  it('stores the document under the record it belongs to', async () => {
    const dependencies = deps();
    const service = createEditorService(dependencies as never);
    await service.save({ captureId: 'capture-1', doc: doc('capture-1'), flattened, saveAsNew: true });
    expect(dependencies.docs.get('capture-2')?.captureId).toBe('capture-2');
  });

  it('refreshes the thumbnail from the flattened image', async () => {
    const dependencies = deps();
    const service = createEditorService(dependencies as never);
    await service.save({ captureId: 'capture-1', doc: doc('capture-1'), flattened, saveAsNew: false });
    expect(dependencies.makeThumbnail).toHaveBeenCalled();
    expect(dependencies.records.get('capture-1')?.thumbnail.key).toBe('thumb-new');
  });

  it('rejects a save for a capture that does not exist', async () => {
    const service = createEditorService(deps() as never);
    await expect(service.save({ captureId: 'missing', doc: doc('missing'), flattened, saveAsNew: false })).rejects.toThrow('Capture not found');
  });

  it('returns a stored document and null when there is none', async () => {
    const dependencies = deps();
    const service = createEditorService(dependencies as never);
    expect(await service.load('capture-1')).toBeNull();
    await service.save({ captureId: 'capture-1', doc: doc('capture-1'), flattened, saveAsNew: false });
    expect(await service.load('capture-1')).not.toBeNull();
  });
});
