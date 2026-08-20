import type { ElementInfo, FixedElementInfo, IframeInfo, PageMetrics, ScanOptions } from '../shared/types/capture';
import type { Rect, Size } from '../shared/types/primitives';

function selectorFor(element: Element): string {
  if (element === document.documentElement) return 'html';
  const htmlElement = element as HTMLElement;
  if (htmlElement.id) {
    const escape = globalThis.CSS?.escape ?? ((value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '\\$&'));
    return `#${escape(htmlElement.id)}`;
  }
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current !== document.documentElement && parts.length < 6) {
    const tag = current.tagName.toLowerCase();
    const parent: HTMLElement | null = current.parentElement;
    if (!parent) {
      parts.unshift(tag);
      break;
    }
    const currentTag = current.tagName;
    const siblings: Element[] = Array.from(parent.children).filter((sibling: Element) => sibling.tagName === currentTag);
    const index = siblings.indexOf(current) + 1;
    parts.unshift(`${tag}:nth-of-type(${Math.max(1, index)})`);
    current = parent;
  }
  return parts.join(' > ') || 'body';
}

function depthOf(element: Element): number {
  let depth = 0;
  for (let current: Element | null = element.parentElement; current; current = current.parentElement) depth += 1;
  return depth;
}

function sizeOf(element: HTMLElement): Size {
  return { width: element.clientWidth, height: element.clientHeight };
}

function scrollSizeOf(element: HTMLElement): Size {
  return { width: element.scrollWidth, height: element.scrollHeight };
}

function isScrollable(element: HTMLElement): boolean {
  const style = getComputedStyle(element);
  const horizontal = /(auto|scroll|overlay)/.test(style.overflowX) && element.scrollWidth > element.clientWidth + 1;
  const vertical = /(auto|scroll|overlay)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1;
  return horizontal || vertical;
}

function elementInfo(element: HTMLElement, frameId = 0): ElementInfo {
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return {
    selector: selectorFor(element),
    rect: { x: rect.left + window.scrollX, y: rect.top + window.scrollY, width: rect.width, height: rect.height },
    clientSize: sizeOf(element),
    scrollSize: scrollSizeOf(element),
    isScrollable: isScrollable(element),
    overflow: { x: style.overflowX, y: style.overflowY },
    tag: element.tagName.toLowerCase(),
    id: element.id || undefined,
    classes: Array.from(element.classList),
    frameId,
    depth: depthOf(element),
  };
}

function fixedInfo(element: HTMLElement, viewport: Size): FixedElementInfo | undefined {
  const style = getComputedStyle(element);
  if (style.position !== 'fixed' && style.position !== 'sticky') return undefined;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return undefined;
  const horizontalAnchor = rect.left <= 1 ? 'left' : rect.right >= viewport.width - 1 ? 'right' : undefined;
  const verticalAnchor = rect.top <= 1 ? 'top' : rect.bottom >= viewport.height - 1 ? 'bottom' : undefined;
  const anchor = verticalAnchor ?? horizontalAnchor ?? (rect.width >= viewport.width * 0.9 && rect.height >= viewport.height * 0.9 ? 'full' : 'other');
  const opacity = Number.parseFloat(style.opacity);
  return {
    ...elementInfo(element),
    position: style.position,
    anchor,
    coversViewportPct: Math.min(100, (rect.width * rect.height * 100) / Math.max(1, viewport.width * viewport.height)),
    zIndex: Number.parseInt(style.zIndex, 10) || 0,
    isTransparentOverlay: Number.isFinite(opacity) && opacity < 0.05,
  };
}

function targetInfo(options: ScanOptions): ElementInfo | undefined {
  if (options.targetSelector) {
    try {
      const target = document.querySelector<HTMLElement>(options.targetSelector);
      return target ? elementInfo(target) : undefined;
    } catch {
      return undefined;
    }
  }
  if (!options.rect) return undefined;
  const rect: Rect = options.rect;
  return {
    selector: '__selection__',
    rect,
    clientSize: { width: rect.width, height: rect.height },
    scrollSize: { width: rect.width, height: rect.height },
    isScrollable: false,
    overflow: { x: 'visible', y: 'visible' },
    tag: 'selection',
    classes: [],
    frameId: 0,
    depth: 0,
  };
}

function scanIframes(): IframeInfo[] {
  return Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe')).map((frame) => {
    const rect = frame.getBoundingClientRect();
    let sameOrigin = false;
    try {
      sameOrigin = new URL(frame.src || location.href, location.href).origin === location.origin;
    } catch {
      sameOrigin = false;
    }
    return {
      selector: selectorFor(frame),
      rect: { x: rect.left + window.scrollX, y: rect.top + window.scrollY, width: rect.width, height: rect.height },
      sameOrigin,
      src: frame.src,
    };
  });
}

export function scanPage(options: ScanOptions): PageMetrics {
  const root = document.scrollingElement ?? document.documentElement;
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const rootWidth = Math.max(root.scrollWidth, viewport.width);
  const rootHeight = Math.max(root.scrollHeight, viewport.height);
  const allElements = options.findScrollContainers || options.findFixedElements ? Array.from(document.querySelectorAll<HTMLElement>('*')) : [];
  const documentScrollers = new Set<Element>([root, document.documentElement, document.body].filter((element): element is Element => element !== null));
  const scrollContainers = options.findScrollContainers
    ? allElements.filter((element) => !documentScrollers.has(element) && isScrollable(element)).slice(0, 200).map((element) => elementInfo(element))
    : [];
  const fixedElements = options.findFixedElements
    ? allElements.map((element) => fixedInfo(element, viewport)).filter((element): element is FixedElementInfo => element !== undefined).slice(0, 100)
    : [];
  const target = targetInfo(options);
  const primaryScrollContainer = scrollContainers.find((container) => container.rect.width >= viewport.width * 0.8 && container.rect.height >= viewport.height * 0.8);
  const documentSize = { width: rootWidth, height: rootHeight };
  return {
    url: location.href,
    title: document.title,
    origin: location.origin,
    viewport,
    document: documentSize,
    scroll: { x: window.scrollX, y: window.scrollY },
    dpr: window.devicePixelRatio || 1,
    zoom: 1,
    hasHorizontalOverflow: rootWidth > viewport.width + 1,
    scrollingElement: primaryScrollContainer ? 'custom' : 'document',
    primaryScrollContainer,
    scrollContainers,
    fixedElements,
    iframes: options.findIframes ? scanIframes() : [],
    target,
    lazyImages: Array.from(document.querySelectorAll<HTMLImageElement>('img')).filter((image) => !image.complete || image.loading === 'lazy').length,
    direction: getComputedStyle(document.documentElement).direction === 'rtl' || document.documentElement.dir.toLowerCase() === 'rtl' ? 'rtl' : 'ltr',
    isRestricted: false,
    userAgent: navigator.userAgent,
    colorScheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  };
}
