import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createJobStateStore } from '../../src/background/job-state';
import { recoverInterruptedJobs } from '../../src/background/lifecycle';
import { createSettingsStore, migrateSettings } from '../../src/background/settings/store';
import { db } from '../../src/shared/db/schema';
import { defaultSettings } from '../../src/shared/defaults';
import type { JobState } from '../../src/shared/types/capture';

function storageMock() {
  const values: Record<string, unknown> = {};
  return {
    values,
    async get(key: string) { return { [key]: values[key] }; },
    async set(value: Record<string, unknown>) { Object.assign(values, value); },
  };
}

const activeJob = {
  jobId: 'job-1', phase: 'capturing', startedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:01.000Z',
  request: {} as JobState['request'], tabId: 1, windowId: 1, backend: 'visibleTab', progress: { done: 1, total: 2 }, tilesWritten: 1, log: [],
} as JobState;

describe('storage lifecycle', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  it('deep-merges settings and migrates missing schema fields', async () => {
    const storage = storageMock();
    const store = createSettingsStore(storage);
    await storage.set({ settings: { schemaVersion: 0, general: { theme: 'dark' } } });
    expect((await store.get()).general.theme).toBe('dark');
    expect((await store.get()).history.enabled).toBe(true);
    expect((await store.get()).schemaVersion).toBe(1);
    expect(migrateSettings({ schemaVersion: 1 }).schemaVersion).toBe(1);
  });

  it('persists nested settings patches with the current schema version', async () => {
    const storage = storageMock();
    const store = createSettingsStore(storage);
    const settings = await store.set({ capture: { limits: { maxTiles: 42 } } });
    expect(settings.capture.limits.maxTiles).toBe(42);
    expect(settings.capture.limits.maxCaptureHeightCss).toBe(defaultSettings.capture.limits.maxCaptureHeightCss);
    expect((await store.get()).schemaVersion).toBe(1);
  });

  it('marks active jobs failed after service worker restart', async () => {
    const storage = storageMock();
    const store = createJobStateStore(storage);
    await store.put(activeJob);
    const failed = await recoverInterruptedJobs(store);
    expect(failed[0]?.phase).toBe('failed');
    expect(failed[0]?.error?.code).toBe('E_SW_RESTART');
    expect((await store.listActive())).toHaveLength(0);
  });

  it('keeps terminal jobs out of active recovery', async () => {
    const storage = storageMock();
    const store = createJobStateStore(storage);
    await store.put({ ...activeJob, phase: 'done' });
    expect(await store.listActive()).toEqual([]);
  });
});
