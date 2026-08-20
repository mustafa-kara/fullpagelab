import { describe, expect, it, vi } from 'vitest';
import { createCaptureCoordinator, createVerticalPlan, type CapturePlatform } from '../../src/background/capture/coordinator';
import { defaultSettings } from '../../src/shared/defaults';
import type { CaptureRequest, JobState, PageMetrics, PreparedState } from '../../src/shared/types/capture';
import type { CaptureRecord } from '../../src/shared/types/history';

function createJobs() {
  const states: JobState[] = [];
  return {
    states,
    put: vi.fn(async (job: JobState) => {
      const index = states.findIndex((item) => item.jobId === job.jobId);
      if (index === -1) states.push(job);
      else states[index] = job;
    }),
    list: vi.fn(async () => states),
  };
}

function captureRequest(mode: CaptureRequest['mode']): CaptureRequest {
  return {
    mode,
    target: {},
    options: structuredClone(defaultSettings.capture),
    export: structuredClone(defaultSettings.export),
    trigger: 'popup',
  };
}

function metrics(): PageMetrics {
  return {
    url: 'https://example.com/docs',
    title: 'Example docs',
    origin: 'https://example.com',
    viewport: { width: 800, height: 600 },
    document: { width: 800, height: 1_350 },
    scroll: { x: 12, y: 34 },
    dpr: 1,
    zoom: 1,
    hasHorizontalOverflow: false,
    scrollingElement: 'document',
    scrollContainers: [],
    fixedElements: [],
    iframes: [],
    lazyImages: 0,
    direction: 'ltr',
    isRestricted: false,
    userAgent: 'Vitest',
    colorScheme: 'light',
  };
}

function preparedState(): PreparedState {
  return {
    hiddenSelectors: [],
    removedScrollbars: true,
    pausedMedia: 0,
    eagerizedImages: 0,
    smartHidden: [],
    scrollRoot: 'document',
    effectiveDocument: { width: 800, height: 1_350 },
  };
}

describe('capture coordinator', () => {
  it('preserves the trigger and merges the resolved tab into the request target', async () => {
    const jobs = createJobs();
    const platform: CapturePlatform = {
      queryActiveTab: vi.fn(async () => ({ id: 7, windowId: 3, url: 'https://example.com/docs', title: 'Example docs' })),
      captureVisibleTab: vi.fn(async () => 'data:image/png;base64,AAAA'),
      download: vi.fn(async () => 11),
    };
    const request: CaptureRequest = {
      mode: 'visible',
      target: { selector: 'main' },
      options: structuredClone(defaultSettings.capture),
      export: structuredClone(defaultSettings.export),
      trigger: 'contextMenu',
    };
    const coordinator = createCaptureCoordinator({ platform, jobs, now: () => '2026-08-19T14:00:00.000Z' });

    await coordinator.start({ request });

    expect(jobs.states[0]?.request.trigger).toBe('contextMenu');
    expect(jobs.states[0]?.request.target).toEqual({
      selector: 'main',
      tabId: 7,
      windowId: 3,
      url: 'https://example.com/docs',
      title: 'Example docs',
    });
  });

  it('captures the visible tab without starting a download', async () => {
    const jobs = createJobs();
    const platform: CapturePlatform = {
      queryActiveTab: vi.fn(async () => ({ id: 7, windowId: 3, url: 'https://example.com/docs', title: 'Example docs' })),
      captureVisibleTab: vi.fn(async () => 'data:image/png;base64,AAAA'),
      download: vi.fn(async () => 11),
    };
    const saveResult = vi.fn(async () => ({ id: 'capture-1' } as CaptureRecord));
    const coordinator = createCaptureCoordinator({ platform, jobs, resultService: { save: saveResult, get: vi.fn(async () => null) }, now: () => '2026-08-19T14:00:00.000Z' });

    const result = await coordinator.start({ request: captureRequest('visible') });

    expect(result.jobId).toBeTruthy();
    expect(platform.captureVisibleTab).toHaveBeenCalledWith(3);
    expect(platform.download).not.toHaveBeenCalled();
    expect(saveResult).toHaveBeenCalledOnce();
    expect(jobs.states.at(-1)?.phase).toBe('done');
    expect(jobs.states.at(-1)?.captureId).toBe('capture-1');
    expect(jobs.states.at(-1)?.progress).toEqual({ done: 1, total: 1 });
  });

  it('prepares and restores an HTTP page around a visible capture', async () => {
    const jobs = createJobs();
    const calls: string[] = [];
    const tab = { id: 7, windowId: 3, url: 'https://example.com/docs', title: 'Example docs' };
    const platform: CapturePlatform = {
      queryActiveTab: vi.fn(async () => tab),
      scan: vi.fn(async () => { calls.push('scan'); return metrics(); }),
      prepare: vi.fn(async () => { calls.push('prepare'); return preparedState(); }),
      captureVisibleTab: vi.fn(async () => { calls.push('captureVisibleTab'); return 'data:image/png;base64,AAAA'; }),
      restore: vi.fn(async () => { calls.push('restore'); }),
      download: vi.fn(async () => 11),
    };
    const coordinator = createCaptureCoordinator({ platform, jobs, now: () => '2026-08-19T14:00:00.000Z' });

    await coordinator.start({ request: captureRequest('visible') });

    expect(calls).toEqual(['scan', 'prepare', 'captureVisibleTab', 'restore']);
    expect(platform.restore).toHaveBeenCalledWith(7, { x: 12, y: 34 });
  });

  it('captures and logs a warning when visible preparation fails', async () => {
    const jobs = createJobs();
    const tab = { id: 7, windowId: 3, url: 'https://example.com/docs', title: 'Example docs' };
    const restore = vi.fn(async () => undefined);
    const captureVisibleTab = vi.fn(async () => 'data:image/png;base64,AAAA');
    const platform: CapturePlatform = {
      queryActiveTab: vi.fn(async () => tab),
      scan: vi.fn(async () => metrics()),
      prepare: vi.fn(async () => { throw new Error('agent unavailable'); }),
      captureVisibleTab,
      restore,
      download: vi.fn(async () => 11),
    };
    const coordinator = createCaptureCoordinator({ platform, jobs, now: () => '2026-08-19T14:00:00.000Z' });

    await coordinator.start({ request: captureRequest('visible') });

    expect(captureVisibleTab).toHaveBeenCalledOnce();
    expect(restore).toHaveBeenCalledWith(7, { x: 12, y: 34 });
    expect(jobs.states.at(-1)?.log).toContain('Visible-area preparation skipped: agent unavailable');
  });

  it('creates a gap-free vertical plan with a final crop', () => {
    const plan = createVerticalPlan({
      viewport: { width: 800, height: 600 },
      document: { width: 800, height: 1_350 },
      scroll: { x: 0, y: 0 },
      dpr: 1,
    });

    expect(plan.steps.map((step) => step.scrollTo.y)).toEqual([0, 600, 750]);
    expect(plan.steps.at(-1)?.cropFromViewport.height).toBe(150);
    expect(plan.content.height).toBe(1_350);
  });
});
