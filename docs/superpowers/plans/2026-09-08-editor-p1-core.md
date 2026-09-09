# Screenshot Editor P1 Core Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Implement task-by-task; run the listed command after every step and do not move on while it fails.

**Goal:** Add a working annotation editor to the result page so a user can draw on a capture, blur or permanently redact sensitive regions, undo/redo, save the result to history and export it.

**Architecture:** The editor is a *mode* of the existing result page, not a new HTML page. Pure logic (annotation model, command stack, geometry, flatten math) lives in `src/lib/editor/**` and is unit-tested in the `node` vitest environment. Fabric.js-dependent rendering lives in `src/editor/**` and is loaded through a dynamic `import()` so it becomes its own Rollup chunk. Persistence reuses what already exists: `putBlob`/`resolveBlob`, the `editorDocs` Dexie store, `history.addFile`, and the export pipeline's already-implemented `editedRef` parameter.

**Tech Stack:** TypeScript, Preact (result page UI), Fabric.js v6 (canvas object model), Dexie (`editorDocs`), Vitest (`node` + `happy-dom`), Playwright (e2e).

---

## Critical context for every task

Read this before starting any task. It is the result of reading the code, not guesswork.

**Coverage gate.** `vitest.config.ts` collects coverage **only** from `src/lib/**` and `src/shared/**`, with thresholds lines 90 / functions 90 / branches 85 / statements 90. Anything you put in `src/lib/editor/**` must be thoroughly unit-tested or the whole suite fails. Code in `src/editor/**` and `src/pages/**` is not part of the coverage gate.

**Test environment.** Unit tests run in `node` by default. A test needing DOM must start with the pragma comment `// @vitest-environment happy-dom` as its very first line (see `test/unit/result-page.test.ts:1`).

**Existing helpers — exact signatures, do not re-derive:**
```ts
// src/shared/ids.ts
export function createId(): Id            // nanoid(16)
export function nowIso(): IsoDate         // new Date().toISOString()

// src/shared/db/blob-ref.ts
export async function putBlob(blob: Blob, options?: { preferOpfs?: boolean; path?: string }): Promise<BlobRef>
export async function resolveBlob(ref: BlobRef): Promise<Blob>   // throws for store:'session'
export async function retain(ref: BlobRef): Promise<void>        // idb only, no-op otherwise
export async function release(ref: BlobRef): Promise<void>

// src/shared/messages.ts
export function sendMessage<K extends keyof MsgMap>(type: K, payload: MsgMap[K]['req']): Promise<MsgMap[K]['res']>

// src/shared/i18n.ts
export function t(key: string, substitutions?: string | string[]): string  // 'a.b' falls back to 'a_b'
```

**Types already defined — use them, do not redefine.** `src/shared/types/editor.ts` contains `ToolId`, `AnnotationType`, `AnnotationStyle`, `AnnotationBase`, `Annotation` (discriminated union), `EditorDocument`, `EditorSettings`, `EditorExport`. `src/shared/db/schema.ts:34` already declares the `editorDocs` Dexie table keyed by `captureId`.

**The export pipeline already accepts editor output.** `ExportRequest` has `editedRef?: BlobRef` (`src/shared/types/export.ts:18`) and the pipeline honours it at `src/background/export/pipeline.ts:179`. To export edited pixels you write the flattened blob with `putBlob()` and pass its ref — no new export path is needed.

**Known trap (Task 9 fixes it).** `sourceFile()` at `src/background/export/pipeline.ts:39-51` returns any `role:'edited'` file *before* checking `stripIndex`, so once an edited file exists, per-strip export silently returns the edited image instead of the requested strip.

**i18n.** Every user-visible string goes through `t()`, and every key must be added to **both** `public/_locales/en/messages.json` and `public/_locales/tr/messages.json`. Keys use underscores: `t('ui.editor.tool.arrow')` reads `ui_editor_tool_arrow`.

**Commit style.** Conventional commits. End every commit message body with:
```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

## File Structure

| Path | Responsibility |
|---|---|
| `src/lib/editor/annotation.ts` | Create/patch `Annotation` values, default styles per tool. Pure. |
| `src/lib/editor/command-stack.ts` | Undo/redo stack with merge support. Pure. |
| `src/lib/editor/geometry.ts` | Rect normalisation, aspect/centre constraints, hit padding. Pure. |
| `src/lib/editor/document.ts` | Build/patch `EditorDocument`, apply annotation list changes. Pure. |
| `src/lib/editor/flatten.ts` | Canvas-agnostic flatten: draw base, effects, annotations onto a supplied 2D context. |
| `src/editor/fabric-bridge.ts` | `Annotation` ⇄ Fabric object conversion. Fabric-dependent. |
| `src/editor/editor-core.ts` | Owns the Fabric canvas, tool dispatch, pointer handling, zoom/pan. |
| `src/editor/index.ts` | `createEditor(container, doc, deps)` entry point, dynamically imported. |
| `src/pages/result/editor-panel.tsx` | Preact toolbar + style panel; hosts the editor canvas inside the result page. |
| `src/background/history/service.ts` | *Modify:* add `replaceFile`, extend patch type. |
| `src/background/export/pipeline.ts` | *Modify:* fix `sourceFile` strip precedence. |

---

### Task 1: Pure geometry helpers

**Files:**
- Create: `src/lib/editor/geometry.ts`
- Test: `test/unit/editor-geometry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { constrainRect, normalizeRect, padRect } from '../../src/lib/editor/geometry';

