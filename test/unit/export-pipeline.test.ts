import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createExportPipeline } from '../../src/background/export/pipeline';
import { createTemporaryResultStore } from '../../src/background/result/temporary-store';
import { putBlob } from '../../src/shared/db/blob-ref';
import { db } from '../../src/shared/db/schema';
import { defaultSettings } from '../../src/shared/defaults';
import type { CaptureRecord } from '../../src/shared/types/history';

function record(ref: Awaited<ReturnType<typeof putBlob>>): CaptureRecord {
  return {
    id: 'capture-1', createdAt: '2026-08-20T11:22:33.000Z', updatedAt: '2026-08-20T11:22:33.000Z',
    url: 'https://example.com/docs', domain: 'example.com', title: 'Docs', mode: 'fullPage', backend: 'visibleTab',
    request: {} as CaptureRecord['request'], size: { width: 800, height: 1_200 }, cssSize: { width: 800, height: 1_200 },
    dpr: 1, zoom: 1, viewport: { width: 800, height: 600 },
    files: [{ id: 'file-1', role: 'full', ref, format: 'png', createdAt: '2026-08-20T11:22:33.000Z' }], thumbnail: ref,
    tags: [], starred: false, warnings: [], durationMs: 100, appVersion: '0.1.0', source: { trigger: 'popup' },
  };
}

describe('export pipeline', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it('downloads the selected PNG only when download is a target', async () => {
    const source = new Blob(['png'], { type: 'image/png' });
    const sourceRef = await putBlob(source);
    const download = vi.fn(async () => 42);
    const pipeline = createExportPipeline({
      history: { get: async () => record(sourceRef), addFile: async () => record(sourceRef) },
      download,
      now: () => new Date('2026-08-20T11:22:33.000Z'),
    });

    const result = await pipeline.run({
      captureId: 'capture-1',
      plan: { ...structuredClone(defaultSettings.export), targets: ['download'], format: 'png' },
    });

    expect(download).toHaveBeenCalledWith(expect.any(Blob), 'example.com_2026-08-20_112233.png', expect.objectContaining({ conflictAction: 'uniquify' }));
    expect(result.files[0]?.downloadId).toBe(42);
  });

  it('encodes JPEG and stores the new export file', async () => {
    const sourceRef = await putBlob(new Blob(['png'], { type: 'image/png' }));
    const addFile = vi.fn(async (value: CaptureRecord) => value);
    const pipeline = createExportPipeline({
      history: { get: async () => record(sourceRef), addFile: async (_recordId, _file) => addFile(record(sourceRef)) },
      encodeImage: vi.fn(async () => new Blob(['jpg'], { type: 'image/jpeg' })),
      download: vi.fn(async () => 7),
      now: () => new Date('2026-08-20T11:22:33.000Z'),
    });

    const result = await pipeline.run({
      captureId: 'capture-1',
      plan: { ...structuredClone(defaultSettings.export), targets: ['download'], format: 'jpeg' },
    });

    expect(addFile).toHaveBeenCalledOnce();
    expect(result.files[0]?.filename).toBe('example.com_2026-08-20_112233.jpg');
  });

  it('exports a temporary result without writing history', async () => {
    const source = new Blob(['png'], { type: 'image/png' });
    const sourceRef = { store: 'session' as const, key: 'capture-1:full', mime: source.type, bytes: source.size };
    const temporary = createTemporaryResultStore();
    const temporaryRecord = record(sourceRef);
    await temporary.put(temporaryRecord, new Map([[sourceRef.key, source]]));
    const addFile = vi.fn(async (_recordId: string, _file: CaptureRecord['files'][number]) => temporaryRecord);
    const pipeline = createExportPipeline({
      history: { get: async () => undefined, addFile },
      temporary,
      encodeImage: vi.fn(async () => new Blob(['jpg'], { type: 'image/jpeg' })),
      download: vi.fn(async () => 8),
      now: () => new Date('2026-08-20T11:22:33.000Z'),
    });

    const result = await pipeline.run({
      captureId: 'capture-1',
      plan: { ...structuredClone(defaultSettings.export), targets: ['download'], format: 'jpeg' },
    });

    expect(result.files[0]?.ref.store).toBe('session');
    expect(addFile).not.toHaveBeenCalled();
    expect((await temporary.payload('capture-1'))?.files).toHaveLength(2);
  });

  it('returns the requested strip even when an edited file exists', async () => {
    const fullRef = await putBlob(new Blob(['full'], { type: 'image/png' }));
    const stripRef = await putBlob(new Blob(['strip'], { type: 'image/png' }));
    const editedRef = await putBlob(new Blob(['edited'], { type: 'image/png' }));
    const base = record(fullRef);
    const stored: CaptureRecord = {
      ...base,
      files: [
        ...base.files,
        { id: 'file-strip', role: 'strip', index: 1, ref: stripRef, format: 'png', createdAt: '2026-08-20T11:22:33.000Z' },
        { id: 'file-edited', role: 'edited', ref: editedRef, format: 'png', createdAt: '2026-08-20T11:22:33.000Z' },
      ],
    };
    const resolve = vi.fn(async (ref: { key: string }) => new Blob([ref.key], { type: 'image/png' }));
    const pipeline = createExportPipeline({
      history: { get: async () => stored, addFile: async () => stored },
      resolve,
      encodeImage: async (source: Blob) => source,
      download: vi.fn(async () => 1),
      now: () => new Date('2026-08-20T11:22:33.000Z'),
    });

    await pipeline.run({
      captureId: stored.id,
      stripIndex: 1,
      plan: { ...structuredClone(defaultSettings.export), targets: ['download'], format: 'png' },
    });

    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ key: stripRef.key }));
  });

  it('falls back to the edited file when no strip is requested', async () => {
    const fullRef = await putBlob(new Blob(['full'], { type: 'image/png' }));
    const editedRef = await putBlob(new Blob(['edited'], { type: 'image/png' }));
    const base = record(fullRef);
    const stored: CaptureRecord = {
      ...base,
      files: [...base.files, { id: 'file-edited', role: 'edited', ref: editedRef, format: 'png', createdAt: '2026-08-20T11:22:33.000Z' }],
    };
    const resolve = vi.fn(async (ref: { key: string }) => new Blob([ref.key], { type: 'image/png' }));
    const pipeline = createExportPipeline({
      history: { get: async () => stored, addFile: async () => stored },
      resolve,
      encodeImage: async (source: Blob) => source,
      download: vi.fn(async () => 1),
      now: () => new Date('2026-08-20T11:22:33.000Z'),
    });

    await pipeline.run({
      captureId: stored.id,
      plan: { ...structuredClone(defaultSettings.export), targets: ['download'], format: 'png' },
    });

    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ key: editedRef.key }));
  });
});
