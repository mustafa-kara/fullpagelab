import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createHistoryService } from '../../src/background/history/service';
import { putBlob } from '../../src/shared/db/blob-ref';
import { db } from '../../src/shared/db/schema';
import type { CaptureRecord } from '../../src/shared/types/history';

function record(id: string, createdAt: string, ref: Awaited<ReturnType<typeof putBlob>>): CaptureRecord {
  return {
    id, createdAt, updatedAt: createdAt, url: `https://${id}.example`, domain: `${id}.example`, title: id, mode: 'visible', backend: 'visibleTab',
    request: {} as CaptureRecord['request'], size: { width: 10, height: 10 }, cssSize: { width: 10, height: 10 }, dpr: 1, zoom: 1,
    viewport: { width: 10, height: 10 }, files: [{ id: `${id}-file`, role: 'full', ref, format: 'png', createdAt }], thumbnail: ref,
    tags: ['tag'], starred: false, warnings: [], durationMs: 1, appVersion: '0.1.0', source: { trigger: 'popup' },
  };
}

describe('history service', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it('lists records with a keyset cursor', async () => {
    const service = createHistoryService();
    const firstRef = await putBlob(new Blob(['a'], { type: 'image/png' }));
    const secondRef = await putBlob(new Blob(['b'], { type: 'image/png' }));
    await service.put(record('first', '2026-01-01T00:00:00.000Z', firstRef));
    await service.put(record('second', '2026-01-02T00:00:00.000Z', secondRef));
    const first = await service.list({ sort: 'createdAt', dir: 'desc', limit: 1 });
    expect(first.items[0]?.id).toBe('second');
    expect(first.nextCursor).toBeDefined();
    const second = await service.list({ sort: 'createdAt', dir: 'desc', limit: 1, cursor: first.nextCursor });
    expect(second.items[0]?.id).toBe('first');
  });

  it('deletes records and releases referenced blobs', async () => {
    const service = createHistoryService();
    const ref = await putBlob(new Blob(['image'], { type: 'image/png' }));
    await service.put(record('one', '2026-01-01T00:00:00.000Z', ref));
    expect(await service.delete(['one'])).toBe(1);
    expect(await db.captures.count()).toBe(0);
    expect(await db.blobs.count()).toBe(0);
  });

  it('replaces an existing edited file instead of appending a second one', async () => {
    const service = createHistoryService();
    const base = await putBlob(new Blob(['full'], { type: 'image/png' }));
    await service.put(record('capture-edit', '2026-09-08T00:00:00.000Z', base));

    const firstEdit = await putBlob(new Blob(['edit-1'], { type: 'image/png' }));
    const secondEdit = await putBlob(new Blob(['edit-2'], { type: 'image/png' }));
    await service.replaceFile('capture-edit', { id: 'e1', role: 'edited', ref: firstEdit, format: 'png', createdAt: '2026-09-08T00:00:01.000Z' });
    await service.replaceFile('capture-edit', { id: 'e2', role: 'edited', ref: secondEdit, format: 'png', createdAt: '2026-09-08T00:00:02.000Z' });

    const stored = await service.get('capture-edit');
    const edited = stored?.files.filter((file) => file.role === 'edited') ?? [];
    expect(edited).toHaveLength(1);
    expect(edited[0]?.ref.key).toBe(secondEdit.key);
    expect(stored?.files.some((file) => file.role === 'full')).toBe(true);
    expect(await db.blobs.get(firstEdit.key)).toBeUndefined();
  });

  it('throws when replacing a file on a missing capture', async () => {
    const service = createHistoryService();
    const ref = await putBlob(new Blob(['x'], { type: 'image/png' }));
    await expect(service.replaceFile('missing', { id: 'e1', role: 'edited', ref, format: 'png', createdAt: '2026-09-08T00:00:00.000Z' })).rejects.toThrow('Capture not found');
  });

  it('updates the thumbnail through a record patch', async () => {
    const service = createHistoryService();
    const ref = await putBlob(new Blob(['thumb-1'], { type: 'image/webp' }));
    await service.put(record('capture-thumb', '2026-09-08T00:00:00.000Z', ref));
    const nextThumb = await putBlob(new Blob(['thumb-2'], { type: 'image/webp' }));
    const next = await service.update('capture-thumb', { thumbnail: nextThumb });
    expect(next.thumbnail.key).toBe(nextThumb.key);
  });
});
