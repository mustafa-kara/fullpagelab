import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createExportPipeline } from '../../src/background/export/pipeline';
import { createHistoryService } from '../../src/background/history/service';
import { createResultTabOpener } from '../../src/background/result/opener';
import { createCaptureResultService } from '../../src/background/result/service';
import { createTemporaryResultStore } from '../../src/background/result/temporary-store';
import { db } from '../../src/shared/db/schema';
import { defaultSettings } from '../../src/shared/defaults';
import type { JobState } from '../../src/shared/types/capture';

function job(): JobState {
  return {
    jobId: 'job-1',
    request: {
      id: 'job-1', mode: 'visible', target: { tabId: 7, windowId: 2, url: 'https://example.com/docs', title: 'Example docs' },
      options: structuredClone(defaultSettings.capture), export: structuredClone(defaultSettings.export), trigger: 'popup',
    },
    tabId: 7, windowId: 2, backend: 'visibleTab', phase: 'exporting', startedAt: '2026-08-20T10:00:00.000Z', updatedAt: '2026-08-20T10:00:01.000Z',
    progress: { done: 1, total: 1 }, tilesWritten: 1, log: [],
  };
}

describe('result flow integration', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it('keeps capture completion download-free until the result action is requested', async () => {
    const history = createHistoryService();
    const resultService = createCaptureResultService({ history, settings: () => structuredClone(defaultSettings), now: () => '2026-08-20T10:00:02.000Z', appVersion: '0.1.0' });
    const record = await resultService.save({ job: job(), original: new Blob(['png'], { type: 'image/png' }), durationMs: 200 });
    const download = vi.fn(async () => 12);
    const pipeline = createExportPipeline({
      history,
      download,
      now: () => new Date('2026-08-20T10:00:02.000Z'),
    });
    const createTab = vi.fn(async () => undefined);
    const openResult = createResultTabOpener({ platform: { baseUrl: () => 'chrome-extension://fullpagelab/src/pages/result/index.html', query: async () => [], update: async () => undefined, create: createTab }, behavior: () => 'newTab' });

    await openResult(record.id);
    expect(createTab).toHaveBeenCalledWith(`chrome-extension://fullpagelab/src/pages/result/index.html?id=${record.id}`);
    expect(download).not.toHaveBeenCalled();

    await pipeline.run({ captureId: record.id, plan: { ...structuredClone(defaultSettings.export), targets: ['download'], format: 'png' } });
    expect(download).toHaveBeenCalledOnce();
  });

  it('serves a history-disabled capture through the temporary result path', async () => {
    const settings = structuredClone(defaultSettings);
    settings.history.enabled = false;
    const temporary = createTemporaryResultStore();
    const history = createHistoryService();
    const resultService = createCaptureResultService({ history, temporary, settings: () => settings, now: () => '2026-08-20T10:00:02.000Z', appVersion: '0.1.0' });
    const record = await resultService.save({ job: job(), original: new Blob(['png'], { type: 'image/png' }), durationMs: 200 });

    expect(await history.get(record.id)).toBeUndefined();
    expect((await temporary.payload(record.id))?.record.title).toBe('Example docs');
  });
});
