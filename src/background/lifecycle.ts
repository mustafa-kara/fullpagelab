import { nowIso } from '../shared/ids';
import { createError } from '../shared/messages';
import type { JobState } from '../shared/types/capture';

export interface RecoverableJobStore {
  listActive(): Promise<JobState[]>;
  put(job: JobState): Promise<void>;
}

export async function recoverInterruptedJobs(store: RecoverableJobStore, restore: (job: JobState) => Promise<boolean> = async () => false): Promise<JobState[]> {
  const recovered: JobState[] = [];
  for (const job of await store.listActive()) {
    const restored = await restore(job);
    if (restored) continue;
    const failed: JobState = {
      ...job,
      phase: 'failed',
      updatedAt: nowIso(),
      finishedAt: nowIso(),
      error: createError('E_SW_RESTART', 'The service worker restarted before this capture finished.', true),
      log: [...job.log, 'Service worker restart detected; job marked failed.'],
    };
    await store.put(failed);
    recovered.push(failed);
  }
  return recovered;
}

export function isTerminalJob(job: JobState): boolean {
  return job.phase === 'done' || job.phase === 'cancelled' || job.phase === 'failed';
}
