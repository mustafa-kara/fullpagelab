import { describe, expect, it, vi } from 'vitest';
import { createContextMenuController, fullPageMenuId } from '../../src/background/context-menus';

describe('context menu controller', () => {
  it('replaces the stable full-page item before creating the page-only menu', async () => {
    const create = vi.fn((properties: chrome.contextMenus.CreateProperties) => properties.id ?? fullPageMenuId);
    const remove = vi.fn(async () => undefined);
    const controller = createContextMenuController({
      platform: { create, remove, addClickListener: vi.fn() },
      getTitle: () => 'Capture full-page screenshot',
      onCapture: vi.fn(),
      onError: vi.fn(),
    });

    await controller.sync();
    await controller.sync();

    expect(remove).toHaveBeenNthCalledWith(1, fullPageMenuId);
    expect(remove).toHaveBeenNthCalledWith(2, fullPageMenuId);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenNthCalledWith(1, {
      id: fullPageMenuId,
      title: 'Capture full-page screenshot',
      contexts: ['page'],
    });
    expect(create.mock.calls.map(([properties]) => properties.id)).toEqual([fullPageMenuId, fullPageMenuId]);
  });

  it('registers once, ignores unrelated clicks, and routes the clicked tab', async () => {
    let listener: ((info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => void) | undefined;
    const onCapture = vi.fn(async () => undefined);
    const onError = vi.fn();
    const controller = createContextMenuController({
      platform: {
        create: vi.fn(() => fullPageMenuId),
        remove: vi.fn(async () => undefined),
        addClickListener: vi.fn((next) => { listener = next; }),
      },
      getTitle: () => 'Capture full-page screenshot',
      onCapture,
      onError,
    });

    controller.register();
    controller.register();

    const tab = { id: 42, windowId: 7, url: 'https://example.com/' } as chrome.tabs.Tab;
    listener?.({ menuItemId: 'unrelated' } as chrome.contextMenus.OnClickData, tab);
    listener?.({ menuItemId: fullPageMenuId } as chrome.contextMenus.OnClickData);
    expect(onCapture).not.toHaveBeenCalled();

    listener?.({ menuItemId: fullPageMenuId } as chrome.contextMenus.OnClickData, tab);
    await vi.waitFor(() => expect(onCapture).toHaveBeenCalledWith(tab));
    expect(onError).not.toHaveBeenCalled();
  });

  it('reports asynchronous capture failures', async () => {
    let listener: ((info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => void) | undefined;
    const failure = new Error('capture failed');
    const onError = vi.fn();
    const controller = createContextMenuController({
      platform: {
        create: vi.fn(() => fullPageMenuId),
        remove: vi.fn(async () => undefined),
        addClickListener: (next) => { listener = next; },
      },
      getTitle: () => 'Capture full-page screenshot',
      onCapture: async () => { throw failure; },
      onError,
    });

    controller.register();
    listener?.({ menuItemId: fullPageMenuId } as chrome.contextMenus.OnClickData, { id: 42 } as chrome.tabs.Tab);

    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(failure));
  });
});
