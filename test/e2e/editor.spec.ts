import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { captureRequest, driverPath, fixtureOrigin, sendCapture, stageChangeShare, stageColorShares } from './capture-helpers';
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

/** Opens the editor on a visible-area capture and returns the page and stage box. */
async function openEditor(context: BrowserContext, extensionId: string, driver: Page, testInfo: TestInfo): Promise<{ page: Page; stage: { x: number; y: number; width: number; height: number } }> {
  const fixture = await context.newPage();
  await fixture.setViewportSize({ width: 1280, height: 800 });
  await fixture.goto(`${fixtureOrigin}/long.html`);
  const page = await sendCapture(context, extensionId, driver, fixture, captureRequest('visible'), testInfo);
  await page.locator('[data-testid="result-viewer"] img').waitFor({ state: 'visible' });
  await page.locator('[data-testid="result-edit"]').click();
  await page.locator('[data-testid="editor-toolbar"][data-ready="true"]').waitFor();
  const stage = await page.locator('.editor-stage').boundingBox();
  if (!stage) throw new Error('The editor stage has no layout box.');
  return { page, stage };
}

/**
 * Drags along `path` with `tool` selected, offset from the drawing surface.
 *
 * The canvas is centred inside the stage, so stage-relative offsets can land
 * outside it and silently draw nothing.
 */
async function drawWith(page: Page, tool: string, path: Array<[number, number]>): Promise<void> {
  await page.locator(`[data-tool="${tool}"]`).click();
  const surface = await surfaceBox(page);
  const stage = await page.locator('.editor-stage').boundingBox();
  if (!stage) throw new Error('The editor stage has no layout box.');
  // Points are fractions of the part of the canvas that is actually on screen:
  // at 100% zoom the canvas overflows the stage, and a drag outside the visible
  // area never reaches it.
  const left = Math.max(surface.x, stage.x) + 4;
  const top = Math.max(surface.y, stage.y) + 4;
  const width = Math.min(surface.x + surface.width, stage.x + stage.width) - left - 8;
  const height = Math.min(surface.y + surface.height, stage.y + stage.height) - top - 8;
  const at = ([fx, fy]: [number, number]): [number, number] => [left + fx * width, top + fy * height];
  const [start, ...rest] = path;
  if (!start) throw new Error('A drag needs at least one point.');
  const [startX, startY] = at(start);
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  for (const point of rest) {
    const [x, y] = at(point);
    await page.mouse.move(x, y, { steps: 4 });
  }
  await page.mouse.up();
  await page.waitForTimeout(250);
}

/** Reads back where the drawing surface sits, for tests that sample raw pixels. */
async function surfaceBox(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.locator('.editor-stage canvas.upper-canvas').boundingBox();
  if (!box) throw new Error('The editor drawing surface has no layout box.');
  return box;
}

/**
 * Every tool has to change what is on screen.
 *
 * These all used to fall through to a plain rectangle: freehand drew a box,
 * blur and pixelate drew an empty outline that obscured nothing, and the arrow
 * had no head. The document model looked correct throughout, so only a
 * screen-level assertion catches it.
 */
for (const tool of ['arrow', 'rect', 'ellipse', 'line', 'freehand', 'highlight', 'blur', 'pixelate', 'redact'] as const) {
  test(`the ${tool} tool draws something visible`, async ({}, testInfo) => {
    testInfo.setTimeout(120_000);
    const { context, extensionId } = await launchExtension(testInfo);
    try {
      const driver = await context.newPage();
      await driver.goto(`chrome-extension://${extensionId}${driverPath}`);
      const { page, stage } = await openEditor(context, extensionId, driver, testInfo);

      const before = await page.screenshot({ clip: stage });
      await drawWith(page, tool, [[0.1, 0.1], [0.4, 0.45], [0.6, 0.3], [0.9, 0.9]]);
      const after = await page.screenshot({ clip: stage });
      await testInfo.attach(`${tool}-drawn`, { body: after, contentType: 'image/png' });

      expect(await stageChangeShare(page, before, after), `the ${tool} tool must visibly change the stage`).toBeGreaterThan(0.002);
    } finally {
      await context.close();
    }
  });
}

