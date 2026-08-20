# Capture Stability and Triggers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make FullPageLab's visible-area and full-page captures reliable in Chrome, expose only working triggers, add the page context-menu action, and remove the obsolete full-page shortcut.

**Architecture:** Every working trigger builds a complete `CaptureRequest` and enters the existing `CaptureCoordinator`. Capture preparation becomes shared by visible and full-page modes, while scroll validation uses acknowledged progress instead of exact requested coordinates. Browser-facing controls are registered in focused background modules and are tested independently from Chrome globals.

**Tech Stack:** TypeScript 5.7, Preact, Chrome Extensions Manifest V3, Zod, Vitest/Happy DOM, Playwright, Vite, pnpm.

---

## File map

- Create `src/background/capture/scroll-progress.ts`: validate first-tile origin and acknowledged forward progress.
- Create `src/background/context-menus.ts`: own context-menu registration, synchronization, and click routing.
- Create `src/background/commands.ts`: route only supported Chrome commands.
- Create `test/unit/scroll-progress.test.ts`: scroll acknowledgment regression tests.
- Create `test/unit/context-menus.test.ts`: idempotent menu and click-routing tests.
- Create `test/unit/commands.test.ts`: supported-command routing tests.
- Create `test/fixtures/vite.config.ts`: deterministic fixture server.
- Create `test/fixtures/pages/*.html`: long, sticky, nested-scroll, iframe, dynamic-height, and DPR/zoom pages.
- Create `test/e2e/extension.ts`: load the built extension and expose its ID/pages.
- Create `test/e2e/capture-stability.spec.ts`: real Chromium capture smoke coverage.
- Modify `src/shared/types/messages.ts`: make `capture.start` accept `CaptureRequest`.
- Modify `src/shared/types/schemas.ts`: validate the capture request boundary.
- Modify `src/background/capture/coordinator.ts`: preserve trigger/request data, prepare visible capture, and use progress validation.
- Modify `src/background/index.ts`: parse requests and wire menus/commands.
- Modify `src/content/preparer.ts`: hide scrollbars in the top document and accessible same-origin frames.
- Modify `src/pages/popup/main.tsx`: send complete requests and expose only working modes.
- Modify `manifest.config.ts`: remove unsupported commands.
- Modify onboarding, locale, unit-test, package, Playwright, canonical spec, and progress files listed in the tasks below.

### Task 1: Complete capture request boundary

**Files:**
- Modify: `src/shared/types/messages.ts`
- Modify: `src/shared/types/schemas.ts`
- Modify: `src/background/capture/coordinator.ts`
- Modify: `src/background/index.ts`
- Modify: `src/pages/popup/main.tsx`
- Test: `test/unit/messages.test.ts`
- Test: `test/unit/capture-coordinator.test.ts`

- [ ] **Step 1: Write failing protocol and trigger-preservation tests**

Add a `captureRequest` fixture to `test/unit/messages.test.ts` and assert that `captureRequestSchema` accepts it but rejects a missing trigger:

```ts
const captureRequest: CaptureRequest = {
  mode: 'fullPage',
  target: {},
  options: structuredClone(defaultSettings.capture),
  export: structuredClone(defaultSettings.export),
  trigger: 'contextMenu',
};
expect(captureRequestSchema.parse(captureRequest)).toEqual(captureRequest);
expect(() => captureRequestSchema.parse({ ...captureRequest, trigger: undefined })).toThrow();
```

Extend `test/unit/capture-coordinator.test.ts` with a request whose trigger is `contextMenu`, start the coordinator, then assert `jobs.states[0]?.request.trigger === 'contextMenu'` and that the resolved tab/window IDs were merged into `request.target`.

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```powershell
pnpm exec vitest run test/unit/messages.test.ts test/unit/capture-coordinator.test.ts
```

Expected: FAIL because `captureRequestSchema` does not exist and the coordinator still overwrites the trigger with `popup`.

- [ ] **Step 3: Add the runtime request schema**

In `src/shared/types/schemas.ts`, export schemas for the stable boundary fields and retain nested option/export objects after structural checks:

