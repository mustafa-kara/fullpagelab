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
});
