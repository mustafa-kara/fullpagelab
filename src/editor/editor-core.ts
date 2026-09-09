import { Canvas, Ellipse, FabricImage, filters, Group, IText, Line, PencilBrush, Rect as FabricRect, Triangle, type FabricObject, type Path } from 'fabric';
import { createAnnotation, defaultStyleFor } from '../lib/editor/annotation';
import { angleDegrees, arrowHeadGeometry } from '../lib/editor/arrow';
import { CommandStack } from '../lib/editor/command-stack';
import { addLayer, nextMarkerNumber, removeLayer } from '../lib/editor/document';
import { constrainRect, normalizeRect } from '../lib/editor/geometry';
import { CANVAS_MAX_AREA, CANVAS_MAX_SIDE, clampZoom, fitCanvasToLimits, fitZoomToViewport } from '../lib/editor/viewport';
import type { Annotation, AnnotationType, EditorDocument, ToolId } from '../shared/types/editor';
import { toFabricOptions } from './fabric-bridge';

export interface EditorHandle {
  setTool(tool: ToolId): void;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  getDocument(): EditorDocument;
  setZoom(zoom: number): void;
  getZoom(): number;
  fitZoom(): number;
  imageSize(): { width: number; height: number };
  /** Flattens at full image resolution, ignoring the on-screen zoom. */
  toDataUrl(): string;
  dispose(): void;
}

export interface EditorDeps {
  onChange?(doc: EditorDocument): void;
  /** Visible stage size, so the editor can open showing the whole capture. */
  viewport?: { width: number; height: number };
  /**
   * Ready-to-load URL for the base image. The result page already resolves this
   * for both stores, and captures kept out of history live in the session store,
   * which `resolveBlob` refuses — so the caller must pass its URL through.
   */
  imageUrl?: string;
}

const drawableTools = new Set<AnnotationType>(['rect', 'ellipse', 'line', 'arrow', 'highlight', 'blur', 'pixelate', 'redact', 'text', 'freehand', 'marker']);