test('freehand follows the pointer instead of drawing a rectangle', async ({}, testInfo) => {
  testInfo.setTimeout(120_000);
  const { context, extensionId } = await launchExtension(testInfo);
  try {
    const driver = await context.newPage();
    await driver.goto(`chrome-extension://${extensionId}${driverPath}`);
    const { page } = await openEditor(context, extensionId, driver, testInfo);

    // A fitted view can be 16%, where a 4px brush is thinner than one device
    // pixel and leaves nothing to sample. Draw at natural size instead.
    await page.locator('[data-testid="editor-zoom-actual"]').click();
    // An L-shaped drag. A real stroke leaves the opposite corner of its bounding
    // box untouched; a rectangle tool paints an outline all the way round it.
    await drawWith(page, 'freehand', [[0.2, 0.25], [0.2, 0.75], [0.7, 0.75]]);

    const shape = await page.locator('.editor-stage canvas.lower-canvas').evaluate((canvas: HTMLCanvasElement) => {
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Editor canvas has no 2D context.');
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      // Find the stroke by its own colour: the annotation default is a magenta
      // that the fixture's red, orange and yellow bands never produce.
      let minX = canvas.width;
      let minY = canvas.height;
      let maxX = -1;
      let maxY = -1;
      const isStroke = (x: number, y: number): boolean => {
        const offset = (y * canvas.width + x) * 4;
        return data[offset]! > 200 && data[offset + 1]! < 90 && data[offset + 2]! > 100;
      };
      for (let y = 0; y < canvas.height; y += 1) {
        for (let x = 0; x < canvas.width; x += 1) {
          if (!isStroke(x, y)) continue;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
      if (maxX < 0) return { found: false, corner: false, leg: false, base: false };
      const near = (fx: number, fy: number): boolean => {
        const cx = Math.round(minX + fx * (maxX - minX));
        const cy = Math.round(minY + fy * (maxY - minY));
        for (let dx = -12; dx <= 12; dx += 1) {
          for (let dy = -12; dy <= 12; dy += 1) {
            const x = cx + dx;
            const y = cy + dy;
            if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) continue;
            if (isStroke(x, y)) return true;
          }
        }
        return false;
      };
      // Within the stroke's own bounding box: down the left leg, along the
      // bottom, and the top-right corner the L never visits.
      return { found: true, leg: near(0, 0.5), base: near(0.5, 1), corner: near(1, 0) };
    });

    expect(shape.found, 'the freehand stroke must be drawn').toBe(true);
    expect(shape.leg, 'the stroke must follow the pointer down the left leg').toBe(true);
    expect(shape.base, 'the stroke must follow the pointer along the base').toBe(true);
    expect(shape.corner, 'freehand must not close the stroke into a rectangle').toBe(false);
  } finally {
    await context.close();
  }
});

test('the arrow tool draws a head at the end of the drag', async ({}, testInfo) => {
  testInfo.setTimeout(120_000);
  const { context, extensionId } = await launchExtension(testInfo);
  try {
    const driver = await context.newPage();
    await driver.goto(`chrome-extension://${extensionId}${driverPath}`);
    const { page } = await openEditor(context, extensionId, driver, testInfo);

    // As above: sample-able stroke width requires natural size.
    await page.locator('[data-testid="editor-zoom-actual"]').click();
    await drawWith(page, 'arrow', [[0.15, 0.5], [0.85, 0.5]]);

    const thickness = await page.locator('.editor-stage canvas.lower-canvas').evaluate((canvas: HTMLCanvasElement) => {
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Editor canvas has no 2D context.');
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      const isStroke = (x: number, y: number): boolean => {
        const offset = (y * canvas.width + x) * 4;
        return data[offset]! > 200 && data[offset + 1]! < 90 && data[offset + 2]! > 100;
      };
      let minX = canvas.width;
      let maxX = -1;
      for (let y = 0; y < canvas.height; y += 1) {
        for (let x = 0; x < canvas.width; x += 1) {
          if (!isStroke(x, y)) continue;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
        }
      }
      if (maxX < 0) return { found: false, shaft: 0, head: 0 };
      // The head is a filled triangle, so a vertical slice through it catches
      // far more of the stroke colour than one through the shaft. A plain line,
      // which is all the arrow tool used to draw, is the same width throughout.
      const measure = (fx: number): number => {
        const x = Math.round(minX + fx * (maxX - minX));
        let count = 0;
        for (let y = 0; y < canvas.height; y += 1) if (isStroke(x, y)) count += 1;
        return count;
      };
      // The head spans only a couple of percent of the arrow's length, so scan
      // every column rather than sampling: a coarse scan walks straight past it.
      let thickest = 0;
      for (let x = minX; x <= maxX; x += 1) {
        let count = 0;
        for (let y = 0; y < canvas.height; y += 1) if (isStroke(x, y)) count += 1;
        if (count > thickest) thickest = count;
      }
      return { found: true, shaft: measure(0.3), head: thickest };
    });

    expect(thickness.found, 'the arrow must be drawn').toBe(true);
    expect(thickness.shaft, 'the arrow shaft must be drawn').toBeGreaterThan(0);
    expect(thickness.head, 'the arrow must be thicker at the head than along the shaft').toBeGreaterThan(thickness.shaft * 2);
  } finally {
    await context.close();
  }
});

test('the text tool accepts typing', async ({}, testInfo) => {
  testInfo.setTimeout(120_000);
  const { context, extensionId } = await launchExtension(testInfo);
  try {
    const driver = await context.newPage();
    await driver.goto(`chrome-extension://${extensionId}${driverPath}`);
    const { page, stage } = await openEditor(context, extensionId, driver, testInfo);

    await drawWith(page, 'text', [[0.15, 0.3], [0.7, 0.6]]);
    const before = await page.screenshot({ clip: stage });
    await page.keyboard.type('Merhaba');
    await page.waitForTimeout(400);
    const after = await page.screenshot({ clip: stage });
    await testInfo.attach('text-typed', { body: after, contentType: 'image/png' });

    expect(await stageChangeShare(page, before, after), 'typing must put characters on the canvas').toBeGreaterThan(0.0005);
  } finally {
    await context.close();
  }
});

test('blur and pixelate obscure the capture underneath', async ({}, testInfo) => {
  testInfo.setTimeout(120_000);
  const { context, extensionId } = await launchExtension(testInfo);
  try {
    const driver = await context.newPage();
    await driver.goto(`chrome-extension://${extensionId}${driverPath}`);
    const { page, stage } = await openEditor(context, extensionId, driver, testInfo);

    // The fixture bands carry text, so an effect that works replaces sharp glyph
    // edges with something smoother. An empty outline changes nothing.
    for (const [index, tool] of (['blur', 'pixelate'] as const).entries()) {
      const top = 0.1 + index * 0.45;
      const before = await page.screenshot({ clip: stage });
      await drawWith(page, tool, [[0.1, top], [0.9, top + 0.35]]);
      const after = await page.screenshot({ clip: stage });
      await testInfo.attach(`${tool}-applied`, { body: after, contentType: 'image/png' });
      expect(await stageChangeShare(page, before, after), `${tool} must change the pixels it covers`).toBeGreaterThan(0.002);
    }
  } finally {
    await context.close();
  }
});

test('the capture opens fitted to the stage and the zoom controls work', async ({}, testInfo) => {
  testInfo.setTimeout(120_000);
  const { context, extensionId } = await launchExtension(testInfo);
  try {
    const driver = await context.newPage();
    await driver.goto(`chrome-extension://${extensionId}${driverPath}`);
    const { page, stage } = await openEditor(context, extensionId, driver, testInfo);

    // Opening at natural size left a wide capture cropped with no way to zoom out.
    const canvas = await page.locator('.editor-stage canvas.lower-canvas').boundingBox();
    if (!canvas) throw new Error('The editor canvas has no layout box.');
    expect(canvas.width, 'the capture must open fitted inside the stage').toBeLessThanOrEqual(stage.width);

    const readZoom = async (): Promise<number> => Number((await page.locator('[data-testid="editor-zoom-value"]').innerText()).replace('%', ''));
    const fitted = await readZoom();
    await page.locator('[data-testid="editor-zoom-in"]').click();
    expect(await readZoom(), 'zooming in must raise the zoom').toBeGreaterThan(fitted);
    await page.locator('[data-testid="editor-zoom-fit"]').click();
    expect(await readZoom(), 'fit must return to the fitted zoom').toBe(fitted);
    await page.locator('[data-testid="editor-zoom-actual"]').click();
    expect(await readZoom(), 'the 100% control must show the capture at natural size').toBe(100);
  } finally {
    await context.close();
  }
});
