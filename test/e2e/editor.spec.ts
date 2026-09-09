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

/** Selects an object by clicking its centre with the select tool. */
async function selectAt(page: Page, fx: number, fy: number): Promise<void> {
  await page.locator('[data-tool="select"]').click();
  const surface = await surfaceBox(page);
  const stage = await page.locator('.editor-stage').boundingBox();
  if (!stage) throw new Error('The editor stage has no layout box.');
  const left = Math.max(surface.x, stage.x) + 4;
  const top = Math.max(surface.y, stage.y) + 4;
  const width = Math.min(surface.x + surface.width, stage.x + stage.width) - left - 8;
  const height = Math.min(surface.y + surface.height, stage.y + stage.height) - top - 8;
  await page.mouse.click(left + fx * width, top + fy * height);
  await page.waitForTimeout(200);
}

/** Drags from one fraction of the visible surface to another. */
async function dragFromTo(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const surface = await surfaceBox(page);
  const stage = await page.locator('.editor-stage').boundingBox();
  if (!stage) throw new Error('The editor stage has no layout box.');
  const left = Math.max(surface.x, stage.x) + 4;
  const top = Math.max(surface.y, stage.y) + 4;
  const width = Math.min(surface.x + surface.width, stage.x + stage.width) - left - 8;
  const height = Math.min(surface.y + surface.height, stage.y + stage.height) - top - 8;
  await page.mouse.move(left + from[0] * width, top + from[1] * height);
  await page.mouse.down();
  await page.mouse.move(left + to[0] * width, top + to[1] * height, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(250);
}

/** Number of Fabric objects on the canvas, excluding the background. */
async function objectCount(page: Page): Promise<number> {
  return page.locator('[data-testid="editor-object-count"]').evaluate((el) => Number(el.textContent));
}

test('moving a blur region re-cuts it from its new position', async ({}, testInfo) => {
  const { context, extensionId } = await launchExtension(testInfo);
  try {
    const driver = await context.newPage();
    await driver.goto(`chrome-extension://${extensionId}${driverPath}`);
    const { page, stage } = await openEditor(context, extensionId, driver, testInfo);

    // Blur a region of the first colour band, then drag it onto a different
    // band. A region that carries its original pixels shows the first band's
    // colour in its new place — which both re-exposes what it covered and
    // transplants a copy of it somewhere the user never looked.
    await drawWith(page, 'blur', [[0.1, 0.05], [0.45, 0.2]]);
    await selectAt(page, 0.27, 0.12);
    await dragFromTo(page, [0.27, 0.12], [0.27, 0.75]);

    const carried = await page.locator('.editor-stage canvas.lower-canvas').evaluate((canvas: HTMLCanvasElement) => {
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Editor canvas has no 2D context.');
      // Compare the moved region against the band it now sits on: a stale
      // snapshot differs sharply from its surroundings.
      const inside = context.getImageData(Math.round(canvas.width * 0.27), Math.round(canvas.height * 0.75), 1, 1).data;
      const beside = context.getImageData(Math.round(canvas.width * 0.9), Math.round(canvas.height * 0.75), 1, 1).data;
      const distance = Math.abs(inside[0]! - beside[0]!) + Math.abs(inside[1]! - beside[1]!) + Math.abs(inside[2]! - beside[2]!);
      return { inside: [inside[0], inside[1], inside[2]], beside: [beside[0], beside[1], beside[2]], distance };
    });

    // A correctly re-cut blur of a flat colour band is that same colour.
    expect(carried.distance, `a moved blur must show its new surroundings, not the pixels it was created over (got ${JSON.stringify(carried)})`).toBeLessThan(60);
  } finally {
    await context.close();
  }
});

test('moving an annotation with the select tool does not also draw one', async ({}, testInfo) => {
  const { context, extensionId } = await launchExtension(testInfo);
  try {
    const driver = await context.newPage();
    await driver.goto(`chrome-extension://${extensionId}${driverPath}`);
    const { page } = await openEditor(context, extensionId, driver, testInfo);

    await drawWith(page, 'rect', [[0.2, 0.2], [0.5, 0.5]]);
    const afterDraw = await objectCount(page);

    // Dragging with the select tool moves the shape. The press used to leave a
    // live drag origin behind that the release then turned into a second shape.
    await selectAt(page, 0.35, 0.35);
    await dragFromTo(page, [0.35, 0.35], [0.6, 0.6]);

    expect(await objectCount(page), 'moving a shape must not also draw a new one').toBe(afterDraw);
  } finally {
    await context.close();
  }
});

test('the shape is visible while it is being dragged', async ({}, testInfo) => {
  const { context, extensionId } = await launchExtension(testInfo);
  try {
    const driver = await context.newPage();
    await driver.goto(`chrome-extension://${extensionId}${driverPath}`);
    const { page, stage } = await openEditor(context, extensionId, driver, testInfo);

    await page.locator('[data-tool="rect"]').click();
    const surface = await surfaceBox(page);
    const left = Math.max(surface.x, stage.x) + 4;
    const top = Math.max(surface.y, stage.y) + 4;
    const width = Math.min(surface.x + surface.width, stage.x + stage.width) - left - 8;
    const height = Math.min(surface.y + surface.height, stage.y + stage.height) - top - 8;

    const before = await page.screenshot({ clip: stage });
    // Hold the drag open: only freehand used to show anything before release.
    await page.mouse.move(left + 0.2 * width, top + 0.2 * height);
    await page.mouse.down();
    await page.mouse.move(left + 0.7 * width, top + 0.7 * height, { steps: 10 });
    await page.waitForTimeout(200);
    const during = await page.screenshot({ clip: stage });
    await page.mouse.up();

    expect(await stageChangeShare(page, before, during), 'the shape must be visible while the pointer is still down').toBeGreaterThan(0.002);
  } finally {
    await context.close();
  }
});

test('the colour and thickness controls change what is drawn', async ({}, testInfo) => {
  const { context, extensionId } = await launchExtension(testInfo);
  try {
    const driver = await context.newPage();
    await driver.goto(`chrome-extension://${extensionId}${driverPath}`);
    const { page } = await openEditor(context, extensionId, driver, testInfo);

    await page.locator('[data-tool="rect"]').click();
    await page.locator('[data-color="#0A84FF"]').click();
    await page.locator('[data-width="14"]').click();
    await drawWith(page, 'rect', [[0.2, 0.2], [0.7, 0.7]]);

    const painted = await page.locator('.editor-stage canvas.lower-canvas').evaluate((canvas: HTMLCanvasElement) => {
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Editor canvas has no 2D context.');
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      let blue = 0;
      let magenta = 0;
      for (let offset = 0; offset < data.length; offset += 4) {
        const [r, g, b] = [data[offset]!, data[offset + 1]!, data[offset + 2]!];
        if (b > 180 && r < 120 && g > 100 && g < 190) blue += 1;
        if (r > 200 && g < 90 && b > 100 && b < 200) magenta += 1;
      }
      return { blue, magenta };
    });

    expect(painted.blue, 'the chosen colour must be what gets drawn').toBeGreaterThan(0);
    expect(painted.magenta, 'the default colour must not be drawn once another is chosen').toBe(0);
  } finally {
    await context.close();
  }
});

test('a selected annotation can be deleted with the keyboard', async ({}, testInfo) => {
  const { context, extensionId } = await launchExtension(testInfo);
  try {
    const driver = await context.newPage();
    await driver.goto(`chrome-extension://${extensionId}${driverPath}`);
    const { page } = await openEditor(context, extensionId, driver, testInfo);

    await drawWith(page, 'rect', [[0.2, 0.2], [0.6, 0.6]]);
    expect(await objectCount(page)).toBe(1);

    // Undo was the only way to remove a shape, and it is strictly last-in
    // first-out, so removing an early shape meant redrawing everything after it.
    await selectAt(page, 0.4, 0.4);
    await page.keyboard.press('Delete');
    await page.waitForTimeout(250);

    expect(await objectCount(page), 'the selected annotation must be deleted').toBe(0);
  } finally {
    await context.close();
  }
});

test('an abandoned empty text box is not left behind', async ({}, testInfo) => {
  const { context, extensionId } = await launchExtension(testInfo);
  try {
    const driver = await context.newPage();
    await driver.goto(`chrome-extension://${extensionId}${driverPath}`);
    const { page } = await openEditor(context, extensionId, driver, testInfo);

    await drawWith(page, 'text', [[0.2, 0.2], [0.6, 0.4]]);
    // Leaving without typing used to strand an invisible object that still
    // intercepted clicks and could not be removed.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    expect(await objectCount(page), 'an empty text box must not survive').toBe(0);
  } finally {
    await context.close();
  }
});

test('typed text is written into the document that gets saved', async ({}, testInfo) => {
  const { context, extensionId } = await launchExtension(testInfo);
  try {
    const driver = await context.newPage();
    await driver.goto(`chrome-extension://${extensionId}${driverPath}`);
    const { page } = await openEditor(context, extensionId, driver, testInfo);

    await drawWith(page, 'text', [[0.2, 0.2], [0.7, 0.4]]);
    await page.keyboard.type('Gizli');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // The model recorded an empty string forever, so a saved document lost
    // every character while the exported image kept them.
    const text = await page.locator('[data-testid="editor-doc-text"]').innerText();
    expect(text, 'the typed text must reach the document').toBe('Gizli');
  } finally {
    await context.close();
  }
});

test('moving an annotation updates the document rather than only the canvas', async ({}, testInfo) => {
  const { context, extensionId } = await launchExtension(testInfo);
  try {
    const driver = await context.newPage();
    await driver.goto(`chrome-extension://${extensionId}${driverPath}`);
    const { page } = await openEditor(context, extensionId, driver, testInfo);

    await drawWith(page, 'rect', [[0.15, 0.15], [0.4, 0.4]]);
    const before = await page.locator('[data-testid="editor-doc-rect"]').innerText();

    await selectAt(page, 0.27, 0.27);
    await dragFromTo(page, [0.27, 0.27], [0.7, 0.7]);

    const after = await page.locator('[data-testid="editor-doc-rect"]').innerText();
    expect(after, 'the document must record where the annotation was left').not.toBe(before);
  } finally {
    await context.close();
  }
});

test('the capture opens large enough to annotate', async ({}, testInfo) => {
  const { context, extensionId } = await launchExtension(testInfo);
  try {
    const driver = await context.newPage();
    await driver.goto(`chrome-extension://${extensionId}${driverPath}`);
    const fixture = await context.newPage();
    await fixture.setViewportSize({ width: 1280, height: 800 });
    await fixture.goto(`${fixtureOrigin}/very-long.html`);
    const page = await sendCapture(context, extensionId, driver, fixture, captureRequest('fullPage'), testInfo);
    await page.locator('[data-testid="result-viewer"] img').waitFor({ state: 'visible' });
    await page.locator('[data-testid="result-edit"]').click();
    await page.locator('[data-testid="editor-toolbar"][data-ready="true"]').waitFor();

    // Fitting a 34,000px capture by height lands around 6%, where the image is
    // a thumbnail and a stroke is thinner than a pixel.
    const zoom = Number((await page.locator('[data-testid="editor-zoom-value"]').innerText()).replace('%', ''));
    expect(zoom, 'a full-page capture must not open as an unusable thumbnail').toBeGreaterThanOrEqual(25);
  } finally {
    await context.close();
  }
});

/** Share of near-black pixels in an image element, sampled in the page. */
async function blackShare(page: Page, selector: string): Promise<number> {
  return page.locator(selector).evaluate((image: HTMLImageElement) => {
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Sampling canvas has no 2D context.');
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let dark = 0;
    for (let offset = 0; offset < data.length; offset += 4) {
      if (data[offset]! < 30 && data[offset + 1]! < 30 && data[offset + 2]! < 30) dark += 1;
    }
    return dark / (data.length / 4);
  });
}

test('saving keeps the annotations and shows the edited version', async ({}, testInfo) => {
  const { context, extensionId } = await launchExtension(testInfo);
  try {
    const driver = await context.newPage();
    await driver.goto(`chrome-extension://${extensionId}${driverPath}`);
    const { page } = await openEditor(context, extensionId, driver, testInfo);
    const originalId = new URL(page.url()).searchParams.get('id');

    // Redaction is opaque black, which the fixture's colour bands never are, so
    // it is unambiguous evidence that the annotation survived the round trip.
    await drawWith(page, 'redact', [[0.2, 0.2], [0.7, 0.7]]);
    await page.locator('[data-testid="editor-save"]').click();
    await page.waitForURL((url) => {
      const id = url.searchParams.get('id');
      return id !== null && id !== originalId;
    }, { timeout: 20_000 });
    await page.locator('[data-testid="result-viewer"] img').waitFor({ state: 'visible' });

    // Two separate failures used to hide here: the export scaled the canvas
    // against its own zoom so the annotations fell outside the frame, and the
    // viewer preferred the untouched capture over the edited file, so a save
    // that had worked still looked as though it had done nothing.
    const share = await blackShare(page, '[data-testid="result-viewer"] img');
    expect(share, 'the saved capture must contain the redaction').toBeGreaterThan(0.05);

    // The export also has to stay at the capture's own resolution: passing a
    // multiplier alone fought with the canvas resize that zooming performs.
    const saved = await page.locator('[data-testid="result-viewer"] img').evaluate((image: HTMLImageElement) => ({ width: image.naturalWidth, height: image.naturalHeight }));
    expect(saved.width, 'the saved capture must keep its width').toBeGreaterThanOrEqual(1600);
  } finally {
    await context.close();
  }
});

test('a shape can be drawn on top of an existing one', async ({}, testInfo) => {
  const { context, extensionId } = await launchExtension(testInfo);
  try {
    const driver = await context.newPage();
    await driver.goto(`chrome-extension://${extensionId}${driverPath}`);
    const { page } = await openEditor(context, extensionId, driver, testInfo);

    // A filled shape, so the second gesture starts on solid pixels of the first
    // rather than between the strokes of an outline.
    await drawWith(page, 'redact', [[0.15, 0.15], [0.75, 0.75]]);
    expect(await objectCount(page)).toBe(1);

    // Starting the second shape on top of the first used to be swallowed: the
    // press was read as "move that one", so the new shape was never created and
    // the area covered by earlier annotations became undrawable.
    await drawWith(page, 'arrow', [[0.3, 0.3], [0.85, 0.6]]);

    expect(await objectCount(page), 'a drawing tool must draw over an existing annotation, not move it').toBe(2);
  } finally {
    await context.close();
  }
});

test('annotations are only draggable with the select tool', async ({}, testInfo) => {
  const { context, extensionId } = await launchExtension(testInfo);
  try {
    const driver = await context.newPage();
    await driver.goto(`chrome-extension://${extensionId}${driverPath}`);
    const { page } = await openEditor(context, extensionId, driver, testInfo);

    await drawWith(page, 'rect', [[0.2, 0.2], [0.6, 0.6]]);
    const drawn = await page.locator('[data-testid="editor-doc-rect"]').innerText();

    // With a drawing tool still active the shape must not move; that is what
    // makes drawing over it possible.
    await dragFromTo(page, [0.4, 0.4], [0.7, 0.7]);
    expect(await page.locator('[data-testid="editor-doc-rect"]').innerText(), 'a drawing tool must not drag existing annotations').toContain(drawn.split('|')[0]!);

    // Switching to select makes the same drag move it.
    await selectAt(page, 0.4, 0.4);
    await dragFromTo(page, [0.4, 0.4], [0.7, 0.7]);
    expect(await page.locator('[data-testid="editor-doc-rect"]').innerText(), 'the select tool must move annotations').not.toBe(drawn);
  } finally {
    await context.close();
  }
});

test('the effect tools preview as a filled region, not an empty outline', async ({}, testInfo) => {
  const { context, extensionId } = await launchExtension(testInfo);
  try {
    const driver = await context.newPage();
    await driver.goto(`chrome-extension://${extensionId}${driverPath}`);
    const { page, stage } = await openEditor(context, extensionId, driver, testInfo);

    for (const tool of ['blur', 'pixelate', 'highlight', 'redact'] as const) {
      await page.locator(`[data-tool="${tool}"]`).click();
      const surface = await surfaceBox(page);
      const left = Math.max(surface.x, stage.x) + 4;
      const top = Math.max(surface.y, stage.y) + 4;
      const width = Math.min(surface.x + surface.width, stage.x + stage.width) - left - 8;
      const height = Math.min(surface.y + surface.height, stage.y + stage.height) - top - 8;

      const before = await page.screenshot({ clip: stage });
      // Hold the drag open and sample the middle of the region: an outline-only
      // preview leaves the interior untouched, which shows nothing of the
      // effect the user is about to apply.
      await page.mouse.move(left + 0.15 * width, top + 0.15 * height);
      await page.mouse.down();
      await page.mouse.move(left + 0.85 * width, top + 0.85 * height, { steps: 10 });
      await page.waitForTimeout(200);
      const during = await page.screenshot({ clip: stage });
      await page.mouse.up();
      await page.waitForTimeout(150);
      await page.keyboard.press('Escape');

      const changed = await page.evaluate(async ({ first, second }) => {
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
        const pixelsBefore = context.getImageData(0, 0, canvas.width, canvas.height);
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(b, 0, 0);
        const pixelsAfter = context.getImageData(0, 0, canvas.width, canvas.height);
        // Sample only the middle of the dragged region, well inside any border.
        let differing = 0;
        let sampled = 0;
        for (let y = Math.round(canvas.height * 0.35); y < canvas.height * 0.65; y += 2) {
          for (let x = Math.round(canvas.width * 0.35); x < canvas.width * 0.65; x += 2) {
            const offset = (y * canvas.width + x) * 4;
            sampled += 1;
            if (pixelsBefore.data[offset] !== pixelsAfter.data[offset] || pixelsBefore.data[offset + 1] !== pixelsAfter.data[offset + 1] || pixelsBefore.data[offset + 2] !== pixelsAfter.data[offset + 2]) differing += 1;
          }
        }
        return differing / Math.max(1, sampled);
      }, { first: before.toString('base64'), second: during.toString('base64') });

      expect(changed, `the ${tool} preview must fill the region it will affect`).toBeGreaterThan(0.5);
    }
  } finally {
    await context.close();
  }
});

test('the toolbar fits on one row and leaves the capture room', async ({}, testInfo) => {
  const { context, extensionId } = await launchExtension(testInfo);
  try {
    const driver = await context.newPage();
    await driver.goto(`chrome-extension://${extensionId}${driverPath}`);
    const { page } = await openEditor(context, extensionId, driver, testInfo);

    // The toolbar took three rows of spelled-out buttons and pushed the capture
    // down the page; the stage is what the user actually needs to see.
    const measure = async (): Promise<number> => {
      const box = await page.locator('[data-testid="editor-toolbar"]').boundingBox();
      if (!box) throw new Error('The editor toolbar has no layout box.');
      return box.height;
    };

    await page.setViewportSize({ width: 1600, height: 900 });
    await page.waitForTimeout(200);
    expect(await measure(), 'the toolbar must fit one row at a normal window size').toBeLessThan(64);

    // Narrower windows may wrap, but never back to the three rows it had.
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.waitForTimeout(200);
    expect(await measure(), 'the toolbar must stay compact on a narrow window').toBeLessThan(100);

    const stageBox = await page.locator('.editor-stage').boundingBox();
    if (!stageBox) throw new Error('The editor stage has no layout box.');
    expect(stageBox.height, 'the stage must get far more room than the toolbar').toBeGreaterThan(await measure() * 3);
  } finally {
    await context.close();
  }
});
