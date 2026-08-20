// @vitest-environment happy-dom

import { h, render } from 'preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '../../src/shared/defaults';
import type { CaptureRecord } from '../../src/shared/types/history';

const sendMessage = vi.fn(async (type: string) => {
  if (type === 'history.get') return record;
  if (type === 'settings.get') return structuredClone(defaultSettings);
  return { files: [] };
});

vi.mock('../../src/shared/messages', () => ({ sendMessage }));
vi.mock('../../src/shared/i18n', () => ({ t: (key: string) => key }));
vi.mock('../../src/shared/db/blob-ref', () => ({ resolveBlob: vi.fn(async () => new Blob(['png'], { type: 'image/png' })) }));

const record: CaptureRecord = {
  id: 'capture-1', createdAt: '2026-08-20T11:22:33.000Z', updatedAt: '2026-08-20T11:22:33.000Z',
  url: 'https://example.com/docs', domain: 'example.com', title: 'Docs', mode: 'fullPage', backend: 'visibleTab',
  request: {} as CaptureRecord['request'], size: { width: 800, height: 1_200 }, cssSize: { width: 800, height: 1_200 },
  dpr: 1, zoom: 1, viewport: { width: 800, height: 600 }, files: [{ id: 'file-1', role: 'full', ref: { store: 'idb', key: 'blob-1', mime: 'image/png', bytes: 3 }, format: 'png', createdAt: '2026-08-20T11:22:33.000Z' }],
  thumbnail: { store: 'idb', key: 'thumb-1', mime: 'image/webp', bytes: 3 }, tags: [], starred: false, warnings: [], durationMs: 100,
  appVersion: '0.1.0', source: { trigger: 'popup' },
};

describe('result page', () => {
  beforeEach(() => {
    document.body.innerHTML = '<main id="app"></main>';
    sendMessage.mockClear();
  });

  it('renders the preview and lets the user choose a format before downloading', async () => {
    const { ResultPage } = await import('../../src/pages/result/main');
    render(h(ResultPage, { captureId: 'capture-1' }), document.getElementById('app')!);
    await vi.waitFor(() => expect(document.querySelector('[data-testid="result-viewer"]')).not.toBeNull());

    expect(document.querySelector('[data-testid="result-title"]')?.textContent).toContain('Docs');
    const jpeg = document.querySelector<HTMLButtonElement>('[data-format="jpeg"]');
    expect(jpeg).not.toBeNull();
    jpeg?.click();
    await vi.waitFor(() => expect(document.querySelector<HTMLInputElement>('[data-testid="filename-input"]')?.value).toContain('.jpg'));

    document.querySelector<HTMLButtonElement>('[data-testid="download-button"]')?.click();
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith('export.request', expect.objectContaining({ captureId: 'capture-1' })));
  });
});
