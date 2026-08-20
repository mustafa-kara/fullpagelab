import { axisStarts, clamp, positive } from '../../lib/geometry/axis';
import type { CaptureMode, CaptureOptions, ElementInfo, PageMetrics, ScrollPlan, ScrollStep } from '../../shared/types/capture';
import type { Point, Rect, Size } from '../../shared/types/primitives';

const MAX_HORIZONTAL_COLUMNS = 5;

export interface CapturePlanInput {
  metrics: PageMetrics;
  options: CaptureOptions;
  mode?: CaptureMode;
  target?: ElementInfo;
  rect?: Rect;
}

export interface VerticalPlanInput {
  viewport: Size;
  document: Size;
  scroll: Point;
  dpr: number;
}

export interface NestedPlanInput {
  metrics: PageMetrics;
  options: CaptureOptions;
  outer: ElementInfo;
  inner: ElementInfo;
}

export interface NestedScrollStep extends ScrollStep {
  outerScrollTo: Point;
  innerScrollTo: Point;
}

export interface NestedScrollPlan extends Omit<ScrollPlan, 'steps'> {
  root: 'nested';
  steps: NestedScrollStep[];
}

interface PlanGeometry {
  root: ScrollPlan['root'];
  viewport: Size;
  sourceContent: Size;
  outputContent: Size;
  origin: Point;
  scrollBounds: Size;
  dpr: number;
  zoom: number;
  direction: PageMetrics['direction'];
  horizontal: boolean;
  stickyInsets: { top: number; bottom: number; left: number; right: number };
  options: CaptureOptions;
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function sizeOrFallback(value: Size | undefined, fallback: Size): Size {
  return {
    width: positive(value?.width ?? fallback.width, fallback.width),
    height: positive(value?.height ?? fallback.height, fallback.height),
  };
}

function resolveDpr(metrics: PageMetrics, options: CaptureOptions): number {
  const deviceDpr = positive(metrics.dpr, 1);
  const requested = options.dprMode === 'device' ? deviceDpr : options.dprMode === 'css' ? 1 : positive(options.dprMode, 1);
  const zoom = options.zoomHandling === 'keep' ? positive(metrics.zoom, 1) : 1;
  return positive(requested * zoom, 1);
}

function stickyInsets(metrics: PageMetrics, options: CaptureOptions): PlanGeometry['stickyInsets'] {
  if (options.hideFixedElements !== 'never') return { top: 0, bottom: 0, left: 0, right: 0 };

  const top = metrics.fixedElements
    .filter((element) => element.anchor === 'top')
    .reduce((total, element) => total + Math.max(0, element.rect.height), 0);
  const bottom = metrics.fixedElements
    .filter((element) => element.anchor === 'bottom')
    .reduce((total, element) => total + Math.max(0, element.rect.height), 0);
  const available = Math.max(0, metrics.viewport.height - top);
  return { top, bottom: Math.min(bottom, available), left: 0, right: 0 };
}

function targetGeometry(input: CapturePlanInput): Omit<PlanGeometry, 'options' | 'dpr' | 'zoom' | 'stickyInsets'> {
  const { metrics, mode = 'fullPage', target, rect } = input;
  const rootInfo = metrics.scrollingElement === 'custom' ? metrics.primaryScrollContainer : undefined;
  const root: ScrollPlan['root'] = rootInfo?.selector ?? 'document';
  const rootViewport = sizeOrFallback(rootInfo?.clientSize, metrics.viewport);
  const rootContent = sizeOrFallback(rootInfo?.scrollSize, metrics.document);

  if (mode === 'selection') {
    if (!rect) throw new Error('Selection geometry is required to build a capture plan.');
    return {
      root: 'document',
      viewport: metrics.viewport,
      sourceContent: sizeOrFallback(undefined, rect),
      outputContent: sizeOrFallback(undefined, rect),
      origin: { x: rect.x, y: rect.y },
      scrollBounds: metrics.document,
      direction: metrics.direction,
      horizontal: rect.width > metrics.viewport.width,
    };
  }

  if (mode === 'element' || mode === 'selector' || mode === 'scrollContainer') {
    if (!target) throw new Error('Capture target is required to build an element plan.');
    const scrollable = mode === 'scrollContainer' || target.isScrollable;
    if (scrollable) {
      const viewport = sizeOrFallback(target.clientSize, metrics.viewport);
      const content = sizeOrFallback(target.scrollSize, viewport);
      return {
        root: target.selector,
        viewport,
        sourceContent: content,
        outputContent: content,
        origin: { x: target.rect.x, y: target.rect.y },
        scrollBounds: content,
        direction: metrics.direction,
        horizontal: content.width > viewport.width,
      };
    }

    const content = { width: positive(target.rect.width), height: positive(target.rect.height) };
    return {
      root,
      viewport: metrics.viewport,
      sourceContent: content,
      outputContent: content,
      origin: { x: target.rect.x, y: target.rect.y },
      scrollBounds: rootContent,
      direction: metrics.direction,
      horizontal: content.width > metrics.viewport.width,
    };
  }

  return {
    root,
    viewport: rootViewport,
    sourceContent: rootContent,
    outputContent: rootContent,
    origin: { x: 0, y: 0 },
    scrollBounds: rootContent,
    direction: metrics.direction,
    horizontal: rootContent.width > rootViewport.width,
  };
}

function limitContent(geometry: PlanGeometry): { content: Size; cols: number; rows: number; warnings: string[]; tileHeight: number } {
  const warnings: string[] = [];
  const tileWidth = positive(geometry.viewport.width);
  const tileHeight = Math.max(1, geometry.viewport.height - geometry.stickyInsets.top - geometry.stickyInsets.bottom);
  const maxHeight = positive(geometry.options.limits.maxCaptureHeightCss, geometry.sourceContent.height);
  const maxTiles = Math.max(1, Math.floor(positive(geometry.options.limits.maxTiles, 1)));
  const horizontalAllowed = geometry.horizontal && geometry.options.captureHorizontalOverflow;

  let width = Math.min(positive(geometry.outputContent.width), horizontalAllowed ? positive(geometry.outputContent.width) : tileWidth);
  if (!horizontalAllowed && geometry.outputContent.width > tileWidth) warnings.push('horizontal-overflow-truncated');

  let cols = Math.max(1, Math.ceil(width / tileWidth));
  if (cols > MAX_HORIZONTAL_COLUMNS) {
    cols = MAX_HORIZONTAL_COLUMNS;
    width = Math.min(width, cols * tileWidth);
    warnings.push('horizontal-overflow-truncated');
  }

  let height = Math.min(positive(geometry.outputContent.height), maxHeight);
  if (geometry.outputContent.height > height) warnings.push('capture-height-truncated');

  const maxOutputPixels = positive(geometry.options.limits.maxOutputPixels, Number.POSITIVE_INFINITY);
  const scaledPixels = geometry.dpr * geometry.dpr;
  if (width * height * scaledPixels > maxOutputPixels) {
    const heightByPixels = maxOutputPixels / Math.max(1, width * scaledPixels);
    if (heightByPixels >= 1) height = Math.min(height, heightByPixels);
    else {
      height = 1;
      width = Math.max(1, maxOutputPixels / Math.max(1, scaledPixels));
    }
    warnings.push('output-pixels-truncated');
  }
  cols = Math.max(1, Math.min(cols, Math.ceil(width / tileWidth)));

  let rows = Math.max(1, Math.ceil(height / tileHeight));
  if (rows * cols > maxTiles) {
    const allowedCols = Math.min(cols, maxTiles);
    if (allowedCols < cols) {
      cols = allowedCols;
      width = Math.min(width, cols * tileWidth);
    }
    const allowedRows = Math.max(1, Math.floor(maxTiles / cols));
    if (allowedRows < rows) {
      rows = allowedRows;
      height = Math.min(height, rows * tileHeight);
    }
    warnings.push('max-tiles-truncated');
  }

  return { content: { width, height }, cols, rows, warnings, tileHeight };
}

function desiredScroll(geometry: PlanGeometry, xStart: number, yStart: number): Point {
  const localRoot = geometry.root !== 'document';
  const maxX = Math.max(0, geometry.scrollBounds.width - geometry.viewport.width);
  const x = geometry.horizontal && geometry.direction === 'rtl' ? Math.max(0, maxX - xStart) : xStart;
  return {
    x: localRoot ? x : geometry.origin.x + x,
    y: localRoot ? yStart : geometry.origin.y + yStart,
  };
}

function cropFromActual(geometry: PlanGeometry, plan: Pick<ScrollPlan, 'content' | 'viewport' | 'dpr' | 'stickyInsets'>, step: ScrollStep, actual: Point): Rect {
  const deltaX = step.scrollTo.x - actual.x;
  const deltaY = step.scrollTo.y - actual.y;
  const cropXCss = clamp(geometry.stickyInsets.left + deltaX, 0, plan.viewport.width - 1);
  const cropYCss = clamp(geometry.stickyInsets.top + deltaY, 0, plan.viewport.height - 1);
  const placeXCss = step.placeAt.x / plan.dpr;
  const placeYCss = step.placeAt.y / plan.dpr;
  const remainingWidth = Math.max(1, plan.content.width - placeXCss);
  const remainingHeight = Math.max(1, plan.content.height - placeYCss);
  const widthCss = Math.max(1, Math.min(plan.viewport.width - cropXCss, remainingWidth));
  const heightCss = Math.max(1, Math.min(plan.viewport.height - cropYCss - geometry.stickyInsets.bottom, remainingHeight));
  return {
    x: Math.round(cropXCss * plan.dpr),
    y: Math.round(cropYCss * plan.dpr),
    width: Math.max(1, Math.round(widthCss * plan.dpr)),
    height: Math.max(1, Math.round(heightCss * plan.dpr)),
  };
}

function buildPlan(geometry: PlanGeometry): ScrollPlan {
  const limited = limitContent(geometry);
  const xStarts = axisStarts(limited.content.width, geometry.viewport.width, limited.cols);
  const yStarts = axisStarts(limited.content.height, limited.tileHeight, limited.rows);
  const maxScrollX = Math.max(0, geometry.scrollBounds.width - geometry.viewport.width);
  const maxScrollY = Math.max(0, geometry.scrollBounds.height - geometry.viewport.height);
  const partial: ScrollPlan = {
    root: geometry.root,
    viewport: geometry.viewport,
    content: limited.content,
    origin: geometry.origin,
    steps: [],
    cols: xStarts.length,
    rows: yStarts.length,
    overlapCss: 0,
    dpr: geometry.dpr,
    zoom: geometry.zoom,
    warnings: limited.warnings,
    stickyInsets: geometry.stickyInsets,
    scrollBounds: geometry.scrollBounds,
  };

  for (const [row, yStart] of yStarts.entries()) {
    for (const [col, xStart] of xStarts.entries()) {
      const scrollTo = desiredScroll(geometry, xStart, yStart);
      const step: ScrollStep = {
        index: partial.steps.length,
        row,
        col,
        scrollTo,
        placeAt: { x: Math.round(xStart * geometry.dpr), y: Math.round(yStart * geometry.dpr) },
        cropFromViewport: { x: 0, y: 0, width: 1, height: 1 },
      };
      const predictedActual = {
        x: clamp(scrollTo.x, geometry.root === 'document' ? geometry.origin.x : 0, geometry.root === 'document' ? geometry.origin.x + maxScrollX : maxScrollX),
        y: clamp(scrollTo.y, geometry.root === 'document' ? geometry.origin.y : 0, geometry.root === 'document' ? geometry.origin.y + maxScrollY : maxScrollY),
      };
      step.cropFromViewport = cropFromActual(geometry, partial, step, predictedActual);
      partial.steps.push(step);
    }
  }
  return partial;
}

function planGeometry(input: CapturePlanInput): PlanGeometry {
  const target = targetGeometry(input);
  const insets = stickyInsets(input.metrics, input.options);
  const dpr = resolveDpr(input.metrics, input.options);
  return { ...target, dpr, zoom: positive(input.metrics.zoom, 1), stickyInsets: insets, options: input.options };
}

export function createCapturePlan(input: CapturePlanInput): ScrollPlan {
  return buildPlan(planGeometry(input));
}

/**
 * Adds only the newly exposed tail of a document whose height grew after a
 * lazy-loaded section was reached. Existing tile placements remain stable so
 * previously captured pixels are never shifted or duplicated.
 */
export function extendCapturePlan(plan: ScrollPlan, document: Size, limits?: CaptureOptions['limits']): ScrollPlan {
  const currentHeight = positive(plan.content.height);
  const maxHeight = positive(limits?.maxCaptureHeightCss ?? document.height, document.height);
  const requestedHeight = Math.min(Math.max(currentHeight, positive(document.height)), maxHeight);
  if (requestedHeight <= currentHeight + 1) {
    return { ...plan, scrollBounds: { width: Math.max(plan.scrollBounds?.width ?? plan.content.width, document.width), height: Math.max(plan.scrollBounds?.height ?? currentHeight, document.height) } };
  }

  const stickyInsets = plan.stickyInsets ?? { top: 0, bottom: 0, left: 0, right: 0 };
  const tileHeight = Math.max(1, plan.viewport.height - stickyInsets.top - stickyInsets.bottom);
  const columnTemplates = plan.steps
    .filter((step) => step.row === 0)
    .sort((left, right) => left.col - right.col);
  const columns = columnTemplates.length > 0 ? columnTemplates : Array.from({ length: Math.max(1, plan.cols) }, (_, col) => ({
    index: col,
    row: 0,
    col,
    scrollTo: { x: plan.root === 'document' ? plan.origin.x + col * plan.viewport.width : col * plan.viewport.width, y: plan.root === 'document' ? plan.origin.y : 0 },
    placeAt: { x: col * plan.viewport.width * plan.dpr, y: 0 },
    cropFromViewport: { x: 0, y: 0, width: plan.viewport.width * plan.dpr, height: plan.viewport.height * plan.dpr },
  }));
  const maxRows = limits ? Math.max(plan.rows, Math.floor(Math.max(1, limits.maxTiles) / Math.max(1, columns.length))) : Number.POSITIVE_INFINITY;
  const additions: ScrollStep[] = [];
  let placeY = currentHeight;
  let rowOffset = 0;
  while (placeY < requestedHeight - 1 && plan.rows + rowOffset < maxRows) {
    for (const template of columns) {
      additions.push({
        index: plan.steps.length + additions.length,
        row: plan.rows + rowOffset,
        col: template.col,
        scrollTo: {
          x: template.scrollTo.x,
          y: plan.root === 'document' ? plan.origin.y + placeY : placeY,
        },
        placeAt: { x: template.placeAt.x, y: Math.round(placeY * plan.dpr) },
        cropFromViewport: { x: 0, y: 0, width: 1, height: 1 },
      });
    }
    placeY += tileHeight;
    rowOffset += 1;
  }
  if (additions.length === 0) return plan;

  const contentHeight = Math.min(requestedHeight, currentHeight + rowOffset * tileHeight);
  const warnings = [...plan.warnings];
  if (contentHeight < requestedHeight && !warnings.includes('max-tiles-truncated')) warnings.push('max-tiles-truncated');
  return {
    ...plan,
    content: { ...plan.content, height: contentHeight },
    steps: [...plan.steps, ...additions],
    rows: plan.rows + rowOffset,
    warnings,
    scrollBounds: { width: Math.max(plan.scrollBounds?.width ?? plan.content.width, document.width), height: Math.max(plan.scrollBounds?.height ?? currentHeight, document.height) },
  };
}

export function recomputeStepFromAck(plan: ScrollPlan, step: ScrollStep, actual: Point): ScrollStep {
  const geometry: PlanGeometry = {
    root: plan.root,
    viewport: plan.viewport,
    sourceContent: plan.scrollBounds ?? plan.content,
    outputContent: plan.content,
    origin: plan.origin,
    scrollBounds: plan.scrollBounds ?? plan.content,
    dpr: plan.dpr,
    zoom: plan.zoom,
    direction: 'ltr',
    horizontal: plan.cols > 1,
    stickyInsets: plan.stickyInsets ?? { top: 0, bottom: 0, left: 0, right: 0 },
    options: {} as CaptureOptions,
  };
  return { ...step, cropFromViewport: cropFromActual(geometry, plan, step, actual) };
}

export function createNestedPlan(input: NestedPlanInput): NestedScrollPlan {
  const innerPlan = createCapturePlan({ metrics: input.metrics, options: input.options, mode: 'scrollContainer', target: input.inner });
  const outerHeight = Math.max(input.outer.rect.height, input.outer.scrollSize.height, input.metrics.viewport.height);
  const outerMaxY = Math.max(0, outerHeight - input.metrics.viewport.height);
  const innerOffsetY = Math.max(0, input.inner.rect.y - input.outer.rect.y);
  const steps = innerPlan.steps.map((step) => {
    const innerStartY = step.placeAt.y / innerPlan.dpr;
    const outerY = clamp(innerOffsetY + innerStartY, 0, outerMaxY);
    return {
      ...step,
      outerScrollTo: { x: 0, y: outerY },
      innerScrollTo: step.scrollTo,
    };
  });
  return { ...innerPlan, root: 'nested', steps };
}

/**
 * Compatibility helper for the initial coordinator tests. New capture paths
 * should use createCapturePlan so the requested position and acknowledged
 * position remain separate.
 */
export function createVerticalPlan(input: VerticalPlanInput): ScrollPlan {
  const viewport = { width: positive(input.viewport.width), height: positive(input.viewport.height) };
  const content = { width: Math.max(viewport.width, positive(input.document.width)), height: positive(input.document.height) };
  const positions = axisStarts(content.height, viewport.height);
  const steps: ScrollStep[] = positions.map((placeY, index) => {
    const desiredY = input.scroll.y + placeY;
    const actualY = Math.min(desiredY, input.scroll.y + Math.max(0, content.height - viewport.height));
    const cropY = Math.max(0, desiredY - actualY);
    const cropHeight = Math.max(1, Math.min(viewport.height - cropY, content.height - placeY));
    return {
      index,
      row: index,
      col: 0,
      scrollTo: { x: input.scroll.x, y: actualY },
      placeAt: { x: 0, y: placeY * input.dpr },
      cropFromViewport: { x: 0, y: cropY * input.dpr, width: viewport.width * input.dpr, height: cropHeight * input.dpr },
    };
  });
  return {
    root: 'document',
    viewport,
    content,
    origin: input.scroll,
    steps,
    cols: 1,
    rows: steps.length,
    overlapCss: 0,
    dpr: positive(input.dpr),
    zoom: 1,
    warnings: [],
  };
}
