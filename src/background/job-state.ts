import type { JobState } from '../shared/types/capture';

const key = 'activeJobs';

export interface SessionStorageLike {
  get(key: string): Promise<Record<string, unknown>>;
  set(value: Record<string, unknown>): Promise<void>;
}

const terminalPhases = new Set<JobState['phase']>(['done', 'cancelled', 'failed']);

export function createJobStateStore(storage: SessionStorageLike = chrome.storage.session) {
  const list = async (): Promise<JobState[]> => {
    const value = await storage.get(key);
    return (value[key] as JobState[] | undefined) ?? [];
  };
  const put = async (job: JobState): Promise<void> => {
    const jobs = await list();
    const next = jobs.filter((item) => item.jobId !== job.jobId);
    next.push(job);
    await storage.set({ [key]: next });
  };
  const remove = async (jobId: string): Promise<void> => {
    const jobs = await list();
    await storage.set({ [key]: jobs.filter((job) => job.jobId !== jobId) });
  };
  const clear = async (): Promise<void> => { await storage.set({ [key]: [] }); };
  const listActive = async (): Promise<JobState[]> => (await list()).filter((job) => !terminalPhases.has(job.phase));
  return { list, listActive, put, remove, clear };
}
