import type { ScrollCommand } from '../shared/types/capture';
import type { Point, Size } from '../shared/types/primitives';

function getRoot(root: 'document' | string): HTMLElement | undefined {
  if (root === 'document') return undefined;
  try {
    return document.querySelector<HTMLElement>(root) ?? undefined;
  } catch {
    return undefined;
  }
}

function frame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function waitForStablePosition(read: () => Point, settleMs: number): Promise<void> {
  const deadline = performance.now() + Math.max(0, settleMs);
  let previous = read();
  do {
    await frame();
    const current = read();
    if (current.x === previous.x && current.y === previous.y && performance.now() >= deadline) return;
    previous = current;
  } while (performance.now() < deadline + 250);
}

function boundedTarget(root: HTMLElement | undefined, requested: Point): Point {
  const scrolling = root ?? document.scrollingElement ?? document.documentElement;
  const clientWidth = root ? root.clientWidth : window.innerWidth;
  const clientHeight = root ? root.clientHeight : window.innerHeight;
  return {
    x: Math.min(requested.x, Math.max(0, scrolling.scrollWidth - clientWidth)),
    y: Math.min(requested.y, Math.max(0, scrolling.scrollHeight - clientHeight)),
  };
}

function currentDocumentSize(root: HTMLElement | undefined): Size {
  if (root) return { width: root.scrollWidth, height: root.scrollHeight };
  const scrolling = document.scrollingElement ?? document.documentElement;
  return { width: scrolling.scrollWidth, height: scrolling.scrollHeight };
}

export async function scrollPage(command: ScrollCommand, rootName: 'document' | string = 'document'): Promise<{ actual: Point; documentNow: Size; elapsedMs: number }> {
  const startedAt = performance.now();
  const root = getRoot(rootName);
  const requested = { x: Math.max(0, command.x), y: Math.max(0, command.y) };
  const read = (): Point => root ? { x: root.scrollLeft, y: root.scrollTop } : { x: window.scrollX, y: window.scrollY };
  const target = boundedTarget(root, requested);
  let actual = read();

  // Some pages intercept the first scroll (scroll-snap, lazy layout work, or a
  // framework effect). Never accept that stale position for a tile: retry a
  // few times so the first frame cannot silently start below the page top.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (root) root.scrollTo({ left: target.x, top: target.y, behavior: 'auto' });
    else window.scrollTo({ left: target.x, top: target.y, behavior: 'auto' });
    await waitForStablePosition(read, command.settleMs);
    actual = read();
    if (Math.abs(actual.x - target.x) <= 1 && Math.abs(actual.y - target.y) <= 1) break;
  }

  return { actual, documentNow: currentDocumentSize(root), elapsedMs: Math.round(performance.now() - startedAt) };
}
