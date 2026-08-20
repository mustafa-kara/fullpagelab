// @vitest-environment happy-dom

import { h, render } from 'preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '../../src/shared/defaults';
import type { Settings } from '../../src/shared/types/settings';

let currentSettings: Settings;
const sendMessage = vi.fn(async (type: string, payload?: unknown) => {
  if (type === 'settings.get') return structuredClone(currentSettings);
  if (type === 'settings.set') {
    const patch = (payload as { patch?: Partial<Settings> } | undefined)?.patch;
    if (patch?.general) currentSettings = { ...currentSettings, general: { ...currentSettings.general, ...patch.general } };
    if (patch?.privacy) currentSettings = { ...currentSettings, privacy: { ...currentSettings.privacy, ...patch.privacy } };
    return structuredClone(currentSettings);
  }
  if (type === 'capture.start') return { jobId: 'job-onboarding' };
  return undefined;
});

vi.mock('../../src/shared/messages', () => ({ sendMessage }));
vi.mock('../../src/shared/i18n', () => ({ t: (key: string) => key }));

describe('onboarding page', () => {
  beforeEach(() => {
    currentSettings = structuredClone(defaultSettings);
    sendMessage.mockClear();
    document.body.innerHTML = '<main id="app"></main>';
  });

  it('renders the welcome experience and moves through the three steps', async () => {
    const { Onboarding } = await import('../../src/pages/onboarding/main');
    render(h(Onboarding, {}), document.getElementById('app')!);

    await vi.waitFor(() => expect(document.querySelector('[data-testid="onboarding-welcome"]')).not.toBeNull());
    expect(document.querySelector('.pin-card')).not.toBeNull();
    document.querySelector<HTMLButtonElement>('[data-testid="onboarding-next"]')?.click();
    await vi.waitFor(() => expect(document.querySelector('[data-testid="onboarding-privacy"]')).not.toBeNull());
    document.querySelector<HTMLButtonElement>('[data-testid="onboarding-next"]')?.click();
    await vi.waitFor(() => expect(document.querySelector('[data-testid="onboarding-try"]')).not.toBeNull());
  });

  it('marks the onboarding complete when the user skips the tour', async () => {
    const { Onboarding } = await import('../../src/pages/onboarding/main');
    render(h(Onboarding, {}), document.getElementById('app')!);

    document.querySelector<HTMLButtonElement>('[data-testid="onboarding-skip"]')?.click();
    await vi.waitFor(() => expect(document.querySelector('[data-testid="onboarding-complete"]')).not.toBeNull());
    expect(sendMessage).toHaveBeenCalledWith('settings.set', { patch: { general: { onboardingDone: true } } });
  });

  it('requests persistent storage and saves telemetry only after the user toggles it', async () => {
    const persist = vi.fn(async () => true);
    Object.defineProperty(navigator, 'storage', { configurable: true, value: { persist } });
    const { Onboarding } = await import('../../src/pages/onboarding/main');
    render(h(Onboarding, {}), document.getElementById('app')!);
    document.querySelector<HTMLButtonElement>('[data-testid="onboarding-next"]')?.click();
    await vi.waitFor(() => expect(document.querySelector('[data-testid="onboarding-privacy"]')).not.toBeNull());

    document.querySelector<HTMLButtonElement>('[data-testid="onboarding-persist"]')?.click();
    await vi.waitFor(() => expect(persist).toHaveBeenCalledOnce());
    document.querySelector<HTMLInputElement>('[data-testid="onboarding-telemetry"]')?.click();
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith('settings.set', { patch: { privacy: { telemetry: true } } }));
  });

  it('starts a full-page capture from the final step', async () => {
    const { Onboarding } = await import('../../src/pages/onboarding/main');
    render(h(Onboarding, {}), document.getElementById('app')!);
    document.querySelector<HTMLButtonElement>('[data-testid="onboarding-next"]')?.click();
    await vi.waitFor(() => expect(document.querySelector('[data-testid="onboarding-privacy"]')).not.toBeNull());
    document.querySelector<HTMLButtonElement>('[data-testid="onboarding-next"]')?.click();
    await vi.waitFor(() => expect(document.querySelector('[data-testid="onboarding-try"]')).not.toBeNull());
    document.querySelector<HTMLButtonElement>('[data-testid="onboarding-capture"]')?.click();

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith('capture.start', { mode: 'fullPage' }));
    expect(document.querySelector('[data-testid="onboarding-try"]')?.textContent).toContain('onboarding.try.startedTitle');
  });
});
