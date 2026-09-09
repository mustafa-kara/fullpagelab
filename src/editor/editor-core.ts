import { Canvas, Ellipse, FabricImage, filters, Group, IText, Line, PencilBrush, Rect as FabricRect, Triangle, type FabricObject, type Path } from 'fabric';
import { ANNOTATION_STROKE, createAnnotation } from '../lib/editor/annotation';
import type { defaultStyleFor } from '../lib/editor/annotation';
import { angleDegrees, arrowHeadGeometry } from '../lib/editor/arrow';
import { CommandStack } from '../lib/editor/command-stack';
import { addLayer, nextMarkerNumber, removeLayer, updateLayer } from '../lib/editor/document';
import { constrainRect, normalizeRect, scaledRect } from '../lib/editor/geometry';
import { CANVAS_MAX_AREA, CANVAS_MAX_SIDE, clampZoom, fitCanvasToLimits, initialZoomFor } from '../lib/editor/viewport';
import type { Annotation, AnnotationType, EditorDocument, ToolId } from '../shared/types/editor';
import type { Rect } from '../shared/types/primitives';
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
  /** Style applied to annotations drawn from now on, and to the selection. */
  setStyle(style: Partial<EditorStyle>): void;
  getStyle(): EditorStyle;
  fitZoom(): number;
  imageSize(): { width: number; height: number };
  /** Flattens at full image resolution, ignoring the on-screen zoom. */
  toDataUrl(): string;
  dispose(): void;
}

