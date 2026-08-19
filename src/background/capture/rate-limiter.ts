export interface CaptureRateLimiterOptions {
  minIntervalMs?: number;
  retryDelaysMs?: readonly number[];
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return '';
  }
}

export function isCaptureRateLimitError(error: unknown): boolean {
  return /MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND|quota|rate.?limit/i.test(errorText(error));
}

export function createCaptureRateLimiter({
  minIntervalMs = 500,
  retryDelaysMs = [750, 1500, 3000],
  now = () => Date.now(),
  sleep = defaultSleep,
}: CaptureRateLimiterOptions = {}) {
  const queues = new Map<number, Promise<void>>();
  const lastStartedAt = new Map<number, number>();

  async function run<T>(windowId: number, operation: () => Promise<T>): Promise<T> {
    const previous = queues.get(windowId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const queued = previous.then(() => current);
    queues.set(windowId, queued);
    await previous;

    try {
      for (let attempt = 0; ; attempt += 1) {
        const elapsed = now() - (lastStartedAt.get(windowId) ?? Number.NEGATIVE_INFINITY);
        const spacing = Math.max(0, minIntervalMs - elapsed);
        if (spacing > 0) await sleep(spacing);
        lastStartedAt.set(windowId, now());
        try {
          return await operation();
        } catch (error) {
          const retryDelay = retryDelaysMs[attempt];
          if (retryDelay === undefined || !isCaptureRateLimitError(error)) throw error;
          await sleep(retryDelay);
        }
      }
    } finally {
      release();
      if (queues.get(windowId) === queued) queues.delete(windowId);
    }
  }

  return { run };
}
