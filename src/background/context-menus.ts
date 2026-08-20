export const fullPageMenuId = 'fullpagelab.capture.fullPage';

export interface ContextMenuPlatform {
  create(properties: chrome.contextMenus.CreateProperties): string | number;
  remove(menuItemId: string): Promise<void>;
  addClickListener(listener: (info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => void): void;
}

export function createContextMenuController({
  platform,
  getTitle,
  onCapture,
  onError,
}: {
  platform: ContextMenuPlatform;
  getTitle: () => string;
  onCapture: (tab: chrome.tabs.Tab) => void | Promise<void>;
  onError: (error: unknown) => void;
}) {
  let registered = false;

  return {
    register(): void {
      if (registered) return;
      registered = true;
      platform.addClickListener((info, tab) => {
        if (info.menuItemId !== fullPageMenuId || !tab) return;
        void Promise.resolve(onCapture(tab)).catch(onError);
      });
    },

    async sync(): Promise<void> {
      try {
        await platform.remove(fullPageMenuId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/cannot find|not found|does not exist/i.test(message)) throw error;
      }
      try {
        platform.create({ id: fullPageMenuId, title: getTitle(), contexts: ['page'] });
      } catch (error) {
        onError(error);
        throw error;
      }
    },
  };
}
