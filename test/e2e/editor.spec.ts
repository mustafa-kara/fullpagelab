import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { captureRequest, driverPath, fixtureOrigin, sendCapture, stageColorShares } from './capture-helpers';
import { launchExtension } from './extension';

const locales = ['en', 'tr'] as const;

/**
 * Fails when the editor stage is mostly one flat colour.
 *
 * The fixtures are built from distinct colour bands, so a stage showing the
 * capture is many-coloured while a blank one is overwhelmingly white. This
 * reads the composited screenshot rather than the canvas buffer, which stays
 * painted even when something covers it on screen.
 */
async function expectStageShowsCapture(page: Page, description: string): Promise<void> {
  const { distinct, shares } = await stageColorShares(page);
  const white = shares['255,255,255'] ?? 0;
  expect(white, `${description}: the visible editor stage must show the capture, not a blank surface`).toBeLessThan(0.6);
  expect(distinct, `${description}: the visible editor stage must show the capture's colours`).toBeGreaterThan(3);
}

/**
 * Chrome picks the locale from the accept-languages chain, which differs between
 * machines, so the expected warnings come from `chrome.i18n` on the page under test
 * rather than a hard-coded English or Turkish string. The values are then checked
 * against the locale files so a missing key cannot pass as its own key name.
 * Everything the test clicks is addressed by `data-testid`, which no locale changes.
 */
async function expectedWarnings(page: Page): Promise<{ blur: string; redact: string }> {
  const resolved = await page.evaluate(() => ({
    blur: chrome.i18n.getMessage('ui_editor_blurWarning'),
    redact: chrome.i18n.getMessage('ui_editor_redactWarning'),
  }));
  const shipped = locales.map((locale) => JSON.parse(readFileSync(resolve(`public/_locales/${locale}/messages.json`), 'utf8')) as Record<string, { message: string }>);
  for (const [key, value] of Object.entries(resolved)) {
    expect(shipped.some((messages) => messages[`ui_editor_${key === 'blur' ? 'blurWarning' : 'redactWarning'}`]?.message === value), `${key} warning must come from a shipped locale file, got: ${value}`).toBe(true);
  }
  return resolved;
}

test('annotates a capture and saves it as a new record', async ({}, testInfo) => {
  const { context, extensionId } = await launchExtension(testInfo);
  try {
    const driver = await context.newPage();
    await driver.goto(`chrome-extension://${extensionId}${driverPath}`);
    const fixture = await context.newPage();
    await fixture.goto(`${fixtureOrigin}/long.html`);
    const resultPage = await sendCapture(context, extensionId, driver, fixture, captureRequest('visible'), testInfo);

    const originalId = new URL(resultPage.url()).searchParams.get('id');
    await resultPage.locator('[data-testid="result-viewer"] img').waitFor({ state: 'visible' });
    await resultPage.locator('[data-testid="result-edit"]').click();
    await resultPage.locator('[data-testid="editor-toolbar"][data-ready="true"]').waitFor({ state: 'visible' });

    await resultPage.locator('[data-tool="rect"]').click();
    const canvas = resultPage.locator('.editor-stage canvas').first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Editor canvas has no layout box.');
    await resultPage.mouse.move(box.x + 60, box.y + 60);
    await resultPage.mouse.down();
    await resultPage.mouse.move(box.x + 200, box.y + 160);
    await resultPage.mouse.up();

    await resultPage.locator('[data-testid="editor-save"]').click();
    // Saving clones the capture, so the page reloads onto a different record id.
    await resultPage.waitForURL((url) => {
      const id = url.searchParams.get('id');
      return id !== null && id !== originalId;
    }, { timeout: 15_000 });
    await resultPage.locator('[data-testid="result-viewer"] img').waitFor({ state: 'visible' });
  } finally {
    await context.close();
  }
});

test('warns that blur is reversible and redaction is permanent', async ({}, testInfo) => {
  const { context, extensionId } = await launchExtension(testInfo);
  try {
    const driver = await context.newPage();
    await driver.goto(`chrome-extension://${extensionId}${driverPath}`);
    const fixture = await context.newPage();
    await fixture.goto(`${fixtureOrigin}/long.html`);
    const resultPage = await sendCapture(context, extensionId, driver, fixture, captureRequest('visible'), testInfo);

    await resultPage.locator('[data-testid="result-edit"]').click();
    await resultPage.locator('[data-testid="editor-toolbar"][data-ready="true"]').waitFor({ state: 'visible' });

    const warnings = await expectedWarnings(resultPage);
    await resultPage.locator('[data-tool="blur"]').click();
    await expect(resultPage.locator('[data-testid="editor-privacy-note"]')).toHaveText(warnings.blur);
    await resultPage.locator('[data-tool="redact"]').click();
    await expect(resultPage.locator('[data-testid="editor-privacy-note"]')).toHaveText(warnings.redact);
  } finally {
    await context.close();
  }
});

/**
 * Captures taken with history disabled live in the session store, which
 * `resolveBlob` refuses to read. The editor used to resolve the base image
 * itself and opened onto a blank canvas for every such capture; it now takes
 * the URL the result page already resolved.
 */
