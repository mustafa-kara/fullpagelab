import { createPreparePlan } from '../../content/preparer';
import { createId } from '../../shared/ids';
import type { CaptureMode, CaptureRequest, JobProgress, JobState, PageMetrics, PreparePlan, PreparedState, ScanOptions, ScrollStep } from '../../shared/types/capture';
import type { ErrorCode, ErrorInfo, Point, Size } from '../../shared/types/primitives';
import type { CaptureResultService } from '../result/types';
import { VisibleTabBackend } from './backends/visible-tab';
import { dataUrlToBlob, stitchVerticalTiles, type CaptureTile } from './image';
import { CaptureTimeoutError, appendJobLog, phaseDeadlineMs, withPhaseDeadline } from './job';
import { createCapturePlan, createVerticalPlan, extendCapturePlan, recomputeStepFromAck } from './plan';
import { createCaptureRateLimiter } from './rate-limiter';
import { assertAcknowledgedProgress } from './scroll-progress';
import { CaptureValidationError, ensureActiveCaptureTab, validateCaptureTab } from './validation';

export { createCapturePlan, createVerticalPlan, createNestedPlan, extendCapturePlan, recomputeStepFromAck } from './plan';
export type { NestedPlanInput, NestedScrollPlan, NestedScrollStep, VerticalPlanInput } from './plan';
export { dataUrlToBlob } from './image';
export { VisibleTabBackend } from './backends/visible-tab';

export interface CaptureTab {
  id: number;
  windowId: number;
  url?: string;
  title?: string;
  active?: boolean;
  discarded?: boolean;
  status?: 'loading' | 'complete' | 'unloaded';
  windowState?: string;
  windowVisible?: boolean;
}

export interface CapturePlatform {
  queryActiveTab(): Promise<CaptureTab | undefined>;
  captureVisibleTab(windowId: number): Promise<string>;
  download(blob: Blob, filename: string): Promise<number>;
  focusTab?(tabId: number, windowId: number): Promise<void>;
  scan?(tabId: number, options?: ScanOptions): Promise<PageMetrics>;
  prepare?(tabId: number, plan: PreparePlan, metrics: PageMetrics): Promise<PreparedState>;
  progress?(tabId: number, update: JobProgress): Promise<void>;
  scroll?(tabId: number, point: Point, meta?: { stepIndex: number; totalSteps: number; settleMs: number }): Promise<Point | { actual: Point; documentNow?: Size; elapsedMs?: number }>;
  restore?(tabId: number, point: Point): Promise<void>;
}

export interface CaptureJobStore {
  list(): Promise<JobState[]>;
  put(job: JobState): Promise<void>;
}

export interface CaptureCoordinatorOptions {
  platform: CapturePlatform;
  jobs: CaptureJobStore;
  resultService?: CaptureResultService;
  now?: () => string;
  rateLimiter?: Pick<ReturnType<typeof createCaptureRateLimiter>, 'run'>;
  onJobUpdate?: (job: JobState) => void | Promise<void>;
}

export interface CaptureStartInput {
  request: CaptureRequest;
  tab?: CaptureTab;
}

export interface CaptureStartResult {
  jobId: string;
}

const supportedModes = new Set<CaptureMode>(['visible', 'fullPage']);
const terminalPhases = new Set<JobState['phase']>(['done', 'cancelled', 'failed']);

export function captureFilename(tab: CaptureTab, mode: CaptureMode): string {
  let host = 'page';
  try {
    host = new URL(tab.url ?? '').hostname || host;
  } catch {
    // The tab can expose no URL on restricted pages; the generic name is safe.
  }
  const safeHost = host.replace(/[^a-z0-9.-]+/gi, '-').replace(/^-+|-+$/g, '') || 'page';
  const safeMode = mode.replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
  return `fullpagelab_${safeHost}_${safeMode}.png`;
}

