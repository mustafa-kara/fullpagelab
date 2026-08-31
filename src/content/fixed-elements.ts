import type { FixedElementInfo } from '../shared/types/capture';
import { Restorer } from './restorer';

export type FixedStrategy = 'none' | 'hideAfterFirst' | 'hideAll' | 'absolutize';

export interface FixedElementController {
  setTile(index: number, total: number): void;
  restore(): Promise<void>;
}

export function shouldHideFixedElement(
  strategy: FixedStrategy,
  tileIndex: number,
  tileCount: number,
  anchor?: FixedElementInfo['anchor'],
): boolean {
  if (strategy === 'hideAll') return true;
  if (strategy !== 'hideAfterFirst') return false;
  if (tileCount <= 1) return false;
  // A top bar belongs to the first tile only and a bottom bar to the last tile
  // only; repeating them on any other tile duplicates them inside the stitched
  // image. Elements without a clear anchor keep the legacy first/last rule.
  if (anchor === 'top') return tileIndex > 0;
  if (anchor === 'bottom') return tileIndex < tileCount - 1;
  return tileCount > 2 && tileIndex > 0 && tileIndex < tileCount - 1;
}

export function isCookieLikeFixedElement(info: FixedElementInfo, element?: HTMLElement): boolean {
  return /cookie|consent|gdpr|çerez|kvkk|onetrust|cookiebot|didomi|usercentrics|osano|iubenda/i.test(`${info.id ?? ''} ${info.classes.join(' ')} ${info.selector} ${(element?.textContent ?? '').slice(0, 500)}`);
}

function queryElement(selector: string, root: Document): HTMLElement | undefined {
  try {
    const element = root.querySelector<HTMLElement>(selector);
    return element ?? undefined;
  } catch {
    return undefined;
  }
}

export function createFixedElementController(
  elements: readonly FixedElementInfo[],
  strategy: FixedStrategy,
  root?: Document,
): FixedElementController {
  const restorer = new Restorer();
  const documentRoot = root ?? (typeof document === 'undefined' ? undefined : document);
  if (!documentRoot) return { setTile: () => undefined, restore: async () => undefined };
  const records = elements
    .map((info) => ({ info, element: queryElement(info.selector, documentRoot) }))
    .filter((record): record is { info: FixedElementInfo; element: HTMLElement } => record.element !== undefined)
    .map((record) => {
      const originalStyle = record.element.getAttribute('style');
      restorer.register(() => {
        if (originalStyle === null) record.element.removeAttribute('style');
        else record.element.setAttribute('style', originalStyle);
      });
      return record;
    });

  function setTile(index: number, total: number): void {
    for (const { info, element } of records) {
      if (element.dataset.fullpagelabSmartHidden === 'true') continue;
      if (strategy !== 'none' && isCookieLikeFixedElement(info, element)) {
        element.style.setProperty('visibility', 'hidden', 'important');
        continue;
      }
      const hidden = shouldHideFixedElement(strategy, index, total, info.anchor);
      if (hidden) {
        // visibility keeps the element's layout box, so hiding an in-flow
        // position:sticky bar cannot shift the rest of the page mid-capture.
        element.style.setProperty('visibility', 'hidden', 'important');
        element.style.setProperty('pointer-events', 'none', 'important');
        continue;
      }
      element.style.removeProperty('visibility');
      element.style.removeProperty('pointer-events');
      element.style.removeProperty('display');
      if (strategy === 'absolutize') {
        const rect = element.getBoundingClientRect();
        const scrollX = window.scrollX;
        const scrollY = window.scrollY;
        element.style.setProperty('position', 'absolute', 'important');
        element.style.setProperty('left', `${rect.left + scrollX}px`, 'important');
        element.style.setProperty('top', `${rect.top + scrollY}px`, 'important');
        element.style.setProperty('width', `${rect.width}px`, 'important');
        element.style.setProperty('height', `${rect.height}px`, 'important');
      }
      if (info.position === 'sticky' && info.anchor === 'other') element.style.setProperty('display', 'block', 'important');
    }
  }

  return { setTile, restore: () => restorer.restore() };
}
