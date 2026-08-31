import { expect, test, type TestInfo } from '@playwright/test';
import type { CaptureRequest } from '../../src/shared/types/capture';
import {
  bandColors,
  captureRequest,
  driverPath,
  fixtureOrigin,
  hexToRgb,
  prepareFixture,
  resultPixels,
  sendCapture,
} from './capture-helpers';
import { launchExtension } from './extension';

interface RobustnessExpectation {
  fixtureName: string;
  bandCount: number;
  expectedCssHeight?: number;
  mutateRequest?: (request: CaptureRequest) => void;
}

async function expectRobustFullPage(
  { fixtureName, bandCount, expectedCssHeight, mutateRequest }: RobustnessExpectation,
  testInfo: TestInfo,
): Promise<void> {
  const { context, extensionId } = await launchExtension(testInfo);
  try {
    const driver = await context.newPage();
    await driver.goto(`chrome-extension://${extensionId}${driverPath}`);
    const fixture = await context.newPage();
    await fixture.goto(`${fixtureOrigin}/${fixtureName}`);
    const prepared = await prepareFixture(fixture);
    expect(prepared.bands.length).toBeGreaterThanOrEqual(bandCount);
    const request = captureRequest('fullPage');
    mutateRequest?.(request);
    const resultPage = await sendCapture(context, extensionId, driver, fixture, request, testInfo);
    const bands = prepared.bands.slice(0, bandCount);
    const sampled = await resultPixels(resultPage, bands.map((band) => ({
      x: band.centerX * prepared.dpr,
      y: band.centerY * prepared.dpr,
    })));
    expect(sampled.height).toBe(Math.round((expectedCssHeight ?? prepared.cssHeight) * prepared.dpr));
    expect(sampled.colors).toEqual(bandColors.slice(0, bandCount).map(hexToRgb));
  } finally {
    await context.close();
  }
}

test('captures the inner scroller of a deep-DOM single-page app layout', async ({}, testInfo) => {
  await expectRobustFullPage({ fixtureName: 'spa-scroller.html', bandCount: 12 }, testInfo);
});

test('captures the full document behind a scroll-locking cookie overlay', async ({}, testInfo) => {
  await expectRobustFullPage({ fixtureName: 'overlay-scroll-lock.html', bandCount: 12 }, testInfo);
});

test('captures the scrolling document even when a large embedded panel is scrollable', async ({}, testInfo) => {
  await expectRobustFullPage({ fixtureName: 'decoy-panel.html', bandCount: 12 }, testInfo);
});

test('keeps the captured portion when the document shrinks mid-capture', async ({}, testInfo) => {
  await expectRobustFullPage({
    fixtureName: 'shrinking.html',
    bandCount: 8,
    expectedCssHeight: 1600,
    mutateRequest: (request) => { request.options.lazyLoad.preScroll = false; },
  }, testInfo);
});