function initialJob(jobId: string, request: CaptureRequest, tab: CaptureTab, now: string): JobState {
  return {
    jobId,
    request: {
      ...structuredClone(request),
      id: jobId,
      target: {
        ...structuredClone(request.target),
        tabId: tab.id,
        windowId: tab.windowId,
        url: tab.url ?? 'about:blank',
        title: tab.title,
      },
    },
    tabId: tab.id,
    windowId: tab.windowId,
    backend: 'visibleTab',
    phase: 'preparing',
    startedAt: now,
    updatedAt: now,
    progress: { done: 0, total: 1 },
    tilesWritten: 0,
    log: [],
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Capture failed.';
}

function isHttpPage(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const protocol = new URL(url).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function elapsedMs(job: JobState, endedAt: string): number {
  const started = Date.parse(job.startedAt);
  const ended = Date.parse(endedAt);
  return Number.isFinite(started) && Number.isFinite(ended) ? Math.max(0, ended - started) : 0;
}

function errorInfo(error: unknown, at: string): ErrorInfo {
  let code: ErrorCode = 'E_UNKNOWN';
  let recoverable = true;
  if (error instanceof CaptureValidationError) {
    code = error.code;
    recoverable = error.recoverable;
  } else if (error instanceof CaptureTimeoutError) {
    code = error.code;
    recoverable = true;
  }
  return { code, message: errorMessage(error), userMessageKey: `error.${code}.body`, recoverable, at };
}

export function createCaptureCoordinator({
  platform,
  jobs,
  resultService,
  now = () => new Date().toISOString(),
  rateLimiter = createCaptureRateLimiter(),
  onJobUpdate,
}: CaptureCoordinatorOptions) {
  const cancelled = new Set<string>();
  const visibleBackend = new VisibleTabBackend({ platform, rateLimiter });

  async function update(job: JobState, patch: Partial<JobState>, logMessage?: string): Promise<JobState> {
    const next = {
      ...job,
      ...patch,
      updatedAt: now(),
      log: appendJobLog(patch.log ?? job.log, logMessage ?? ''),
    };
    await jobs.put(next);
    try {
      await onJobUpdate?.(next);
    } catch {
      // Progress subscribers must not be able to break a capture job.
    }
    return next;
  }

  function assertNotCancelled(jobId: string): void {
    if (cancelled.has(jobId)) throw new Error('Capture cancelled.');
  }

  async function runVisible(job: JobState): Promise<JobState> {
    let current = job;
    let metrics: PageMetrics | undefined;
    if (isHttpPage(current.request.target.url) && platform.scan) {
      current = await update(current, { phase: 'preparing' }, 'Scanning the page for visible-area preparation.');
      try {
        metrics = await withPhaseDeadline('preparing', phaseDeadlineMs('preparing', current.request.options), platform.scan(current.tabId));
        current = await update(current, { metrics }, 'Page metrics collected for visible-area preparation.');
        if (platform.prepare) {
          const preparePlan = createPreparePlan(current.request.options, metrics);
          await withPhaseDeadline('preparing', phaseDeadlineMs('preparing', current.request.options), platform.prepare(current.tabId, preparePlan, metrics));
          current = await update(current, {}, 'Page prepared for visible-area capture.');
        }
      } catch (error) {
        current = await update(current, {}, `Visible-area preparation skipped: ${errorMessage(error)}`);
      }
    }

    try {
      current = await update(current, { phase: 'capturing' }, 'Capturing the visible tab.');
      assertNotCancelled(current.jobId);
      const dataUrl = await withPhaseDeadline(
        'capturing',
        phaseDeadlineMs('capturing', current.request.options),
        visibleBackend.capture({ id: current.tabId, windowId: current.windowId }),
      );
      assertNotCancelled(current.jobId);
      current = await update(current, { phase: 'exporting', progress: { done: 0, total: 1 }, tilesWritten: 1 }, 'Saving the capture result.');
      const result = resultService
        ? await withPhaseDeadline('exporting', phaseDeadlineMs('exporting', current.request.options), resultService.save({ job: current, original: dataUrlToBlob(dataUrl), durationMs: elapsedMs(current, now()) }))
        : undefined;
      return update(current, { phase: 'done', finishedAt: now(), progress: { done: 1, total: 1 }, captureId: result?.id }, 'Capture ready.');
    } finally {
      if (metrics) await platform.restore?.(current.tabId, metrics.scroll).catch(() => undefined);
    }
  }

  async function runFullPage(job: JobState): Promise<JobState> {
    if (!platform.scan || !platform.scroll || !platform.restore) throw new Error('Full-page capture is unavailable on this build.');
    const expected = { id: job.tabId, windowId: job.windowId };
    let current = job;
    let metrics: PageMetrics | undefined;
    const tiles: CaptureTile[] = [];
    try {
      current = await update(current, { phase: 'preparing' }, 'Scanning the page.');
      await ensureActiveCaptureTab(platform, expected, true);
      metrics = await withPhaseDeadline('preparing', phaseDeadlineMs('preparing', current.request.options), platform.scan(current.tabId));
      if (metrics.isRestricted) throw new CaptureValidationError('E_RESTRICTED_PAGE', 'This page cannot be captured by the extension.', false);
      current = await update(current, { metrics }, 'Page metrics collected.');

      if (platform.prepare) {
        const preparePlan = createPreparePlan(current.request.options, metrics);
        await withPhaseDeadline('preparing', phaseDeadlineMs('preparing', current.request.options), platform.prepare(current.tabId, preparePlan, metrics));
        const preparedMetrics = await platform.scan?.(current.tabId, { findScrollContainers: true, findFixedElements: true, findIframes: true });
        if (preparedMetrics) {
          if (preparedMetrics.viewport.width !== metrics.viewport.width || preparedMetrics.viewport.height !== metrics.viewport.height || preparedMetrics.dpr !== metrics.dpr || preparedMetrics.zoom !== metrics.zoom) {
            throw new CaptureValidationError('E_VALIDATION', 'The viewport changed while the page was being prepared.', true);
          }
          metrics = preparedMetrics;
        }
        current = await update(current, {}, 'Page prepared; original styles are guarded for restore.');
      }

      if (current.request.options.delayMs > 0) {
        current = await update(current, { phase: 'countdown' }, 'Countdown before capture.');
        await platform.progress?.(current.tabId, { jobId: current.jobId, phase: 'countdown', done: 0, total: 1, message: 'Countdown before capture.', visible: true, allowCancel: true });
        await withPhaseDeadline('countdown', phaseDeadlineMs('countdown', current.request.options), new Promise<void>((resolve) => setTimeout(resolve, current.request.options.delayMs)));
        assertNotCancelled(current.jobId);
      }

      let plan = createCapturePlan({ metrics, options: current.request.options, mode: 'fullPage' });
      current = await update(current, { phase: 'capturing', metrics, plan, progress: { done: 0, total: plan.steps.length } }, 'Capturing planned tiles.');
      await platform.progress?.(current.tabId, { jobId: current.jobId, phase: 'capturing', done: 0, total: plan.steps.length, message: 'Capturing planned tiles.', visible: false, allowCancel: true });
      await withPhaseDeadline('capturing', phaseDeadlineMs('capturing', current.request.options), (async () => {
        let stepIndex = 0;
        let previousAck: { step: ScrollStep; actual: Point } | undefined;
        while (stepIndex < plan.steps.length) {
          const step = plan.steps[stepIndex];
          if (!step) break;
          assertNotCancelled(current.jobId);
          await ensureActiveCaptureTab(platform, expected, true);
          const scrollResult = await platform.scroll?.(current.tabId, step.scrollTo, { stepIndex: step.index, totalSteps: plan.steps.length, settleMs: current.request.options.limits.stepSettleMs });
          if (!scrollResult) throw new Error('Page scrolling is unavailable on this build.');
          const actual = 'actual' in scrollResult ? scrollResult.actual : scrollResult;
          let observedDocument = 'actual' in scrollResult ? scrollResult.documentNow : undefined;
          assertAcknowledgedProgress(plan, step, actual, previousAck);
          const acknowledgedStep = recomputeStepFromAck(plan, step, actual);
          assertNotCancelled(current.jobId);
          const refreshedMetrics = await platform.scan?.(current.tabId, { findScrollContainers: false, findFixedElements: false, findIframes: false });
          if (refreshedMetrics && (refreshedMetrics.viewport.width !== metrics.viewport.width || refreshedMetrics.viewport.height !== metrics.viewport.height || refreshedMetrics.dpr !== metrics.dpr || refreshedMetrics.zoom !== metrics.zoom)) {
            throw new CaptureValidationError('E_VALIDATION', 'The viewport changed during capture; the result would not be deterministic.', true);
          }
          observedDocument ??= refreshedMetrics?.document;
          await platform.progress?.(current.tabId, { jobId: current.jobId, phase: 'capturing', done: tiles.length, total: plan.steps.length, visible: false, allowCancel: true });
          let dataUrl: string;
          try {
            dataUrl = await visibleBackend.capture(expected, true);
          } finally {
            await platform.progress?.(current.tabId, { jobId: current.jobId, phase: 'capturing', done: tiles.length, total: plan.steps.length, visible: true, allowCancel: true }).catch(() => undefined);
          }
          assertNotCancelled(current.jobId);
          tiles.push({ dataUrl, actual, step: acknowledgedStep });
          previousAck = { step, actual };
          if (observedDocument && observedDocument.height > plan.content.height + 50) {
            const extended = extendCapturePlan(plan, observedDocument, current.request.options.limits);
            if (extended.steps.length > plan.steps.length || extended.content.height > plan.content.height || extended.content.width > plan.content.width) {
              plan = extended;
              metrics = { ...metrics, document: { width: Math.max(metrics.document.width, observedDocument.width), height: Math.max(metrics.document.height, observedDocument.height) } };
              current = await update(current, { metrics, plan }, 'Page height changed while lazy content loaded; capture plan extended.');
            }
          }
          stepIndex += 1;
          current = await update(current, { progress: { done: tiles.length, total: plan.steps.length }, tilesWritten: tiles.length });
        }
      })());

      current = await update(current, { phase: 'stitching' }, 'Stitching captured tiles.');
      const stitched = await withPhaseDeadline('stitching', phaseDeadlineMs('stitching', current.request.options), stitchVerticalTiles(tiles, plan));
      current = await update(current, { phase: 'exporting' }, 'Saving the full-page result.');
      const result = resultService
        ? await withPhaseDeadline('exporting', phaseDeadlineMs('exporting', current.request.options), resultService.save({ job: current, original: stitched, metrics, durationMs: elapsedMs(current, now()) }))
        : undefined;
      return update(current, { phase: 'done', finishedAt: now(), progress: { done: plan.steps.length, total: plan.steps.length }, captureId: result?.id }, 'Capture ready.');
    } finally {
      if (metrics) await platform.restore(current.tabId, metrics.scroll).catch(() => undefined);
    }
  }

  async function latestJob(jobId: string, fallback: JobState): Promise<JobState> {
    return (await jobs.list()).find((item) => item.jobId === jobId) ?? fallback;
  }

  async function run(job: JobState): Promise<JobState> {
    try {
      if (job.request.mode === 'visible') return await runVisible(job);
      if (job.request.mode === 'fullPage') return await runFullPage(job);
      throw new Error(`Capture mode "${job.request.mode}" is not available yet.`);
    } catch (error) {
      const current = await latestJob(job.jobId, job);
      const cancelledByUser = cancelled.has(job.jobId) || errorMessage(error) === 'Capture cancelled.' || current.phase === 'cancelled';
      if (terminalPhases.has(current.phase)) return current;
      return update(current, {
        phase: cancelledByUser ? 'cancelled' : 'failed',
        finishedAt: now(),
        error: cancelledByUser ? undefined : errorInfo(error, now()),
      }, cancelledByUser ? 'Capture cancelled.' : `Capture failed: ${errorMessage(error)}`);
    } finally {
      cancelled.delete(job.jobId);
    }
  }

  async function createJob(input: CaptureStartInput): Promise<JobState> {
    if (!supportedModes.has(input.request.mode)) throw new Error(`Capture mode "${input.request.mode}" is not available yet.`);
    const tab = input.tab ?? await platform.queryActiveTab();
    if (!tab) throw new Error('No active tab is available.');
    validateCaptureTab(tab, input.request.mode !== 'visible');
    const job = initialJob(createId(), input.request, tab, now());
    await jobs.put(job);
    return job;
  }

  async function startDetached(input: CaptureStartInput): Promise<CaptureStartResult> {
    const job = await createJob(input);
    void run(job);
    return { jobId: job.jobId };
  }

  return {
    async start(input: CaptureStartInput): Promise<CaptureStartResult> {
      const job = await createJob(input);
      const terminal = await run(job);
      if (terminal.phase === 'failed') throw new Error(terminal.error?.message ?? 'Capture failed.');
      return { jobId: job.jobId };
    },
    startDetached,
    async cancel(jobId: string): Promise<void> {
      cancelled.add(jobId);
      const job = (await jobs.list()).find((item) => item.jobId === jobId);
      if (!job || terminalPhases.has(job.phase)) return;
      await update(job, { phase: 'cancelled', finishedAt: now(), error: undefined }, 'Capture cancelled.');
    },
  };
}
