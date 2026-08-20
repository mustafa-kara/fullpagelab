import { describe, expect, it, vi } from 'vitest';
import { createResultTabOpener } from '../../src/background/result/opener';
import { createTemporaryResultStore } from '../../src/background/result/temporary-store';
import type { CaptureRecord } from '../../src/shared/types/history';

describe('result lifecycle', () => {
  it('opens one result tab per capture and reuses an existing result tab when configured', async () => {
    const query = vi.fn(async () => [{ id: 21 }]);
    const update = vi.fn(async () => undefined);
    const create = vi.fn(async () => undefined);
    const opener = createResultTabOpener({
      platform: { baseUrl: () => 'chrome-extension://fullpagelab/src/pages/result/index.html', query, update, create },
      behavior: () => 'reuseTab',
    });

    await opener('capture-1');
    await opener('capture-1');

    expect(query).toHaveBeenCalledWith('chrome-extension://fullpagelab/src/pages/result/index.html*');
    expect(update).toHaveBeenCalledWith(21, 'chrome-extension://fullpagelab/src/pages/result/index.html?id=capture-1');
    expect(create).not.toHaveBeenCalled();
  });

  it('keeps temporary results isolated and expires them', async () => {
    let now = 1_000;
    const store = createTemporaryResultStore(() => now);
    const record = { id: 'capture-1' } as CaptureRecord;
    const ref = { store: 'session' as const, key: 'capture-1:full', mime: 'image/png', bytes: 3 };
    const blob = new Blob(['png'], { type: 'image/png' });
    await store.put({ ...record, files: [{ id: 'file-1', role: 'full', ref, format: 'png', createdAt: new Date(0).toISOString() }] } as CaptureRecord, new Map([[ref.key, blob]]));

    expect(await store.get('capture-1')).toBeDefined();
    now += 30 * 60 * 1000 + 1;
    store.clearExpired();
    expect(await store.get('capture-1')).toBeUndefined();
  });
});