describe('editor geometry', () => {
  it('normalizes a rectangle dragged up and to the left', () => {
    expect(normalizeRect({ x: 100, y: 80 }, { x: 40, y: 20 })).toEqual({ x: 40, y: 20, width: 60, height: 60 });
  });

  it('keeps a zero-size drag at a minimum of one pixel', () => {
    expect(normalizeRect({ x: 10, y: 10 }, { x: 10, y: 10 })).toEqual({ x: 10, y: 10, width: 1, height: 1 });
  });

  it('locks the aspect ratio to a square when shift is held', () => {
    expect(constrainRect({ x: 0, y: 0, width: 80, height: 30 }, { lockAspect: true })).toEqual({ x: 0, y: 0, width: 80, height: 80 });
  });

  it('grows from the center when alt is held', () => {
    expect(constrainRect({ x: 50, y: 50, width: 20, height: 10 }, { fromCenter: true })).toEqual({ x: 30, y: 40, width: 40, height: 20 });
  });

  it('pads a rectangle for hit testing without going negative', () => {
    expect(padRect({ x: 2, y: 2, width: 10, height: 10 }, 6)).toEqual({ x: 0, y: 0, width: 18, height: 18 });
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm exec vitest run test/unit/editor-geometry.test.ts`
Expected: FAIL — cannot resolve `src/lib/editor/geometry`.

- [ ] **Step 3: Implement**

```ts
import type { Point, Rect } from '../../shared/types/primitives';

export interface RectConstraints { lockAspect?: boolean; fromCenter?: boolean }

/** Builds a positive-size rect from two drag points, regardless of drag direction. */
export function normalizeRect(start: Point, end: Point): Rect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.max(1, Math.abs(end.x - start.x)),
    height: Math.max(1, Math.abs(end.y - start.y)),
  };
}

export function constrainRect(rect: Rect, { lockAspect = false, fromCenter = false }: RectConstraints): Rect {
  let { x, y, width, height } = rect;
  if (lockAspect) {
    const side = Math.max(width, height);
    width = side;
    height = side;
  }
  if (fromCenter) {
    // Double first, then recentre, so the point the user pressed stays the centre.
    width *= 2;
    height *= 2;
    x -= width / 2;
    y -= height / 2;
  }
  return { x, y, width, height };
}

/** Expands a rect by `padding` on every side, clamped so it never starts before the origin. */
export function padRect(rect: Rect, padding: number): Rect {
  const x = Math.max(0, rect.x - padding);
  const y = Math.max(0, rect.y - padding);
  return {
    x,
    y,
    width: rect.width + (rect.x - x) + padding,
    height: rect.height + (rect.y - y) + padding,
  };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm exec vitest run test/unit/editor-geometry.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/editor/geometry.ts test/unit/editor-geometry.test.ts
git commit -m "feat(editor): add pure rect geometry helpers"
```

---

### Task 2: Annotation factory and tool defaults

**Files:**
- Create: `src/lib/editor/annotation.ts`
- Test: `test/unit/editor-annotation.test.ts`

Default styles come from `docs/specs/05-editor.md §4`: shapes use stroke `#FF3B30`; arrow width 4, rect/ellipse/line width 3, freehand width 4; text is Inter 24px weight 600 in `#111111`; highlight fills `#FFEB3B` at opacity 0.4; blur radius 16; pixelate block 12; redact is black.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { createAnnotation, defaultStyleFor } from '../../src/lib/editor/annotation';

const rect = { x: 10, y: 20, width: 100, height: 50 };

describe('annotation factory', () => {
  it('gives every annotation an id, timestamp and visible/unlocked defaults', () => {
    const annotation = createAnnotation('rect', rect, { id: 'a1', now: '2026-09-08T00:00:00.000Z' });
    expect(annotation).toMatchObject({ id: 'a1', type: 'rect', rect, visible: true, locked: false, opacity: 1, rotationDeg: 0, createdAt: '2026-09-08T00:00:00.000Z' });
  });

  it('uses the red stroke and width 3 for rectangles', () => {
    expect(defaultStyleFor('rect')).toMatchObject({ stroke: '#FF3B30', strokeWidth: 3, fill: 'none' });
  });

  it('uses a thicker stroke and an end arrow head for arrows', () => {
    expect(defaultStyleFor('arrow')).toMatchObject({ stroke: '#FF3B30', strokeWidth: 4, arrowHead: 'end' });
  });

  it('makes highlights a translucent yellow fill', () => {
    expect(defaultStyleFor('highlight')).toMatchObject({ fill: '#FFEB3B' });
  });

  it('stores the drag endpoints on arrows and lines', () => {
    const arrow = createAnnotation('arrow', rect, { id: 'a2', from: { x: 10, y: 20 }, to: { x: 110, y: 70 } });
    expect(arrow).toMatchObject({ type: 'arrow', from: { x: 10, y: 20 }, to: { x: 110, y: 70 } });
  });

  it('seeds text annotations with empty auto-sizing text', () => {
    expect(createAnnotation('text', rect, { id: 'a3' })).toMatchObject({ type: 'text', text: '', autoSize: true });
  });

  it('applies the documented blur radius and pixelate block size', () => {
    expect(createAnnotation('blur', rect, { id: 'a4' })).toMatchObject({ radiusPx: 16 });
    expect(createAnnotation('pixelate', rect, { id: 'a5' })).toMatchObject({ blockPx: 12 });
  });

  it('defaults redaction to opaque black', () => {
    expect(createAnnotation('redact', rect, { id: 'a6' })).toMatchObject({ color: '#000000' });
  });

  it('numbers markers from the supplied sequence value', () => {
    expect(createAnnotation('marker', rect, { id: 'a7', number: 3 })).toMatchObject({ number: 3, shape: 'circle' });
  });

  it('generates an id and timestamp when none are supplied', () => {
    const annotation = createAnnotation('ellipse', rect, {});
    expect(annotation.id).toMatch(/\S/);
    expect(Number.isNaN(Date.parse(annotation.createdAt))).toBe(false);
  });

  it('lets the caller override individual style fields', () => {
    const annotation = createAnnotation('rect', rect, { id: 'a8', style: { stroke: '#0000FF' } });
    expect(annotation.style).toMatchObject({ stroke: '#0000FF', strokeWidth: 3 });
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm exec vitest run test/unit/editor-annotation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { createId, nowIso } from '../../shared/ids';
import type { Annotation, AnnotationStyle, AnnotationType } from '../../shared/types/editor';
import type { Point, Rect } from '../../shared/types/primitives';

const shapeStroke = '#FF3B30';

const styles: Record<AnnotationType, AnnotationStyle> = {
  arrow: { stroke: shapeStroke, strokeWidth: 4, fill: 'none', lineCap: 'round', arrowHead: 'end', arrowHeadSize: 12 },
  line: { stroke: shapeStroke, strokeWidth: 3, fill: 'none', lineCap: 'round', arrowHead: 'none' },
  rect: { stroke: shapeStroke, strokeWidth: 3, fill: 'none', cornerRadius: 0 },
  ellipse: { stroke: shapeStroke, strokeWidth: 3, fill: 'none' },
  freehand: { stroke: shapeStroke, strokeWidth: 4, fill: 'none', lineCap: 'round' },
  text: { stroke: 'none', strokeWidth: 0, fill: '#111111', fontFamily: 'Inter', fontSizePx: 24, fontWeight: 600, textAlign: 'left', textBackground: 'none' },
  highlight: { stroke: 'none', strokeWidth: 0, fill: '#FFEB3B' },
  marker: { stroke: 'none', strokeWidth: 0, fill: shapeStroke, fontFamily: 'Inter', fontSizePx: 16, fontWeight: 600 },
  emoji: { stroke: 'none', strokeWidth: 0, fill: 'none' },
  image: { stroke: 'none', strokeWidth: 0, fill: 'none' },
  blur: { stroke: 'none', strokeWidth: 0, fill: 'none' },
  pixelate: { stroke: 'none', strokeWidth: 0, fill: 'none' },
  redact: { stroke: 'none', strokeWidth: 0, fill: '#000000' },
  crop: { stroke: '#FFFFFF', strokeWidth: 1, fill: 'none' },
};

export function defaultStyleFor(type: AnnotationType): AnnotationStyle {
  return { ...styles[type] };
}

export interface CreateAnnotationOptions {
  id?: string;
  now?: string;
  style?: Partial<AnnotationStyle>;
  from?: Point;
  to?: Point;
  number?: number;
  emoji?: string;
  text?: string;
}

/** Builds a fully-formed Annotation of `type`; variant fields fall back to the documented defaults. */
export function createAnnotation(type: AnnotationType, rect: Rect, options: CreateAnnotationOptions): Annotation {
  const base = {
    id: options.id ?? createId(),
    type,
    rect,
    rotationDeg: 0,
    opacity: 1,
    locked: false,
    visible: true,
    style: { ...defaultStyleFor(type), ...options.style },
    createdAt: options.now ?? nowIso(),
  };
  const from = options.from ?? { x: rect.x, y: rect.y };
  const to = options.to ?? { x: rect.x + rect.width, y: rect.y + rect.height };
  switch (type) {
    case 'arrow':
    case 'line':
      return { ...base, type, from, to } as Annotation;
    case 'freehand':
      return { ...base, type, points: [from, to], smoothing: 0.5 } as Annotation;
    case 'text':
      return { ...base, type, text: options.text ?? '', autoSize: true } as Annotation;
    case 'marker':
      return { ...base, type, number: options.number ?? 1, shape: 'circle' } as Annotation;
    case 'emoji':
      return { ...base, type, emoji: options.emoji ?? '⭐' } as Annotation;
    case 'blur':
      return { ...base, type, radiusPx: 16 } as Annotation;
    case 'pixelate':
      return { ...base, type, blockPx: 12 } as Annotation;
    case 'redact':
      return { ...base, type, color: '#000000' } as Annotation;
    default:
      return { ...base, type } as Annotation;
  }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm exec vitest run test/unit/editor-annotation.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/editor/annotation.ts test/unit/editor-annotation.test.ts
git commit -m "feat(editor): add annotation factory with documented tool defaults"
```

---

### Task 3: Undo/redo command stack

**Files:**
- Create: `src/lib/editor/command-stack.ts`
- Test: `test/unit/editor-command-stack.test.ts`

Spec reference `05-editor.md §9`: max 200 entries, `merge` collapses a drag into one command, `clear()` after a redaction commit.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest';
import { CommandStack } from '../../src/lib/editor/command-stack';

function counterCommand(log: string[], label: string) {
  return { label, do: () => log.push(`do:${label}`), undo: () => log.push(`undo:${label}`) };
}

describe('command stack', () => {
  it('runs a command when it is pushed', () => {
    const log: string[] = [];
    new CommandStack().push(counterCommand(log, 'a'));
    expect(log).toEqual(['do:a']);
  });

  it('undoes and redoes in order', () => {
    const log: string[] = [];
    const stack = new CommandStack();
    stack.push(counterCommand(log, 'a'));
    stack.push(counterCommand(log, 'b'));
    stack.undo();
    stack.undo();
    stack.redo();
    expect(log).toEqual(['do:a', 'do:b', 'undo:b', 'undo:a', 'do:a']);
  });

  it('reports what is available', () => {
    const stack = new CommandStack();
    expect(stack.canUndo).toBe(false);
    expect(stack.canRedo).toBe(false);
    stack.push(counterCommand([], 'a'));
    expect(stack.canUndo).toBe(true);
    stack.undo();
    expect(stack.canRedo).toBe(true);
  });

  it('ignores undo and redo when the stack is empty', () => {
    const stack = new CommandStack();
    expect(() => { stack.undo(); stack.redo(); }).not.toThrow();
  });

  it('drops the redo branch once a new command is pushed', () => {
    const log: string[] = [];
    const stack = new CommandStack();
    stack.push(counterCommand(log, 'a'));
    stack.undo();
    stack.push(counterCommand(log, 'b'));
    stack.redo();
    expect(log).toEqual(['do:a', 'undo:a', 'do:b']);
    expect(stack.canRedo).toBe(false);
  });

  it('merges a command into the previous one when merge returns true', () => {
    const stack = new CommandStack();
    const merge = vi.fn(() => true);
    stack.push({ label: 'drag', do: () => undefined, undo: () => undefined, merge });
    stack.push({ label: 'drag', do: () => undefined, undo: () => undefined });
    expect(merge).toHaveBeenCalledTimes(1);
    expect(stack.depth).toBe(1);
  });

  it('keeps commands separate when merge declines', () => {
    const stack = new CommandStack();
    stack.push({ label: 'a', do: () => undefined, undo: () => undefined, merge: () => false });
    stack.push({ label: 'b', do: () => undefined, undo: () => undefined });
    expect(stack.depth).toBe(2);
  });

  it('caps the stack at its maximum depth', () => {
    const stack = new CommandStack(3);
    for (const label of ['a', 'b', 'c', 'd']) stack.push(counterCommand([], label));
    expect(stack.depth).toBe(3);
  });

  it('clears both stacks', () => {
    const stack = new CommandStack();
    stack.push(counterCommand([], 'a'));
    stack.clear();
    expect(stack.canUndo).toBe(false);
    expect(stack.depth).toBe(0);
  });

  it('exposes the label of the next undo step', () => {
    const stack = new CommandStack();
    stack.push(counterCommand([], 'Add arrow'));
    expect(stack.undoLabel).toBe('Add arrow');
    stack.undo();
    expect(stack.undoLabel).toBeUndefined();
    expect(stack.redoLabel).toBe('Add arrow');
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm exec vitest run test/unit/editor-command-stack.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
export interface Command {
  label: string;
  do(): void;
  undo(): void;
  /** Return true to absorb `next` into this command instead of stacking it. */
  merge?(next: Command): boolean;
}

export class CommandStack {
  private readonly undoStack: Command[] = [];
  private readonly redoStack: Command[] = [];

  constructor(private readonly max = 200) {}

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }
  get depth(): number { return this.undoStack.length; }
  get undoLabel(): string | undefined { return this.undoStack.at(-1)?.label; }
  get redoLabel(): string | undefined { return this.redoStack.at(-1)?.label; }

  push(command: Command): void {
    command.do();
    this.redoStack.length = 0;
    const previous = this.undoStack.at(-1);
    if (previous?.merge?.(command)) return;
    this.undoStack.push(command);
    if (this.undoStack.length > this.max) this.undoStack.shift();
  }

  undo(): void {
    const command = this.undoStack.pop();
    if (!command) return;
    command.undo();
    this.redoStack.push(command);
  }

  redo(): void {
    const command = this.redoStack.pop();
    if (!command) return;
    command.do();
    this.undoStack.push(command);
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm exec vitest run test/unit/editor-command-stack.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/editor/command-stack.ts test/unit/editor-command-stack.test.ts
git commit -m "feat(editor): add undo/redo command stack"
```

---

### Task 4: Editor document model

**Files:**
- Create: `src/lib/editor/document.ts`
- Test: `test/unit/editor-document.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { createAnnotation } from '../../src/lib/editor/annotation';
import { addLayer, createDocument, moveLayer, nextMarkerNumber, removeLayer, updateLayer } from '../../src/lib/editor/document';
import type { BlobRef } from '../../src/shared/types/primitives';

const ref: BlobRef = { store: 'idb', key: 'blob-1', mime: 'image/png', bytes: 10 };
const size = { width: 800, height: 1200 };
const rect = { x: 0, y: 0, width: 10, height: 10 };

function doc() {
  return createDocument({ captureId: 'capture-1', base: { ref, size }, now: '2026-09-08T00:00:00.000Z' });
}

describe('editor document', () => {
  it('creates an empty version 1 document sized to the base image', () => {
    expect(doc()).toMatchObject({ version: 1, captureId: 'capture-1', canvas: { size, rotation: 0, scale: 1 }, layers: [] });
  });

  it('appends a layer without mutating the original document', () => {
    const original = doc();
    const next = addLayer(original, createAnnotation('rect', rect, { id: 'a1' }));
    expect(next.layers).toHaveLength(1);
    expect(original.layers).toHaveLength(0);
  });

  it('patches an existing layer by id', () => {
    const next = updateLayer(addLayer(doc(), createAnnotation('rect', rect, { id: 'a1' })), 'a1', { opacity: 0.5 });
    expect(next.layers[0]).toMatchObject({ id: 'a1', opacity: 0.5 });
  });

  it('leaves the document alone when patching an unknown id', () => {
    const before = addLayer(doc(), createAnnotation('rect', rect, { id: 'a1' }));
    expect(updateLayer(before, 'missing', { opacity: 0.2 }).layers).toEqual(before.layers);
  });

  it('removes a layer by id', () => {
    const next = removeLayer(addLayer(doc(), createAnnotation('rect', rect, { id: 'a1' })), 'a1');
    expect(next.layers).toHaveLength(0);
  });

  it('reorders a layer to a new index', () => {
    let next = doc();
    for (const id of ['a', 'b', 'c']) next = addLayer(next, createAnnotation('rect', rect, { id }));
    expect(moveLayer(next, 'a', 2).layers.map((layer) => layer.id)).toEqual(['b', 'c', 'a']);
  });

  it('numbers the first marker 1 and later markers one above the highest', () => {
    expect(nextMarkerNumber([])).toBe(1);
    const withMarkers = [createAnnotation('marker', rect, { id: 'm1', number: 1 }), createAnnotation('marker', rect, { id: 'm2', number: 7 })];
    expect(nextMarkerNumber(withMarkers)).toBe(8);
  });

  it('refreshes updatedAt whenever layers change', () => {
    const next = addLayer(doc(), createAnnotation('rect', rect, { id: 'a1' }), '2026-09-09T00:00:00.000Z');
    expect(next.updatedAt).toBe('2026-09-09T00:00:00.000Z');
  });

  it('reports pending redactions', () => {
    const withRedact = addLayer(doc(), createAnnotation('redact', rect, { id: 'r1' }));
    expect(withRedact.layers.filter((layer) => layer.type === 'redact')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm exec vitest run test/unit/editor-document.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { nowIso } from '../../shared/ids';
import type { Annotation, EditorDocument } from '../../shared/types/editor';
import type { BlobRef, Size } from '../../shared/types/primitives';

export interface CreateDocumentInput {
  captureId: string;
  base: { ref: BlobRef; size: Size };
  now?: string;
  background?: string;
}

export function createDocument({ captureId, base, now = nowIso(), background = '#ffffff' }: CreateDocumentInput): EditorDocument {
  return {
    version: 1,
    captureId,
    base,
    canvas: { size: base.size, background, rotation: 0, scale: 1 },
    layers: [],
    history: { undo: 0, redo: 0 },
    updatedAt: now,
  };
}

function withLayers(doc: EditorDocument, layers: Annotation[], now: string): EditorDocument {
  return { ...doc, layers, updatedAt: now };
}

export function addLayer(doc: EditorDocument, annotation: Annotation, now = nowIso()): EditorDocument {
  return withLayers(doc, [...doc.layers, annotation], now);
}

export function updateLayer(doc: EditorDocument, id: string, patch: Partial<Annotation>, now = nowIso()): EditorDocument {
  if (!doc.layers.some((layer) => layer.id === id)) return doc;
  return withLayers(doc, doc.layers.map((layer) => layer.id === id ? { ...layer, ...patch } as Annotation : layer), now);
}

export function removeLayer(doc: EditorDocument, id: string, now = nowIso()): EditorDocument {
  return withLayers(doc, doc.layers.filter((layer) => layer.id !== id), now);
}

export function moveLayer(doc: EditorDocument, id: string, toIndex: number, now = nowIso()): EditorDocument {
  const from = doc.layers.findIndex((layer) => layer.id === id);
  if (from < 0) return doc;
  const layers = [...doc.layers];
  const [moved] = layers.splice(from, 1);
  if (moved) layers.splice(Math.max(0, Math.min(layers.length, toIndex)), 0, moved);
  return withLayers(doc, layers, now);
}

/** Markers auto-increment from the highest existing number; deleting one never renumbers the rest. */
export function nextMarkerNumber(layers: readonly Annotation[]): number {
  return layers.reduce((highest, layer) => layer.type === 'marker' ? Math.max(highest, layer.number) : highest, 0) + 1;
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm exec vitest run test/unit/editor-document.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/editor/document.ts test/unit/editor-document.test.ts
git commit -m "feat(editor): add immutable editor document model"
```

---

### Task 5: Flatten renderer (privacy-critical)

**Files:**
- Create: `src/lib/editor/flatten.ts`
- Test: `test/unit/editor-flatten.test.ts`

This is the code that burns annotations into exported pixels. `redact` **must** paint fully opaque — that is the privacy guarantee in `05-editor.md §5.2`. The function takes a `CanvasRenderingContext2D`-shaped object so it can be unit-tested with a fake in the `node` environment and reused with a real `OffscreenCanvas` in the browser.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest';
import { createAnnotation } from '../../src/lib/editor/annotation';
import { drawAnnotations, type FlattenContext } from '../../src/lib/editor/flatten';

function fakeContext() {
  const calls: string[] = [];
  const context = {
    calls,
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    lineCap: 'butt',
    font: '',
    textAlign: 'left',
    filter: 'none',
    imageSmoothingEnabled: true,
    save: () => calls.push('save'),
    restore: () => calls.push('restore'),
    beginPath: () => calls.push('beginPath'),
    closePath: () => calls.push('closePath'),
    moveTo: () => calls.push('moveTo'),
    lineTo: () => calls.push('lineTo'),
    stroke: () => calls.push('stroke'),
    fill: () => calls.push('fill'),
    fillRect: (...args: number[]) => calls.push(`fillRect:${args.join(',')}`),
    strokeRect: () => calls.push('strokeRect'),
    ellipse: () => calls.push('ellipse'),
    fillText: () => calls.push('fillText'),
    translate: () => calls.push('translate'),
    rotate: () => calls.push('rotate'),
    drawImage: () => calls.push('drawImage'),
  };
  return context as unknown as FlattenContext & { calls: string[] };
}

const rect = { x: 10, y: 20, width: 100, height: 50 };

describe('flatten renderer', () => {
  it('paints redaction fully opaque even when the annotation is translucent', () => {
    const context = fakeContext();
    const redact = { ...createAnnotation('redact', rect, { id: 'r1' }), opacity: 0.1 };
    drawAnnotations(context, [redact]);
    expect(context.calls).toContain('fillRect:10,20,100,50');
    expect(context.globalAlpha).toBe(1);
  });

  it('draws a rectangle outline', () => {
    const context = fakeContext();
    drawAnnotations(context, [createAnnotation('rect', rect, { id: 'a1' })]);
    expect(context.calls).toContain('strokeRect');
  });

  it('fills a highlight rather than stroking it', () => {
    const context = fakeContext();
    drawAnnotations(context, [createAnnotation('highlight', rect, { id: 'h1' })]);
    expect(context.calls).toContain('fillRect:10,20,100,50');
  });

  it('draws an ellipse for ellipse annotations', () => {
    const context = fakeContext();
    drawAnnotations(context, [createAnnotation('ellipse', rect, { id: 'e1' })]);
    expect(context.calls).toContain('ellipse');
  });

  it('strokes a line between the endpoints of a line annotation', () => {
    const context = fakeContext();
    drawAnnotations(context, [createAnnotation('line', rect, { id: 'l1' })]);
    expect(context.calls.filter((call) => call === 'lineTo').length).toBeGreaterThan(0);
    expect(context.calls).toContain('stroke');
  });

  it('draws an arrow head in addition to the shaft', () => {
    const context = fakeContext();
    drawAnnotations(context, [createAnnotation('arrow', rect, { id: 'a2' })]);
    expect(context.calls).toContain('fill');
  });

  it('draws freehand paths through every collected point', () => {
    const context = fakeContext();
    const freehand = createAnnotation('freehand', rect, { id: 'f1' });
    drawAnnotations(context, [{ ...freehand, type: 'freehand', points: [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 9, y: 2 }] } as typeof freehand]);
    expect(context.calls.filter((call) => call === 'lineTo')).toHaveLength(2);
  });

  it('renders text annotations', () => {
    const context = fakeContext();
    const text = createAnnotation('text', rect, { id: 't1', text: 'Merhaba' });
    drawAnnotations(context, [text]);
    expect(context.calls).toContain('fillText');
  });

  it('skips annotations that are hidden', () => {
    const context = fakeContext();
    drawAnnotations(context, [{ ...createAnnotation('rect', rect, { id: 'a3' }), visible: false }]);
    expect(context.calls).not.toContain('strokeRect');
  });

  it('draws layers in array order so later layers land on top', () => {
    const context = fakeContext();
    drawAnnotations(context, [createAnnotation('highlight', rect, { id: 'h2' }), createAnnotation('redact', rect, { id: 'r2' })]);
    expect(context.calls.filter((call) => call.startsWith('fillRect'))).toHaveLength(2);
  });

  it('restores the context state for every annotation it draws', () => {
    const context = fakeContext();
    drawAnnotations(context, [createAnnotation('rect', rect, { id: 'a4' }), createAnnotation('ellipse', rect, { id: 'e2' })]);
    expect(context.calls.filter((call) => call === 'save')).toHaveLength(2);
    expect(context.calls.filter((call) => call === 'restore')).toHaveLength(2);
  });

  it('applies rotation around the annotation center when set', () => {
    const context = fakeContext();
    drawAnnotations(context, [{ ...createAnnotation('rect', rect, { id: 'a5' }), rotationDeg: 45 }]);
    expect(context.calls).toContain('rotate');
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm exec vitest run test/unit/editor-flatten.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import type { Annotation } from '../../shared/types/editor';
import type { Rect } from '../../shared/types/primitives';

/** The subset of CanvasRenderingContext2D the flatten pass uses. */
export interface FlattenContext {
  globalAlpha: number;
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  lineCap: CanvasLineCap;
  font: string;
  textAlign: CanvasTextAlign;
  save(): void;
  restore(): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  fill(): void;
  fillRect(x: number, y: number, width: number, height: number): void;
  strokeRect(x: number, y: number, width: number, height: number): void;
  ellipse(x: number, y: number, radiusX: number, radiusY: number, rotation: number, start: number, end: number): void;
  fillText(text: string, x: number, y: number): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
}

function centerOf(rect: Rect): { x: number; y: number } {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function applyTransform(context: FlattenContext, annotation: Annotation): void {
  if (!annotation.rotationDeg) return;
  const center = centerOf(annotation.rect);
  context.translate(center.x, center.y);
  context.rotate((annotation.rotationDeg * Math.PI) / 180);
  context.translate(-center.x, -center.y);
}

function drawArrowHead(context: FlattenContext, from: { x: number; y: number }, to: { x: number; y: number }, size: number): void {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const spread = Math.PI / 7;
  context.beginPath();
  context.moveTo(to.x, to.y);
  context.lineTo(to.x - size * Math.cos(angle - spread), to.y - size * Math.sin(angle - spread));
  context.lineTo(to.x - size * Math.cos(angle + spread), to.y - size * Math.sin(angle + spread));
  context.closePath();
  context.fill();
}

function drawOne(context: FlattenContext, annotation: Annotation): void {
  const { rect, style } = annotation;
  context.strokeStyle = style.stroke;
  context.lineWidth = style.strokeWidth;
  context.lineCap = style.lineCap ?? 'butt';
  if (style.fill !== 'none') context.fillStyle = style.fill;

  switch (annotation.type) {
    case 'redact':
      // Privacy guarantee: redaction is always fully opaque, whatever the layer opacity says.
      context.globalAlpha = 1;
      context.fillStyle = annotation.color;
      context.fillRect(rect.x, rect.y, rect.width, rect.height);
      return;
    case 'highlight':
      context.fillRect(rect.x, rect.y, rect.width, rect.height);
      return;
    case 'rect':
      if (style.fill !== 'none') context.fillRect(rect.x, rect.y, rect.width, rect.height);
      context.strokeRect(rect.x, rect.y, rect.width, rect.height);
      return;
    case 'ellipse': {
      const center = centerOf(rect);
      context.beginPath();
      context.ellipse(center.x, center.y, rect.width / 2, rect.height / 2, 0, 0, Math.PI * 2);
      if (style.fill !== 'none') context.fill();
      context.stroke();
      return;
    }
    case 'line':
    case 'arrow':
      context.beginPath();
      context.moveTo(annotation.from.x, annotation.from.y);
      context.lineTo(annotation.to.x, annotation.to.y);
      context.stroke();
      if (annotation.type === 'arrow' && style.arrowHead !== 'none') {
        context.fillStyle = style.stroke;
        drawArrowHead(context, annotation.from, annotation.to, style.arrowHeadSize ?? style.strokeWidth * 3);
      }
      return;
    case 'freehand': {
      const [first, ...rest] = annotation.points;
      if (!first) return;
      context.beginPath();
      context.moveTo(first.x, first.y);
      for (const point of rest) context.lineTo(point.x, point.y);
      context.stroke();
      return;
    }
    case 'text':
      context.fillStyle = style.fill === 'none' ? '#111111' : style.fill;
      context.font = `${style.fontWeight ?? 400} ${style.fontSizePx ?? 24}px ${style.fontFamily ?? 'Inter'}`;
      context.textAlign = style.textAlign ?? 'left';
      context.fillText(annotation.text, rect.x, rect.y + (style.fontSizePx ?? 24));
      return;
    case 'marker': {
      const center = centerOf(rect);
      context.fillStyle = style.fill === 'none' ? '#FF3B30' : style.fill;
      context.beginPath();
      context.ellipse(center.x, center.y, rect.width / 2, rect.height / 2, 0, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = '#FFFFFF';
      context.font = `${style.fontWeight ?? 600} ${style.fontSizePx ?? 16}px ${style.fontFamily ?? 'Inter'}`;
      context.textAlign = 'center';
      context.fillText(String(annotation.number), center.x, center.y + (style.fontSizePx ?? 16) / 3);
      return;
    }
    default:
      return;
  }
}

/**
 * Draws every visible annotation onto `context` in array order. Blur and pixelate
 * are handled by the caller because they need to sample the base image first.
 */
export function drawAnnotations(context: FlattenContext, layers: readonly Annotation[]): void {
  for (const annotation of layers) {
    if (!annotation.visible) continue;
    context.save();
    context.globalAlpha = annotation.opacity;
    applyTransform(context, annotation);
    drawOne(context, annotation);
    context.restore();
  }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm exec vitest run test/unit/editor-flatten.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Check coverage of the whole lib**

Run: `pnpm test:coverage`
Expected: PASS with no threshold error for `src/lib/editor/**`. If a branch is uncovered, add a test for it — do not lower the threshold.

- [ ] **Step 6: Commit**

```bash
git add src/lib/editor/flatten.ts test/unit/editor-flatten.test.ts
git commit -m "feat(editor): add annotation flatten renderer with opaque redaction"
```

---

### Task 6: History service — replace edited file and widen the patch type

**Files:**
- Modify: `src/background/history/service.ts:40-53`
- Modify: `src/shared/types/history.ts:9`
- Test: `test/unit/history.test.ts` (append to the existing suite)

Problem: `addFile` is append-only, so saving twice leaves two `role:'edited'` files and leaks the old blob. `CaptureRecordPatch` also lacks `thumbnail` and `files`, so the thumbnail cannot be refreshed after an edit.

- [ ] **Step 1: Write the failing test** (append inside the existing top-level `describe` in `test/unit/history.test.ts`)

```ts
  it('replaces an existing edited file instead of appending a second one', async () => {
    const service = createHistoryService();
    const base = { store: 'idb', key: 'blob-1', mime: 'image/png', bytes: 3 } as const;
    await service.put({ ...baseRecord, id: 'capture-edit', files: [{ id: 'f1', role: 'full', ref: base, format: 'png', createdAt: '2026-09-08T00:00:00.000Z' }] });

    await service.replaceFile('capture-edit', { id: 'e1', role: 'edited', ref: { ...base, key: 'blob-2' }, format: 'png', createdAt: '2026-09-08T00:00:01.000Z' });
    await service.replaceFile('capture-edit', { id: 'e2', role: 'edited', ref: { ...base, key: 'blob-3' }, format: 'png', createdAt: '2026-09-08T00:00:02.000Z' });

    const record = await service.get('capture-edit');
    const edited = record?.files.filter((file) => file.role === 'edited') ?? [];
    expect(edited).toHaveLength(1);
    expect(edited[0]?.ref.key).toBe('blob-3');
    expect(record?.files.some((file) => file.role === 'full')).toBe(true);
  });

  it('updates the thumbnail through a record patch', async () => {
    const service = createHistoryService();
    await service.put({ ...baseRecord, id: 'capture-thumb' });
    const next = await service.update('capture-thumb', { thumbnail: { store: 'idb', key: 'thumb-2', mime: 'image/webp', bytes: 9 } });
    expect(next.thumbnail.key).toBe('thumb-2');
  });
```

If the existing suite has no reusable `baseRecord`, define one at the top of the file matching the shape used by the other tests in that file.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm exec vitest run test/unit/history.test.ts`
Expected: FAIL — `service.replaceFile is not a function`.

- [ ] **Step 3: Widen the patch type** in `src/shared/types/history.ts:9`

```ts
export interface CaptureRecordPatch { title?: string; tags?: string[]; folderId?: Id; notes?: string; starred?: boolean; thumbnail?: BlobRef; files?: CaptureFile[]; }
```

Confirm `BlobRef` is already imported in that file; if not, add it to the existing import from `./primitives`.

- [ ] **Step 4: Add `replaceFile`** to `src/background/history/service.ts`, directly after the existing `addFile` definition (which ends at line 53)

```ts
  const replaceFile = async (id: string, file: CaptureFile): Promise<CaptureRecord> => {
    const record = await db.captures.get(id);
    if (!record) throw new Error(`Capture not found: ${id}`);
    const superseded = record.files.filter((existing) => existing.role === file.role);
    const next = { ...record, files: [...record.files.filter((existing) => existing.role !== file.role), file], updatedAt: new Date().toISOString() };
    await db.captures.put(next);
    // Drop the blobs that are no longer referenced by the record.
    for (const stale of superseded) await release(stale.ref).catch(() => undefined);
    return next;
  };
```

Add `replaceFile` to the object returned at the end of `createHistoryService()`, next to `addFile`. Import `release` from `../../shared/db/blob-ref` — check the existing import block first and extend it rather than adding a duplicate import line.

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `pnpm exec vitest run test/unit/history.test.ts`
Expected: PASS, including the two new tests.

- [ ] **Step 6: Commit**

```bash
git add src/background/history/service.ts src/shared/types/history.ts test/unit/history.test.ts
git commit -m "feat(history): replace edited files in place and allow thumbnail patches"
```

---

### Task 7: Editor message contracts

**Files:**
- Modify: `src/shared/types/messages.ts:21-41`
- Modify: `src/background/index.ts` (switch at line 324)
- Test: `test/unit/editor-messages.test.ts`

Two messages: `editor.save` persists a flattened image plus its document; `editor.load` returns a stored document.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import type { MsgMap } from '../../src/shared/types/messages';

describe('editor message contracts', () => {
  it('declares editor.save and editor.load in the message map', () => {
    const save: keyof MsgMap = 'editor.save';
    const load: keyof MsgMap = 'editor.load';
    expect([save, load]).toEqual(['editor.save', 'editor.load']);
  });

  it('types editor.save to return the capture id it wrote', () => {
    const response: MsgMap['editor.save']['res'] = { captureId: 'capture-1', createdNewRecord: false };
    expect(response.captureId).toBe('capture-1');
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm exec vitest run test/unit/editor-messages.test.ts`
Expected: FAIL — type error, `'editor.save'` is not assignable to `keyof MsgMap`.

- [ ] **Step 3: Add the contracts** to `src/shared/types/messages.ts`, inside `MsgMap` after the `history.get` line

```ts
  'editor.save': { req: { captureId: Id; doc: EditorDocument; flattened: { dataUrl: string; mime: string }; saveAsNew: boolean }; res: { captureId: Id; createdNewRecord: boolean } };
  'editor.load': { req: { captureId: Id }; res: EditorDocument | null };
```

Add `import type { EditorDocument } from './editor';` to the imports at the top of the file.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm exec vitest run test/unit/editor-messages.test.ts && pnpm typecheck`
Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/types/messages.ts test/unit/editor-messages.test.ts
git commit -m "feat(editor): declare editor.save and editor.load message contracts"
```

---

### Task 8: Editor persistence service

**Files:**
- Create: `src/background/editor/service.ts`
- Modify: `src/background/index.ts`
- Test: `test/unit/editor-service.test.ts`

Behaviour, from `05-editor.md §13`: with `keepOriginalsAfterEdit` enabled (the default) the first save clones the record and sets `source.editedFrom`; the original is never modified. Later saves to the clone replace its edited file in place.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest';
import { createEditorService } from '../../src/background/editor/service';
import type { CaptureRecord } from '../../src/shared/types/history';
import type { EditorDocument } from '../../src/shared/types/editor';

const ref = { store: 'idb', key: 'blob-1', mime: 'image/png', bytes: 3 } as const;

function record(id: string, overrides: Partial<CaptureRecord> = {}): CaptureRecord {
  return {
    id, createdAt: '2026-09-08T00:00:00.000Z', updatedAt: '2026-09-08T00:00:00.000Z',
    url: 'https://example.com/', domain: 'example.com', title: 'Example', mode: 'fullPage', backend: 'visibleTab',
    request: {} as CaptureRecord['request'], size: { width: 800, height: 600 }, cssSize: { width: 800, height: 600 },
    dpr: 1, zoom: 1, viewport: { width: 800, height: 600 },
    files: [{ id: 'f1', role: 'full', ref, format: 'png', createdAt: '2026-09-08T00:00:00.000Z' }],
    thumbnail: { store: 'idb', key: 'thumb-1', mime: 'image/webp', bytes: 3 },
    tags: [], starred: false, warnings: [], durationMs: 10, appVersion: '0.1.0', source: { trigger: 'popup' },
    ...overrides,
  };
}

function doc(captureId: string): EditorDocument {
  return { version: 1, captureId, base: { ref, size: { width: 800, height: 600 } }, canvas: { size: { width: 800, height: 600 }, background: '#fff', rotation: 0, scale: 1 }, layers: [], history: { undo: 0, redo: 0 }, updatedAt: '2026-09-08T00:00:00.000Z' };
}

function deps(overrides: Record<string, unknown> = {}) {
  const records = new Map<string, CaptureRecord>([['capture-1', record('capture-1')]]);
  const docs = new Map<string, EditorDocument>();
  return {
    records,
    docs,
    history: {
      get: vi.fn(async (id: string) => records.get(id)),
      put: vi.fn(async (next: CaptureRecord) => { records.set(next.id, next); return next; }),
      replaceFile: vi.fn(async (id: string, file) => { const found = records.get(id)!; const next = { ...found, files: [...found.files.filter((existing) => existing.role !== file.role), file] }; records.set(id, next); return next; }),
      update: vi.fn(async (id: string, patch) => { const next = { ...records.get(id)!, ...patch }; records.set(id, next); return next; }),
    },
    putBlob: vi.fn(async () => ({ ...ref, key: 'blob-edited' })),
    saveDoc: vi.fn(async (next: EditorDocument) => { docs.set(next.captureId, next); }),
    loadDoc: vi.fn(async (id: string) => docs.get(id) ?? null),
    makeThumbnail: vi.fn(async () => ({ ...ref, key: 'thumb-new', mime: 'image/webp' })),
    createId: vi.fn(() => 'capture-2'),
    now: () => '2026-09-09T00:00:00.000Z',
    ...overrides,
  };
}

const flattened = { dataUrl: 'data:image/png;base64,AAAA', mime: 'image/png' };

describe('editor service', () => {
  it('clones the record and links editedFrom when saving as new', async () => {
    const dependencies = deps();
    const service = createEditorService(dependencies as never);
    const result = await service.save({ captureId: 'capture-1', doc: doc('capture-1'), flattened, saveAsNew: true });

    expect(result).toEqual({ captureId: 'capture-2', createdNewRecord: true });
    expect(dependencies.records.get('capture-2')?.source.editedFrom).toBe('capture-1');
    expect(dependencies.records.get('capture-1')?.files.some((file) => file.role === 'edited')).toBe(false);
  });

  it('writes the edited file onto the same record when not saving as new', async () => {
    const dependencies = deps();
    const service = createEditorService(dependencies as never);
    const result = await service.save({ captureId: 'capture-1', doc: doc('capture-1'), flattened, saveAsNew: false });

    expect(result).toEqual({ captureId: 'capture-1', createdNewRecord: false });
    expect(dependencies.history.replaceFile).toHaveBeenCalledWith('capture-1', expect.objectContaining({ role: 'edited' }));
  });

  it('stores the document under the record it belongs to', async () => {
    const dependencies = deps();
    const service = createEditorService(dependencies as never);
    await service.save({ captureId: 'capture-1', doc: doc('capture-1'), flattened, saveAsNew: true });
    expect(dependencies.docs.get('capture-2')?.captureId).toBe('capture-2');
  });

  it('refreshes the thumbnail from the flattened image', async () => {
    const dependencies = deps();
    const service = createEditorService(dependencies as never);
    await service.save({ captureId: 'capture-1', doc: doc('capture-1'), flattened, saveAsNew: false });
    expect(dependencies.makeThumbnail).toHaveBeenCalled();
    expect(dependencies.records.get('capture-1')?.thumbnail.key).toBe('thumb-new');
  });

  it('rejects a save for a capture that does not exist', async () => {
    const service = createEditorService(deps() as never);
    await expect(service.save({ captureId: 'missing', doc: doc('missing'), flattened, saveAsNew: false })).rejects.toThrow('Capture not found');
  });

  it('returns a stored document and null when there is none', async () => {
    const dependencies = deps();
    const service = createEditorService(dependencies as never);
    expect(await service.load('capture-1')).toBeNull();
    await service.save({ captureId: 'capture-1', doc: doc('capture-1'), flattened, saveAsNew: false });
    expect(await service.load('capture-1')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm exec vitest run test/unit/editor-service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { dataUrlToBlob } from '../capture/image';
import { createId as defaultCreateId, nowIso } from '../../shared/ids';
import { putBlob as defaultPutBlob } from '../../shared/db/blob-ref';
import { db } from '../../shared/db/schema';
import type { EditorDocument } from '../../shared/types/editor';
import type { BlobRef } from '../../shared/types/primitives';
import type { CaptureFile, CaptureRecord, CaptureRecordPatch } from '../../shared/types/history';

export interface EditorSaveInput {
  captureId: string;
  doc: EditorDocument;
  flattened: { dataUrl: string; mime: string };
  saveAsNew: boolean;
}

export interface EditorServiceDependencies {
  history: {
    get(id: string): Promise<CaptureRecord | undefined>;
    put(record: CaptureRecord): Promise<CaptureRecord>;
    replaceFile(id: string, file: CaptureFile): Promise<CaptureRecord>;
    update(id: string, patch: CaptureRecordPatch): Promise<CaptureRecord>;
  };
  putBlob?: (blob: Blob) => Promise<BlobRef>;
  saveDoc?: (doc: EditorDocument) => Promise<void>;
  loadDoc?: (captureId: string) => Promise<EditorDocument | null>;
  makeThumbnail?: (blob: Blob) => Promise<BlobRef | undefined>;
  createId?: () => string;
  now?: () => string;
}

export function createEditorService({
  history,
  putBlob = defaultPutBlob,
  saveDoc = async (doc) => { await db.editorDocs.put(doc); },
  loadDoc = async (captureId) => (await db.editorDocs.get(captureId)) ?? null,
  makeThumbnail = async () => undefined,
  createId = defaultCreateId,
  now = nowIso,
}: EditorServiceDependencies) {
  return {
    async save({ captureId, doc, flattened, saveAsNew }: EditorSaveInput): Promise<{ captureId: string; createdNewRecord: boolean }> {
      const record = await history.get(captureId);
      if (!record) throw new Error(`Capture not found: ${captureId}`);

      const blob = dataUrlToBlob(flattened.dataUrl);
      const ref = await putBlob(blob);
      const timestamp = now();
      const editedFile: CaptureFile = { id: `edited-${createId()}`, role: 'edited', ref, format: 'png', createdAt: timestamp };
      const thumbnail = await makeThumbnail(blob);

      if (saveAsNew) {
        const cloneId = createId();
        const clone: CaptureRecord = {
          ...structuredClone(record),
          id: cloneId,
          createdAt: timestamp,
          updatedAt: timestamp,
          files: [...record.files.filter((file) => file.role !== 'edited'), editedFile],
          thumbnail: thumbnail ?? record.thumbnail,
          source: { ...record.source, editedFrom: record.id },
        };
        await history.put(clone);
        await saveDoc({ ...doc, captureId: cloneId, updatedAt: timestamp });
        return { captureId: cloneId, createdNewRecord: true };
      }

      await history.replaceFile(captureId, editedFile);
      if (thumbnail) await history.update(captureId, { thumbnail });
      await saveDoc({ ...doc, captureId, updatedAt: timestamp });
      return { captureId, createdNewRecord: false };
    },

    async load(captureId: string): Promise<EditorDocument | null> {
      return loadDoc(captureId);
    },
  };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm exec vitest run test/unit/editor-service.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Wire the messages** into `src/background/index.ts`

Near the other service constructions (after `createExportPipeline`, around line 47) add:

```ts
const editorService = createEditorService({ history: historyService });
```

Import it at the top: `import { createEditorService } from './editor/service';`

Inside the `switch (message.type)` block (line 324), next to `case 'history.get'`, add:

```ts
        case 'editor.save': {
          const payload = message.payload as MessageMap['editor.save']['req'];
          sendResponse(reply(message, await editorService.save(payload)));
          return;
        }
        case 'editor.load': {
          const payload = message.payload as MessageMap['editor.load']['req'];
          sendResponse(reply(message, await editorService.load(payload.captureId)));
          return;
        }
```

`historyService` must expose `replaceFile` — that came from Task 6. Confirm with `grep -n "replaceFile" src/background/history/service.ts`.

- [ ] **Step 6: Verify the whole suite and types**

Run: `pnpm test && pnpm typecheck`
Expected: both PASS.

- [ ] **Step 7: Commit**

```bash
git add src/background/editor/service.ts src/background/index.ts test/unit/editor-service.test.ts
git commit -m "feat(editor): persist edited captures and editor documents"
```

---

### Task 9: Fix strip export precedence

**Files:**
- Modify: `src/background/export/pipeline.ts:39-51`
- Test: `test/unit/export-pipeline.test.ts` (append)

Once an edited file exists, `sourceFile()` returns it even when the caller asked for a specific strip. A requested strip must win.

- [ ] **Step 1: Write the failing test** (append inside the existing `describe` in `test/unit/export-pipeline.test.ts`, following that file's existing setup helpers)

```ts
  it('returns the requested strip even when an edited file exists', async () => {
    const stripRef = { store: 'idb', key: 'strip-1', mime: 'image/png', bytes: 5 } as const;
    const editedRef = { store: 'idb', key: 'edited-1', mime: 'image/png', bytes: 7 } as const;
    const resolve = vi.fn(async (ref: { key: string }) => new Blob([ref.key], { type: 'image/png' }));
    const record = {
      ...baseRecord,
      files: [
        { id: 'f1', role: 'full', ref: { store: 'idb', key: 'full-1', mime: 'image/png', bytes: 3 }, format: 'png', createdAt: '2026-09-08T00:00:00.000Z' },
        { id: 'f2', role: 'strip', index: 1, ref: stripRef, format: 'png', createdAt: '2026-09-08T00:00:00.000Z' },
        { id: 'f3', role: 'edited', ref: editedRef, format: 'png', createdAt: '2026-09-08T00:00:00.000Z' },
      ],
    };
    const pipeline = createExportPipeline({
      history: { get: async () => record, addFile: async () => record },
      resolve,
      encodeImage: async (source: Blob) => source,
      download: async () => 1,
    } as never);

    await pipeline.run({ captureId: record.id, stripIndex: 1, plan: { ...basePlan, targets: ['download'], format: 'png' } });
    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ key: 'strip-1' }));
  });
```

Reuse whatever `baseRecord` / `basePlan` fixtures that file already defines; if the names differ, adapt to them rather than duplicating fixtures.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm exec vitest run test/unit/export-pipeline.test.ts`
Expected: FAIL — resolve is called with `edited-1`.

- [ ] **Step 3: Fix the precedence** in `src/background/export/pipeline.ts`

```ts
function sourceFile(record: CaptureRecord, stripIndex?: number): CaptureFile {
  // An explicitly requested strip wins over the edited composite, which represents the whole capture.
  if (stripIndex !== undefined) {
    const strip = record.files.find((file) => file.role === 'strip' && file.index === stripIndex);
    if (strip) return strip;
  }
  const edited = record.files.find((file) => file.role === 'edited');
  if (edited) return edited;
  const full = record.files.find((file) => file.role === 'full');
  if (full) return full;
  const strip = record.files.find((file) => file.role === 'strip');
  if (strip) return strip;
  throw new Error('Capture has no exportable image file.');
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `pnpm exec vitest run test/unit/export-pipeline.test.ts`
Expected: PASS, including the pre-existing tests.

- [ ] **Step 5: Commit**

```bash
git add src/background/export/pipeline.ts test/unit/export-pipeline.test.ts
git commit -m "fix(export): prefer the requested strip over the edited composite"
```

---

### Task 10: Add Fabric.js and the editor core

**Files:**
- Modify: `package.json`
- Create: `src/editor/fabric-bridge.ts`
- Create: `src/editor/editor-core.ts`
- Create: `src/editor/index.ts`
- Test: `test/unit/editor-fabric-bridge.test.ts`

Fabric v6 uses **named ESM exports** (`import { Canvas, Rect } from 'fabric'`), not the v5 `fabric.*` namespace. The bridge module must stay free of side effects at import time so it can be unit-tested.

- [ ] **Step 1: Install Fabric**

```bash
pnpm add fabric@6
```

Confirm: `grep -n '"fabric"' package.json` shows a `6.x` entry under `dependencies`.

- [ ] **Step 2: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { createAnnotation } from '../../src/lib/editor/annotation';
import { toFabricOptions } from '../../src/editor/fabric-bridge';

const rect = { x: 10, y: 20, width: 100, height: 50 };

describe('fabric bridge', () => {
  it('maps annotation geometry onto fabric positioning options', () => {
    expect(toFabricOptions(createAnnotation('rect', rect, { id: 'a1' }))).toMatchObject({ left: 10, top: 20, width: 100, height: 50, angle: 0, opacity: 1 });
  });

  it('carries the stroke style across', () => {
    expect(toFabricOptions(createAnnotation('rect', rect, { id: 'a2' }))).toMatchObject({ stroke: '#FF3B30', strokeWidth: 3 });
  });

  it('maps a none fill to a transparent fabric fill', () => {
    expect(toFabricOptions(createAnnotation('rect', rect, { id: 'a3' })).fill).toBe('');
  });

  it('marks locked annotations as unselectable', () => {
    const locked = { ...createAnnotation('rect', rect, { id: 'a4' }), locked: true };
    expect(toFabricOptions(locked)).toMatchObject({ selectable: false, evented: false });
  });

  it('carries the annotation id so canvas objects can be traced back', () => {
    expect(toFabricOptions(createAnnotation('rect', rect, { id: 'a5' }))).toMatchObject({ ssxId: 'a5' });
  });

  it('passes the rotation through as an angle', () => {
    const rotated = { ...createAnnotation('rect', rect, { id: 'a6' }), rotationDeg: 30 };
    expect(toFabricOptions(rotated).angle).toBe(30);
  });
});
```

- [ ] **Step 3: Run the test and confirm it fails**

Run: `pnpm exec vitest run test/unit/editor-fabric-bridge.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the bridge** in `src/editor/fabric-bridge.ts`

```ts
import type { Annotation } from '../shared/types/editor';

export interface FabricOptions {
  ssxId: string;
  left: number;
  top: number;
  width: number;
  height: number;
  angle: number;
  opacity: number;
  stroke: string;
  strokeWidth: number;
  fill: string;
  selectable: boolean;
  evented: boolean;
  visible: boolean;
}

/** Translates an Annotation into the option bag a Fabric object constructor accepts. */
export function toFabricOptions(annotation: Annotation): FabricOptions {
  return {
    ssxId: annotation.id,
    left: annotation.rect.x,
    top: annotation.rect.y,
    width: annotation.rect.width,
    height: annotation.rect.height,
    angle: annotation.rotationDeg,
    opacity: annotation.opacity,
    stroke: annotation.style.stroke,
    strokeWidth: annotation.style.strokeWidth,
    fill: annotation.style.fill === 'none' ? '' : annotation.style.fill,
    selectable: !annotation.locked,
    evented: !annotation.locked,
    visible: annotation.visible,
  };
}
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `pnpm exec vitest run test/unit/editor-fabric-bridge.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Implement the editor core** in `src/editor/editor-core.ts`

The core owns the Fabric canvas and translates pointer drags into annotations. Keep every pure decision in `src/lib/editor/**` and call into it from here.

```ts
import { Canvas, Ellipse, FabricImage, IText, Line, Rect as FabricRect } from 'fabric';
import { createAnnotation } from '../lib/editor/annotation';
import { CommandStack } from '../lib/editor/command-stack';
import { addLayer, nextMarkerNumber, removeLayer } from '../lib/editor/document';
import { constrainRect, normalizeRect } from '../lib/editor/geometry';
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
}

const drawableTools = new Set<AnnotationType>(['rect', 'ellipse', 'line', 'arrow', 'highlight', 'blur', 'pixelate', 'redact', 'text', 'freehand', 'marker']);

export async function createEditorCore(canvasElement: HTMLCanvasElement, initial: EditorDocument, deps: EditorDeps = {}): Promise<EditorHandle> {
  const canvas = new Canvas(canvasElement, { selection: true, preserveObjectStacking: true, renderOnAddRemove: false });
  const stack = new CommandStack();
  let doc = initial;
  let tool: ToolId = 'select';
  let origin: { x: number; y: number } | null = null;

  // Keep the object URL so dispose() can revoke it; inlining it would leak for the page's lifetime.
  const objectUrl = await blobUrlFor(initial);
  const baseImage = await FabricImage.fromURL(objectUrl);
  baseImage.set({ selectable: false, evented: false, left: 0, top: 0 });
  canvas.backgroundImage = baseImage;
  canvas.setDimensions({ width: initial.canvas.size.width, height: initial.canvas.size.height });
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
    dispose() { void canvas.dispose(); URL.revokeObjectURL(objectUrl); },
  };
}

async function blobUrlFor(doc: EditorDocument): Promise<string> {
  const { resolveBlob } = await import('../shared/db/blob-ref');
  return URL.createObjectURL(await resolveBlob(doc.base.ref));
}
```

- [ ] **Step 7: Add the lazy entry point** in `src/editor/index.ts`

```ts
export type { EditorHandle } from './editor-core';

/** Loads the Fabric-backed editor on demand so it stays out of the result page's initial chunk. */
export async function createEditor(canvas: HTMLCanvasElement, doc: import('../shared/types/editor').EditorDocument, deps: import('./editor-core').EditorDeps = {}) {
  const { createEditorCore } = await import('./editor-core');
  return createEditorCore(canvas, doc, deps);
}
```

- [ ] **Step 8: Verify the build produces a separate Fabric chunk**

Run: `pnpm build`
Expected: build succeeds and the output lists a chunk containing Fabric separate from the result page entry. Confirm with:
```bash
ls dist/store/assets | head -20
```

- [ ] **Step 9: Commit**

```bash
git add package.json pnpm-lock.yaml src/editor test/unit/editor-fabric-bridge.test.ts
git commit -m "feat(editor): add Fabric.js editor core behind a lazy entry point"
```

---

### Task 11: Editor panel in the result page

**Files:**
- Create: `src/pages/result/editor-panel.tsx`
- Modify: `src/pages/result/main.tsx:185` and `:210`
- Modify: `src/pages/result/result.css`
- Modify: `public/_locales/en/messages.json`, `public/_locales/tr/messages.json`
- Test: `test/unit/editor-panel.test.ts`

- [ ] **Step 1: Add the i18n keys** to **both** locale files

English (`public/_locales/en/messages.json`):
```json
  "ui_editor_title": { "message": "Edit" },
  "ui_editor_done": { "message": "Done" },
  "ui_editor_cancel": { "message": "Cancel" },
  "ui_editor_save": { "message": "Save" },
  "ui_editor_saved": { "message": "Your edit was saved." },
  "ui_editor_saving": { "message": "Saving…" },
  "ui_editor_undo": { "message": "Undo" },
  "ui_editor_redo": { "message": "Redo" },
  "ui_editor_tool_select": { "message": "Select" },
  "ui_editor_tool_arrow": { "message": "Arrow" },
  "ui_editor_tool_rect": { "message": "Rectangle" },
  "ui_editor_tool_ellipse": { "message": "Ellipse" },
  "ui_editor_tool_line": { "message": "Line" },
  "ui_editor_tool_freehand": { "message": "Draw" },
  "ui_editor_tool_text": { "message": "Text" },
  "ui_editor_tool_highlight": { "message": "Highlight" },
  "ui_editor_tool_blur": { "message": "Blur" },
  "ui_editor_tool_pixelate": { "message": "Pixelate" },
  "ui_editor_tool_redact": { "message": "Redact" },
  "ui_editor_blurWarning": { "message": "Blur and pixelate can be reversed. Use Redact for sensitive data." },
  "ui_editor_redactWarning": { "message": "Redaction permanently removes the original pixels from this copy." },
  "ui_editor_keepOriginal": { "message": "The original capture is kept unchanged." },
```

Turkish (`public/_locales/tr/messages.json`), same keys:
```json
  "ui_editor_title": { "message": "Düzenle" },
  "ui_editor_done": { "message": "Bitti" },
  "ui_editor_cancel": { "message": "Vazgeç" },
  "ui_editor_save": { "message": "Kaydet" },
  "ui_editor_saved": { "message": "Düzenlemeniz kaydedildi." },
  "ui_editor_saving": { "message": "Kaydediliyor…" },
  "ui_editor_undo": { "message": "Geri al" },
  "ui_editor_redo": { "message": "İleri al" },
  "ui_editor_tool_select": { "message": "Seç" },
  "ui_editor_tool_arrow": { "message": "Ok" },
  "ui_editor_tool_rect": { "message": "Dikdörtgen" },
  "ui_editor_tool_ellipse": { "message": "Elips" },
  "ui_editor_tool_line": { "message": "Çizgi" },
  "ui_editor_tool_freehand": { "message": "Serbest çizim" },
  "ui_editor_tool_text": { "message": "Metin" },
  "ui_editor_tool_highlight": { "message": "Vurgula" },
  "ui_editor_tool_blur": { "message": "Bulanıklaştır" },
  "ui_editor_tool_pixelate": { "message": "Pikselleştir" },
  "ui_editor_tool_redact": { "message": "Karart" },
  "ui_editor_blurWarning": { "message": "Bulanıklaştırma geri alınabilir. Hassas veriler için Karart aracını kullanın." },
  "ui_editor_redactWarning": { "message": "Karartma, orijinal pikselleri bu kopyadan kalıcı olarak siler." },
  "ui_editor_keepOriginal": { "message": "Orijinal görüntü değiştirilmeden korunuyor." },
```

- [ ] **Step 2: Write the failing test**

```ts
// @vitest-environment happy-dom

import { h, render } from 'preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendMessage = vi.fn(async () => ({ captureId: 'capture-1', createdNewRecord: true }));
const editorHandle = {
  setTool: vi.fn(),
  undo: vi.fn(),
  redo: vi.fn(),
  canUndo: () => true,
  canRedo: () => false,
  getDocument: () => ({ version: 1, captureId: 'capture-1', layers: [] }),
  setZoom: vi.fn(),
  getZoom: () => 1,
  toDataUrl: () => 'data:image/png;base64,AAAA',
  dispose: vi.fn(),
};

vi.mock('../../src/shared/messages', () => ({ sendMessage }));
vi.mock('../../src/shared/i18n', () => ({ t: (key: string) => key }));
vi.mock('../../src/editor/index', () => ({ createEditor: vi.fn(async () => editorHandle) }));

const doc = { version: 1, captureId: 'capture-1', base: { ref: { store: 'idb', key: 'b1', mime: 'image/png', bytes: 3 }, size: { width: 400, height: 300 } }, canvas: { size: { width: 400, height: 300 }, background: '#fff', rotation: 0, scale: 1 }, layers: [], history: { undo: 0, redo: 0 }, updatedAt: '2026-09-08T00:00:00.000Z' };

describe('editor panel', () => {
  beforeEach(() => {
    document.body.innerHTML = '<main id="app"></main>';
    sendMessage.mockClear();
    editorHandle.setTool.mockClear();
  });

  it('renders a toolbar with the core tools', async () => {
    const { EditorPanel } = await import('../../src/pages/result/editor-panel');
    render(h(EditorPanel, { doc, captureId: 'capture-1', onClose: () => undefined }), document.getElementById('app')!);
    await vi.waitFor(() => expect(document.querySelector('[data-testid="editor-toolbar"]')).not.toBeNull());
    for (const tool of ['arrow', 'rect', 'text', 'blur', 'redact']) {
      expect(document.querySelector(`[data-tool="${tool}"]`)).not.toBeNull();
    }
  });

  it('activates the tool the user clicks', async () => {
    const { EditorPanel } = await import('../../src/pages/result/editor-panel');
    render(h(EditorPanel, { doc, captureId: 'capture-1', onClose: () => undefined }), document.getElementById('app')!);
    await vi.waitFor(() => expect(document.querySelector('[data-tool="arrow"]')).not.toBeNull());
    document.querySelector<HTMLButtonElement>('[data-tool="arrow"]')?.click();
    await vi.waitFor(() => expect(editorHandle.setTool).toHaveBeenCalledWith('arrow'));
  });

  it('warns that blur is reversible when the blur tool is selected', async () => {
    const { EditorPanel } = await import('../../src/pages/result/editor-panel');
    render(h(EditorPanel, { doc, captureId: 'capture-1', onClose: () => undefined }), document.getElementById('app')!);
    await vi.waitFor(() => expect(document.querySelector('[data-tool="blur"]')).not.toBeNull());
    document.querySelector<HTMLButtonElement>('[data-tool="blur"]')?.click();
    await vi.waitFor(() => expect(document.querySelector('[data-testid="editor-privacy-note"]')?.textContent).toContain('ui.editor.blurWarning'));
  });

  it('saves through the editor.save message', async () => {
    const { EditorPanel } = await import('../../src/pages/result/editor-panel');
    render(h(EditorPanel, { doc, captureId: 'capture-1', onClose: () => undefined }), document.getElementById('app')!);
    await vi.waitFor(() => expect(document.querySelector('[data-testid="editor-save"]')).not.toBeNull());
    document.querySelector<HTMLButtonElement>('[data-testid="editor-save"]')?.click();
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith('editor.save', expect.objectContaining({ captureId: 'capture-1' })));
  });

  it('disposes the editor when it unmounts', async () => {
    const { EditorPanel } = await import('../../src/pages/result/editor-panel');
    const host = document.getElementById('app')!;
    render(h(EditorPanel, { doc, captureId: 'capture-1', onClose: () => undefined }), host);
    await vi.waitFor(() => expect(document.querySelector('[data-testid="editor-toolbar"]')).not.toBeNull());
    render(null, host);
    expect(editorHandle.dispose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the test and confirm it fails**

Run: `pnpm exec vitest run test/unit/editor-panel.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the panel** in `src/pages/result/editor-panel.tsx`

```tsx
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { createEditor } from '../../editor/index';
import type { EditorHandle } from '../../editor/editor-core';
import { t } from '../../shared/i18n';
import { sendMessage } from '../../shared/messages';
import type { EditorDocument, ToolId } from '../../shared/types/editor';

const tools: ToolId[] = ['select', 'arrow', 'rect', 'ellipse', 'line', 'freehand', 'text', 'highlight', 'blur', 'pixelate', 'redact'];

export interface EditorPanelProps {
  doc: EditorDocument;
  captureId: string;
  onClose(saved?: { captureId: string }): void;
}

export function EditorPanel({ doc, captureId, onClose }: EditorPanelProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<EditorHandle | null>(null);
  const [tool, setTool] = useState<ToolId>('select');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let disposed = false;
    const element = canvasRef.current;
    if (!element) return;
    void createEditor(element, doc).then((handle) => {
      if (disposed) { handle.dispose(); return; }
      handleRef.current = handle;
    }).catch((error: unknown) => setMessage(error instanceof Error ? error.message : t('error.E_UNKNOWN.body')));
    return () => {
      disposed = true;
      handleRef.current?.dispose();
      handleRef.current = null;
    };
  }, [doc]);

  const chooseTool = (next: ToolId): void => {
    setTool(next);
    handleRef.current?.setTool(next);
  };

  const save = async (): Promise<void> => {
    const handle = handleRef.current;
    if (!handle) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await sendMessage('editor.save', {
        captureId,
        doc: handle.getDocument(),
        flattened: { dataUrl: handle.toDataUrl(), mime: 'image/png' },
        saveAsNew: true,
      });
      setMessage(t('ui.editor.saved'));
      onClose(result);
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : t('error.E_UNKNOWN.body'));
    } finally {
      setBusy(false);
    }
  };

  const privacyNote = tool === 'blur' || tool === 'pixelate' ? t('ui.editor.blurWarning') : tool === 'redact' ? t('ui.editor.redactWarning') : t('ui.editor.keepOriginal');

  return <section class="editor-panel" aria-label={t('ui.editor.title')}>
    <div class="editor-toolbar" data-testid="editor-toolbar" role="toolbar" aria-label={t('ui.editor.title')}>
      {tools.map((item) => <button key={item} type="button" data-tool={item} class={tool === item ? 'editor-tool active' : 'editor-tool'} aria-pressed={tool === item} onClick={() => chooseTool(item)}>{t(`ui.editor.tool.${item}`)}</button>)}
      <span class="editor-toolbar-spacer" />
      <button type="button" class="button button-quiet" onClick={() => handleRef.current?.undo()}>{t('ui.editor.undo')}</button>
      <button type="button" class="button button-quiet" onClick={() => handleRef.current?.redo()}>{t('ui.editor.redo')}</button>
      <button type="button" class="button button-quiet" onClick={() => onClose()}>{t('ui.editor.cancel')}</button>
      <button type="button" class="button button-primary" data-testid="editor-save" disabled={busy} onClick={() => void save()}>{busy ? t('ui.editor.saving') : t('ui.editor.save')}</button>
    </div>
    <p class="editor-privacy-note" data-testid="editor-privacy-note">{privacyNote}</p>
    <div class="editor-stage"><canvas ref={canvasRef} /></div>
    {message && <div class="toast" role="status" aria-live="polite">{message}</div>}
  </section>;
}
```

- [ ] **Step 5: Add the styles** to `src/pages/result/result.css`, matching the single-line-rule style already used in that file

```css
.editor-panel { border: 1px solid var(--result-line); border-radius: 14px; background: var(--result-surface); overflow: hidden; }
.editor-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 10px 12px; border-bottom: 1px solid var(--result-line); }
.editor-toolbar-spacer { flex: 1; }
.editor-tool { min-height: 34px; padding: 0 10px; border: 1px solid var(--result-line); border-radius: 8px; background: white; color: var(--result-muted); cursor: pointer; font: inherit; font-size: 12px; font-weight: 600; }
.editor-tool:hover, .editor-tool.active { border-color: var(--result-accent); background: var(--result-accent-soft); color: var(--result-accent); }
.editor-privacy-note { margin: 0; padding: 8px 14px; border-bottom: 1px solid var(--result-line); background: #fbfcfe; color: var(--result-muted); font-size: 11px; }
.editor-stage { display: flex; justify-content: center; max-height: calc(100vh - 260px); overflow: auto; padding: 20px; background: var(--result-canvas); }
.editor-stage canvas { border: 1px solid #cbd6e2; background: white; box-shadow: 0 10px 24px rgb(20 34 56 / 10%); }
```

- [ ] **Step 6: Wire the Edit buttons** in `src/pages/result/main.tsx`

Add to the imports:
```tsx
import { EditorPanel } from './editor-panel';
import { createDocument } from '../../lib/editor/document';
```

Add state next to the other `useState` calls:
```tsx
  const [editing, setEditing] = useState(false);
```

Replace the two placeholder handlers. At line 185 the header button becomes:
```tsx
<button class="button button-quiet" type="button" onClick={() => setEditing(true)}>{t('ui.result.edit')}</button>
```
and the panel link at line 210 becomes:
```tsx
<button type="button" onClick={() => setEditing(true)}>{t('ui.result.edit')}</button>
```

Render the editor in place of the viewer column when `editing` is true. Inside `result-layout`, replace the `<section class="viewer-column">` element with:
```tsx
      {editing && currentFile
        ? <EditorPanel
            captureId={captureId}
            doc={createDocument({ captureId, base: { ref: currentFile.ref, size: record.size } })}
            onClose={(saved) => { setEditing(false); if (saved) window.location.search = `?id=${saved.captureId}`; }}
          />
        : <section class="viewer-column" aria-label={t('ui.result.preview')}>
            {/* leave the existing viewer markup here unchanged */}
          </section>}
```

- [ ] **Step 7: Run the tests and confirm they pass**

Run: `pnpm exec vitest run test/unit/editor-panel.test.ts test/unit/result-page.test.ts`
Expected: both PASS — the pre-existing result page test must not regress.

- [ ] **Step 8: Verify types, lint and the whole suite**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add src/pages/result public/_locales test/unit/editor-panel.test.ts
git commit -m "feat(editor): open the annotation editor from the result page"
```

---

### Task 12: End-to-end verification

**Files:**
- Create: `test/e2e/editor.spec.ts`

Reuse the helpers in `test/e2e/capture-helpers.ts` (`captureRequest`, `sendCapture`, `driverPath`, `fixtureOrigin`) rather than duplicating that setup.

- [ ] **Step 1: Write the test**

```ts
import { expect, test } from '@playwright/test';
import { captureRequest, driverPath, fixtureOrigin, sendCapture } from './capture-helpers';
import { launchExtension } from './extension';

test('annotates a capture and saves it as a new record', async ({}, testInfo) => {
  const { context, extensionId } = await launchExtension(testInfo);
  try {
    const driver = await context.newPage();
    await driver.goto(`chrome-extension://${extensionId}${driverPath}`);
    const fixture = await context.newPage();
    await fixture.goto(`${fixtureOrigin}/long.html`);
    const resultPage = await sendCapture(context, extensionId, driver, fixture, captureRequest('visible'), testInfo);

    await resultPage.locator('[data-testid="result-viewer"] img').waitFor({ state: 'visible' });
    await resultPage.getByRole('button', { name: 'Düzenle' }).first().click();
    await resultPage.locator('[data-testid="editor-toolbar"]').waitFor({ state: 'visible' });

    await resultPage.locator('[data-tool="rect"]').click();
    const canvas = resultPage.locator('.editor-stage canvas');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Editor canvas has no layout box.');
    await resultPage.mouse.move(box.x + 60, box.y + 60);
    await resultPage.mouse.down();
    await resultPage.mouse.move(box.x + 200, box.y + 160);
    await resultPage.mouse.up();

    await resultPage.locator('[data-testid="editor-save"]').click();
    await resultPage.waitForURL((url) => url.searchParams.get('id') !== null, { timeout: 15_000 });
    await resultPage.locator('[data-testid="result-viewer"] img').waitFor({ state: 'visible' });
  } finally {
    await context.close();
  }
});

test('warns that blur is reversible and redaction is permanent', async ({}, testInfo) => {
  const { context, extensionId } = await launchExtension(testInfo);
  try {
    const driver = await context.newPage();
    await driver.goto(`chrome-extension://${extensionId}${driverPath}`);
    const fixture = await context.newPage();
    await fixture.goto(`${fixtureOrigin}/long.html`);
    const resultPage = await sendCapture(context, extensionId, driver, fixture, captureRequest('visible'), testInfo);

    await resultPage.getByRole('button', { name: 'Düzenle' }).first().click();
    await resultPage.locator('[data-tool="blur"]').click();
    await expect(resultPage.locator('[data-testid="editor-privacy-note"]')).toContainText('geri alınabilir');
    await resultPage.locator('[data-tool="redact"]').click();
    await expect(resultPage.locator('[data-testid="editor-privacy-note"]')).toContainText('kalıcı');
  } finally {
    await context.close();
  }
});
```

- [ ] **Step 2: Build and run**

Run: `pnpm build && pnpm exec playwright test test/e2e/editor.spec.ts`
Expected: both tests PASS. The extension must be rebuilt first — `launchExtension` copies `dist/store`.

If a test times out because the button label differs, read the rendered label from the trace (`pnpm exec playwright show-trace test-results/.../trace.zip`) and align the selector with the real locale string rather than loosening the assertion.

- [ ] **Step 3: Run the whole suite once more**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm e2e`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add test/e2e/editor.spec.ts
git commit -m "test(editor): cover annotate-and-save and privacy warnings end to end"
```

---

## Out of scope for this plan (P2)

Deliberately excluded, per the scope decision: emoji and sticker tools, the layers panel, crop / resize / rotate, tiled rendering for images beyond the canvas limit, mip levels for zoomed-out rendering, autosave with a debounce, cross-tab locking via `BroadcastChannel`, the numbered-marker "Renumber" action, alignment tools, grouping, the eyedropper, and offscreen-worker flatten. `docs/specs/05-editor.md` remains the reference for all of these.

Also unresolved and worth a follow-up: `src/background/result/service.ts:62` keeps `makeThumbnail` module-private, so Task 8 passes a no-op thumbnail generator by default. Exporting and sharing that helper would let edited captures refresh their history thumbnail.