export async function createEditorCore(canvasElement: HTMLCanvasElement, initial: EditorDocument, deps: EditorDeps = {}): Promise<EditorHandle> {
  const canvas = new Canvas(canvasElement, { selection: true, preserveObjectStacking: true, renderOnAddRemove: false });
  const stack = new CommandStack();
  let doc = initial;
  let tool: ToolId = 'select';
  let origin: { x: number; y: number } | null = null;

  // Only a URL this function created may be revoked; a caller-supplied one is theirs.
  const ownedUrl = deps.imageUrl ? undefined : await blobUrlFor(initial);
  const sourceUrl = deps.imageUrl ?? ownedUrl;
  if (!sourceUrl) {
    canvas.dispose().catch(() => undefined);
    throw new Error('The editor was opened without a base image to load.');
  }

  let baseImage: FabricImage;
  try {
    baseImage = await FabricImage.fromURL(sourceUrl);
  } catch (cause: unknown) {
    // Fabric resolves `fromURL` through an <img>, which reports decode and size
    // failures as a bare event. Without this the editor opened onto a blank
    // canvas that still looked ready, so the user saw no image and no error.
    canvas.dispose().catch(() => undefined);
    if (ownedUrl) URL.revokeObjectURL(ownedUrl);
    throw new Error(`The capture image could not be decoded for editing (${describe(cause)}).`);
  }
  baseImage.set({ selectable: false, evented: false, left: 0, top: 0 });

  // The image the browser decoded is the only trustworthy source of the base
  // size: `canvas.size` comes from capture metadata, which disagrees with the
  // file whenever the pipeline rounds or rescales. Sizing the canvas from
  // metadata while drawing an image of another size leaves the visible area
  // blank, so measure the bitmap and scale it onto the canvas explicitly.
  const natural = { width: baseImage.width || initial.canvas.size.width, height: baseImage.height || initial.canvas.size.height };

  // Fabric multiplies its backing store by the device pixel ratio for crisp
  // retina output, so the limit that matters is the CSS size times that ratio.
  const retina = canvas.getRetinaScaling() || 1;
  const fitted = fitCanvasToLimits(natural, { maxSide: CANVAS_MAX_SIDE / retina, maxArea: CANVAS_MAX_AREA / (retina * retina) });
  // Open showing the whole capture. Without this the editor started at natural
  // size, so a 1,920px-wide capture arrived cropped inside a narrower stage.
  const viewport = deps.viewport ?? { width: fitted.width, height: fitted.height };
  const initialZoom = Math.min(fitted.zoom, fitZoomToViewport(natural, viewport));
  applyZoom(initialZoom);

  function applyZoom(zoom: number): void {
    const next = clampZoom(zoom);
    canvas.setDimensions({ width: Math.max(1, Math.round(natural.width * next)), height: Math.max(1, Math.round(natural.height * next)) });
    canvas.setZoom(next);
    canvas.requestRenderAll();
  }
  // Scene coordinates stay in image pixels, so the background must cover the
  // untransformed image rather than the shrunken canvas.
  baseImage.scaleX = natural.width / (baseImage.width || natural.width);
  baseImage.scaleY = natural.height / (baseImage.height || natural.height);
  canvas.backgroundImage = baseImage;
  canvas.requestRenderAll();

  function emit(): void {
    deps.onChange?.(doc);
  }

  /**
   * Builds the pixel-effect tools out of a cropped copy of the base image.
   *
   * Blur and pixelate have to show the capture's own pixels, processed. Drawing
   * a plain rectangle — which is all these tools used to do — leaves an empty
   * outline and hides nothing.
   */
  function effectObject(annotation: Annotation & { type: 'blur' | 'pixelate' }): FabricObject {
    const options = toFabricOptions(annotation);
    const filter = annotation.type === 'blur'
      // Fabric's blur is a fraction of the image size, not a pixel radius.
      ? new filters.Blur({ blur: Math.min(1, annotation.radiusPx / 100) })
      : new filters.Pixelate({ blocksize: Math.max(2, Math.round(annotation.blockPx)) });
    // `applyFilters` ignores cropX/cropY and processes the whole source, so
    // cropping a shared element would filter the entire full-page capture for a
    // small region — slow, and it makes the blur strength depend on the capture
    // size, since Fabric scales blur by the source width. Copying the region out
    // first keeps both the cost and the strength tied to the region alone.
    const width = Math.max(1, Math.round(annotation.rect.width));
    const height = Math.max(1, Math.round(annotation.rect.height));
    const patch = document.createElement('canvas');
    patch.width = width;
    patch.height = height;
    const patchContext = patch.getContext('2d');
    if (!patchContext) throw new Error('Effect region canvas has no 2D context.');
    // Annotation rects are in scene coordinates, but the source bitmap may be a
    // different size, so the crop has to be converted into its pixel space or
    // the effect lands somewhere other than where the user dragged.
    const element = baseImage.getElement() as HTMLImageElement | HTMLCanvasElement;
    const sourceWidth = (element as HTMLImageElement).naturalWidth || element.width;
    const sourceHeight = (element as HTMLImageElement).naturalHeight || element.height;
    const scaleX = sourceWidth / natural.width;
    const scaleY = sourceHeight / natural.height;
    patchContext.drawImage(
      element,
      Math.round(annotation.rect.x * scaleX),
      Math.round(annotation.rect.y * scaleY),
      Math.max(1, Math.round(width * scaleX)),
      Math.max(1, Math.round(height * scaleY)),
      0, 0, width, height,
    );

    // `width`/`height` on a FabricImage describe its source bitmap, not the size
    // it is drawn at. The patch canvas is already exactly the region, so the
    // object must sit at scale 1 and carry only position from the options.
    const region = new FabricImage(patch, {
      left: annotation.rect.x,
      top: annotation.rect.y,
      angle: options.angle,
      opacity: options.opacity,
      selectable: options.selectable,
      evented: options.evented,
      visible: options.visible,
      objectCaching: false,
    });
    region.set({ ssxId: options.ssxId } as Partial<FabricObject>);
    region.filters = [filter];
    region.applyFilters();
    return region;
  }

  function arrowObject(annotation: Extract<Annotation, { type: 'arrow' | 'line' }>): FabricObject {
    const options = toFabricOptions(annotation);
    const size = annotation.style.arrowHeadSize ?? 12;
    const headSize = Math.max(size, annotation.style.strokeWidth * 3);
    const { shaftEnd } = arrowHeadGeometry(annotation.from, annotation.to, headSize);
    const shaft = new Line([annotation.from.x, annotation.from.y, shaftEnd.x, shaftEnd.y], {
      stroke: annotation.style.stroke,
      strokeWidth: annotation.style.strokeWidth,
      strokeLineCap: annotation.style.lineCap ?? 'round',
    });
    // A Polygon re-bases its points onto its own origin, so absolute coordinates
    // land in the wrong place; a Triangle rotated about its centre does not.
    // Its apex points at -Y, which is 90 degrees behind atan2's zero at +X.
    const head = new Triangle({
      left: annotation.to.x,
      top: annotation.to.y,
      width: headSize,
      height: headSize,
      fill: annotation.style.stroke,
      stroke: '',
      strokeWidth: 0,
      angle: angleDegrees(annotation.from, annotation.to) + 90,
      originX: 'center',
      originY: 'center',
    });
    // Grouping keeps the head welded to the shaft when the arrow is moved.
    const group = new Group([shaft, head], { opacity: options.opacity, selectable: options.selectable, evented: options.evented, visible: options.visible });
    group.set({ ssxId: options.ssxId } as Partial<FabricObject>);
    return group;
  }

  function fabricFor(annotation: Annotation): FabricObject {
    const options = toFabricOptions(annotation);
    if (annotation.type === 'ellipse') return new Ellipse({ ...options, rx: annotation.rect.width / 2, ry: annotation.rect.height / 2 });
    if (annotation.type === 'arrow') return arrowObject(annotation);
    if (annotation.type === 'line') return new Line([annotation.from.x, annotation.from.y, annotation.to.x, annotation.to.y], options);
    if (annotation.type === 'text') return new IText(annotation.text || ' ', { ...options, fontSize: annotation.style.fontSizePx ?? 24, fontFamily: annotation.style.fontFamily ?? 'Inter', fill: annotation.style.fill, stroke: '', strokeWidth: 0 });
    if (annotation.type === 'redact') return new FabricRect({ ...options, fill: annotation.color, opacity: 1 });
    if (annotation.type === 'blur' || annotation.type === 'pixelate') return effectObject(annotation);
    // A highlight must let the capture show through, the way a marker pen does.
    if (annotation.type === 'highlight') return new FabricRect({ ...options, stroke: '', strokeWidth: 0, opacity: 0.35, globalCompositeOperation: 'multiply' });
    return new FabricRect(options);
  }

  function commitAnnotation(annotation: Annotation): FabricObject {
    const object = fabricFor(annotation);
    stack.push({
      label: `Add ${annotation.type}`,
      do: () => { canvas.add(object); doc = addLayer(doc, annotation); canvas.requestRenderAll(); emit(); },
      undo: () => { canvas.remove(object); doc = removeLayer(doc, annotation.id); canvas.requestRenderAll(); emit(); },
    });
    return object;
  }

  canvas.on('mouse:down', (event) => {
    // Freehand is drawn by Fabric's brush, so the drag-rectangle path must not
    // also run for it or every stroke would leave a rectangle behind.
    if (tool === 'select' || tool === 'pan' || tool === 'freehand') return;
    const pointer = canvas.getScenePoint(event.e);
    origin = { x: pointer.x, y: pointer.y };
  });

  // The brush produces its own Path; adopt it as a freehand layer so undo and
  // saving treat it like every other annotation.
  canvas.on('path:created', (event) => {
    const path = (event as unknown as { path: Path }).path;
    const bounds = path.getBoundingRect();
    const annotation = createAnnotation('freehand', { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height }, {});
    path.set({ ssxId: annotation.id } as Partial<FabricObject>);
    // Fabric already added the path, so the command starts from the drawn state.
    canvas.remove(path);
    stack.push({
      label: 'Add freehand',
      do: () => { canvas.add(path); doc = addLayer(doc, annotation); canvas.requestRenderAll(); emit(); },
      undo: () => { canvas.remove(path); doc = removeLayer(doc, annotation.id); canvas.requestRenderAll(); emit(); },
    });
  });

  canvas.on('mouse:up', (event) => {
    if (!origin || tool === 'select' || tool === 'pan' || tool === 'freehand') return;
    const pointer = canvas.getScenePoint(event.e);
    const pointerEvent = event.e as MouseEvent;
    const rect = constrainRect(normalizeRect(origin, { x: pointer.x, y: pointer.y }), { lockAspect: pointerEvent.shiftKey, fromCenter: pointerEvent.altKey });
    const from = origin;
    origin = null;
    if (!drawableTools.has(tool as AnnotationType)) return;
    if (rect.width < 3 && rect.height < 3 && tool !== 'text' && tool !== 'marker') return;
    const annotation = createAnnotation(tool as AnnotationType, rect, {
      from,
      to: { x: pointer.x, y: pointer.y },
      number: tool === 'marker' ? nextMarkerNumber(doc.layers) : undefined,
    });
    const object = commitAnnotation(annotation);
    if (annotation.type === 'text' && object instanceof IText) {
      // Without this the caret never appears and the box cannot be typed into.
      canvas.setActiveObject(object);
      object.enterEditing();
      object.selectAll();
      canvas.requestRenderAll();
    }
  });

  return {
    setTool(next) {
      tool = next;
      canvas.selection = next === 'select';
      canvas.isDrawingMode = next === 'freehand';
      if (canvas.isDrawingMode) {
        const brush = new PencilBrush(canvas);
        const style = defaultStyleFor('freehand');
        brush.color = style.stroke;
        brush.width = style.strokeWidth;
        canvas.freeDrawingBrush = brush;
      }
    },
    undo() { stack.undo(); },
    redo() { stack.redo(); },
    canUndo: () => stack.canUndo,
    canRedo: () => stack.canRedo,
    getDocument: () => doc,
    setZoom(zoom) { applyZoom(zoom); },
    getZoom: () => canvas.getZoom(),
    /** Zoom that shows the whole capture in the stage the editor was given. */
    fitZoom: () => Math.min(fitted.zoom, fitZoomToViewport(natural, deps.viewport ?? { width: fitted.width, height: fitted.height })),
    imageSize: () => ({ ...natural }),
    toDataUrl() {
      // Fabric's own toDataURL divides out the viewport zoom, so the export is
      // always at image resolution no matter what the user is zoomed to.
      return canvas.toDataURL({ format: 'png', multiplier: 1 / canvas.getZoom() });
    },
    dispose() {
      void canvas.dispose();
      if (ownedUrl) URL.revokeObjectURL(ownedUrl);
    },
  };
}

function describe(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (cause instanceof Event) return `${cause.type} while loading the image`;
  return String(cause);
}

async function blobUrlFor(doc: EditorDocument): Promise<string> {
  const { resolveBlob } = await import('../shared/db/blob-ref');
  return URL.createObjectURL(await resolveBlob(doc.base.ref));
}
