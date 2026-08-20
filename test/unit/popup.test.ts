// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '../../src/shared/defaults';

const sendMessage = vi.fn(async (type: string) => {
  if (type === 'settings.get') return structuredClone(defaultSettings);
  if (type === 'capture.listActive') return [];
  return undefined;
});

vi.mock('../../src/shared/messages', () => ({ sendMessage }));
vi.mock('../../src/shared/i18n', () => ({ t: (key: string) => key }));

describe('popup capture controls', () => {
  beforeEach(() => {
    sendMessage.mockClear();
    document.body.innerHTML = '<main id="app"></main>';
  });

  it('renders only full-page and visible-area capture actions', async () => {
    await import('../../src/pages/popup/main');
    await vi.waitFor(() => expect(document.querySelectorAll('button.action')).toHaveLength(2));

    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button.action'));
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'ui.capture.mode.fullPage',
      'ui.capture.mode.visible',
    ]);
    expect(document.body.textContent).not.toContain('ui.capture.mode.selection');
    expect(document.body.textContent).not.toContain('ui.capture.mode.element');
    expect(document.body.textContent).not.toContain('ui.capture.mode.scrollContainer');
  });
});
