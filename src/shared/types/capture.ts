import type { ExportPlan } from './export';
import type { BlobRef, CssPx, DevicePx, ErrorInfo, Id, Millis, Point, Rect, Size, Url } from './primitives';

export type CaptureMode = 'fullPage' | 'visible' | 'selection' | 'element' | 'selector' | 'scrollContainer' | 'iframe' | 'infinite' | 'allTabs' | 'browserWindow';
export type CaptureTrigger = 'popup' | 'shortcut' | 'contextMenu' | 'sidePanel' | 'batch' | 'recapture' | 'api' | 'monitor';
export type CaptureBackend = 'visibleTab' | 'debugger';

export interface CaptureTarget { tabId?: number; windowId?: number; frameId?: number; selector?: string; selectorIndex?: number; rect?: Rect; url?: Url; title?: string; tabIds?: number[]; }
export interface SmartHideOptions { enabled: boolean; categories: Array<'cookieBanner' | 'modal' | 'chatWidget' | 'ad' | 'floatingWidget' | 'newsletterPopup' | 'stickyBar'>; customSelectors: string[]; mode: 'hide' | 'remove'; }
export interface LazyLoadOptions { enabled: boolean; preScroll: boolean; preScrollStepCss: CssPx; preScrollDwellMs: Millis; forceEagerImages: boolean; waitImagesDecode: boolean; waitFonts: boolean; maxWaitMs: Millis; }
export interface WaitConditions { fixedDelayMs?: Millis; networkIdle?: { idleMs: Millis; maxWaitMs: Millis; maxInflight?: number }; domQuiet?: { quietMs: Millis; maxWaitMs: Millis }; selectorVisible?: { selector: string; timeoutMs: Millis }; selectorHidden?: { selector: string; timeoutMs: Millis }; fontsReady?: { timeoutMs: Millis }; imagesLoaded?: { timeoutMs: Millis; inViewportOnly: boolean }; pageLoad?: 'domcontentloaded' | 'load' | 'none'; customJs?: never; }
export interface InfiniteScrollOptions { maxSteps: number; maxHeightCss: CssPx; maxDurationMs: Millis; stepDwellMs: Millis; stopWhenNoGrowth: number; duplicateDetection: boolean; manualStop: boolean; direction: 'down' | 'up'; clickSelector?: string; }
export interface CaptureLimits { maxCaptureHeightCss: CssPx; maxTiles: number; maxDurationMs: Millis; stepSettleMs: Millis; tileFormat: 'png' | 'jpeg'; maxOutputPixels: number; maxStripHeightPx: DevicePx; memoryBudgetMb: number; }
export interface CaptureOptions { backend: 'auto' | CaptureBackend; delayMs: Millis; countdownOverlay: boolean; hideFixedElements: 'auto' | 'always' | 'never'; hideScrollbars: boolean; freezeAnimations: boolean; pauseMedia: boolean; smartHide: SmartHideOptions; lazyLoad: LazyLoadOptions; wait: WaitConditions; infinite?: InfiniteScrollOptions; iframes: 'pixelsOnly' | 'injectSameOrigin' | 'injectAll'; dprMode: 'device' | 'css' | number; zoomHandling: 'normalizeTo100' | 'keep'; limits: CaptureLimits; captureCursor: false; background: 'page' | 'transparent'; includeMetadata: boolean; captureHorizontalOverflow: boolean; }
export interface CaptureRequest { id?: Id; mode: CaptureMode; target: CaptureTarget; options: CaptureOptions; export: ExportPlan; presetId?: Id; trigger: CaptureTrigger; meta?: { batchId?: Id; batchItemId?: Id; recaptureOf?: Id; monitorRuleId?: Id }; }

