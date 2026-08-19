import { describe, expect, it, vi } from 'vitest';
import { createCaptureRateLimiter } from '../../src/background/capture/rate-limiter';

describe('capture rate limiter', () => {
  it('keeps calls for one window at least 500 ms apart', async () => {
    let clock = 0;
    const sleeps: number[] = [];
    const limiter = createCaptureRateLimiter({ now: () => clock, sleep: async (ms) => { sleeps.push(ms); clock += ms; } });
    const capture = vi.fn(async () => 'ok');

    await limiter.run(7, capture);
    await limiter.run(7, capture);

    expect(capture).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([500]);
  });

  it('retries Chrome quota errors with the documented backoff', async () => {
    let clock = 0;
    const sleeps: number[] = [];
    const limiter = createCaptureRateLimiter({ now: () => clock, sleep: async (ms) => { sleeps.push(ms); clock += ms; } });
    const capture = vi.fn()
      .mockRejectedValueOnce(new Error('MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND'))
      .mockResolvedValueOnce('ok');

    await expect(limiter.run(7, capture)).resolves.toBe('ok');
    expect(sleeps).toEqual([750]);
    expect(capture).toHaveBeenCalledTimes(2);
  });
});
