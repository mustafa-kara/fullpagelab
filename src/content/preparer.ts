import type { CaptureOptions, PageMetrics, PreparePlan, PreparedState } from '../shared/types/capture';
import { createFixedElementController, type FixedElementController } from './fixed-elements';
import { Restorer } from './restorer';
import { scrollPage } from './scroller';
import { findSmartHideMatches } from './smart-hide';
import { waitForVisualSettle } from './visual-settle';

export interface PagePreparation {
  state: PreparedState;
  fixed: FixedElementController;
  restore(): Promise<void>;
}

function fixedStrategy(options: CaptureOptions, metrics: PageMetrics): PreparePlan['fixedStrategy'] {
  if (options.hideFixedElements === 'never' || metrics.fixedElements.length === 0) return 'none';
  if (options.hideFixedElements === 'always') return 'hideAll';
  return 'hideAfterFirst';
}

export function createPreparePlan(options: CaptureOptions, metrics: PageMetrics): PreparePlan {
  return {
    hideScrollbars: options.hideScrollbars,
    freezeAnimations: options.freezeAnimations,
    pauseMedia: options.pauseMedia,
    smartHide: options.smartHide,
    lazyLoad: options.lazyLoad,
    fixedStrategy: fixedStrategy(options, metrics),
    fixedTargets: metrics.fixedElements.map((element) => element.selector),
    scrollContainerSelector: metrics.scrollingElement === 'custom' ? metrics.primaryScrollContainer?.selector : undefined,
    overlay: { showProgress: options.countdownOverlay, allowCancel: true, allowStop: false },
    restoreScroll: true,
  };
}

function addStyle(restorer: Restorer, cssText: string, id: string): void {
  const style = document.createElement('style');
  style.dataset.fullpagelabPreparation = id;
  style.textContent = cssText;
  document.documentElement.append(style);
  restorer.register(() => style.remove());
}

function rememberStyle(restorer: Restorer, element: HTMLElement): void {
  const original = element.getAttribute('style');
  restorer.register(() => {
    if (original === null) element.removeAttribute('style');
    else element.setAttribute('style', original);
  });
}

function prepareSmartHide(restorer: Restorer, options: PreparePlan['smartHide'], hiddenSelectors: string[]): void {
  for (const match of findSmartHideMatches(options)) {
    rememberStyle(restorer, match.element);
    match.element.dataset.fullpagelabSmartHidden = 'true';
    restorer.register(() => {
      delete match.element.dataset.fullpagelabSmartHidden;
    });
    if (options.mode === 'remove') match.element.style.setProperty('display', 'none', 'important');
    else {
      match.element.style.setProperty('visibility', 'hidden', 'important');
      match.element.style.setProperty('pointer-events', 'none', 'important');
    }
    hiddenSelectors.push(match.selector);
  }
}

function prepareImages(restorer: Restorer): number {
  let count = 0;
  for (const image of Array.from(document.querySelectorAll<HTMLImageElement>('img'))) {
    const originalLoading = image.loading;
    const originalFetchPriority = image.fetchPriority;
    if (image.loading === 'lazy') image.loading = 'eager';
    image.fetchPriority = 'high';
    if (image.loading !== originalLoading || image.fetchPriority !== originalFetchPriority) {
      count += 1;
      restorer.register(() => {
        image.loading = originalLoading;
        image.fetchPriority = originalFetchPriority;
      });
    }
  }
  return count;
}

function prepareMedia(restorer: Restorer): number {
  let count = 0;
  for (const media of Array.from(document.querySelectorAll<HTMLMediaElement>('audio,video'))) {
    const wasPlaying = !media.paused;
    if (wasPlaying) {
      media.pause();
      count += 1;
      restorer.register(() => {
        void media.play().catch(() => undefined);
      });
    }
  }
  return count;
}

async function waitForImages(maxWaitMs: number): Promise<void> {
  const images = Array.from(document.querySelectorAll<HTMLImageElement>('img')).filter((image) => !image.complete);
  if (images.length === 0) return;
  await Promise.race([
    Promise.all(images.map((image) => image.decode().catch(() => undefined))),
    new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, maxWaitMs))),
  ]);
}

async function waitForFonts(maxWaitMs: number): Promise<void> {
  if (!document.fonts?.ready) return;
  await Promise.race([document.fonts.ready.then(() => undefined), new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, maxWaitMs)))]);
}