test('loads the base image for a capture kept out of history', async ({}, testInfo) => {
  // A scale factor other than 1 is what most laptops report. Fabric sizes its
  // backing store by that ratio, so a DPR-1-only test never exercised the sizes
  // the editor actually allocates on a real machine.
  testInfo.setTimeout(120_000);
  const { context, extensionId } = await launchExtension(testInfo, { deviceScaleFactor: 2 });
  try {
    const driver = await context.newPage();
    await driver.goto(`chrome-extension://${extensionId}${driverPath}`);
    await driver.evaluate(async () => {
      await new Promise<void>((resolve, reject) => {
        chrome.runtime.sendMessage(
          { v: 1, type: 'settings.set', id: 'e2e-history-off', payload: { patch: { history: { enabled: false } } }, from: 'ui' },
          (response: { ok: boolean }) => (chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(response?.ok ? undefined : reject(new Error('settings.set failed')))),
        );
      });
    });

    const fixture = await context.newPage();
    await fixture.goto(`${fixtureOrigin}/long.html`);
    const resultPage = await sendCapture(context, extensionId, driver, fixture, captureRequest('visible'), testInfo);

    await resultPage.locator('[data-testid="result-edit"]').click();
    await resultPage.locator('[data-testid="editor-toolbar"][data-ready="true"]').waitFor();

    await expect(resultPage.locator('[data-testid="editor-load-error"]'), 'the editor must not report a load failure').toHaveCount(0);
    await expectStageShowsCapture(resultPage, 'a capture kept out of history');
  } finally {
    await context.close();
  }
});

/**
 * The editor renders through a stack of canvases, and both the browser's canvas
 * limits and Fabric's retina backing store scale with the device pixel ratio, so
 * a capture that renders at ratio 1 can fail at the ratios real machines report.
 * A very tall capture exercises the same limits from the other direction.
 */
for (const [fixture, deviceScaleFactor] of [['very-long.html', 1], ['long.html', 2], ['very-long.html', 2]] as Array<[string, number]>) {
  test(`shows the capture in the editor for ${fixture} at scale factor ${deviceScaleFactor}`, async ({}, testInfo) => {
    // Stitching a 34,000px capture and decoding it into the editor runs past the
    // default budget on a loaded machine.
    testInfo.setTimeout(120_000);
    const { context, extensionId } = await launchExtension(testInfo, { deviceScaleFactor });
    try {
      const driver = await context.newPage();
      await driver.goto(`chrome-extension://${extensionId}${driverPath}`);
      const page = await context.newPage();
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`${fixtureOrigin}/${fixture}`);
      const resultPage = await sendCapture(context, extensionId, driver, page, captureRequest('fullPage'), testInfo);

      await resultPage.locator('[data-testid="result-viewer"] img').waitFor({ state: 'visible' });
      await resultPage.locator('[data-testid="result-edit"]').click();
      await resultPage.locator('[data-testid="editor-toolbar"][data-ready="true"]').waitFor();
      await expect(resultPage.locator('[data-testid="editor-load-error"]')).toHaveCount(0);

      await expectStageShowsCapture(resultPage, `${fixture} at scale factor ${deviceScaleFactor}`);
    } finally {
      await context.close();
    }
  });
}

/** A drawn annotation has to reach the screen, not just the document model. */
test('shows a drawn rectangle on screen', async ({}, testInfo) => {
  const { context, extensionId } = await launchExtension(testInfo, { deviceScaleFactor: 2 });
  try {
    const driver = await context.newPage();
    await driver.goto(`chrome-extension://${extensionId}${driverPath}`);
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${fixtureOrigin}/long.html`);
    const resultPage = await sendCapture(context, extensionId, driver, page, captureRequest('fullPage'), testInfo);

    await resultPage.locator('[data-testid="result-viewer"] img').waitFor({ state: 'visible' });
    await resultPage.locator('[data-testid="result-edit"]').click();
    await resultPage.locator('[data-testid="editor-toolbar"][data-ready="true"]').waitFor();

    const stage = await resultPage.locator('.editor-stage').boundingBox();
    if (!stage) throw new Error('The editor stage has no layout box.');
    const before = await resultPage.screenshot({ clip: stage });

    await resultPage.locator('[data-tool="rect"]').click();
    const surface = await resultPage.locator('.editor-stage canvas.upper-canvas').boundingBox();
    if (!surface) throw new Error('The editor drawing surface has no layout box.');
    const startX = Math.max(surface.x + 20, stage.x + 30);
    const startY = Math.max(surface.y + 20, stage.y + 30);
    await resultPage.mouse.move(startX, startY);
    await resultPage.mouse.down();
    await resultPage.mouse.move(startX + 220, startY + 160, { steps: 12 });
    await resultPage.mouse.up();

    const after = await resultPage.screenshot({ clip: stage });
    const changed = await resultPage.evaluate(async ({ first, second }) => {
      const decode = async (encoded: string): Promise<HTMLImageElement> => {
        const image = new Image();
        await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = `data:image/png;base64,${encoded}`; });
        return image;
      };
      const [a, b] = [await decode(first), await decode(second)];
      const canvas = document.createElement('canvas');
      canvas.width = a.naturalWidth;
      canvas.height = a.naturalHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Comparison canvas has no 2D context.');
      context.drawImage(a, 0, 0);
      const pixelsBefore = context.getImageData(0, 0, canvas.width, canvas.height).data;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(b, 0, 0);
      const pixelsAfter = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let differing = 0;
      for (let offset = 0; offset < pixelsBefore.length; offset += 4) {
        if (pixelsBefore[offset] !== pixelsAfter[offset] || pixelsBefore[offset + 1] !== pixelsAfter[offset + 1] || pixelsBefore[offset + 2] !== pixelsAfter[offset + 2]) differing += 1;
      }
      return differing / (pixelsBefore.length / 4);
    }, { first: before.toString('base64'), second: after.toString('base64') });

    expect(changed, 'drawing a rectangle must visibly change the editor stage').toBeGreaterThan(0.005);
  } finally {
    await context.close();
  }
});
