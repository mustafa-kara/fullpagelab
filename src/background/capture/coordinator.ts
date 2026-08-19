import { createId } from '../../shared/ids';
import type { CaptureMode, CaptureRequest, JobState, PageMetrics, ScrollPlan } from '../../shared/types/capture';
import type { Point, Rect } from '../../shared/types/primitives';
import type { Settings } from '../../shared/types/settings';
import { dataUrlToBlob, stitchVerticalTiles, type CaptureTile } from './image';
import { createCaptureRateLimiter } from './rate-limiter';

export { dataUrlToBlob } from './image';

export interface CaptureTab {
  id: number;
  windowId: number;
  url?: string;
  title?: string;
}

export interface CapturePlatform {
  queryActiveTab(): Promise<CaptureTab | undefined>;
  captureVisibleTab(windowId: number): Promise<string>;
  download(blob: Blob, filename: string): Promise<number>;
  scan?(tabId: number): Promise<PageMetrics>;
  scroll?(tabId: number, point: Point): Promise<Point>;
  restore?(tabId: number, point: Point): Promise<void>;
}

export interface CaptureJobStore {
  list(): Promise<JobState[]>;
  put(job: JobState): Promise<void>;
}

export interface CaptureCoordinatorOptions {
  platform: CapturePlatform;
  jobs: CaptureJobStore;
  now?: () => string;
  rateLimiter?: Pick<ReturnType<typeof createCaptureRateLimiter>, 'run'>;
}

export interface CaptureStartInput {
  mode: CaptureMode;
  settings: Settings;
}

export interface CaptureStartResult {
  jobId: string;
}

const supportedModes = new Set<CaptureMode>(['visible', 'fullPage']);

interface VerticalPlanInput {
  viewport: { width: number; height: number };
  document: { width: number; height: number };
  scroll: Point;
  dpr: number;
}

export function createVerticalPlan(input: VerticalPlanInput): ScrollPlan {
  const viewportWidth = Math.max(1, input.viewport.width);
  const viewportHeight = Math.max(1, input.viewport.height);
  const contentWidth = Math.max(viewportWidth, input.document.width);
  const contentHeight = Math.max(1, input.document.height);
  const maxScrollY = Math.max(0, contentHeight - viewportHeight);
  const steps: ScrollPlan['steps'] = [];
  const positions: number[] = [0];
  while ((positions.at(-1) ?? 0) < maxScrollY) {
    const next = Math.min(maxScrollY, (positions.at(-1) ?? 0) + viewportHeight);
    if (next === positions.at(-1)) break;
    positions.push(next);
  }
  let placeY = 0;
  positions.forEach((scrollY, index) => {
    const cropY = Math.max(0, placeY - scrollY);
    const cropHeight = Math.min(viewportHeight - cropY, contentHeight - placeY);
    const crop: Rect = { x: 0, y: cropY, width: viewportWidth, height: Math.max(1, cropHeight) };
    steps.push({
      index,
      row: index,
      col: 0,
      scrollTo: { x: input.scroll.x, y: scrollY },
      placeAt: { x: 0, y: placeY },
      cropFromViewport: crop,
    });
    placeY += crop.height;
  });
  return {
    root: 'document',
    viewport: { width: viewportWidth, height: viewportHeight },
    content: { width: contentWidth, height: contentHeight },
    origin: input.scroll,
    steps,
    cols: 1,
    rows: steps.length,
    overlapCss: 0,
    dpr: Math.max(1, input.dpr),
    zoom: 1,
  };
}

export function captureFilename(tab: CaptureTab, mode: CaptureMode): string {
  let host = 'page';
  try {
    host = new URL(tab.url ?? '').hostname || host;
  } catch {
    // The tab can expose no URL on restricted pages; the generic name is safe.
  }
  const safeHost = host.replace(/[^a-z0-9.-]+/gi, '-').replace(/^-+|-+$/g, '') || 'page';
  const safeMode = mode.replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
  return `pageshot_${safeHost}_${safeMode}.png`;
}

function requestFor(jobId: string, mode: CaptureMode, tab: CaptureTab, settings: Settings): CaptureRequest {
  return {
    id: jobId,
    mode,
    target: { tabId: tab.id, windowId: tab.windowId, url: tab.url ?? 'about:blank' },
    options: structuredClone(settings.capture),
    export: structuredClone(settings.export),
    trigger: 'popup',
  };
}