```ts
export const captureModeSchema = z.enum(['fullPage', 'visible', 'selection', 'element', 'selector', 'scrollContainer', 'iframe', 'infinite', 'allTabs', 'browserWindow']);
export const captureTriggerSchema = z.enum(['popup', 'shortcut', 'contextMenu', 'sidePanel', 'batch', 'recapture', 'api', 'monitor']);
export const captureRequestSchema = z.object({
  id: idSchema.optional(),
  mode: captureModeSchema,
  target: z.object({
    tabId: z.number().int().positive().optional(),
    windowId: z.number().int().optional(),
    frameId: z.number().int().nonnegative().optional(),
    selector: z.string().min(1).optional(),
    selectorIndex: z.number().int().nonnegative().optional(),
    rect: z.object({ x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive() }).optional(),
    url: z.string().optional(),
    title: z.string().optional(),
    tabIds: z.array(z.number().int().positive()).optional(),
  }),
  options: z.object({
    backend: z.enum(['auto', 'visibleTab', 'debugger']),
    delayMs: z.number().nonnegative(),
    countdownOverlay: z.boolean(),
    hideFixedElements: z.enum(['auto', 'always', 'never']),
    hideScrollbars: z.boolean(),
  }).passthrough(),
  export: z.object({ targets: z.array(z.string()), format: z.string() }).passthrough(),
  presetId: idSchema.optional(),
  trigger: captureTriggerSchema,
  meta: z.object({ batchId: idSchema.optional(), batchItemId: idSchema.optional(), recaptureOf: idSchema.optional(), monitorRuleId: idSchema.optional() }).optional(),
});
```

- [ ] **Step 4: Preserve complete requests in coordinator jobs**

Change `CaptureStartInput` to carry a request and optional known tab:

```ts
export interface CaptureStartInput {
  request: CaptureRequest;
  tab?: CaptureTab;
}
```

Replace `requestFor`/`initialJob` construction with:

```ts
function initialJob(jobId: string, request: CaptureRequest, tab: CaptureTab, now: string): JobState {
  return {
    jobId,
    request: {
      ...structuredClone(request),
      id: jobId,
      target: { ...structuredClone(request.target), tabId: tab.id, windowId: tab.windowId, url: tab.url ?? 'about:blank', title: tab.title },
    },
    tabId: tab.id,
    windowId: tab.windowId,
    backend: 'visibleTab',
    phase: 'preparing',
    startedAt: now,
    updatedAt: now,
    progress: { done: 0, total: 1 },
    tilesWritten: 0,
    log: [],
  };
}
```

In `createJob`, use `input.tab ?? await platform.queryActiveTab()`, validate `input.request.mode`, and call `initialJob(createId(), input.request, tab, now())`.

- [ ] **Step 5: Parse the request and update popup callers**

Change `MsgMap['capture.start']['req']` to `CaptureRequest`. In the service worker, parse with `const request = captureRequestSchema.parse(message.payload) as CaptureRequest` before calling `startDetached({ request })`; import the runtime schema and the TypeScript type explicitly.

In the popup, require loaded settings and send:

```ts
await sendMessage('capture.start', {
  mode,
  target: {},
  options: structuredClone(settings.capture),
  export: structuredClone(settings.export),
  trigger: 'popup',
});
```

- [ ] **Step 6: Run tests and commit**

Run `pnpm exec vitest run test/unit/messages.test.ts test/unit/capture-coordinator.test.ts test/unit/task6.test.ts` and `pnpm typecheck`. Expected: PASS.

```powershell
git add src/shared/types/messages.ts src/shared/types/schemas.ts src/background/capture/coordinator.ts src/background/index.ts src/pages/popup/main.tsx test/unit/messages.test.ts test/unit/capture-coordinator.test.ts test/unit/task6.test.ts
git commit -m "refactor: route complete capture requests"
```

### Task 2: Validate acknowledged scroll progress

**Files:**
- Create: `src/background/capture/scroll-progress.ts`
- Modify: `src/background/capture/coordinator.ts`
- Create: `test/unit/scroll-progress.test.ts`
- Modify: `test/unit/task6.test.ts`

