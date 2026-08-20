import { describe, expect, it } from 'vitest';
import { createCapturePlan, createNestedPlan, extendCapturePlan, recomputeStepFromAck } from '../../src/background/capture/plan';
import { defaultSettings } from '../../src/shared/defaults';
import type { ElementInfo, PageMetrics } from '../../src/shared/types/capture';
import type { Point, Size } from '../../src/shared/types/primitives';

function metrics(overrides: Partial<PageMetrics> = {}): PageMetrics {
  return {
    url: 'https://example.com',
    title: 'Example',
    origin: 'https://example.com',
    viewport: { width: 800, height: 600 },
    document: { width: 800, height: 1_350 },
    scroll: { x: 0, y: 0 },
    dpr: 1,
    zoom: 1,
    hasHorizontalOverflow: false,
    scrollingElement: 'document',
    scrollContainers: [],
    fixedElements: [],
    iframes: [],
    lazyImages: 0,
    direction: 'ltr',
    isRestricted: false,
    userAgent: 'Vitest',
    colorScheme: 'light',
    ...overrides,
  };
}

function options() {
  return structuredClone(defaultSettings.capture);
}

function element(overrides: Partial<ElementInfo> = {}): ElementInfo {
  return {
    selector: '#target',
    rect: { x: 80, y: 120, width: 800, height: 600 },
    clientSize: { width: 800, height: 600 },
    scrollSize: { width: 800, height: 1_800 },
    isScrollable: true,
    overflow: { x: 'hidden', y: 'auto' },
    tag: 'div',
    classes: [],
    frameId: 0,
    depth: 1,
    ...overrides,
  };
}

function assertGapFree(plan: { steps: Array<{ row: number; col: number; placeAt: Point; cropFromViewport: { width: number; height: number } }>; content: Size; dpr: number }): void {
  const rows = new Map<number, Array<{ start: number; end: number }>>();
  const columns = new Map<number, Array<{ start: number; end: number }>>();
  for (const step of plan.steps) {
    const row = rows.get(step.row) ?? [];
    row.push({ start: step.placeAt.x / plan.dpr, end: (step.placeAt.x + step.cropFromViewport.width) / plan.dpr });
    rows.set(step.row, row);
    const column = columns.get(step.col) ?? [];
    column.push({ start: step.placeAt.y / plan.dpr, end: (step.placeAt.y + step.cropFromViewport.height) / plan.dpr });
    columns.set(step.col, column);
  }

  for (const intervals of rows.values()) {
    intervals.sort((left, right) => left.start - right.start);
    expect(intervals[0]?.start).toBe(0);
    for (let index = 1; index < intervals.length; index += 1) expect(intervals[index]?.start).toBeCloseTo(intervals[index - 1]?.end ?? 0, 6);
    expect(intervals.at(-1)?.end).toBeCloseTo(plan.content.width, 6);
  }
  for (const intervals of columns.values()) {
    intervals.sort((left, right) => left.start - right.start);
    expect(intervals[0]?.start).toBe(0);
    for (let index = 1; index < intervals.length; index += 1) expect(intervals[index]?.start).toBeCloseTo(intervals[index - 1]?.end ?? 0, 6);
    expect(intervals.at(-1)?.end).toBeCloseTo(plan.content.height, 6);
  }
}

