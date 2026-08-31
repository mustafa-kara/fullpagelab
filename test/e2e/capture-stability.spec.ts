import { expect, test, type TestInfo } from '@playwright/test';
import {
  bandColors,
  captureRequest,
  driverPath,
  fixtureOrigin,
  hexToRgb,
  prepareFixture,
  resultPixels,
  scrollbarColor,
  sendCapture,
} from './capture-helpers';
import { launchExtension } from './extension';

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