- [ ] **Step 1: Write failing scroll-progress tests**

Cover these exact cases in `test/unit/scroll-progress.test.ts`: first tile acknowledged at `{x:0,y:0}` passes; first tile at `y:120` throws `E_VALIDATION`; requested final `y:750` acknowledged at `y:749.5` passes; a later tile that repeats the preceding acknowledgment throws before capture; a new row may reset `x` while `y` advances.

Use a plan with `viewport: {width:800,height:600}`, `content: {width:800,height:1350}`, and steps from `createVerticalPlan`.

- [ ] **Step 2: Verify the tests fail**

Run `pnpm exec vitest run test/unit/scroll-progress.test.ts`. Expected: FAIL because the module is missing.

- [ ] **Step 3: Implement the focused validator**

Create `src/background/capture/scroll-progress.ts`:

```ts
import type { Point } from '../../shared/types/primitives';
import type { ScrollPlan, ScrollStep } from '../../shared/types/capture';
import { CaptureValidationError } from './validation';

const tolerance = 1;

export function assertAcknowledgedProgress(plan: ScrollPlan, step: ScrollStep, actual: Point, previous?: { step: ScrollStep; actual: Point }): void {
  if (step.index === 0) {
    const start = plan.steps[0]?.scrollTo ?? { x: 0, y: 0 };
    if (Math.abs(actual.x - start.x) > tolerance || Math.abs(actual.y - start.y) > tolerance) {
      throw new CaptureValidationError('E_VALIDATION', 'The page did not reach the capture origin; capture stopped to avoid a cropped first section.', true);
    }
    return;
  }
  if (!previous) throw new CaptureValidationError('E_VALIDATION', 'The previous scroll acknowledgement is missing.', true);
  const movedToNewRow = step.row > previous.step.row;
  const progressed = movedToNewRow
    ? actual.y > previous.actual.y + tolerance
    : actual.x > previous.actual.x + tolerance;
  if (!progressed) {
    throw new CaptureValidationError('E_VALIDATION', 'The page stopped scrolling before capture completed; duplicate tiles were prevented.', true);
  }
}
```

- [ ] **Step 4: Replace exact-position validation**

In the coordinator, keep `previousAck`, call `assertAcknowledgedProgress(plan, step, actual, previousAck)`, recompute the tile with `recomputeStepFromAck`, then set `previousAck = { step, actual }`. Remove `expectedScrollY` and exact equality checks.

- [ ] **Step 5: Run regression tests and commit**

Run `pnpm exec vitest run test/unit/scroll-progress.test.ts test/unit/task6.test.ts test/unit/plan.test.ts`. Expected: PASS.

```powershell
git add src/background/capture/scroll-progress.ts src/background/capture/coordinator.ts test/unit/scroll-progress.test.ts test/unit/task6.test.ts
git commit -m "fix: validate actual capture scroll progress"
```

### Task 3: Prepare and restore visible-area captures

**Files:**
- Modify: `src/background/capture/coordinator.ts`
- Modify: `test/unit/capture-coordinator.test.ts`
- Modify: `test/unit/task6.test.ts`

- [ ] **Step 1: Write failing visible-preparation tests**

Add three tests: normal HTTP capture calls `scan → prepare → captureVisibleTab → restore`; a rejected `prepare` still captures and stores a warning log; `chrome://settings` captures without calling `scan`, `prepare`, or `restore`.

- [ ] **Step 2: Verify failure**

Run `pnpm exec vitest run test/unit/capture-coordinator.test.ts test/unit/task6.test.ts`. Expected: FAIL because `runVisible` currently captures directly.

- [ ] **Step 3: Add best-effort visual preparation**

In `runVisible`, retain the original scroll point only after a successful scan. For non-restricted HTTP(S) tabs, create a minimal plan from current settings, call `prepare`, and capture inside a `try/finally`. Catch scan/prepare errors, append `Visible-area preparation skipped: <message>` to the job log, and continue. In `finally`, call `restore` only when metrics exist.

