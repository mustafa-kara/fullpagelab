import { resolve } from 'node:path';
import { chromium, type BrowserContext, type TestInfo } from '@playwright/test';

export async function launchExtension(testInfo: TestInfo): Promise<{ context: BrowserContext; extensionId: string }> {
  const extensionPath = resolve('dist/store');
  const context = await chromium.launchPersistentContext(testInfo.outputPath('profile'), {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  let worker = context.serviceWorkers()[0];
  worker ??= await context.waitForEvent('serviceworker');
  return { context, extensionId: new URL(worker.url()).host };
}
