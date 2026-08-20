import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createCommandController } from '../../src/background/commands';

describe('command controller', () => {
  it('routes capture-visible and ignores unknown commands', async () => {
    let listener: ((command: string) => void) | undefined;
    const onVisibleCapture = vi.fn(async () => undefined);
    const onError = vi.fn();
    const controller = createCommandController({
      platform: { addListener: (next) => { listener = next; } },
      onVisibleCapture,
      onError,
    });

    controller.register();
    listener?.('capture-full-page');
    listener?.('unknown-command');
    expect(onVisibleCapture).not.toHaveBeenCalled();

    listener?.('capture-visible');
    await vi.waitFor(() => expect(onVisibleCapture).toHaveBeenCalledOnce());
    expect(onError).not.toHaveBeenCalled();
  });

  it('reports visible capture failures', async () => {
    let listener: ((command: string) => void) | undefined;
    const failure = new Error('capture failed');
    const onError = vi.fn();
    createCommandController({
      platform: { addListener: (next) => { listener = next; } },
      onVisibleCapture: async () => { throw failure; },
      onError,
    }).register();

    listener?.('capture-visible');
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(failure));
  });

  it('declares only the working visible command in the manifest source', () => {
    const source = readFileSync('manifest.config.ts', 'utf8');

    expect(source).toContain("'capture-visible'");
    expect(source).not.toContain('capture-full-page');
    expect(source).not.toContain('capture-selection');
    expect(source).not.toContain('capture-element');
    expect(source).not.toContain('Alt+Shift+P');
  });
});
