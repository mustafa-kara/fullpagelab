import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { defaultSettings } from '../../src/shared/defaults';
import type { CaptureMode, CaptureOptions, CaptureRequest } from '../../src/shared/types/capture';
import type { Reply } from '../../src/shared/types/messages';
import { launchExtension } from './extension';

const fixtureOrigin = 'http://127.0.0.1:4173';
const resultPath = '/src/pages/result/index.html';
const driverPath = '/src/pages/popup/index.html';
const bandColors = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
  '#84cc16',
  '#f59e0b',
  '#6366f1',
] as const;
const scrollbarColor = '#ff00ff';

type Rgb = [number, number, number];

interface PreparedFixture {
  cssHeight: number;
  dpr: number;
  bands: Array<{ index: number; centerX: number; centerY: number }>;
}

async function waitForCaptureFailure(driver: Page, jobId: string): Promise<never> {
  for (;;) {
    const failure = await driver.evaluate(async (id) => {
      const stored = await chrome.storage.session.get('activeJobs');
      const jobs = (stored.activeJobs ?? []) as Array<{ jobId: string; phase: string; error?: { code: string; message: string } }>;
      const job = jobs.find((item) => item.jobId === id);
      return job?.phase === 'failed' ? job.error ?? { code: 'E_UNKNOWN', message: 'Capture failed without an error.' } : null;
    }, jobId);
    if (failure) throw new Error(`Capture job failed: ${failure.code} ${failure.message}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function waitForResultPage(context: BrowserContext, extensionId: string): Promise<Page> {
  const prefix = `chrome-extension://${extensionId}${resultPath}`;
  for (;;) {
    const page = context.pages().find((candidate) => candidate.url().startsWith(prefix));
    if (page) return page;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function hexToRgb(color: string): Rgb {
  const value = Number.parseInt(color.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function captureOptions(): CaptureOptions {
  const { smartHideOverrides: _smartHideOverrides, ...options } = structuredClone(defaultSettings.capture);
  return options;
}

function captureRequest(mode: CaptureMode): CaptureRequest {
  return {
    mode,
    target: {},
    options: captureOptions(),
    export: structuredClone(defaultSettings.export),
    trigger: 'api',
  };
}

async function prepareFixture(page: Page): Promise<PreparedFixture> {
  return page.evaluate(() => {
    const scrollingElement = document.scrollingElement ?? document.documentElement;
    const bands = Array.from(document.querySelectorAll<HTMLElement>('.band[data-band-index]'))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          index: Number(element.dataset.bandIndex),
          centerX: rect.left + window.scrollX + rect.width / 2,
          centerY: rect.top + window.scrollY + rect.height / 2,
        };
      })
      .sort((left, right) => left.index - right.index);
    return {
      cssHeight: scrollingElement.scrollHeight,
      dpr: window.devicePixelRatio,
      bands,
    };
  });
}

async function sendCapture(
  context: BrowserContext,
  extensionId: string,
  driver: Page,
  fixture: Page,
  request: CaptureRequest,
  testInfo: TestInfo,
): Promise<Page> {
  await fixture.bringToFront();
  const messageId = `e2e-${testInfo.testId}`;
  const resultPagePromise = waitForResultPage(context, extensionId);
  const reply = await driver.evaluate(async ({ fixtureUrl, id, payload }) => {
    const fixtureTab = (await chrome.tabs.query({})).find((tab) => tab.url === fixtureUrl);
    if (fixtureTab?.id === undefined || fixtureTab.windowId === undefined) {
      throw new Error(`Fixture tab not found: ${fixtureUrl}`);
    }
    await chrome.tabs.update(fixtureTab.id, { active: true });
    const targetedPayload = {
      ...payload,
      target: { ...payload.target, tabId: fixtureTab.id, windowId: fixtureTab.windowId },
    };
    return new Promise<Reply<'capture.start'>>((resolve, reject) => {
      chrome.runtime.sendMessage({ v: 1, type: 'capture.start', id, payload: targetedPayload, from: 'ui' }, (response: Reply<'capture.start'>) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response);
      });
    });
  }, { fixtureUrl: fixture.url(), id: messageId, payload: request });
  if (!reply.ok) {
    void resultPagePromise.catch(() => undefined);
    throw new Error(`Capture request failed: ${reply.error.code} ${reply.error.message}`);
  }
  expect(reply).toMatchObject({ v: 1, type: 'capture.start', id: messageId, ok: true });
  const resultPage = await Promise.race([resultPagePromise, waitForCaptureFailure(driver, reply.payload.jobId)]);
  await resultPage.waitForURL((url) => url.href.startsWith(`chrome-extension://${extensionId}${resultPath}`));
  await resultPage.waitForLoadState('domcontentloaded');
  await resultPage.locator('[data-testid="result-viewer"] img').waitFor({ state: 'visible' });
  await resultPage.locator('[data-testid="result-viewer"] img').evaluate((image: HTMLImageElement) => {
    if (image.complete && image.naturalHeight > 0) return;
    return new Promise<void>((resolve, reject) => {
      image.addEventListener('load', () => resolve(), { once: true });
      image.addEventListener('error', () => reject(new Error('Result preview failed to load.')), { once: true });
    });
  });
  return resultPage;
}

async function resultPixels(resultPage: Page, samples: Array<{ x: number; y: number }>): Promise<{ height: number; colors: Rgb[] }> {
  return resultPage.locator('[data-testid="result-viewer"] img').evaluate((image: HTMLImageElement, points) => {
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Result sampling canvas is unavailable.');
    context.drawImage(image, 0, 0);
    return {
      height: image.naturalHeight,
      colors: points.map(({ x, y }) => {
        const pixel = context.getImageData(
          Math.max(0, Math.min(image.naturalWidth - 1, Math.floor(x))),
          Math.max(0, Math.min(image.naturalHeight - 1, Math.floor(y))),
          1,
          1,
        ).data;
        return [pixel[0] ?? 0, pixel[1] ?? 0, pixel[2] ?? 0] as Rgb;
      }),
    };
  }, samples);
}

async function expectFullPageBands(fixtureName: 'long.html' | 'sticky.html', testInfo: TestInfo): Promise<void> {
  const { context, extensionId } = await launchExtension(testInfo);
  try {
    const driver = await context.newPage();
    await driver.goto(`chrome-extension://${extensionId}${driverPath}`);
    const fixture = await context.newPage();
    await fixture.goto(`${fixtureOrigin}/${fixtureName}`);
    const prepared = await prepareFixture(fixture);
    expect(prepared.bands.map((band) => band.index)).toEqual(bandColors.map((_, index) => index));
    const request = captureRequest('fullPage');
    if (fixtureName === 'sticky.html') request.options.hideFixedElements = 'always';
    const resultPage = await sendCapture(context, extensionId, driver, fixture, request, testInfo);
    const sampled = await resultPixels(resultPage, prepared.bands.map((band) => ({
      x: band.centerX * prepared.dpr,
      y: band.centerY * prepared.dpr,
    })));
    expect(sampled.height).toBe(Math.round(prepared.cssHeight * prepared.dpr));
    expect(sampled.colors).toEqual(bandColors.map(hexToRgb));
  } finally {
    await context.close();
  }
}

async function expectScrollbarAbsent(fixtureName: 'long.html' | 'nested-scroll.html', testInfo: TestInfo): Promise<void> {
  const { context, extensionId } = await launchExtension(testInfo);
  try {
    const driver = await context.newPage();
    await driver.goto(`chrome-extension://${extensionId}${driverPath}`);
    const fixture = await context.newPage();
    await fixture.goto(`${fixtureOrigin}/${fixtureName}`);
    const resultPage = await sendCapture(context, extensionId, driver, fixture, captureRequest('visible'), testInfo);
    const scrollbarPixels = await resultPage.locator('[data-testid="result-viewer"] img').evaluate((image: HTMLImageElement) => {
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Scrollbar sampling canvas is unavailable.');
      context.drawImage(image, 0, 0);
      return Array.from(context.getImageData(image.naturalWidth - 2, 0, 2, image.naturalHeight).data);
    });
    const expectedScrollbar = hexToRgb(scrollbarColor);
    for (let offset = 0; offset < scrollbarPixels.length; offset += 4) {
      expect(scrollbarPixels.slice(offset, offset + 3)).not.toEqual(expectedScrollbar);
    }
  } finally {
    await context.close();
  }
}

test('captures every long-page color band exactly once at the prepared DPR height', async ({}, testInfo) => {
  await expectFullPageBands('long.html', testInfo);
});

test('captures every sticky-page color band exactly once at the prepared DPR height', async ({}, testInfo) => {
  await expectFullPageBands('sticky.html', testInfo);
});

test('omits the fixture scrollbar color from a visible capture', async ({}, testInfo) => {
  await expectScrollbarAbsent('long.html', testInfo);
});

test('omits the fixture scrollbar color from the nested-scroll fixture', async ({}, testInfo) => {
  await expectScrollbarAbsent('nested-scroll.html', testInfo);
});
