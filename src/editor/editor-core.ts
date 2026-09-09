import { Canvas, Ellipse, FabricImage, IText, Line, Rect as FabricRect } from 'fabric';
import { createAnnotation } from '../lib/editor/annotation';
import { CommandStack } from '../lib/editor/command-stack';
import { addLayer, nextMarkerNumber, removeLayer } from '../lib/editor/document';
import { constrainRect, normalizeRect } from '../lib/editor/geometry';
import { CANVAS_MAX_AREA, CANVAS_MAX_SIDE, fitCanvasToLimits } from '../lib/editor/viewport';
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
  /** Flattens at full image resolution, ignoring the on-screen zoom. */
  toDataUrl(): string;
  dispose(): void;
}

export interface EditorDeps {
  onChange?(doc: EditorDocument): void;
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
  canvas.setDimensions({ width: fitted.width, height: fitted.height });
  canvas.setZoom(fitted.zoom);
  // Scene coordinates stay in image pixels, so the background must cover the
  // untransformed image rather than the shrunken canvas.
  baseImage.scaleX = natural.width / (baseImage.width || natural.width);
  baseImage.scaleY = natural.height / (baseImage.height || natural.height);
  canvas.backgroundImage = baseImage;
  canvas.requestRenderAll();

  function emit(): void {
    deps.onChange?.(doc);
  }

  function fabricFor(annotation: Annotation) {
    const options = toFabricOptions(annotation);
    if (annotation.type === 'ellipse') return new Ellipse({ ...options, rx: annotation.rect.width / 2, ry: annotation.rect.height / 2 });
    if (annotation.type === 'line' || annotation.type === 'arrow') return new Line([annotation.from.x, annotation.from.y, annotation.to.x, annotation.to.y], options);
    if (annotation.type === 'text') return new IText(annotation.text || ' ', { ...options, fontSize: annotation.style.fontSizePx ?? 24, fontFamily: annotation.style.fontFamily ?? 'Inter', fill: annotation.style.fill });
    if (annotation.type === 'redact') return new FabricRect({ ...options, fill: annotation.color, opacity: 1 });
    return new FabricRect(options);
  }

  function commitAnnotation(annotation: Annotation): void {
    const object = fabricFor(annotation);
    stack.push({
      label: `Add ${annotation.type}`,
      do: () => { canvas.add(object); doc = addLayer(doc, annotation); canvas.requestRenderAll(); emit(); },
      undo: () => { canvas.remove(object); doc = removeLayer(doc, annotation.id); canvas.requestRenderAll(); emit(); },
    });
  }

  canvas.on('mouse:down', (event) => {
    if (tool === 'select' || tool === 'pan') return;
    const pointer = canvas.getScenePoint(event.e);
    origin = { x: pointer.x, y: pointer.y };
  });

  canvas.on('mouse:up', (event) => {
    if (!origin || tool === 'select' || tool === 'pan') return;
    const pointer = canvas.getScenePoint(event.e);
    const pointerEvent = event.e as MouseEvent;
    const rect = constrainRect(normalizeRect(origin, { x: pointer.x, y: pointer.y }), { lockAspect: pointerEvent.shiftKey, fromCenter: pointerEvent.altKey });
    const from = origin;
    origin = null;
    if (!drawableTools.has(tool as AnnotationType)) return;
    if (rect.width < 3 && rect.height < 3 && tool !== 'text' && tool !== 'marker') return;
    commitAnnotation(createAnnotation(tool as AnnotationType, rect, {
      from,
      to: { x: pointer.x, y: pointer.y },
      number: tool === 'marker' ? nextMarkerNumber(doc.layers) : undefined,
    }));
  });

  return {
    setTool(next) { tool = next; canvas.selection = next === 'select'; },
    undo() { stack.undo(); },
    redo() { stack.redo(); },
    canUndo: () => stack.canUndo,
    canRedo: () => stack.canRedo,
    getDocument: () => doc,
    setZoom(zoom) { canvas.setZoom(zoom); canvas.requestRenderAll(); },
    getZoom: () => canvas.getZoom(),
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