The capture operation remains:

```ts
const dataUrl = await withPhaseDeadline(
  'capturing',
  phaseDeadlineMs('capturing', current.request.options),
  visibleBackend.capture({ id: current.tabId, windowId: current.windowId }),
);
```

- [ ] **Step 4: Run tests and commit**

Run `pnpm exec vitest run test/unit/capture-coordinator.test.ts test/unit/task6.test.ts`. Expected: PASS.

```powershell
git add src/background/capture/coordinator.ts test/unit/capture-coordinator.test.ts test/unit/task6.test.ts
git commit -m "fix: prepare visible captures before screenshot"
```

### Task 4: Hide and restore accessible scrollbars

**Files:**
- Modify: `src/content/preparer.ts`
- Modify: `test/integration/coordinator.int.test.ts`

- [ ] **Step 1: Write failing scrollbar tests**

Create a top-level scrollable element and a same-origin iframe document. After `preparePage`, assert each document has `style[data-fullpagelab-preparation="scrollbars"]`, its text includes `scrollbar-width: none`, `width: 0`, and `height: 0`; after restore, assert all injected styles are gone. Add a cross-origin-access simulation whose `contentDocument` getter throws and assert preparation still succeeds.

- [ ] **Step 2: Verify failure**

Run `pnpm exec vitest run test/integration/coordinator.int.test.ts`. Expected: FAIL because only the top document receives a style and WebKit dimensions are not zeroed.

- [ ] **Step 3: Implement document-scoped scrollbar preparation**

Replace the current scrollbar call with helpers that accept a `Document`, append to that document's root, and recurse through accessible frames:

```ts
const scrollbarCss = 'html, body, * { scrollbar-width: none !important; } html::-webkit-scrollbar, body::-webkit-scrollbar, *::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }';

function addDocumentStyle(restorer: Restorer, owner: Document, cssText: string, id: string): void {
  const root = owner.documentElement;
  if (!root) return;
  const style = owner.createElement('style');
  style.dataset.fullpagelabPreparation = id;
  style.textContent = cssText;
  root.append(style);
  restorer.register(() => style.remove());
}

function prepareScrollbarDocuments(restorer: Restorer, owner: Document): void {
  addDocumentStyle(restorer, owner, scrollbarCss, 'scrollbars');
  for (const frame of Array.from(owner.querySelectorAll('iframe'))) {
    try {
      const child = frame.contentDocument;
      if (child?.documentElement) prepareScrollbarDocuments(restorer, child);
    } catch {
      // Cross-origin frames remain unchanged without an optional host permission.
    }
  }
}
```

- [ ] **Step 4: Run integration tests and commit**

Run `pnpm exec vitest run test/integration/coordinator.int.test.ts`. Expected: PASS.

```powershell
git add src/content/preparer.ts test/integration/coordinator.int.test.ts
git commit -m "fix: hide scrollbars across accessible documents"
```

### Task 5: Add the idempotent full-page context menu

**Files:**
- Create: `src/background/context-menus.ts`
- Modify: `src/background/index.ts`
- Modify: `public/_locales/en/messages.json`
- Modify: `public/_locales/tr/messages.json`
- Create: `test/unit/context-menus.test.ts`

- [ ] **Step 1: Write failing controller tests**

Mock `create`, `remove`, and `onClicked.addListener`. Assert `sync()` removes the stable ID before creating one `contexts:['page']` item; repeated `sync()` never changes the ID; unrelated clicks do nothing; matching clicks pass the clicked tab to `onCapture`.

- [ ] **Step 2: Verify failure**

Run `pnpm exec vitest run test/unit/context-menus.test.ts`. Expected: FAIL because the module is missing.

- [ ] **Step 3: Implement the controller**

Create a dependency-injected controller with ID `fullpagelab.capture.fullPage`, synchronous listener registration, and async `sync()`:

```ts
export const fullPageMenuId = 'fullpagelab.capture.fullPage';

export interface ContextMenuPlatform {
  create(properties: chrome.contextMenus.CreateProperties): string | number;
  remove(menuItemId: string): Promise<void>;
  addClickListener(listener: (info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab) => void): void;
}

export function createContextMenuController({ platform, getTitle, onCapture, onError }: {
  platform: ContextMenuPlatform;
  getTitle: () => string;
  onCapture: (tab: chrome.tabs.Tab) => void | Promise<void>;
  onError: (error: unknown) => void;
}) {
  let registered = false;
  return {
    register(): void {
      if (registered) return;
      registered = true;
      platform.addClickListener((info, tab) => {
        if (info.menuItemId !== fullPageMenuId || !tab) return;
        void Promise.resolve(onCapture(tab)).catch(onError);
      });
    },
    async sync(): Promise<void> {
      await platform.remove(fullPageMenuId).catch(() => undefined);
      platform.create({ id: fullPageMenuId, title: getTitle(), contexts: ['page'] });
    },
  };
}
```

Ignore `chrome.runtime.lastError` only for removal of a missing item; surface create failures through `onError`.

- [ ] **Step 4: Wire service-worker startup and capture routing**

Register the click listener at module evaluation time. In `initialize()`, await `contextMenus.sync()`. On click, build a full-page request from current settings with `trigger:'contextMenu'`, pass the clicked tab as `CaptureStartInput.tab`, and log detached-job failures.

Add locale keys:

```json
"contextMenuCaptureFullPage": { "message": "Capture full-page screenshot" }
```

```json
"contextMenuCaptureFullPage": { "message": "Tam sayfa ekran görüntüsünü al" }
```

- [ ] **Step 5: Run tests and commit**

Run `pnpm exec vitest run test/unit/context-menus.test.ts test/unit/messages.test.ts` and `pnpm typecheck`. Expected: PASS.

```powershell
git add src/background/context-menus.ts src/background/index.ts public/_locales/en/messages.json public/_locales/tr/messages.json test/unit/context-menus.test.ts
git commit -m "feat: add full-page context menu capture"
```

### Task 6: Remove unsupported controls and wire the remaining command

**Files:**
- Create: `src/background/commands.ts`
- Modify: `src/background/index.ts`
- Modify: `manifest.config.ts`
- Modify: `src/pages/popup/main.tsx`
- Modify: `src/pages/onboarding/main.tsx`
- Modify: `src/pages/onboarding/onboarding.css`
- Modify: `public/_locales/en/messages.json`
- Modify: `public/_locales/tr/messages.json`
- Create: `test/unit/commands.test.ts`
- Modify: `test/unit/onboarding.test.ts`
- Create: `test/unit/popup.test.ts`

- [ ] **Step 1: Write failing UI, manifest, and command tests**

Assert the popup renders only `fullPage` and `visible`; onboarding contains `.pin-card` but no `.shortcut-card`, `<kbd>`, or `Alt + Shift + P`; manifest source contains neither `capture-full-page`, `capture-selection`, nor `capture-element`; command routing accepts `capture-visible` and ignores unknown commands.

- [ ] **Step 2: Verify failure**

Run `pnpm exec vitest run test/unit/onboarding.test.ts test/unit/popup.test.ts test/unit/commands.test.ts`. Expected: FAIL against current controls.

- [ ] **Step 3: Remove obsolete surfaces**

Keep popup modes:

```ts
const modes = [
  ['fullPage', 'ui.capture.mode.fullPage'],
  ['visible', 'ui.capture.mode.visible'],
] as const;
```

Render labels through `t(label)`. Remove `ShortcutCard`, the `command` icon case, its export, shortcut locale keys, and `.shortcut-card`/`.shortcut-keys`/`kbd` CSS. Change `.welcome-notes` to one column containing only `PinCard`.

In the manifest, retain only:

```ts
commands: {
  'capture-visible': {
    suggested_key: { default: 'Alt+Shift+V' },
    description: '__MSG_cmdVisible__',
  },
},
```

Remove unused command locale keys.

- [ ] **Step 4: Implement supported command routing**

Create and test this focused command controller, then wire it at service-worker module evaluation time and start a complete visible request with `trigger:'shortcut'`:

```ts
export interface CommandPlatform {
  addListener(listener: (command: string) => void): void;
}

export function createCommandController({ platform, onVisibleCapture, onError }: {
  platform: CommandPlatform;
  onVisibleCapture: () => void | Promise<void>;
  onError: (error: unknown) => void;
}) {
  return {
    register(): void {
      platform.addListener((command) => {
        if (command !== 'capture-visible') return;
        void Promise.resolve(onVisibleCapture()).catch(onError);
      });
    },
  };
}
```

- [ ] **Step 5: Run tests, build manifest, and commit**

Run:

```powershell
pnpm exec vitest run test/unit/onboarding.test.ts test/unit/popup.test.ts test/unit/commands.test.ts
pnpm typecheck
pnpm build:store
pnpm check:manifest
```

Expected: all commands PASS; built manifest has no full-page shortcut.

```powershell
git add src/background/commands.ts src/background/index.ts manifest.config.ts src/pages/popup/main.tsx src/pages/onboarding/main.tsx src/pages/onboarding/onboarding.css public/_locales/en/messages.json public/_locales/tr/messages.json test/unit/commands.test.ts test/unit/onboarding.test.ts test/unit/popup.test.ts
git commit -m "fix: expose only working capture controls"
```

### Task 7: Add deterministic Chromium fixtures and smoke coverage

**Files:**
- Modify: `playwright.config.ts`
- Create: `test/fixtures/vite.config.ts`
- Create: `test/fixtures/pages/index.html`
- Create: `test/fixtures/pages/long.html`
- Create: `test/fixtures/pages/sticky.html`
- Create: `test/fixtures/pages/nested-scroll.html`
- Create: `test/fixtures/pages/iframe.html`
- Create: `test/fixtures/pages/frame-child.html`
- Create: `test/fixtures/pages/dynamic-height.html`
- Create: `test/fixtures/pages/dpr-zoom.html`
- Create: `test/e2e/extension.ts`
- Create: `test/e2e/capture-stability.spec.ts`

- [ ] **Step 1: Add deterministic fixture pages**

Use fixed dimensions, system fonts, no external resources, and colored 200 px bands labeled with their zero-based index. `long.html` must be exactly 2,400 CSS px high; `sticky.html` must contain 72 px fixed top and 48 px fixed bottom bars; `nested-scroll.html` must contain a 420 px panel with 1,680 px content; iframe pages must be same-origin; dynamic height must append one 400 px band after the first scroll event.

- [ ] **Step 2: Configure the fixture server and extension launch helper**

Set Playwright `webServer.command` to `pnpm fixtures:serve`, URL to `http://127.0.0.1:4173`, and reuse outside CI. Use this extension helper in `test/e2e/extension.ts`:

```ts
import { chromium, type BrowserContext, type TestInfo } from '@playwright/test';
import { resolve } from 'node:path';

export async function launchExtension(testInfo: TestInfo): Promise<{ context: BrowserContext; extensionId: string }> {
  const extensionPath = resolve('dist/store');
  const context = await chromium.launchPersistentContext(testInfo.outputPath('profile'), {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  let worker = context.serviceWorkers()[0];
  worker ??= await context.waitForEvent('serviceworker');
  return { context, extensionId: new URL(worker.url()).host };
}
```

Configure the fixture server:

```ts
import { defineConfig } from 'vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtureRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: resolve(fixtureRoot, 'pages'),
  server: { host: '127.0.0.1', port: 4173, strictPort: true },
});
```

- [ ] **Step 3: Write the failing real-browser tests**

For long and sticky fixtures: open the fixture, open `chrome-extension://<id>/src/pages/popup/index.html` as a driver page, bring the fixture page back to the front, and call `chrome.runtime.sendMessage` from the driver page with a versioned full-page `CaptureRequest`. Wait for `src/pages/result/index.html`, then assert the result image's `naturalHeight` equals the fixture's prepared `scrollHeight × devicePixelRatio`. Sample the center pixel of each colored band in a canvas and assert every expected band appears once. The context-menu click path remains covered by `test/unit/context-menus.test.ts`; this browser test exercises the shared coordinator. For visible and nested-scroll fixtures, assert the rightmost two pixel columns do not contain the fixture's scrollbar color.

