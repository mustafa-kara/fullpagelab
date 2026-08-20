import type { Id } from '../../shared/types/primitives';

export interface ResultTab {
  id?: number;
}

export interface ResultTabPlatform {
  baseUrl(): string;
  query(urlPattern: string): Promise<ResultTab[]>;
  update(tabId: number, url: string): Promise<void>;
  create(url: string): Promise<void>;
}

export interface ResultTabOpenerOptions {
  platform: ResultTabPlatform;
  behavior: () => 'newTab' | 'reuseTab';
  onError?: (error: unknown) => void;
}

export function createResultTabOpener({ platform, behavior, onError }: ResultTabOpenerOptions): (captureId: Id) => Promise<void> {
  const opened = new Set<Id>();

  return async (captureId: Id): Promise<void> => {
    if (opened.has(captureId)) return;
    opened.add(captureId);
    const url = `${platform.baseUrl()}?id=${encodeURIComponent(captureId)}`;
    try {
      if (behavior() === 'reuseTab') {
        const existing = (await platform.query(`${platform.baseUrl()}*`)).find((tab) => tab.id !== undefined);
        if (existing?.id !== undefined) {
          await platform.update(existing.id, url);
          return;
        }
      }
      await platform.create(url);
    } catch (error) {
      opened.delete(captureId);
      onError?.(error);
    }
  };
}