function initialJob(jobId: string, mode: CaptureMode, tab: CaptureTab, settings: Settings, now: string): JobState {
  return {
    jobId,
    request: requestFor(jobId, mode, tab, settings),
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

export function createCaptureCoordinator({ platform, jobs, now = () => new Date().toISOString(), rateLimiter = createCaptureRateLimiter() }: CaptureCoordinatorOptions) {
  const cancelled = new Set<string>();

  function captureVisibleTab(windowId: number): Promise<string> {
    return rateLimiter.run(windowId, () => platform.captureVisibleTab(windowId));
  }

  async function update(job: JobState, patch: Partial<JobState>): Promise<JobState> {
    const next = { ...job, ...patch, updatedAt: now() };
    await jobs.put(next);
    return next;
  }

  async function runVisible(job: JobState): Promise<JobState> {
    let current = await update(job, { phase: 'capturing', log: [...job.log, 'Capturing the visible tab.'] });
    if (cancelled.has(current.jobId)) throw new Error('Capture cancelled.');
    const dataUrl = await captureVisibleTab(current.windowId);
    if (cancelled.has(current.jobId)) throw new Error('Capture cancelled.');
    current = await update(current, { phase: 'exporting', progress: { done: 0, total: 1 }, tilesWritten: 1 });
    await platform.download(dataUrlToBlob(dataUrl), captureFilename({ id: current.tabId, windowId: current.windowId, url: current.request.target.url }, current.request.mode));
    return update(current, { phase: 'done', finishedAt: now(), progress: { done: 1, total: 1 }, log: [...current.log, 'PNG downloaded.'] });
  }

  async function runFullPage(job: JobState): Promise<JobState> {
    if (!platform.scan || !platform.scroll || !platform.restore) throw new Error('Full-page capture is unavailable on this build.');
    const metrics = await platform.scan(job.tabId);
    if (metrics.isRestricted) throw new Error('This page cannot be captured by the extension.');
    const plan = createVerticalPlan(metrics);
    let current = await update(job, { phase: 'capturing', metrics, plan, progress: { done: 0, total: plan.steps.length } });
    const tiles: CaptureTile[] = [];
    try {
      for (const step of plan.steps) {
        if (cancelled.has(current.jobId)) throw new Error('Capture cancelled.');
        const actual = await platform.scroll(current.tabId, step.scrollTo);
        const dataUrl = await captureVisibleTab(current.windowId);
        tiles.push({ dataUrl, actual, step });
        current = await update(current, { progress: { done: tiles.length, total: plan.steps.length }, tilesWritten: tiles.length });
      }
      current = await update(current, { phase: 'stitching' });
      const stitched = await stitchVerticalTiles(tiles, plan);
      current = await update(current, { phase: 'exporting' });
      await platform.download(stitched, captureFilename({ id: current.tabId, windowId: current.windowId, url: current.request.target.url }, current.request.mode));
      return update(current, { phase: 'done', finishedAt: now(), progress: { done: plan.steps.length, total: plan.steps.length }, log: [...current.log, 'Full-page PNG downloaded.'] });
    } finally {
      await platform.restore(current.tabId, metrics.scroll).catch(() => undefined);
    }
  }

  async function run(job: JobState): Promise<JobState> {
    try {
      if (job.request.mode === 'visible') return await runVisible(job);
      if (job.request.mode === 'fullPage') return await runFullPage(job);
      throw new Error(`Capture mode "${job.request.mode}" is not available yet.`);
    } catch (error) {
      const cancelledByUser = cancelled.has(job.jobId) || errorMessage(error) === 'Capture cancelled.';
      const terminal = await update(job, {
        phase: cancelledByUser ? 'cancelled' : 'failed',
        finishedAt: now(),
        error: cancelledByUser ? undefined : { code: 'E_UNKNOWN', message: errorMessage(error), userMessageKey: 'error.E_UNKNOWN.body', recoverable: true, at: now() },
      });
      return terminal;
    } finally {
      cancelled.delete(job.jobId);
    }
  }

  return {
    async start(input: CaptureStartInput): Promise<CaptureStartResult> {
      if (!supportedModes.has(input.mode)) throw new Error(`Capture mode "${input.mode}" is not available yet.`);
      const tab = await platform.queryActiveTab();
      if (!tab) throw new Error('No active tab is available.');
      const job = initialJob(createId(), input.mode, tab, input.settings, now());
      await jobs.put(job);
      const terminal = await run(job);
      if (terminal.phase === 'failed') throw new Error(terminal.error?.message ?? 'Capture failed.');
      return { jobId: job.jobId };
    },
    async cancel(jobId: string): Promise<void> {
      cancelled.add(jobId);
      const job = (await jobs.list()).find((item) => item.jobId === jobId);
      if (!job || ['done', 'cancelled', 'failed'].includes(job.phase)) return;
      await update(job, { phase: 'cancelled', finishedAt: now(), error: undefined });
    },
  };
}
