import { describe, expect, it, vi } from 'vitest';
import { createCaptureCoordinator, type CapturePlatform } from '../../src/background/capture/coordinator';
import { CaptureTimeoutError, appendJobLog, canTransition, phaseDeadlineMs, transitionJob, withPhaseDeadline } from '../../src/background/capture/job';
import { CaptureValidationError, ensureActiveCaptureTab, isPdfViewerUrl, isRestrictedPageUrl, validateCaptureTab } from '../../src/background/capture/validation';
import { createFixedElementController, shouldHideFixedElement } from '../../src/content/fixed-elements';
import { Restorer } from '../../src/content/restorer';
import { defaultSettings } from '../../src/shared/defaults';
import type { CaptureRequest, JobState, PageMetrics } from '../../src/shared/types/capture';

function createJobs(states: JobState[]) {
  return {
    list: vi.fn(async () => states),
    put: vi.fn(async (next: JobState) => {
      const index = states.findIndex((item) => item.jobId === next.jobId);
      if (index < 0) states.push(next);
      else states[index] = next;
    }),
  };
}

function metrics(): PageMetrics {
  return {
    url: 'https://example.com/docs',
    title: 'Docs',
    origin: 'https://example.com',
    viewport: { width: 800, height: 600 },
    document: { width: 800, height: 900 },
    scroll: { x: 0, y: 0 },
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
    userAgent: 'test',
    colorScheme: 'light',
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

function job(): JobState {
  return {
    jobId: 'job-1',
    request: {
      mode: 'visible',
      target: { tabId: 1, windowId: 2, url: 'https://example.com' },
      options: structuredClone(defaultSettings.capture),
      export: structuredClone(defaultSettings.export),
      trigger: 'popup',
    },
    tabId: 1,
    windowId: 2,
    backend: 'visibleTab',
    phase: 'preparing',
    startedAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
    progress: { done: 0, total: 1 },
    tilesWritten: 0,
    log: [],
  };
}

describe('Task 6 capture contracts', () => {
  it('bounds the job log and validates phase transitions', () => {
    const log = appendJobLog(Array.from({ length: 205 }, (_, index) => `line-${index}`), 'latest');
    expect(log).toHaveLength(200);
    expect(log[0]).toBe('line-6');
    expect(log.at(-1)).toBe('latest');
    expect(canTransition('preparing', 'capturing')).toBe(true);
    expect(canTransition('done', 'capturing')).toBe(false);
    expect(() => transitionJob(job(), 'done', '2026-08-20T00:00:01.000Z')).toThrow('Invalid capture job transition');
    expect(phaseDeadlineMs('capturing', defaultSettings.capture)).toBe(180_000);
  });

  it('enforces phase deadlines with a typed timeout', async () => {
    await expect(withPhaseDeadline('preparing', 1, new Promise<void>(() => undefined))).rejects.toBeInstanceOf(CaptureTimeoutError);
  });

  it('allows visible restricted fallback but rejects page-agent capture', () => {
    const tab = { id: 1, windowId: 2, url: 'chrome://settings' };
    expect(isRestrictedPageUrl(tab.url)).toBe(true);
    expect(isPdfViewerUrl('https://example.com/manual.pdf')).toBe(true);
    expect(() => validateCaptureTab(tab, false)).not.toThrow();
    expect(() => validateCaptureTab(tab, true)).toThrowError(CaptureValidationError);
    expect(() => validateCaptureTab({ ...tab, discarded: true }, false)).toThrow('discarded');
  });

  it('focuses the expected tab once when the active identity changed', async () => {
    const expected = { id: 7, windowId: 3 };
    const queryActiveTab = vi.fn()
      .mockResolvedValueOnce({ id: 9, windowId: 3 })
      .mockResolvedValueOnce({ ...expected, url: 'https://example.com' });
    const focusTab = vi.fn(async () => undefined);
    await expect(ensureActiveCaptureTab({ queryActiveTab, focusTab }, expected, false)).resolves.toMatchObject(expected);
    expect(focusTab).toHaveBeenCalledWith(7, 3);
  });

  it('restores content changes in LIFO order and only once', async () => {
    const calls: string[] = [];
    const restorer = new Restorer();
    restorer.register(() => { calls.push('first'); });
    restorer.register(() => { calls.push('second'); });
    await restorer.restore();
    await restorer.restore();
    expect(calls).toEqual(['second', 'first']);
  });

  it('keeps first and last fixed anchors while hiding middle tiles', () => {
    expect(shouldHideFixedElement('hideAfterFirst', 0, 3)).toBe(false);
    expect(shouldHideFixedElement('hideAfterFirst', 1, 3)).toBe(true);
    expect(shouldHideFixedElement('hideAfterFirst', 2, 3)).toBe(false);
    expect(shouldHideFixedElement('hideAll', 0, 3)).toBe(true);
    expect(createFixedElementController([], 'none')).toBeDefined();
  });

  it('fails before capture when the active tab changes', async () => {
    const states: JobState[] = [];
    const jobs = createJobs(states);
    const tab = { id: 7, windowId: 3, url: 'https://example.com/docs' };
    const platform: CapturePlatform = {
      queryActiveTab: vi.fn()
        .mockResolvedValueOnce(tab)
        .mockResolvedValueOnce({ id: 8, windowId: 3, url: tab.url }),
      captureVisibleTab: vi.fn(async () => 'data:image/png;base64,AAAA'),
      download: vi.fn(async () => 1),
    };
    const coordinator = createCaptureCoordinator({ platform, jobs, now: () => '2026-08-20T00:00:00.000Z' });
    await expect(coordinator.start({ request: captureRequest('visible') })).rejects.toThrow('no longer active');
    expect(platform.captureVisibleTab).not.toHaveBeenCalled();
    expect(states.at(-1)?.phase).toBe('failed');
    expect(states.at(-1)?.error?.code).toBe('E_TAB_NOT_ACTIVE');
  });

  it('runs visible capture on a restricted page without injecting an agent', async () => {
    const states: JobState[] = [];
    const jobs = createJobs(states);
    const tab = { id: 7, windowId: 3, url: 'chrome://settings' };
    const scan = vi.fn(async () => metrics());
    const prepare = vi.fn(async () => ({
      hiddenSelectors: [], removedScrollbars: true, pausedMedia: 0, eagerizedImages: 0,
      smartHidden: [], scrollRoot: 'document' as const, effectiveDocument: metrics().document,
    }));
    const restore = vi.fn(async () => undefined);
    const platform: CapturePlatform = {
      queryActiveTab: vi.fn(async () => tab),
      captureVisibleTab: vi.fn(async () => 'data:image/png;base64,AAAA'),
      download: vi.fn(async () => 1),
      scan,
      prepare,
      restore,
    };
    const coordinator = createCaptureCoordinator({ platform, jobs, now: () => '2026-08-20T00:00:00.000Z' });
    await expect(coordinator.start({ request: captureRequest('visible') })).resolves.toBeTruthy();
    expect(platform.captureVisibleTab).toHaveBeenCalledWith(3);
    expect(scan).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
    expect(states.at(-1)?.phase).toBe('done');
  });

  it('returns a job id before a detached capture completes', async () => {
    const states: JobState[] = [];
    const jobs = createJobs(states);
    let releaseCapture: ((value: string) => void) | undefined;
    const capture = new Promise<string>((resolve) => { releaseCapture = resolve; });
    const tab = { id: 7, windowId: 3, url: 'https://example.com/docs' };
    const platform: CapturePlatform = {
      queryActiveTab: vi.fn(async () => tab),
      captureVisibleTab: vi.fn(() => capture),
      download: vi.fn(async () => 1),
    };
    const coordinator = createCaptureCoordinator({ platform, jobs, now: () => '2026-08-20T00:00:00.000Z' });

    const start = coordinator.startDetached({ request: captureRequest('visible') });
    await vi.waitFor(() => expect(platform.captureVisibleTab).toHaveBeenCalled());
    const result = await start;

    expect(result.jobId).toBeTruthy();
    expect(states.at(-1)?.phase).toBe('capturing');
    releaseCapture?.('data:image/png;base64,AAAA');
    await vi.waitFor(() => expect(states.at(-1)?.phase).toBe('done'));
  });

  it('does not download after an explicit cancellation during capture', async () => {
    const states: JobState[] = [];
    const jobs = createJobs(states);
    const tab = { id: 7, windowId: 3, url: 'https://example.com/docs' };
    let releaseCapture: ((value: string) => void) | undefined;
    const capturePromise = new Promise<string>((resolve) => { releaseCapture = resolve; });
    const platform: CapturePlatform = {
      queryActiveTab: vi.fn(async () => tab),
      captureVisibleTab: vi.fn(() => capturePromise),
      download: vi.fn(async () => 1),
    };
    const coordinator = createCaptureCoordinator({ platform, jobs, now: () => '2026-08-20T00:00:00.000Z' });
    const start = coordinator.start({ request: captureRequest('visible') });
    await vi.waitFor(() => expect(platform.captureVisibleTab).toHaveBeenCalled());
    const jobId = states[0]?.jobId;
    if (!jobId) throw new Error('Job was not persisted.');
    await coordinator.cancel(jobId);
    releaseCapture?.('data:image/png;base64,AAAA');
    await expect(start).resolves.toEqual({ jobId });
    expect(platform.download).not.toHaveBeenCalled();
    expect(states.at(-1)?.phase).toBe('cancelled');
  });

  it('restores the page after a full-page failure', async () => {
    const states: JobState[] = [];
    const jobs = createJobs(states);
    const tab = { id: 7, windowId: 3, url: 'https://example.com/docs' };
    const restore = vi.fn(async () => undefined);
    const platform: CapturePlatform = {
      queryActiveTab: vi.fn(async () => tab),
      captureVisibleTab: vi.fn(async () => 'data:image/png;base64,AAAA'),
      download: vi.fn(async () => 1),
      scan: vi.fn(async () => metrics()),
      scroll: vi.fn(async () => { throw new Error('scroll disconnected'); }),
      restore,
    };
    const coordinator = createCaptureCoordinator({ platform, jobs, now: () => '2026-08-20T00:00:00.000Z' });
    await expect(coordinator.start({ request: captureRequest('fullPage') })).rejects.toThrow('scroll disconnected');
    expect(restore).toHaveBeenCalledTimes(1);
    expect(states.at(-1)?.phase).toBe('failed');
  });

  it('stops before the first tile when the page does not acknowledge the top position', async () => {
    const states: JobState[] = [];
    const jobs = createJobs(states);
    const tab = { id: 7, windowId: 3, url: 'https://example.com/docs' };
    const captureVisibleTab = vi.fn(async () => 'data:image/png;base64,AAAA');
    const platform: CapturePlatform = {
      queryActiveTab: vi.fn(async () => tab),
      captureVisibleTab,
      download: vi.fn(async () => 1),
      scan: vi.fn(async () => metrics()),
      scroll: vi.fn(async () => ({ actual: { x: 0, y: 120 }, documentNow: metrics().document, elapsedMs: 0 })),
      restore: vi.fn(async () => undefined),
    };
    const coordinator = createCaptureCoordinator({ platform, jobs, now: () => '2026-08-20T00:00:00.000Z' });

    await expect(coordinator.start({ request: captureRequest('fullPage') })).rejects.toThrow('cropped first section');
    expect(captureVisibleTab).not.toHaveBeenCalled();
    expect(states.at(-1)?.error?.code).toBe('E_VALIDATION');
  });

  it('stops before duplicate tiles when a later scroll command is ignored', async () => {
    const states: JobState[] = [];
    const jobs = createJobs(states);
    const tab = { id: 7, windowId: 3, url: 'https://example.com/docs' };
    const captureVisibleTab = vi.fn(async () => 'data:image/png;base64,AAAA');
    const platform: CapturePlatform = {
      queryActiveTab: vi.fn(async () => tab),
      captureVisibleTab,
      download: vi.fn(async () => 1),
      scan: vi.fn(async () => metrics()),
      scroll: vi.fn(async () => ({ actual: { x: 0, y: 0 }, documentNow: metrics().document, elapsedMs: 0 })),
      restore: vi.fn(async () => undefined),
    };
    const coordinator = createCaptureCoordinator({ platform, jobs, now: () => '2026-08-20T00:00:00.000Z' });

    await expect(coordinator.start({ request: captureRequest('fullPage') })).rejects.toThrow('duplicate tiles');
    expect(captureVisibleTab).toHaveBeenCalledTimes(1);
    expect(states.at(-1)?.error?.code).toBe('E_VALIDATION');
  });

  it('hides the page progress overlay before the first screenshot', async () => {
    const states: JobState[] = [];
    const jobs = createJobs(states);
    const progressUpdates: Array<{ phase: string; visible?: boolean }> = [];
    const tab = { id: 7, windowId: 3, url: 'https://example.com/docs' };
    const platform: CapturePlatform = {
      queryActiveTab: vi.fn(async () => tab),
      captureVisibleTab: vi.fn(async () => 'data:image/png;base64,AAAA'),
      download: vi.fn(async () => 1),
      scan: vi.fn(async () => metrics()),
      progress: vi.fn(async (_tabId, update) => { progressUpdates.push({ phase: update.phase, visible: update.visible }); }),
      scroll: vi.fn(async () => { throw new Error('stop after progress assertion'); }),
      restore: vi.fn(async () => undefined),
    };
    const coordinator = createCaptureCoordinator({ platform, jobs, now: () => '2026-08-20T00:00:00.000Z' });

    await expect(coordinator.start({ request: captureRequest('fullPage') })).rejects.toThrow('stop after progress assertion');
    expect(progressUpdates.find((update) => update.phase === 'capturing')?.visible).toBe(false);
  });
});