export interface EditorStyle {
  /** Stroke colour, or fill for the tools that have no stroke. */
  color: string;
  strokeWidth: number;
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
  let style: EditorStyle = { color: ANNOTATION_STROKE, strokeWidth: 4 };
  let preview: FabricObject | null = null;

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
  const initialZoom = Math.min(fitted.zoom, initialZoomFor(natural, viewport));
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
  /**
   * Copies the capture's pixels under `rect` into a canvas of its own.
   *
   * `applyFilters` ignores cropX/cropY and processes the whole source, so
   * filtering a shared element would process the entire full-page capture for a
   * small region — slow, and it makes blur strength depend on capture size,
   * since Fabric scales blur by the source width. Copying the region out first
   * ties both the cost and the strength to the region alone.
   */
  function regionPatch(rect: Rect): HTMLCanvasElement {
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
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
      Math.round(rect.x * scaleX),
      Math.round(rect.y * scaleY),
      Math.max(1, Math.round(width * scaleX)),
      Math.max(1, Math.round(height * scaleY)),
      0, 0, width, height,
    );
    return patch;
  }

  function effectFilter(annotation: Annotation & { type: 'blur' | 'pixelate' }): filters.BaseFilter<string> {
    return annotation.type === 'blur'
      // Fabric's blur is a fraction of the image size, not a pixel radius.
      ? new filters.Blur({ blur: Math.min(1, annotation.radiusPx / 100) })
      : new filters.Pixelate({ blocksize: Math.max(2, Math.round(annotation.blockPx)) });
  }

  /**
   * Re-cuts an effect region from whatever the capture shows at its new place.
   *
   * The region is a snapshot of the pixels it was created over, so moving or
   * resizing it would otherwise carry those original pixels along and reveal
   * the content it was meant to hide somewhere else on the image.
   */
  function refreshEffect(object: FabricImage, annotation: Annotation & { type: 'blur' | 'pixelate' }): void {
    const rect = objectRect(object);
    const patch = regionPatch(rect);
    object.setElement(patch);
    object.set({ left: rect.x, top: rect.y, scaleX: 1, scaleY: 1, width: patch.width, height: patch.height });
    object.filters = [effectFilter(annotation)];
    object.applyFilters();
    object.setCoords();
  }

  function effectObject(annotation: Annotation & { type: 'blur' | 'pixelate' }): FabricObject {
    const options = toFabricOptions(annotation);
    const patch = regionPatch(annotation.rect);
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
    region.filters = [effectFilter(annotation)];
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

  /**
   * Turns the toolbar's colour and width into the fields each tool actually
   * paints with: outline tools carry it on the stroke, filled tools on the fill.
   * Redaction is excluded on purpose — it must stay opaque black.
   */
  function styleOverrideFor(type: AnnotationType): Partial<ReturnType<typeof defaultStyleFor>> {
    if (type === 'redact') return {};
    if (type === 'highlight' || type === 'marker') return { fill: style.color };
    if (type === 'text') return { fill: style.color, fontSizePx: Math.max(12, style.strokeWidth * 6) };
    if (type === 'blur' || type === 'pixelate') return {};
    return { stroke: style.color, strokeWidth: style.strokeWidth };
  }

  /** Scene rect an object currently occupies, with its resize scale applied. */
  function objectRect(object: FabricObject): Rect {
    return scaledRect({ left: object.left, top: object.top, width: object.width, height: object.height, scaleX: object.scaleX, scaleY: object.scaleY });
  }

  function layerFor(object: FabricObject): Annotation | undefined {
    const id = (object as unknown as { ssxId?: string }).ssxId;
    return id ? doc.layers.find((layer) => layer.id === id) : undefined;
  }

  /**
   * Writes a canvas-side move or resize back into the document.
   *
   * Nothing used to update the model after an object was dragged, so the saved
   * document described where every annotation was first drawn rather than where
   * the user left it.
   */
  canvas.on('object:modified', (event) => {
    const object = event.target;
    if (!object) return;
    const layer = layerFor(object);
    if (!layer) return;
    const before = layer;
    const rect = objectRect(object);

    const apply = (): void => {
      let next: Partial<Annotation> = { rect, rotationDeg: object.angle ?? 0 };
      if (before.type === 'arrow' || before.type === 'line') {
        // A line's endpoints, not its bounding box, are what gets rendered.
        const dx = rect.x - before.rect.x;
        const dy = rect.y - before.rect.y;
        next = { ...next, from: { x: before.from.x + dx, y: before.from.y + dy }, to: { x: before.to.x + dx, y: before.to.y + dy } } as Partial<Annotation>;
      }
      doc = updateLayer(doc, layer.id, next);
      if (layer.type === 'blur' || layer.type === 'pixelate') {
        const moved = doc.layers.find((candidate) => candidate.id === layer.id);
        if (moved && (moved.type === 'blur' || moved.type === 'pixelate') && object instanceof FabricImage) refreshEffect(object, moved);
      }
      canvas.requestRenderAll();
      emit();
    };

    apply();
    stack.push({
      label: `Move ${layer.type}`,
      do: apply,
      undo: () => {
        object.set({ left: before.rect.x, top: before.rect.y, scaleX: 1, scaleY: 1, angle: before.rotationDeg });
        doc = updateLayer(doc, layer.id, { rect: before.rect, rotationDeg: before.rotationDeg });
        if (before.type === 'blur' || before.type === 'pixelate') {
          if (object instanceof FabricImage) refreshEffect(object, before);
        }
        object.setCoords();
        canvas.requestRenderAll();
        emit();
      },
    });
  });

  /** Removes an object and its layer as one undoable step. */
  function deleteObject(object: FabricObject): void {
    const layer = layerFor(object);
    if (!layer) return;
    stack.push({
      label: `Delete ${layer.type}`,
      do: () => { canvas.remove(object); doc = removeLayer(doc, layer.id); canvas.requestRenderAll(); emit(); },
      undo: () => { canvas.add(object); doc = addLayer(doc, layer); canvas.requestRenderAll(); emit(); },
    });
  }

  /**
   * Deleting the selection was impossible: the only way to remove a shape was
   * to undo everything drawn after it.
   */
  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Delete' && event.key !== 'Backspace') return;
    // While a text box is being typed into, these keys belong to the text.
    const active = canvas.getActiveObject();
    if (!active || (active instanceof IText && active.isEditing)) return;
    event.preventDefault();
    for (const object of canvas.getActiveObjects()) deleteObject(object);
    canvas.discardActiveObject();
    canvas.requestRenderAll();
  }
  canvasElement.ownerDocument.addEventListener('keydown', onKeyDown);

  /**
   * Writes typed text into the document, and drops a box left empty.
   *
   * The model recorded `text: ''` forever, so a saved document lost every
   * character the user typed, and abandoning an empty box left an invisible
   * but clickable object behind.
   */
  canvas.on('text:editing:exited', (event) => {
    const object = event.target;
    const layer = layerFor(object);
    if (!layer || layer.type !== 'text') return;
    const text = object.text.trim();
    if (!text) { deleteObject(object); return; }
    doc = updateLayer(doc, layer.id, { text: object.text } as Partial<Annotation>);
    emit();
  });

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
    // Pressing on an existing annotation means the user is moving or resizing
    // it. Starting a new shape as well would draw a stray rectangle over the
    // one being dragged, so the drawing gesture yields to the manipulation.
    if (event.target) { origin = null; clearPreview(); return; }
    const pointer = canvas.getScenePoint(event.e);
    origin = { x: pointer.x, y: pointer.y };
  });

  /**
   * Shows the shape while it is being dragged.
   *
   * Only freehand gave live feedback, because Fabric's brush paints as it goes.
   * Every other tool committed on release, so the user dragged blind. This
   * paints a provisional object on the interaction layer and replaces it with
   * the real annotation on release.
   */
  canvas.on('mouse:move', (event) => {
    if (!origin || tool === 'select' || tool === 'pan' || tool === 'freehand') return;
    if (!drawableTools.has(tool as AnnotationType)) return;
    const pointer = canvas.getScenePoint(event.e);
    const pointerEvent = event.e as MouseEvent;
    const rect = constrainRect(normalizeRect(origin, { x: pointer.x, y: pointer.y }), { lockAspect: pointerEvent.shiftKey, fromCenter: pointerEvent.altKey });
    if (preview) canvas.remove(preview);
    // A preview of the pixel effects would re-cut the region on every pointer
    // move, so those show an outline until release.
    const previewType: AnnotationType = tool === 'blur' || tool === 'pixelate' || tool === 'redact' ? 'rect' : tool as AnnotationType;
    const draft = createAnnotation(previewType, rect, {
      from: origin,
      to: { x: pointer.x, y: pointer.y },
      style: { ...styleOverrideFor(previewType), fill: 'none' },
    });
    preview = fabricFor(draft);
    preview.set({ selectable: false, evented: false, excludeFromExport: true } as Partial<FabricObject>);
    canvas.add(preview);
    canvas.requestRenderAll();
  });

  function clearPreview(): void {
    if (!preview) return;
    canvas.remove(preview);
    preview = null;
  }

  // The brush produces its own Path; adopt it as a freehand layer so undo and
  // saving treat it like every other annotation.
  canvas.on('path:created', (event) => {
    const path = (event as unknown as { path: Path }).path;
    const bounds = path.getBoundingRect();
    const annotation = createAnnotation('freehand', { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height }, { style: { stroke: style.color, strokeWidth: style.strokeWidth } });
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
    const started = origin;
    origin = null;
    clearPreview();
    if (!started || tool === 'select' || tool === 'pan' || tool === 'freehand') return;
    // Fabric can take a gesture over after the press — grabbing a resize handle
    // that sits outside the object's box, for instance — which would otherwise
    // leave a live origin for this handler to turn into a stray shape.
    if (event.target || canvas.getActiveObject()) return;
    const pointer = canvas.getScenePoint(event.e);
    const pointerEvent = event.e as MouseEvent;
    const rect = constrainRect(normalizeRect(started, { x: pointer.x, y: pointer.y }), { lockAspect: pointerEvent.shiftKey, fromCenter: pointerEvent.altKey });
    const from = started;
    if (!drawableTools.has(tool as AnnotationType)) return;
    // The minimum is in screen pixels: three scene pixels is invisible at a
    // fitted zoom and larger than a deliberate drag when zoomed in.
    const minimum = 3 / canvas.getZoom();
    if (rect.width < minimum && rect.height < minimum && tool !== 'text' && tool !== 'marker') return;
    const annotation = createAnnotation(tool as AnnotationType, rect, {
      from,
      to: { x: pointer.x, y: pointer.y },
      number: tool === 'marker' ? nextMarkerNumber(doc.layers) : undefined,
      style: styleOverrideFor(tool as AnnotationType),
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

  const api: EditorHandle = {
    setTool(next) {
      tool = next;
      canvas.selection = next === 'select';
      canvas.isDrawingMode = next === 'freehand';
      if (canvas.isDrawingMode) {
        const brush = new PencilBrush(canvas);
        brush.color = style.color;
        brush.width = style.strokeWidth;
        canvas.freeDrawingBrush = brush;
      }
    },
    undo() { stack.undo(); },
    redo() { stack.redo(); },
    canUndo: () => stack.canUndo,
    canRedo: () => stack.canRedo,
    getDocument: () => doc,
    setStyle(next) {
      style = { ...style, ...next };
      if (canvas.freeDrawingBrush) {
        canvas.freeDrawingBrush.color = style.color;
        canvas.freeDrawingBrush.width = style.strokeWidth;
      }
      // Restyle the selection too, so the pickers act on what is selected
      // rather than only on the next shape drawn.
      for (const object of canvas.getActiveObjects()) {
        const layer = layerFor(object);
        if (!layer || layer.type === 'redact' || layer.type === 'blur' || layer.type === 'pixelate') continue;
        const override = styleOverrideFor(layer.type);
        object.set(override as Partial<FabricObject>);
        doc = updateLayer(doc, layer.id, { style: { ...layer.style, ...override } });
      }
      canvas.requestRenderAll();
      emit();
    },
    getStyle: () => ({ ...style }),
    setZoom(zoom) { applyZoom(zoom); },
    getZoom: () => canvas.getZoom(),
    /**
     * The zoom the editor opens at, which the Fit control returns to.
     *
     * This is deliberately the same calculation as the initial zoom: a Fit that
     * jumped to a different scale than the one the editor opened at would be
     * confusing, and for a tall capture it is an unusable thumbnail.
     */
    fitZoom: () => Math.min(fitted.zoom, initialZoomFor(natural, deps.viewport ?? { width: fitted.width, height: fitted.height })),
    imageSize: () => ({ ...natural }),
    toDataUrl() {
      // Export at the capture's own resolution, whatever the user is zoomed to.
      // Passing a multiplier alone is not enough: `applyZoom` also resizes the
      // canvas, and Fabric bakes the current viewport transform into the export,
      // so the two scalings fought and the annotations fell outside the frame.
      const zoom = canvas.getZoom();
      const width = canvas.getWidth();
      const height = canvas.getHeight();
      const viewport = [...canvas.viewportTransform] as typeof canvas.viewportTransform;
      canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
      canvas.setDimensions({ width: natural.width, height: natural.height });
      canvas.renderAll();
      try {
        return canvas.toDataURL({ format: 'png', multiplier: 1 });
      } finally {
        canvas.setDimensions({ width, height });
        canvas.setViewportTransform(viewport);
        canvas.setZoom(zoom);
        canvas.requestRenderAll();
      }
    },
    dispose() {
      canvasElement.ownerDocument.removeEventListener('keydown', onKeyDown);
      void canvas.dispose();
      if (ownedUrl) URL.revokeObjectURL(ownedUrl);
    },
  };
  return api;
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
