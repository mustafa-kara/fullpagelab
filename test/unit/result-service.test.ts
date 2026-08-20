import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHistoryService } from '../../src/background/history/service';
import { createCaptureResultService } from '../../src/background/result/service';
import { createTemporaryResultStore } from '../../src/background/result/temporary-store';
import { db } from '../../src/shared/db/schema';
import { defaultSettings } from '../../src/shared/defaults';
import type { JobState } from '../../src/shared/types/capture';

function job(): JobState {
  return {
    jobId: 'job-1',
    request: {
      id: 'job-1',
      mode: 'visible',
      target: { tabId: 7, windowId: 2, url: 'https://example.com/docs', title: 'Example docs' },
      options: structuredClone(defaultSettings.capture),
      export: structuredClone(defaultSettings.export),
      trigger: 'popup',
    },
    tabId: 7,
    windowId: 2,
    backend: 'visibleTab',
    phase: 'exporting',
    startedAt: '2026-08-20T10:00:00.000Z',
    updatedAt: '2026-08-20T10:00:01.000Z',
    progress: { done: 1, total: 1 },
    tilesWritten: 1,
    log: [],
  };
}

describe('capture result service', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await db.delete();
    await db.open();
  });

  it('stores the original image, separate thumbnail and capture metadata', async () => {
    const service = createCaptureResultService({
      history: createHistoryService(),
      settings: () => structuredClone(defaultSettings),
      now: () => '2026-08-20T10:00:02.000Z',
      appVersion: '0.1.0',
    });
    const record = await service.save({ job: job(), original: new Blob(['png'], { type: 'image/png' }), durationMs: 200 });

    expect(record.id).toBeTruthy();
    expect(record.title).toBe('Example docs');
    expect(record.domain).toBe('example.com');
    expect(record.files).toHaveLength(1);
    expect(record.files[0]?.role).toBe('full');
    expect(record.files[0]?.format).toBe('png');
    expect(record.thumbnail).not.toEqual(record.files[0]?.ref);
    expect(await db.captures.get(record.id)).toMatchObject({ id: record.id, url: 'https://example.com/docs' });
    expect(await db.blobs.count()).toBe(2);
  });

  it('keeps a temporary result available when history is disabled', async () => {
    const settings = structuredClone(defaultSettings);
    settings.history.enabled = false;
    const temporary = createTemporaryResultStore(() => Date.parse('2026-08-20T10:00:02.000Z'));
    const service = createCaptureResultService({
      history: createHistoryService(),
      temporary,
      settings: () => settings,
      now: () => '2026-08-20T10:00:02.000Z',
      appVersion: '0.1.0',
    });
    const original = new Blob(['temporary-png'], { type: 'image/png' });
    const record = await service.save({ job: job(), original, durationMs: 200 });

    expect(record.files[0]?.ref.store).toBe('session');
    expect(await db.captures.count()).toBe(0);
    expect(await db.blobs.count()).toBe(0);
    expect(await temporary.resolve(record.files[0]!.ref)).toEqual(original);
    expect((await temporary.payload(record.id))?.record.id).toBe(record.id);
  });
});
