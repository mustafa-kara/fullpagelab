// @vitest-environment happy-dom

import { describe, expect, it, vi } from 'vitest';
import { createPreparePlan, preparePage } from '../../src/content/preparer';
import { ProgressOverlay } from '../../src/content/progress-overlay';
import { scanPage } from '../../src/content/scanner';
import { defaultSettings } from '../../src/shared/defaults';
import type { PageMetrics } from '../../src/shared/types/capture';

function metrics(): PageMetrics {
  return {
    url: 'https://example.com',
    title: 'Example',
    origin: 'https://example.com',
    viewport: { width: 800, height: 600 },
    document: { width: 800, height: 1_200 },
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
    userAgent: 'happy-dom',
    colorScheme: 'light',
  };
}

describe('content preparation and progress integration', () => {
  it('hides scrollbars in the top document and accessible same-origin frames, then restores them', async () => {
    document.body.innerHTML = '<div style="height: 2000px; overflow: auto">Scrollable content</div><iframe></iframe>';
    const frame = document.querySelector<HTMLIFrameElement>('iframe');
    const frameDocument = frame?.contentDocument;
    if (!frameDocument?.documentElement) throw new Error('Expected an accessible iframe document.');
    frameDocument.body.innerHTML = '<div style="height: 2000px; overflow: auto">Frame content</div><iframe></iframe>';
    const nestedFrameDocument = frameDocument.querySelector<HTMLIFrameElement>('iframe')?.contentDocument;
    if (!nestedFrameDocument?.documentElement) throw new Error('Expected an accessible nested iframe document.');
    nestedFrameDocument.body.innerHTML = '<div style="height: 2000px; overflow: auto">Nested frame content</div>';

    const options = structuredClone(defaultSettings.capture);
    options.lazyLoad.forceEagerImages = false;
    options.lazyLoad.waitImagesDecode = false;
    options.lazyLoad.waitFonts = false;
    options.pauseMedia = false;
    const preparation = await preparePage(createPreparePlan(options, metrics()), metrics());

    const topStyle = document.querySelector<HTMLStyleElement>('style[data-fullpagelab-preparation="scrollbars"]');
    const frameStyle = frameDocument.querySelector<HTMLStyleElement>('style[data-fullpagelab-preparation="scrollbars"]');
    const nestedFrameStyle = nestedFrameDocument.querySelector<HTMLStyleElement>('style[data-fullpagelab-preparation="scrollbars"]');
    for (const style of [topStyle, frameStyle, nestedFrameStyle]) {
      expect(style).not.toBeNull();
      expect(style?.textContent).toContain('scrollbar-width: none');
      expect(style?.textContent).toContain('width: 0');
      expect(style?.textContent).toContain('height: 0');
    }

    await preparation.restore();
    expect(document.querySelector('style[data-fullpagelab-preparation="scrollbars"]')).toBeNull();
    expect(frameDocument.querySelector('style[data-fullpagelab-preparation="scrollbars"]')).toBeNull();
    expect(nestedFrameDocument.querySelector('style[data-fullpagelab-preparation="scrollbars"]')).toBeNull();
  });

  it('continues preparation when an iframe document is inaccessible', async () => {
    document.body.innerHTML = '<iframe></iframe>';
    const frame = document.querySelector<HTMLIFrameElement>('iframe');
    if (!frame) throw new Error('Expected an iframe.');
    Object.defineProperty(frame, 'contentDocument', {
      configurable: true,
      get: () => {
        throw new DOMException('Blocked a frame with origin from accessing a cross-origin frame.');
      },
    });

    const options = structuredClone(defaultSettings.capture);
    options.lazyLoad.forceEagerImages = false;
    options.lazyLoad.waitImagesDecode = false;
    options.lazyLoad.waitFonts = false;
    options.pauseMedia = false;
    const preparation = await preparePage(createPreparePlan(options, metrics()), metrics());

    expect(document.querySelector('style[data-fullpagelab-preparation="scrollbars"]')).not.toBeNull();
    await preparation.restore();
    expect(document.querySelector('style[data-fullpagelab-preparation="scrollbars"]')).toBeNull();
  });

  it('scans the document and restores preparation styles exactly', async () => {
    document.documentElement.dir = 'rtl';
    document.body.innerHTML = '<div id="banner" style="display: block">Banner</div><main>Content</main>';
    const scanned = scanPage({ findScrollContainers: true, findFixedElements: true, findIframes: true });
    expect(scanned.direction).toBe('rtl');
    expect(scanned.isRestricted).toBe(false);

    const options = structuredClone(defaultSettings.capture);
    options.lazyLoad.forceEagerImages = false;
    options.lazyLoad.waitImagesDecode = false;
    options.lazyLoad.waitFonts = false;
    options.pauseMedia = false;
    options.smartHide.customSelectors = ['#banner'];
    const plan = createPreparePlan(options, metrics());
    const preparation = await preparePage(plan, metrics());
    expect(document.querySelector('[data-fullpagelab-preparation]')).not.toBeNull();
    expect(document.querySelector<HTMLElement>('#banner')?.style.visibility).toBe('hidden');
    expect(document.querySelector<HTMLElement>('#banner')?.style.pointerEvents).toBe('none');
    await preparation.restore();
    expect(document.querySelector('[data-fullpagelab-preparation]')).toBeNull();
    expect(document.querySelector<HTMLElement>('#banner')?.getAttribute('style')).toBe('display: block');
  });

  it('keeps the browser document scroller out of custom scroll-container detection', () => {
    const originalScrollingElement = Object.getOwnPropertyDescriptor(document, 'scrollingElement');
    const originalWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');
    const originalHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight');
    const root = document.documentElement;
    document.body.innerHTML = '';
    root.style.overflowY = 'auto';
    Object.defineProperty(document, 'scrollingElement', { configurable: true, value: root });
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
    Object.defineProperty(root, 'clientWidth', { configurable: true, value: 800 });
    Object.defineProperty(root, 'clientHeight', { configurable: true, value: 600 });
    Object.defineProperty(root, 'scrollWidth', { configurable: true, value: 800 });
    Object.defineProperty(root, 'scrollHeight', { configurable: true, value: 2_000 });
    Object.defineProperty(root, 'getBoundingClientRect', { configurable: true, value: () => ({ left: 0, top: 0, width: 800, height: 2_000 }) });

    try {
      const scanned = scanPage({ findScrollContainers: true, findFixedElements: true, findIframes: true });
      expect(scanned.scrollingElement).toBe('document');
      expect(scanned.primaryScrollContainer).toBeUndefined();
    } finally {
      root.style.overflowY = '';
      document.body.innerHTML = '';
      if (originalScrollingElement) Object.defineProperty(document, 'scrollingElement', originalScrollingElement);
      else Reflect.deleteProperty(document, 'scrollingElement');
      if (originalWidth) Object.defineProperty(window, 'innerWidth', originalWidth);
      if (originalHeight) Object.defineProperty(window, 'innerHeight', originalHeight);
    }
  });

  it('mounts a closed-shadow progress overlay and hides it around capture', async () => {
    const overlay = new ProgressOverlay({ allowCancel: true });
    overlay.update({ phase: 'capturing', done: 1, total: 3, message: 'Working' });
    const host = document.querySelector<HTMLDivElement>('#fullpagelab-progress-overlay');
    expect(host).not.toBeNull();
    await overlay.setVisible(false);
    expect(host?.style.visibility).toBe('hidden');
    overlay.remove();
    expect(document.querySelector('#fullpagelab-progress-overlay')).toBeNull();
  });

  it('waits for a clean compositor frame after hiding the progress overlay', async () => {
    const overlay = new ProgressOverlay({ allowCancel: true });
    overlay.update({ phase: 'capturing', done: 1, total: 3, message: 'Working' });
    const frameSpy = vi.spyOn(window, 'requestAnimationFrame');

    try {
      await overlay.setVisible(false);
      expect(frameSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    } finally {
      frameSpy.mockRestore();
      overlay.remove();
    }
  });

  it('keeps a smart-hidden cookie overlay hidden on the first and later tiles', async () => {
    document.body.innerHTML = '<div id="cookie-backdrop" style="position: fixed; z-index: 2000"><div role="dialog">Çerez Kullanımı</div></div><main>Content</main>';
    const options = structuredClone(defaultSettings.capture);
    options.smartHide.enabled = true;
    options.smartHide.categories = ['cookieBanner'];
    const fixedElement: PageMetrics['fixedElements'][number] = {
      selector: '#cookie-backdrop', rect: { x: 0, y: 0, width: 800, height: 600 }, clientSize: { width: 800, height: 600 }, scrollSize: { width: 800, height: 600 },
      isScrollable: false, overflow: { x: 'hidden', y: 'hidden' }, tag: 'div', classes: [], frameId: 0, depth: 1, position: 'fixed', anchor: 'full', coversViewportPct: 100, zIndex: 2000, isTransparentOverlay: false,
    };
    const preparedMetrics = { ...metrics(), fixedElements: [fixedElement] };
    const preparation = await preparePage(createPreparePlan(options, preparedMetrics), preparedMetrics);
    const overlay = document.querySelector<HTMLElement>('#cookie-backdrop');
    expect(overlay?.style.visibility).toBe('hidden');
    preparation.fixed.setTile(1, 3);
    preparation.fixed.setTile(2, 3);
    expect(overlay?.style.visibility).toBe('hidden');
    await preparation.restore();
    expect(overlay?.style.visibility).toBe('');
  });

  it('waits for the compositor to paint after preparation changes', async () => {
    document.body.innerHTML = '<div id="cookie-overlay" style="position: fixed">Çerez Kullanımı</div><main>Content</main>';
    const options = structuredClone(defaultSettings.capture);
    options.lazyLoad.forceEagerImages = false;
    options.lazyLoad.waitImagesDecode = false;
    options.lazyLoad.waitFonts = false;
    options.pauseMedia = false;
    options.smartHide.enabled = true;
    options.smartHide.categories = ['cookieBanner'];
    const frameSpy = vi.spyOn(window, 'requestAnimationFrame');

    try {
      const preparedMetrics = {
        ...metrics(),
        fixedElements: [{
          selector: '#cookie-overlay', rect: { x: 0, y: 0, width: 800, height: 100 }, clientSize: { width: 800, height: 100 }, scrollSize: { width: 800, height: 100 },
          isScrollable: false, overflow: { x: 'hidden', y: 'hidden' }, tag: 'div', id: 'cookie-overlay', classes: [], frameId: 0, depth: 1,
          position: 'fixed', anchor: 'top', coversViewportPct: 10, zIndex: 2000, isTransparentOverlay: false,
        }],
      } satisfies PageMetrics;
      const preparation = await preparePage(createPreparePlan(options, preparedMetrics), preparedMetrics);

      expect(frameSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
      await preparation.restore();
    } finally {
      frameSpy.mockRestore();
    }
  });

  it('pre-scrolls a custom root to prime lazy content and returns to the top', async () => {
    document.body.innerHTML = '<main id="lazy-root"></main>';
    const root = document.querySelector<HTMLElement>('#lazy-root');
    if (!root) throw new Error('Expected lazy root.');
    let scrollTop = 0;
    const scrollCalls: number[] = [];
    Object.defineProperty(root, 'clientHeight', { configurable: true, value: 400 });
    Object.defineProperty(root, 'scrollHeight', { configurable: true, value: 1_200 });
    Object.defineProperty(root, 'scrollWidth', { configurable: true, value: 800 });
    Object.defineProperty(root, 'scrollTop', { configurable: true, get: () => scrollTop, set: (value: number) => { scrollTop = value; } });
    Object.defineProperty(root, 'scrollLeft', { configurable: true, value: 0, writable: true });
    root.scrollTo = ((options: ScrollToOptions) => {
      const top = typeof options === 'object' ? Number(options.top ?? 0) : 0;
      scrollCalls.push(top);
      scrollTop = top;
    }) as typeof root.scrollTo;

    const options = structuredClone(defaultSettings.capture);
    options.lazyLoad.preScroll = true;
    options.lazyLoad.preScrollStepCss = 400;
    options.lazyLoad.preScrollDwellMs = 0;
    options.lazyLoad.maxWaitMs = 500;
    options.lazyLoad.forceEagerImages = false;
    options.lazyLoad.waitImagesDecode = false;
    options.lazyLoad.waitFonts = false;
    options.pauseMedia = false;
    const preparedMetrics = {
      ...metrics(),
      document: { width: 800, height: 1_200 },
      scrollingElement: 'custom' as const,
      primaryScrollContainer: {
        selector: '#lazy-root', rect: { x: 0, y: 0, width: 800, height: 400 }, clientSize: { width: 800, height: 400 }, scrollSize: { width: 800, height: 1_200 },
        isScrollable: true, overflow: { x: 'hidden', y: 'auto' }, tag: 'main', classes: [], frameId: 0, depth: 0,
      },
      scrollContainers: [],
    } satisfies PageMetrics;

    const preparation = await preparePage(createPreparePlan(options, preparedMetrics), preparedMetrics);
    expect(scrollCalls).toEqual([0, 400, 800, 0]);
    expect(preparation.state.effectiveDocument.height).toBe(1_200);
    expect(scrollTop).toBe(0);
    await preparation.restore();
  });
});
