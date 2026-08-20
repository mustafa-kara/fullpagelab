// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { scrollPage } from '../../src/content/scroller';

describe('page scroller', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retries the first scroll when the page does not acknowledge the top position', async () => {
    let scrollY = 120;
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => scrollY });
    Object.defineProperty(window, 'scrollX', { configurable: true, get: () => 0 });

    let calls = 0;
    vi.spyOn(window, 'scrollTo').mockImplementation((options) => {
      calls += 1;
      const top = typeof options === 'object' ? Number((options as ScrollToOptions).top ?? 0) : 0;
      scrollY = calls === 1 ? 120 : top;
    });

    const result = await scrollPage({ stepIndex: 0, x: 0, y: 0, afterFirstTile: false, settleMs: 0 });

    expect(calls).toBeGreaterThanOrEqual(2);
    expect(result.actual).toEqual({ x: 0, y: 0 });
  });
});
