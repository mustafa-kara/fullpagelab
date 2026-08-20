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

function currentDocumentSize(root: HTMLElement | undefined): Size {
  if (root) return { width: root.scrollWidth, height: root.scrollHeight };
  const scrolling = document.scrollingElement ?? document.documentElement;
  return { width: scrolling.scrollWidth, height: scrolling.scrollHeight };
}

export async function scrollPage(command: ScrollCommand, rootName: 'document' | string = 'document'): Promise<{ actual: Point; documentNow: Size; elapsedMs: number }> {
  const startedAt = performance.now();
  const root = getRoot(rootName);
  const requested = { x: Math.max(0, command.x), y: Math.max(0, command.y) };
  if (root) root.scrollTo({ left: requested.x, top: requested.y, behavior: 'auto' });
  else window.scrollTo({ left: requested.x, top: requested.y, behavior: 'auto' });

  const read = (): Point => root ? { x: root.scrollLeft, y: root.scrollTop } : { x: window.scrollX, y: window.scrollY };
  await waitForStablePosition(read, command.settleMs);
  return { actual: read(), documentNow: currentDocumentSize(root), elapsedMs: Math.round(performance.now() - startedAt) };
}
