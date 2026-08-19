import { describe, expect, it, vi } from 'vitest';
import { createCaptureCoordinator, createVerticalPlan, type CapturePlatform } from '../../src/background/capture/coordinator';
import { defaultSettings } from '../../src/shared/defaults';
import type { JobState } from '../../src/shared/types/capture';

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

describe('capture coordinator', () => {
  it('captures the visible tab and downloads a PNG', async () => {
    const jobs = createJobs();
    const platform: CapturePlatform = {
      queryActiveTab: vi.fn(async () => ({ id: 7, windowId: 3, url: 'https://example.com/docs', title: 'Example docs' })),
      captureVisibleTab: vi.fn(async () => 'data:image/png;base64,AAAA'),
      download: vi.fn(async () => 11),
    };
    const coordinator = createCaptureCoordinator({ platform, jobs, now: () => '2026-08-19T14:00:00.000Z' });

    const result = await coordinator.start({ mode: 'visible', settings: structuredClone(defaultSettings) });

    expect(result.jobId).toBeTruthy();
    expect(platform.captureVisibleTab).toHaveBeenCalledWith(3);
    expect(platform.download).toHaveBeenCalledWith(expect.any(Blob), 'pageshot_example.com_visible.png');
    expect(jobs.states.at(-1)?.phase).toBe('done');
    expect(jobs.states.at(-1)?.progress).toEqual({ done: 1, total: 1 });
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
