import type { CaptureOptions, JobPhase, JobState } from '../../shared/types/capture';

export const MAX_JOB_LOG_LINES = 200;

const terminalPhases = new Set<JobPhase>(['done', 'cancelled', 'failed']);

const allowedTransitions: Record<JobPhase, ReadonlySet<JobPhase>> = {
  idle: new Set(['preparing', 'cancelled', 'failed']),
  preparing: new Set(['countdown', 'capturing', 'failed', 'cancelled']),
  countdown: new Set(['capturing', 'failed', 'cancelled']),
  capturing: new Set(['stitching', 'exporting', 'failed', 'cancelled']),
  stitching: new Set(['exporting', 'failed', 'cancelled']),
  exporting: new Set(['done', 'failed', 'cancelled']),
  done: new Set(),
  cancelled: new Set(),
  failed: new Set(),
};

export class CaptureTimeoutError extends Error {
  readonly code = 'E_TIMEOUT' as const;
  readonly phase: JobPhase;

  constructor(phase: JobPhase, timeoutMs: number) {
    super(`Capture phase "${phase}" exceeded its ${timeoutMs} ms deadline.`);
    this.name = 'CaptureTimeoutError';
    this.phase = phase;
  }
}

export function appendJobLog(log: readonly string[], message: string, maxLines = MAX_JOB_LOG_LINES): string[] {
  const normalized = message.trim();
  if (!normalized) return [...log].slice(-maxLines);
  const safeMax = Math.max(1, Math.floor(maxLines));
  return [...log, normalized].slice(-safeMax);
}

export function canTransition(from: JobPhase, to: JobPhase): boolean {
  return from === to || allowedTransitions[from].has(to);
}

export function transitionJob(
  job: JobState,
  phase: JobPhase,
  now: string,
  patch: Partial<JobState> = {},
  logMessage?: string,
): JobState {
  if (!canTransition(job.phase, phase)) {
    throw new Error(`Invalid capture job transition: ${job.phase} -> ${phase}.`);
  }
  return {
    ...job,
    ...patch,
    phase,
    updatedAt: now,
    log: logMessage === undefined ? appendJobLog(job.log, '') : appendJobLog(job.log, logMessage),
  };
}

export function phaseDeadlineMs(phase: JobPhase, options: CaptureOptions): number | undefined {
  switch (phase) {
    case 'preparing':
      return Math.max(10_000, Math.min(options.limits.maxDurationMs, 30_000));
    case 'countdown':
      return Math.max(1_000, options.delayMs + 1_000);
    case 'capturing':
      return Math.max(1_000, options.limits.maxDurationMs);
    case 'stitching':
      return Math.max(10_000, Math.min(options.limits.maxDurationMs, 60_000));
    case 'exporting':
      return Math.max(10_000, Math.min(options.limits.maxDurationMs, 60_000));
    default:
      return undefined;
  }
}

export function isTerminalPhase(phase: JobPhase): boolean {
  return terminalPhases.has(phase);
}

export async function withPhaseDeadline<T>(phase: JobPhase, timeoutMs: number | undefined, operation: Promise<T>): Promise<T> {
  if (timeoutMs === undefined || !Number.isFinite(timeoutMs)) return operation;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new CaptureTimeoutError(phase, timeoutMs)), timeoutMs);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