describe('capture geometry plans', () => {
  it('builds a full-page plan with an acknowledged final crop', () => {
    const plan = createCapturePlan({ metrics: metrics(), options: options(), mode: 'fullPage' });

    expect(plan.steps.map((step) => step.scrollTo.y)).toEqual([0, 600, 1_200]);
    expect(plan.steps.at(-1)?.cropFromViewport).toEqual({ x: 0, y: 450, width: 800, height: 150 });
    expect(plan.steps.at(-1)?.placeAt).toEqual({ x: 0, y: 1_200 });
    expect(plan.content).toEqual({ width: 800, height: 1_350 });
    assertGapFree(plan);
  });

  it('supports horizontal overflow in row-major order and clamps the final scroll acknowledgement', () => {
    const plan = createCapturePlan({
      metrics: metrics({ document: { width: 2_100, height: 1_200 }, hasHorizontalOverflow: true }),
      options: options(),
      mode: 'fullPage',
    });

    expect({ cols: plan.cols, rows: plan.rows, steps: plan.steps.length }).toEqual({ cols: 3, rows: 2, steps: 6 });
    expect(plan.steps.slice(0, 3).map((step) => step.scrollTo.x)).toEqual([0, 800, 1_600]);
    expect(plan.steps.slice(0, 3).map((step) => step.placeAt.x)).toEqual([0, 800, 1_600]);
    expect(plan.steps[2]?.cropFromViewport.width).toBe(500);
    assertGapFree(plan);
  });

  it('walks RTL overflow from the right edge while placing output left-to-right', () => {
    const plan = createCapturePlan({
      metrics: metrics({ document: { width: 2_100, height: 600 }, hasHorizontalOverflow: true, direction: 'rtl' }),
      options: options(),
      mode: 'fullPage',
    });

    expect(plan.steps.map((step) => step.scrollTo.x)).toEqual([1_300, 500, 0]);
    expect(plan.steps.map((step) => step.placeAt.x)).toEqual([0, 800, 1_600]);
    assertGapFree(plan);
  });

  it('uses device scale and retained zoom in crop and placement calculations', () => {
    const captureOptions = options();
    captureOptions.zoomHandling = 'keep';
    const plan = createCapturePlan({ metrics: metrics({ dpr: 1.25, zoom: 1.5 }), options: captureOptions, mode: 'fullPage' });

    expect(plan.dpr).toBeCloseTo(1.875, 8);
    expect(plan.steps[0]?.placeAt).toEqual({ x: 0, y: 0 });
    expect(plan.steps[0]?.cropFromViewport.width).toBe(1_500);
    expect(plan.steps.at(-1)?.cropFromViewport.height).toBe(281);
  });

  it('accounts for visible sticky insets when fixed elements are not hidden', () => {
    const captureOptions = options();
    captureOptions.hideFixedElements = 'never';
    const plan = createCapturePlan({
      metrics: metrics({
        document: { width: 800, height: 1_200 },
        fixedElements: [
          { ...element({ selector: '#header', rect: { x: 0, y: 0, width: 800, height: 40 }, isScrollable: false }), anchor: 'top', position: 'fixed', coversViewportPct: 6, zIndex: 1, isTransparentOverlay: false },
          { ...element({ selector: '#footer', rect: { x: 0, y: 560, width: 800, height: 40 }, isScrollable: false }), anchor: 'bottom', position: 'fixed', coversViewportPct: 6, zIndex: 1, isTransparentOverlay: false },
        ],
      }),
      options: captureOptions,
      mode: 'fullPage',
    });

    expect(plan.stickyInsets).toEqual({ top: 40, bottom: 40, left: 0, right: 0 });
    expect(plan.steps[0]?.cropFromViewport).toEqual({ x: 0, y: 40, width: 800, height: 520 });
    expect(plan.steps.length).toBe(3);
  });

  it('truncates height when the tile budget is reached and exposes warnings', () => {
    const captureOptions = options();
    captureOptions.limits.maxTiles = 3;
    const plan = createCapturePlan({ metrics: metrics({ document: { width: 2_100, height: 2_000 } }), options: captureOptions, mode: 'fullPage' });

    expect(plan.steps.length).toBeLessThanOrEqual(3);
    expect(plan.warnings).toContain('max-tiles-truncated');
    expect(plan.content.height).toBe(600);
  });

  it('applies the output pixel budget after DPR scaling', () => {
    const captureOptions = options();
    captureOptions.limits.maxOutputPixels = 800 * 600;
    const plan = createCapturePlan({ metrics: metrics(), options: captureOptions, mode: 'fullPage' });

    expect(plan.content).toEqual({ width: 800, height: 600 });
    expect(plan.warnings).toContain('output-pixels-truncated');
  });

  it('builds selection and scroll-container plans from target geometry', () => {
    const selection = createCapturePlan({ metrics: metrics(), options: options(), mode: 'selection', rect: { x: 120, y: 240, width: 320, height: 180 } });
    expect(selection.root).toBe('document');
    expect(selection.origin).toEqual({ x: 120, y: 240 });
    expect(selection.steps).toHaveLength(1);
    expect(selection.steps[0]?.scrollTo).toEqual({ x: 120, y: 240 });
    expect(selection.steps[0]?.cropFromViewport).toEqual({ x: 0, y: 0, width: 320, height: 180 });

    const container = createCapturePlan({ metrics: metrics(), options: options(), mode: 'scrollContainer', target: element() });
    expect(container.root).toBe('#target');
    expect(container.content).toEqual({ width: 800, height: 1_800 });
    expect(container.steps.map((step) => step.scrollTo.y)).toEqual([0, 600, 1_200]);
  });

  it('adds outer scroll commands for nested containers without duplicating inner output', () => {
    const plan = createNestedPlan({
      metrics: metrics(),
      options: options(),
      outer: element({ selector: '#outer', rect: { x: 0, y: 0, width: 800, height: 600 }, scrollSize: { width: 800, height: 1_200 } }),
      inner: element({ selector: '#inner', rect: { x: 20, y: 80, width: 700, height: 400 }, clientSize: { width: 700, height: 400 }, scrollSize: { width: 700, height: 1_000 } }),
    });

    expect(plan.root).toBe('nested');
    expect(plan.steps).toHaveLength(3);
    expect(plan.steps[0]?.innerScrollTo).toEqual({ x: 0, y: 0 });
    expect(plan.steps[0]?.outerScrollTo).toEqual({ x: 0, y: 80 });
    expect(plan.content).toEqual({ width: 700, height: 1_000 });
  });

  it('recomputes crop geometry from a real scroll acknowledgement', () => {
    const plan = createCapturePlan({ metrics: metrics(), options: options(), mode: 'fullPage' });
    const step = plan.steps[2];
    if (!step) throw new Error('Expected a final plan step.');

    const acknowledged = recomputeStepFromAck(plan, step, { x: 0, y: 750 });
    expect(acknowledged.cropFromViewport).toEqual({ x: 0, y: 450, width: 800, height: 150 });
  });

  it('extends only the newly loaded tail without moving captured tiles', () => {
    const original = createCapturePlan({ metrics: metrics(), options: options(), mode: 'fullPage' });
    const extended = extendCapturePlan(original, { width: 800, height: 1_800 }, options().limits);

    expect(extended.content).toEqual({ width: 800, height: 1_800 });
    expect(extended.steps).toHaveLength(original.steps.length + 1);
    expect(extended.steps.slice(0, original.steps.length).map((step) => step.placeAt.y)).toEqual(original.steps.map((step) => step.placeAt.y));
    expect(extended.steps.at(-1)?.placeAt).toEqual({ x: 0, y: 1_350 });
    expect(extended.steps.at(-1)?.scrollTo).toEqual({ x: 0, y: 1_350 });

    const tail = extended.steps.at(-1);
    if (!tail) throw new Error('Expected an extension step.');
    expect(recomputeStepFromAck(extended, tail, { x: 0, y: 1_200 }).cropFromViewport).toEqual({ x: 0, y: 150, width: 800, height: 450 });
  });
});
