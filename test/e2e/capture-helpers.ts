import { expect, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { defaultSettings } from '../../src/shared/defaults';
import type { CaptureMode, CaptureOptions, CaptureRequest } from '../../src/shared/types/capture';
import type { Reply } from '../../src/shared/types/messages';

export const fixtureOrigin = 'http://127.0.0.1:4173';
export const resultPath = '/src/pages/result/index.html';
export const driverPath = '/src/pages/popup/index.html';
export const bandColors = [
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
export const scrollbarColor = '#ff00ff';

export type Rgb = [number, number, number];

export interface PreparedFixture {
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

export function hexToRgb(color: string): Rgb {
  const value = Number.parseInt(color.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

export function captureOptions(): CaptureOptions {
  const { smartHideOverrides: _smartHideOverrides, ...options } = structuredClone(defaultSettings.capture);
  return options;
}

export function captureRequest(mode: CaptureMode): CaptureRequest {
  return {
    mode,
    target: {},
    options: captureOptions(),
    export: structuredClone(defaultSettings.export),
    trigger: 'api',
  };
}

/**
 * Measures the fixture before capture. When a `[data-capture-root]` element is
 * present the fixture scrolls inside that container, so its scroll size is the
 * expected capture height; otherwise the document scroll size is used.
 */
export async function prepareFixture(page: Page): Promise<PreparedFixture> {
  return page.evaluate(() => {
    const captureRoot = document.querySelector<HTMLElement>('[data-capture-root]');
    const scrollingElement = captureRoot ?? document.scrollingElement ?? document.documentElement;
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

export async function sendCapture(
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

export async function resultPixels(resultPage: Page, samples: Array<{ x: number; y: number }>): Promise<{ height: number; colors: Rgb[] }> {
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

/**
 * Shares of each colour actually painted inside the editor stage, read back from
 * a screenshot.
 *
 * Reading the Fabric canvas with `getImageData` measures the drawing buffer,
 * which stays fully painted even when nothing reaches the screen: the editor
 * once rendered the capture correctly while an opaque sibling canvas covered it,
 * and buffer-based assertions passed against a blank window. Only the composited
 * screenshot proves what the user sees.
 */
export async function stageColorShares(page: Page): Promise<{ distinct: number; shares: Record<string, number> }> {
  const stage = await page.locator('.editor-stage').boundingBox();
  if (!stage) throw new Error('The editor stage has no layout box.');
  const shot = await page.screenshot({ clip: stage });
  return page.evaluate(async (encoded) => {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = `data:image/png;base64,${encoded}`;
    });
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Screenshot canvas has no 2D context.');
    context.drawImage(image, 0, 0);
    const counts = new Map<string, number>();
    let total = 0;
    for (let y = 0; y < canvas.height; y += 4) {
      for (let x = 0; x < canvas.width; x += 4) {
        const [r, g, b] = context.getImageData(x, y, 1, 1).data;
        const key = `${r},${g},${b}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
        total += 1;
      }
    }
    // A Map cannot cross the evaluate boundary, so shares come back as an object.
    const shares: Record<string, number> = {};
    for (const [key, count] of counts) shares[key] = count / total;
    return { distinct: counts.size, shares };
  }, shot.toString('base64'));
}
