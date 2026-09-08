import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { captureRequest, driverPath, fixtureOrigin, sendCapture } from './capture-helpers';
import { launchExtension } from './extension';

const locales = ['en', 'tr'] as const;

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
  const { context, extensionId } = await launchExtension(testInfo);
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

    const painted = await resultPage.locator('.editor-stage canvas.lower-canvas').evaluate((canvas: HTMLCanvasElement) => {
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Editor canvas has no 2D context.');
      const { data } = context.getImageData(0, 0, Math.min(60, canvas.width), Math.min(60, canvas.height));
      let opaque = 0;
      for (let offset = 3; offset < data.length; offset += 4) if (data[offset] !== 0) opaque += 1;
      return opaque;
    });

    expect(painted, 'the editor canvas must show the capture, not a blank surface').toBeGreaterThan(0);
  } finally {
    await context.close();
  }
});
