import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, type BrowserContext, type TestInfo } from '@playwright/test';

export async function launchExtension(testInfo: TestInfo): Promise<{ context: BrowserContext; extensionId: string }> {
  const extensionPath = testInfo.outputPath('extension');
  cpSync(resolve('dist/store'), extensionPath, { recursive: true });
  const manifestPath = resolve(extensionPath, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    host_permissions?: string[];
    permissions?: string[];
  };
  manifest.permissions = [...new Set([...(manifest.permissions ?? []), 'tabs'])];
  manifest.host_permissions = ['<all_urls>'];
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const context = await chromium.launchPersistentContext(testInfo.outputPath('profile'), {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  let worker = context.serviceWorkers()[0];
  worker ??= await context.waitForEvent('serviceworker');
  return { context, extensionId: new URL(worker.url()).host };
}