export interface ElementInfo { selector: string; rect: Rect; clientSize: Size; scrollSize: Size; isScrollable: boolean; overflow: { x: string; y: string }; tag: string; id?: string; classes: string[]; frameId: number; depth: number; }
export interface FixedElementInfo extends ElementInfo { position: 'fixed' | 'sticky'; anchor: 'top' | 'bottom' | 'left' | 'right' | 'full' | 'other'; coversViewportPct: number; zIndex: number; isTransparentOverlay: boolean; }
export interface IframeInfo { frameId?: number; selector: string; rect: Rect; sameOrigin: boolean; src: Url; isScrollable?: boolean; scrollSize?: Size; }
export interface PageMetrics { url: Url; title: string; origin: string; viewport: Size; document: Size; scroll: Point; dpr: number; zoom: number; hasHorizontalOverflow: boolean; scrollingElement: 'document' | 'custom'; primaryScrollContainer?: ElementInfo; scrollContainers: ElementInfo[]; fixedElements: FixedElementInfo[]; iframes: IframeInfo[]; target?: ElementInfo; lazyImages: number; direction: 'ltr' | 'rtl'; isRestricted: boolean; userAgent: string; colorScheme: 'light' | 'dark'; }
export interface ScanOptions { findScrollContainers: boolean; findFixedElements: boolean; findIframes: boolean; targetSelector?: string; rect?: Rect; }
export interface PreparePlan { hideScrollbars: boolean; freezeAnimations: boolean; pauseMedia: boolean; smartHide: SmartHideOptions; lazyLoad: LazyLoadOptions; fixedStrategy: 'none' | 'hideAfterFirst' | 'hideAll' | 'absolutize'; fixedTargets?: string[]; scrollContainerSelector?: string; overlay: { showProgress: boolean; allowCancel: boolean; allowStop: boolean }; restoreScroll: boolean; }
export interface PreparedState { hiddenSelectors: string[]; removedScrollbars: boolean; pausedMedia: number; eagerizedImages: number; smartHidden: Array<{ selector: string; category: string }>; scrollRoot: 'document' | string; effectiveDocument: Size; }
export interface ScrollCommand { stepIndex: number; x: CssPx; y: CssPx; afterFirstTile: boolean; settleMs: Millis; wait?: WaitConditions; }
export interface AgentScrollRequest { point: Point; stepIndex?: number; totalSteps?: number; settleMs?: Millis; }
export interface ScrollAck { stepIndex: number; actual: Point; documentNow: Size; hiddenApplied: boolean; elapsedMs: Millis; }
export interface PickerOptions { mode: 'element' | 'scrollContainer' | 'selection'; highlightColor?: string; showInfoBadge: boolean; allowParentNavigation: boolean; onlyScrollable?: boolean; }
export type PickerEvent = { kind: 'hover'; info: ElementInfo } | { kind: 'picked'; info: ElementInfo } | { kind: 'selected'; rect: Rect } | { kind: 'cancelled' };
export interface ScrollStep { index: number; row: number; col: number; scrollTo: Point; placeAt: Point; cropFromViewport: Rect; }
export interface ScrollPlan { root: 'document' | string; viewport: Size; content: Size; origin: Point; steps: ScrollStep[]; cols: number; rows: number; overlapCss: CssPx; dpr: number; zoom: number; warnings: string[]; stickyInsets?: { top: CssPx; bottom: CssPx; left: CssPx; right: CssPx }; scrollBounds?: Size; }
export type JobPhase = 'idle' | 'preparing' | 'countdown' | 'capturing' | 'stitching' | 'exporting' | 'done' | 'cancelled' | 'failed';
export interface JobState { jobId: Id; request: CaptureRequest; tabId: number; windowId: number; backend: CaptureBackend; phase: JobPhase; startedAt: string; updatedAt: string; finishedAt?: string; progress: { done: number; total: number; etaMs?: Millis }; metrics?: PageMetrics; plan?: ScrollPlan; tilesWritten: number; error?: ErrorInfo; captureId?: Id; log: string[]; }
export interface JobProgress { jobId: Id; phase: JobPhase; done: number; total: number; message?: string; etaMs?: Millis; visible?: boolean; allowCancel?: boolean; }
export interface TileRecord { id: string; jobId: Id; index: number; blob: Blob; step: ScrollStep; capturedAt: string; size: Size; }
export interface CaptureResultSummary { captureId: Id; size: Size; cssSize: Size; strips: number; durationMs: Millis; backend: CaptureBackend; warnings: string[]; }
export interface CanvasLimits { maxSide: number; maxArea: number; probedAt: string; }