function waitMs(duration: number): Promise<void> {
  if (duration <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, duration));
}

async function preScrollForLazyContent(plan: PreparePlan, metrics: PageMetrics): Promise<{ width: number; height: number }> {
  const lazyLoad = plan.lazyLoad;
  const root = plan.scrollContainerSelector ?? 'document';
  const rootInfo = plan.scrollContainerSelector
    ? metrics.scrollContainers.find((container) => container.selector === plan.scrollContainerSelector) ?? metrics.primaryScrollContainer
    : undefined;
  let viewportHeight = Math.max(1, rootInfo?.clientSize.height ?? metrics.viewport.height);
  let documentNow = { width: rootInfo?.scrollSize.width ?? metrics.document.width, height: rootInfo?.scrollSize.height ?? metrics.document.height };
  if (!lazyLoad.enabled || !lazyLoad.preScroll || documentNow.height <= viewportHeight) return documentNow;

  const startedAt = performance.now();
  const deadline = startedAt + Math.max(0, lazyLoad.maxWaitMs);
  const stepSize = Math.max(1, lazyLoad.preScrollStepCss);
  let requestedY = 0;
  let stepIndex = 0;
  do {
    const result = await scrollPage({ stepIndex, x: 0, y: requestedY, afterFirstTile: stepIndex > 0, settleMs: 0 }, root);
    documentNow = result.documentNow;
    viewportHeight = Math.max(1, rootInfo?.clientSize.height ?? metrics.viewport.height);
    const maxY = Math.max(0, documentNow.height - viewportHeight);
    const remainingMs = Math.max(0, deadline - performance.now());
    await waitMs(Math.min(lazyLoad.preScrollDwellMs, remainingMs));
    stepIndex += 1;
    if (requestedY >= maxY || performance.now() >= deadline) break;
    requestedY = Math.min(maxY, requestedY + stepSize);
  } while (stepIndex < 200);

  if (requestedY > 0 || stepIndex > 1) {
    const result = await scrollPage({ stepIndex, x: 0, y: 0, afterFirstTile: true, settleMs: 0 }, root);
    documentNow = result.documentNow;
  }
  return documentNow;
}

export async function preparePage(plan: PreparePlan, metrics: PageMetrics): Promise<PagePreparation> {
  const restorer = new Restorer();
  const hiddenSelectors: string[] = [];
  if (plan.hideScrollbars) addStyle(restorer, 'html, body, * { scrollbar-width: none !important; } html::-webkit-scrollbar, body::-webkit-scrollbar, *::-webkit-scrollbar { display: none !important; }', 'scrollbars');
  if (plan.freezeAnimations) addStyle(restorer, '*, *::before, *::after { animation-play-state: paused !important; transition: none !important; scroll-behavior: auto !important; scroll-snap-type: none !important; } html, body { overflow-anchor: none !important; }', 'motion');
  const eagerizedImages = plan.lazyLoad.forceEagerImages ? prepareImages(restorer) : 0;
  const pausedMedia = plan.pauseMedia ? prepareMedia(restorer) : 0;
  const fixed = createFixedElementController(metrics.fixedElements, plan.fixedStrategy);
  restorer.register(() => fixed.restore());
  fixed.setTile(0, 2);
  prepareSmartHide(restorer, plan.smartHide, hiddenSelectors);

  const effectiveDocument = await preScrollForLazyContent(plan, metrics);
  if (plan.lazyLoad.waitImagesDecode) await waitForImages(plan.lazyLoad.maxWaitMs);
  if (plan.lazyLoad.waitFonts) await waitForFonts(plan.lazyLoad.maxWaitMs);
  await waitForVisualSettle();

  const state: PreparedState = {
    hiddenSelectors,
    removedScrollbars: plan.hideScrollbars,
    pausedMedia,
    eagerizedImages,
    smartHidden: hiddenSelectors.map((selector) => ({ selector, category: 'custom' })),
    scrollRoot: plan.scrollContainerSelector ?? 'document',
    effectiveDocument: {
      width: Math.max(metrics.document.width, effectiveDocument.width),
      height: Math.max(metrics.document.height, effectiveDocument.height),
    },
  };
  return { state, fixed, restore: () => restorer.restore() };
}