- [ ] **Step 4: Run Chromium E2E and fix only fixture/test integration defects**

Run:

```powershell
pnpm build:store
pnpm e2e
```

Expected: all capture-stability tests PASS in headed Chromium. If CI is Linux, run the same command under `xvfb-run` rather than skipping extension tests.

- [ ] **Step 5: Commit the E2E foundation**

```powershell
git add playwright.config.ts test/fixtures test/e2e
git commit -m "test: add Chromium capture stability fixtures"
```

### Task 8: Reconcile canonical documentation and run the release gate

**Files:**
- Modify: `docs/specs/02-architecture.md`
- Modify: `docs/specs/03-capture-engine.md`
- Modify: `docs/specs/10-ui-ux.md`
- Modify: `docs/specs/12-roadmap-and-milestones.md`
- Modify: `docs/specs/13-data-contracts.md`
- Modify: `docs/specs/14-release-and-store.md`
- Modify: `docs/progress.md`
- Modify: `docs/superpowers/specs/2026-08-20-onboarding-promo-design.md`

- [ ] **Step 1: Update product decisions exactly**

Document these statements consistently: full-page has no default `Alt+Shift+P`; visible retains its working command; context menu initially contains only the working full-page page-context action; inactive capture modes are not exposed; `capture.start` accepts `CaptureRequest`; actual scroll acknowledgments determine crop and progress; visible capture uses best-effort preparation; same-origin iframe scrollbar styles are restored.

Mark selection, scrolling area, element, large-tile/offscreen storage, advanced History, and advanced export as subsequent plans, not completed behavior. Remove unsupported features from current-version Store claims while preserving them as roadmap entries.

- [ ] **Step 2: Correct known data-contract defects**

Remove the duplicate `offscreen.redact` declaration in `13-data-contracts.md`. Standardize `BatchControl.pdfChunkSize` to `200` in both its primary declaration and extension note. Ensure trigger and command prose matches the approved override.

- [ ] **Step 3: Update the progress report from evidence**

Set test counts from the final `pnpm test` output, list the new context-menu/visible/full-page behavior, record E2E fixture coverage, remove the onboarding shortcut claim, and add the implementation commit hashes produced by Tasks 1–7.

- [ ] **Step 4: Run the complete verification gate**

Run:

```powershell
pnpm test
pnpm typecheck
pnpm lint
pnpm build:all
pnpm check:manifest
pnpm check:content-assets
pnpm e2e
git diff --check
```

Expected: every command exits `0`.

- [ ] **Step 5: Run the manual Chrome smoke checklist**

Load `dist/store` from `chrome://extensions`, open the long fixture, and verify: the page context menu contains exactly one FullPageLab full-page action; the action opens a complete result with no missing first band, repeated band, progress overlay, or scrollbar; visible-area capture has no accessible scrollbar; `chrome://extensions/shortcuts` contains no FullPageLab full-page command. Record browser version and pass/fail results in `docs/progress.md`.

- [ ] **Step 6: Run UTF-8 and Turkish pre-flight audit**

For every modified text file, verify no UTF-8 BOM and scan for Unicode mojibake markers U+00C3, U+00C2, U+00C4, U+00C5 and U+FFFD. Read every modified Turkish line and correct İngilizceleştirilmiş words or missing `ç, ğ, ı, İ, ö, ş, ü` before staging.

- [ ] **Step 7: Commit documentation and final verification state**

```powershell
git add docs/specs/02-architecture.md docs/specs/03-capture-engine.md docs/specs/10-ui-ux.md docs/specs/12-roadmap-and-milestones.md docs/specs/13-data-contracts.md docs/specs/14-release-and-store.md docs/progress.md docs/superpowers/specs/2026-08-20-onboarding-promo-design.md
git commit -m "docs: align capture specs with working triggers"
git status --short
```

Expected: only pre-existing user-owned untracked files remain.
