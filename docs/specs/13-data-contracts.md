# 13 — Veri Sözleşmeleri (TypeScript Tipleri)

> Bu dosya uzantının **tek doğruluk kaynağı** tip tanımlarıdır. Tüm bileşenler (SW, CS, offscreen, UI) bu tipleri `src/shared/types/*` altından import eder. Runtime doğrulama için her tipin bir `zod` şeması (`*Schema`) bulunur; mesaj alıcıları payload'ı parse eder. Tipler `readonly` ve JSON-serializable'dır (Blob/ArrayBuffer taşıyanlar açıkça işaretlenmiştir ve sadece aynı context içinde dolaşır; context'ler arası referans (`BlobRef`) kullanılır).

> **Uygulama durumu (2026-08-21):** `CaptureMode` gelecekteki modları da kapsayan ileriye dönük bir union'dır. Runtime şu anda yalnız `fullPage` ve `visible` isteklerini yürütür; diğer modlar desteklenmeyen istek olarak reddedilir ve arayüzde gösterilmez. `capture.start` payload'ı tek bir mod adı değil, hedef sekme/pencere bilgisi dâhil eksiksiz `CaptureRequest` nesnesidir.

Dosya içindeki bölümler:
1. Ortak ilkel tipler · 2. Mesaj zarfı ve `MsgMap` · 3. Capture · 4. Export · 5. History/Storage · 6. Settings & Presets · 7. Hatalar · 8. Batch · 9. Editor/Annotation · 10. Diff/Evidence/BugReport · 11. Integrations · 12. Filename template grameri · 13. Public API · 14. Ek tipler ve genişletmeler (04–14'ten gelen)

---

## 1. Ortak İlkel Tipler

```ts
export type Id = string;                 // nanoid(16)
export type IsoDate = string;            // ISO 8601, UTC ("2026-08-19T10:15:30.123Z")
export type Millis = number;
export type CssPx = number;              // CSS piksel
export type DevicePx = number;           // fiziksel piksel
export type Pt = number;                 // PDF point (1/72 in)
export type Url = string;
export type Sha256Hex = string;          // 64 hex karakter
export type Percent = number;            // 0..100

export interface Rect { x: number; y: number; width: number; height: number; }    // birim bağlama göre (CssPx | DevicePx)
export interface Size { width: number; height: number; }
export interface Point { x: number; y: number; }

/** Context'ler arası büyük veri referansı. Veri IndexedDB `blobs` store'unda ya da OPFS'te durur. */
export interface BlobRef {
  store: 'idb' | 'opfs';
  key: string;            // idb: blobs.id ; opfs: relative path ("captures/<captureId>/full.png")
  mime: string;
  bytes: number;
  size?: Size;            // görüntüyse DevicePx
}

export type Priority = 'P0' | 'P1' | 'P1.5' | 'P2' | 'DIFF';
```

---

## 2. Mesaj Zarfı ve `MsgMap`

```ts
export interface Msg<K extends keyof MsgMap = keyof MsgMap> {
  v: 1;
  type: K;
  id: Id;
  payload: MsgMap[K]['req'];
  /** Gönderen bağlamı; SW route/log için. */
  from?: 'sw' | 'cs' | 'offscreen' | 'ui' | 'external';
}
export type Reply<K extends keyof MsgMap = keyof MsgMap> =
  | { v: 1; type: K; id: Id; ok: true; payload: MsgMap[K]['res'] }
  | { v: 1; type: K; id: Id; ok: false; error: ErrorInfo };

/** Port adları */
export type PortName =
  | `page-agent:${Id}`      // CS ↔ SW, jobId
  | 'offscreen'             // offscreen ↔ SW
  | 'job-events'            // UI ↔ SW (progress aboneliği)
  | 'history-events'        // SW → history UI değişiklikleri
  | 'batch-events'          // UI ↔ SW
  | 'editor';               // result page ↔ SW

/** Tüm mesaj tipleri. `req` istek payload'ı, `res` cevap payload'ı. `void` = yok. */
export interface MsgMap {
  // ---- UI → SW : capture
  'capture.start':    { req: CaptureRequest;            res: { jobId: Id } };
  'capture.cancel':   { req: { jobId: Id };             res: void };
  'capture.status':   { req: { jobId: Id };             res: JobState };
  'capture.listActive': { req: void;                    res: JobState[] };
  'capture.pickElement': { req: { tabId?: number; mode: 'element' | 'scrollContainer' | 'selection' }; res: { jobId: Id } }; // picker akışı başlatır
  'capture.infiniteStop': { req: { jobId: Id };         res: void };    // infinite scroll'u durdur ve mevcutla bitir

  // ---- SW → UI (Port 'job-events' üzerinden push)
  'job.progress':     { req: JobProgress;               res: void };
  'job.done':         { req: { jobId: Id; captureId: Id; result: CaptureResultSummary }; res: void };
  'job.failed':       { req: { jobId: Id; error: ErrorInfo; partial?: CaptureResultSummary }; res: void };
  'job.cancelled':    { req: { jobId: Id };             res: void };

  // ---- SW → CS (page agent)
  'agent.ping':       { req: void;                      res: { version: string; ready: boolean } };
  'agent.scan':       { req: ScanOptions;               res: PageMetrics };
  'agent.prepare':    { req: PreparePlan;               res: PreparedState };
  'agent.scrollTo':   { req: ScrollCommand;             res: ScrollAck };
  'agent.waitFor':    { req: WaitConditions;            res: WaitResult };
  'agent.restore':    { req: void;                      res: void };
  'agent.abort':      { req: { reason: ErrorCode };     res: void };
  'agent.pickStart':  { req: PickerOptions;             res: void };
  'agent.pickCancel': { req: void;                      res: void };
  'agent.getElementRect': { req: { selector: string; index?: number }; res: ElementInfo | null };
  'agent.setOverlay': { req: OverlayState;              res: void };
  'agent.clipboardWrite': { req: { dataUrl: string };   res: { ok: boolean } };
  'agent.collectLinks': { req: { rect?: Rect };         res: LinkRect[] };      // PDF clickable links
  'agent.collectText':  { req: { rect?: Rect };         res: TextRect[] };      // smart page break ipuçları
  'agent.collectConsole': { req: void;                  res: ConsoleEntry[] };  // bug report (main world tap)
  'agent.infiniteStep': { req: InfiniteScrollStep;      res: InfiniteScrollAck };
  'agent.pickerEvent': { req: PickerEvent;              res: void };            // CS → SW

  // ---- SW ↔ Offscreen
  'offscreen.stitch':    { req: StitchRequest;          res: StitchResult };
  'offscreen.encode':    { req: EncodeRequest;          res: { ref: BlobRef } };
  'offscreen.pdf':       { req: PdfBuildRequest;        res: { ref: BlobRef; pages: number } };
  'offscreen.thumbnail': { req: { src: BlobRef; maxSize: number }; res: { ref: BlobRef } };
  'offscreen.crop':      { req: { src: BlobRef; rect: Rect /*DevicePx*/ }; res: { ref: BlobRef } };
  'offscreen.ocr':       { req: OcrRequest;             res: OcrResult };
  'offscreen.diff':      { req: DiffRequest;            res: DiffResult };
  'offscreen.zip':       { req: ZipRequest;             res: { ref: BlobRef } };
  'offscreen.hash':      { req: { src: BlobRef };       res: { sha256: Sha256Hex } };
  'offscreen.objectUrl': { req: { src: BlobRef };       res: { url: string } };   // downloads için blob: URL
  'offscreen.revokeUrl': { req: { url: string };        res: void };
  'offscreen.clipboardText': { req: { text: string };   res: void };
  'offscreen.abort':     { req: { jobId: Id };          res: void };
  'offscreen.probeLimits': { req: void;                 res: CanvasLimits };
  'offscreen.redact':    { req: { src: BlobRef; rects: Rect[] /*DevicePx*/; color: string; label?: string }; res: { ref: BlobRef } };

  // ---- SW → UI : history events
  'history.changed':    { req: { kind: 'put' | 'delete' | 'clear'; ids: Id[] }; res: void };

  // ---- UI → SW : history / settings / presets / batch / integrations / permissions
  'history.list':     { req: HistoryQuery;              res: HistoryPage };
  'history.get':      { req: { id: Id };                res: CaptureRecord | null };
  'history.update':   { req: { id: Id; patch: CaptureRecordPatch }; res: CaptureRecord };
  'history.delete':   { req: { ids: Id[] };             res: { deleted: number } };
  'history.export':   { req: { ids: Id[]; format: ExportFormat; asZip: boolean }; res: { downloadIds: number[] } };
  'history.recapture':{ req: { id: Id; overrides?: Partial<CaptureRequest> }; res: { jobId: Id } };
  'history.stats':    { req: void;                      res: StorageStats };
  'history.clear':    { req: { olderThan?: IsoDate };   res: { deleted: number } };
  // ---- UI → SW : editor  (uygulandı — 05 §13)
  'editor.save':      { req: { captureId: Id; doc: EditorDocument; flattened: { dataUrl: string; mime: string }; saveAsNew: boolean };
                        res: { captureId: Id; createdNewRecord: boolean } };
  'editor.load':      { req: { captureId: Id };         res: EditorDocument | null };
  'settings.get':     { req: void;                      res: Settings };
  'settings.set':     { req: { patch: DeepPartial<Settings> }; res: Settings };
  'settings.reset':   { req: void;                      res: Settings };
  'preset.list':      { req: void;                      res: Preset[] };
  'preset.save':      { req: Preset;                    res: Preset };
  'preset.delete':    { req: { id: Id };                res: void };
  'batch.create':     { req: BatchJobInput;             res: { batchId: Id } };
  'batch.start':      { req: { batchId: Id };           res: void };
  'batch.pause':      { req: { batchId: Id };           res: void };
  'batch.resume':     { req: { batchId: Id };           res: void };
  'batch.cancel':     { req: { batchId: Id };           res: void };
  'batch.retryFailed':{ req: { batchId: Id };           res: void };
  'batch.get':        { req: { batchId: Id };           res: BatchJob };
  'batch.list':       { req: void;                      res: BatchJob[] };
  'batch.event':      { req: BatchEvent;                res: void };           // SW → UI push
  'export.run':       { req: ExportRequest;             res: ExportResult };
  'export.copy':      { req: { captureId: Id; variant?: 'full' | 'strip'; stripIndex?: number }; res: void };
  'permissions.check':{ req: { feature: FeatureKey };   res: PermissionStatus };
  'permissions.request': { req: { feature: FeatureKey }; res: PermissionStatus };
  'permissions.revoke':  { req: { feature: FeatureKey }; res: PermissionStatus };
  'integration.connect':    { req: { provider: IntegrationProvider }; res: IntegrationAccount };
  'integration.disconnect': { req: { provider: IntegrationProvider }; res: void };
  'integration.send':       { req: IntegrationSendRequest; res: IntegrationSendResult };
  'integration.list':       { req: void;                res: IntegrationAccount[] };
  'diff.run':         { req: { baseId: Id; headId: Id; options?: DiffOptions }; res: DiffResult };
  'diff.history':     { req: { url: Url; limit?: number }; res: DiffTimelineEntry[] };
  'monitor.upsert':   { req: MonitorRule;               res: MonitorRule };
  'monitor.list':     { req: void;                      res: MonitorRule[] };
  'monitor.delete':   { req: { id: Id };                res: void };
  'ocr.index':        { req: { captureId: Id; lang?: string[] }; res: { words: number } };
  'ocr.search':       { req: { q: string; limit?: number }; res: OcrSearchHit[] };
  'evidence.build':   { req: { captureId: Id; options?: EvidenceOptions }; res: { ref: BlobRef; manifest: EvidenceManifest } };
  'bugreport.build':  { req: { captureId: Id; options?: BugReportOptions }; res: { ref: BlobRef; report: BugReport } };
  'tabs.listForCapture': { req: { scope: 'currentWindow' | 'allWindows' }; res: TabSummary[] };
  'log.dump':         { req: { jobId?: Id };            res: { lines: string[] } };
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };
```

---

## 3. Capture

### 3.1 Request
```ts
export type CaptureMode =
  | 'fullPage'          // tüm belge (document scrolling element)
  | 'visible'           // mevcut viewport
  | 'selection'         // kullanıcı çizdiği dikdörtgen (viewport koordinatları; sayfa scroll'u ile tam sayfa koordinatına çevrilir)
  | 'element'           // tıklanarak seçilen DOM elementi (tam yüksekliğiyle; scroll container ise içi de)
  | 'selector'          // CSS selector ile element
  | 'scrollContainer'   // seçilen/algılanan iç scroll alanı (chat paneli vb.)
  | 'iframe'            // belirli bir frame'in tamamı
  | 'infinite'          // auto-scroll ile sonsuz sayfa
  | 'allTabs'           // pencere(ler)deki tüm sekmeler (alt istekler üretir)
  | 'browserWindow';    // pencere görünür alanı (visible ile aynı; sadece semantik)

export interface CaptureRequest {
  id?: Id;                               // SW atar
  mode: CaptureMode;
  target: CaptureTarget;
  options: CaptureOptions;
  export: ExportPlan;                    // capture bitince ne yapılacak (04)
  presetId?: Id;
  trigger: 'popup' | 'shortcut' | 'contextMenu' | 'sidePanel' | 'batch' | 'recapture' | 'api' | 'monitor';
  meta?: { batchId?: Id; batchItemId?: Id; recaptureOf?: Id; monitorRuleId?: Id };
}

export interface CaptureTarget {
  tabId?: number;                        // yoksa aktif sekme
  windowId?: number;
  frameId?: number;                      // mode 'iframe' için
  selector?: string;                     // mode 'selector' | 'element' (picker sonucu normalize edilmiş selector)
  selectorIndex?: number;                // aynı selector'dan kaçıncı (0)
  rect?: Rect;                           // mode 'selection' — CSS px, **sayfa** koordinatı (scrollX/Y eklenmiş)
  url?: Url;                             // batch/recapture: önce bu URL'ye gidilir
  tabIds?: number[];                     // mode 'allTabs'
}

export interface CaptureOptions {
  backend: 'auto' | 'visibleTab' | 'debugger';
  delayMs: Millis;                       // capture öncesi sabit gecikme (timer)
  countdownOverlay: boolean;             // delay sırasında geri sayım göster
  hideFixedElements: 'auto' | 'always' | 'never';   // auto = ilk tile sonrası gizle (03 §6)
  hideScrollbars: boolean;               // varsayılan true
  freezeAnimations: boolean;             // varsayılan true
  pauseMedia: boolean;                   // video/audio pause
  smartHide: SmartHideOptions;           // cookie banner vb. (09 §3)
  lazyLoad: LazyLoadOptions;
  wait: WaitConditions;                  // her tile öncesi / sayfa hazır bekleme
  infinite?: InfiniteScrollOptions;      // mode 'infinite'
  iframes: 'pixelsOnly' | 'injectSameOrigin' | 'injectAll';   // 03 §9
  dprMode: 'device' | 'css' | number;    // çıktı ölçeği: device (DPR×), css (1×), veya sabit çarpan
  zoomHandling: 'normalizeTo100' | 'keep';
  limits: CaptureLimits;
  captureCursor: false;                  // her zaman false (captureVisibleTab cursor yakalamaz)
  background: 'page' | 'transparent';    // transparent sadece element/selector modunda denenir (03 §7.4)
  includeMetadata: boolean;              // EXIF/PNG tEXt ile URL/timestamp gömme (04 §7)
  captureHorizontalOverflow: boolean;    // yatay taşmayı en fazla 5 sütunla yakala
}

export interface SmartHideOptions {
  enabled: boolean;
  categories: Array<'cookieBanner' | 'modal' | 'chatWidget' | 'ad' | 'floatingWidget' | 'newsletterPopup' | 'stickyBar'>;
  customSelectors: string[];             // kullanıcı ek selector'ları
  mode: 'hide' | 'remove';               // visibility:hidden vs. display:none (remove layout'u değiştirir)
}

export interface LazyLoadOptions {
  enabled: boolean;                      // varsayılan true (fullPage/infinite/element)
  preScroll: boolean;                    // capture öncesi hızlı tam scroll turu
  preScrollStepCss: CssPx;               // varsayılan viewport yüksekliği
  preScrollDwellMs: Millis;              // adım başına bekleme (100)
  forceEagerImages: boolean;             // loading="lazy" → eager, data-src → src
  waitImagesDecode: boolean;
  waitFonts: boolean;
  maxWaitMs: Millis;                     // toplam üst sınır (lazyLoadWaitMs, 1500)
}

export interface WaitConditions {
  fixedDelayMs?: Millis;
  networkIdle?: { idleMs: Millis; maxWaitMs: Millis; maxInflight?: number };   // PerformanceObserver resource bazlı
  domQuiet?: { quietMs: Millis; maxWaitMs: Millis };                             // MutationObserver
  selectorVisible?: { selector: string; timeoutMs: Millis };
  selectorHidden?:  { selector: string; timeoutMs: Millis };
  fontsReady?: { timeoutMs: Millis };
  imagesLoaded?: { timeoutMs: Millis; inViewportOnly: boolean };
  pageLoad?: 'domcontentloaded' | 'load' | 'none';     // batch navigasyonunda
  customJs?: never;                                     // REMOTE CODE YASAK — desteklenmez
}

export interface InfiniteScrollOptions {
  maxSteps: number;                      // 100
  maxHeightCss: CssPx;                   // 100_000
  maxDurationMs: Millis;                 // 120_000
  stepDwellMs: Millis;                   // yeni içerik için bekleme (800)
  stopWhenNoGrowth: number;              // ardışık büyümesiz adım sayısı (3)
  duplicateDetection: boolean;           // perceptual hash ile aynı tile tekrarını algıla
  manualStop: boolean;                   // overlay'de "Stop capture" göster
  direction: 'down' | 'up';               // iç scroll/chat geçmişi yönü
  clickSelector?: string;                 // P2: her adımda tıklanacak load-more düğmesi
}

export interface CaptureLimits {
  maxCaptureHeightCss: CssPx;            // 50_000
  maxTiles: number;                      // 200
  maxDurationMs: Millis;                 // 180_000
  stepSettleMs: Millis;                  // 150
  tileFormat: 'png' | 'jpeg';            // captureVisibleTab formatı (png)
  maxOutputPixels: number;               // tek görüntü için; aşılırsa strip (268_435_456)
  maxStripHeightPx: DevicePx;            // 16_384 (güvenli) — runtime probe ile güncellenir
  memoryBudgetMb: number;                // offscreen stitch hedefi (600)
}
```

### 3.2 Sayfa metrikleri (CS → SW)
```ts
export interface ScanOptions {
  findScrollContainers: boolean;
  findFixedElements: boolean;
  findIframes: boolean;
  targetSelector?: string;               // element/selector modunda hedefi de ölç
  rect?: Rect;                           // selection modunda
}

export interface PageMetrics {
  url: Url; title: string; origin: string;
  viewport: Size;                        // innerWidth/innerHeight (CSS)
  document: Size;                        // scrollingElement scrollWidth/Height (CSS)
  scroll: Point;                         // mevcut scrollX/Y
  dpr: number;
  zoom: number;                          // chrome.tabs.getZoom (SW doldurur)
  hasHorizontalOverflow: boolean;
  scrollingElement: 'document' | 'custom';   // body/html yerine bir container scroll ediyorsa (ör. overflow hidden + inner div)
  primaryScrollContainer?: ElementInfo;      // document scroll etmiyorsa en büyük scrollable
  scrollContainers: ElementInfo[];           // scrollHeight > clientHeight + overflow auto/scroll/overlay
  fixedElements: FixedElementInfo[];
  iframes: IframeInfo[];
  target?: ElementInfo;                      // element/selector modunda
  lazyImages: number;                        // img[loading=lazy] / data-src sayısı
  direction: 'ltr' | 'rtl';
  isRestricted: boolean;                     // chrome:// vb. (SW de kontrol eder)
  userAgent: string;
  colorScheme: 'light' | 'dark';
}

export interface ElementInfo {
  selector: string;                      // üretilmiş benzersiz selector (03 §7.2 algoritması)
  rect: Rect;                            // CSS px, sayfa koordinatı (scroll eklenmiş)
  clientSize: Size; scrollSize: Size;
  isScrollable: boolean;
  overflow: { x: string; y: string };
  tag: string; id?: string; classes: string[];
  frameId: number;                       // 0 = top
  depth: number;
}

export interface FixedElementInfo extends ElementInfo {
  position: 'fixed' | 'sticky';
  anchor: 'top' | 'bottom' | 'left' | 'right' | 'full' | 'other';   // viewport kenarına göre
  coversViewportPct: Percent;
  zIndex: number;
  isTransparentOverlay: boolean;         // pointer-events:none / opacity 0 vb. (gizlenmez)
}

export interface IframeInfo {
  frameId?: number;                      // webNavigation varsa
  selector: string;
  rect: Rect;
  sameOrigin: boolean;
  src: Url;
  isScrollable?: boolean;                // sameOrigin ise ölçülür
  scrollSize?: Size;
}
```

### 3.3 Hazırlık / scroll / bekleme
```ts
export interface PreparePlan {
  hideScrollbars: boolean;
  freezeAnimations: boolean;
  pauseMedia: boolean;
  smartHide: SmartHideOptions;
  lazyLoad: LazyLoadOptions;
  fixedStrategy: 'none' | 'hideAfterFirst' | 'hideAll' | 'absolutize';   // 03 §6
  fixedTargets?: string[];               // selector listesi (SW hesaplar; boş = CS'nin kendi taraması)
  scrollContainerSelector?: string;      // hedef iç scroll alanı
  overlay: { showProgress: boolean; allowCancel: boolean; allowStop: boolean };
  restoreScroll: boolean;                // bitince orijinal scroll'a dön (true)
}

export interface PreparedState {
  hiddenSelectors: string[];
  removedScrollbars: boolean;
  pausedMedia: number;
  eagerizedImages: number;
  smartHidden: Array<{ selector: string; category: string }>;
  scrollRoot: 'document' | string;       // scroll edilecek kök (selector)
  effectiveDocument: Size;               // hazırlık sonrası (lazy-load sonrası büyümüş olabilir)
}

export interface ScrollCommand {
  stepIndex: number;
  x: CssPx; y: CssPx;                    // hedef scroll (scrollRoot'a göre)
  afterFirstTile: boolean;               // fixedStrategy=hideAfterFirst için tetik
  settleMs: Millis;
  wait?: WaitConditions;                 // adım bazlı ek bekleme
}
export interface ScrollAck {
  stepIndex: number;
  actual: Point;                         // gerçekleşen scroll (sona gelince hedeften küçük olur)
  documentNow: Size;                     // büyüme kontrolü (infinite/lazy)
  hiddenApplied: boolean;
  elapsedMs: Millis;
}
export interface WaitResult { satisfied: string[]; timedOut: string[]; elapsedMs: Millis; }

export interface InfiniteScrollStep { stepIndex: number; dwellMs: Millis; }
export interface InfiniteScrollAck { scrollTop: CssPx; documentHeight: CssPx; grew: boolean; reachedEnd: boolean; }

export interface OverlayState {
  visible: boolean;
  phase?: JobPhase; done?: number; total?: number; message?: string;
  countdown?: number;                    // saniye
  buttons?: Array<'cancel' | 'stop'>;
}
```

### 3.4 Picker (element / selection / scroll container)
```ts
export interface PickerOptions {
  mode: 'element' | 'scrollContainer' | 'selection';
  highlightColor?: string;
  showInfoBadge: boolean;                // tag#id.class + boyut
  allowParentNavigation: boolean;        // ↑/↓ ile ebeveyne/çocuğa geçiş
  onlyScrollable?: boolean;              // scrollContainer modunda sadece scrollable elementler vurgulanır
}
export type PickerEvent =
  | { kind: 'hover'; info: ElementInfo }
  | { kind: 'picked'; info: ElementInfo }
  | { kind: 'selected'; rect: Rect /*sayfa CSS px*/ }
  | { kind: 'cancelled' };
```

### 3.5 Job state / progress
```ts
export type JobPhase = 'idle' | 'preparing' | 'countdown' | 'capturing' | 'stitching' | 'exporting' | 'done' | 'cancelled' | 'failed';

export interface JobState {
  jobId: Id;
  request: CaptureRequest;
  tabId: number; windowId: number;
  backend: 'visibleTab' | 'debugger';
  phase: JobPhase;
  startedAt: IsoDate; updatedAt: IsoDate; finishedAt?: IsoDate;
  progress: { done: number; total: number; etaMs?: Millis };
  metrics?: PageMetrics;
  plan?: ScrollPlan;
  tilesWritten: number;
  error?: ErrorInfo;
  captureId?: Id;                        // done sonrası
  log: string[];                         // son 200 satır
}
export interface JobProgress { jobId: Id; phase: JobPhase; done: number; total: number; message?: string; etaMs?: Millis; visible?: boolean; allowCancel?: boolean; }

export interface ScrollPlan {
  root: 'document' | string;
  viewport: Size;                        // CSS
  content: Size;                         // CSS (capture alanı)
  origin: Point;                         // capture alanının sayfa koordinatındaki sol üstü (element modunda element.rect)
  steps: ScrollStep[];                   // satır-major (y sonra x)
  cols: number; rows: number;
  overlapCss: CssPx;                     // 0 (Karar: overlap yok; son satır/sütun 'offset' ile hizalanır)
  dpr: number; zoom: number;
  warnings: string[];                    // limit/sticky/overflow uyarıları
  stickyInsets?: { top: CssPx; bottom: CssPx; left: CssPx; right: CssPx };
  scrollBounds?: Size;                   // seçim/element planlarında scroll root'un gerçek sınırı
}
export interface ScrollStep {
  index: number; row: number; col: number;
  scrollTo: Point;                       // CSS, scrollRoot'a göre
  /** Tile'ın çıktı tuvalinde yerleştirileceği yer ve viewport'tan kesilecek bölge (DevicePx) */
  placeAt: Point;                        // DevicePx çıktı koordinatı
  cropFromViewport: Rect;                // DevicePx; son satır/sütunda tile'ın sadece bir kısmı kullanılır
}
```

### 3.6 Tile / stitch
```ts
export interface TileRecord {            // IndexedDB `tiles`
  id: string;                            // `${jobId}:${index}`
  jobId: Id; index: number;
  blob: Blob;                            // PNG (sadece offscreen/SW okur)
  step: ScrollStep;
  capturedAt: IsoDate;
  size: Size;                            // DevicePx gerçek tile boyutu
}

export interface StitchRequest {
  jobId: Id;
  plan: ScrollPlan;
  tileCount: number;
  output: { size: Size /*DevicePx*/; maxSide: DevicePx; maxPixels: number; background: string | 'transparent'; };
  postCrop?: Rect;                       // element/selection modunda çıktı tuvalinden kesilecek (DevicePx)
  scaleTo?: number;                      // dprMode css → 1/dpr
  produceStrips: 'auto' | 'never' | 'force';
}
export interface StitchResult {
  full?: BlobRef;                        // limitlere sığıyorsa tek görüntü (PNG)
  strips: BlobRef[];                     // sığmıyorsa ya da force ise parçalar (yukarıdan aşağı)
  size: Size;                            // toplam DevicePx
  stripHeightPx?: DevicePx;
  memoryPeakMb?: number;
  warnings: string[];
}
export interface CanvasLimits { maxSide: number; maxArea: number; probedAt: IsoDate; }
```

### 3.7 Sonuç
```ts
export interface CaptureResultSummary {
  captureId: Id;
  size: Size;                            // DevicePx
  cssSize: Size;
  strips: number;                        // 0 = tek görüntü
  durationMs: Millis;
  backend: 'visibleTab' | 'debugger';
  warnings: string[];                    // ör. "3 sticky element gizlendi", "lazy-load zaman aşımı"
}
```

---

## 4. Export

```ts
export type ExportFormat = 'png' | 'jpeg' | 'webp' | 'pdf' | 'gif' | 'bmp' | 'avif';
export type ExportTarget = 'download' | 'clipboard' | 'history' | 'openResult' | 'print' | 'integration';

export interface ExportPlan {
  targets: ExportTarget[];               // varsayılan ['history','openResult']
  format: ExportFormat;                  // openResult için önizleme formatı PNG'dir; download/clipboard için bu
  image: ImageEncodeOptions;
  pdf?: PdfOptions;
  gif?: GifOptions;
  filename: FilenameTemplate;            // 12. bölüm grameri
  download: DownloadOptions;
  multiImage: 'zip' | 'separate' | 'pdfPages';   // strip'ler nasıl teslim edilir
  metadata: EmbeddedMetadataOptions;
  watermark?: WatermarkOptions;
  integration?: IntegrationSendRequest;  // target 'integration' ise
}

export interface ImageEncodeOptions {
  jpegQuality: number;                   // 0..1 (0.92)
  webpQuality: number;                   // 0..1 (0.9)
  pngCompression: 'fast' | 'default' | 'max';   // fast-png/UPNG için
  maxWidthPx?: DevicePx;                 // downscale
  maxHeightPx?: DevicePx;
  scale?: number;                        // 0.1..1
  stripAlpha: boolean;                   // JPEG/BMP için zorunlu true
}

export interface DownloadOptions {
  auto: boolean;                         // capture bitince otomatik indir
  saveAs: boolean;                       // Chrome "Farklı kaydet" diyaloğu
  subfolder: string;                     // Downloads altında göreli ("Screenshots/{domain}") — template destekler; '..' yasak
  conflictAction: 'uniquify' | 'overwrite' | 'prompt';
}

export type PdfPageSize = 'auto' /*tek uzun sayfa*/ | 'A4' | 'A3' | 'A5' | 'Letter' | 'Legal' | 'Tabloid' | { widthPt: Pt; heightPt: Pt };
export interface PdfOptions {
  mode: 'singleLongPage' | 'paged';
  pageSize: PdfPageSize;                 // paged modda
  orientation: 'portrait' | 'landscape' | 'auto';
  fit: 'width' | 'contain';              // görüntü sayfaya nasıl sığar
  marginPt: { top: Pt; right: Pt; bottom: Pt; left: Pt };   // varsayılan 0 (auto) / 28 (paged)
  scale: number;                         // 1 = CSS px → 0.75 pt (96 dpi)
  smartPageBreaks: boolean;              // metin satırı/görsel bölmeme (04 §5.4)
  breakSearchWindowPct: Percent;         // sayfanın son %20'sinde en iyi kesim noktası aranır
  imageFormat: 'jpeg' | 'png';           // PDF'e gömülen görüntü (jpeg varsayılan — boyut)
  imageQuality: number;                  // jpeg 0..1 (0.85)
  clickableLinks: boolean;
  searchableText: 'none' | 'ocr' | 'native';   // native = cdp printToPDF (sadece cdp varyantı)
  ocrLang?: string[];
  headerFooter: PdfHeaderFooter;
  watermark?: WatermarkOptions;
  metadata: { title?: string; author?: string; subject?: string; keywords?: string[]; creator: string };
  outline: boolean;                      // DOM h1/h2 → bookmark (opsiyonel, P2)
  maxSinglePageHeightPt: Pt;             // 14_400 (200 inch) — aşılırsa otomatik böl
  combineStrategy?: 'appendPages';       // çoklu capture → tek PDF
}
export interface PdfHeaderFooter {
  enabled: boolean;
  header: { left?: HfToken[]; center?: HfToken[]; right?: HfToken[] };
  footer: { left?: HfToken[]; center?: HfToken[]; right?: HfToken[] };
  fontSizePt: Pt;                        // 8
  color: string;                         // '#666'
  heightPt: Pt;                          // 24
}
export type HfToken = '{title}' | '{url}' | '{domain}' | '{date}' | '{time}' | '{datetime}' | '{page}' | '{pages}' | '{timezone}' | `{text:${string}}`;

export interface GifOptions { colors: number /*256*/; dither: boolean; }
export interface WatermarkOptions {
  kind: 'text' | 'image';
  text?: string; imageRef?: BlobRef;
  position: 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight' | 'center' | 'tile';
  opacity: number; fontSizePx?: number; color?: string; marginPx: number; rotateDeg?: number;
}
export interface EmbeddedMetadataOptions {
  enabled: boolean;                      // PNG tEXt/iTXt, JPEG EXIF/XMP, PDF Info/XMP
  fields: Array<'url' | 'title' | 'timestamp' | 'timezone' | 'viewport' | 'dpr' | 'userAgent' | 'sha256' | 'captureMode' | 'appVersion'>;
}

export interface EncodeRequest {
  src: BlobRef | BlobRef[];              // strip'ler
  format: ExportFormat; options: ImageEncodeOptions;
  watermark?: WatermarkOptions; metadata?: Record<string, string>;
}
export interface PdfBuildRequest {
  jobId?: Id;
  images: Array<{ ref: BlobRef; cssWidth: CssPx; cssHeight: CssPx; dpr: number }>;   // strip'ler ya da çoklu capture
  options: PdfOptions;
  links?: LinkRect[]; textRects?: TextRect[]; ocr?: OcrResult[];
  context: { url: Url; title: string; domain: string; capturedAt: IsoDate; timezone: string };
}
export interface LinkRect { href: Url; rect: Rect; /*CSS px, sayfa koordinatı*/ frameId?: number; }
export interface TextRect {
  rect: Rect;
  kind: 'textLine' | 'image' | 'block' | 'heading';
  text?: string;
  level?: number;
}

export interface ExportRequest {
  captureId: Id; plan: ExportPlan;
  stripIndex?: number;                   // sadece bir strip
  editedRef?: BlobRef;                   // editörden gelen düzenlenmiş görüntü
}
export interface ExportResult { files: Array<{ ref: BlobRef; filename: string; downloadId?: number }>; warnings: string[]; }
export interface ZipRequest { entries: Array<{ name: string; ref: BlobRef }>; level: 0 | 1 | 6; comment?: string; }
```

---

## 5. History / Storage

```ts
export interface CaptureRecordAux { links?: LinkRect[]; textRects?: TextRect[]; }
export interface CaptureRecord {        // IndexedDB `captures`
  id: Id;
  createdAt: IsoDate; updatedAt: IsoDate;
  url: Url; domain: string; title: string; favicon?: BlobRef;
  mode: CaptureMode; backend: 'visibleTab' | 'debugger';
  request: CaptureRequest;               // recapture için tam istek (tabId gibi geçici alanlar temizlenmiş)
  presetId?: Id; presetName?: string;
  size: Size; cssSize: Size; dpr: number; zoom: number; viewport: Size;
  files: CaptureFile[];                  // full / strips / pdf / edited
  thumbnail: BlobRef;                    // 320px genişlik WebP
  sha256?: Sha256Hex;                    // full görüntünün (evidence)
  tags: string[]; folderId?: Id; notes?: string;
  starred: boolean;
  ocr?: { indexedAt: IsoDate; lang: string[]; words: number };
  evidence?: EvidenceManifest;
  bugReport?: BugReport;
  aux?: CaptureRecordAux;
  source: { trigger: CaptureRequest['trigger']; batchId?: Id; batchItemId?: Id; recaptureOf?: Id; editedFrom?: Id; monitorRuleId?: Id };
  warnings: string[];
  durationMs: Millis;
  appVersion: string;
}
export interface CaptureFile {
  id: Id;
  role: 'full' | 'strip' | 'pdf' | 'edited' | 'evidenceBundle' | 'bugReport' | 'diff' | 'ocr' | 'editorDoc';
  index?: number;                        // strip sırası
  ref: BlobRef;
  format: ExportFormat | 'zip' | 'json';
  createdAt: IsoDate;
}
export type CaptureRecordPatch = Partial<Pick<CaptureRecord, 'title' | 'tags' | 'folderId' | 'notes' | 'starred'>>;

export interface HistoryQuery {
  q?: string;                            // title/url/notes/tags + (OCR varsa) metin
  domains?: string[]; tags?: string[]; folderId?: Id;
  modes?: CaptureMode[]; formats?: ExportFormat[];
  dateFrom?: IsoDate; dateTo?: IsoDate;
  starred?: boolean;
  sort: 'createdAt' | 'title' | 'domain' | 'size';
  dir: 'asc' | 'desc';
  cursor?: string; limit: number;        // keyset pagination (createdAt+id)
}
export interface HistoryMatch { field: 'title' | 'url' | 'notes' | 'tags' | 'ocr'; snippet: string; }
export interface HistoryPage { items: Array<CaptureRecord & { matches?: HistoryMatch[] }>; nextCursor?: string; total: number; }
export interface StorageStats { usageBytes: number; quotaBytes: number; captures: number; blobs: number; opfsBytes: number; persisted: boolean; }

export interface Folder { id: Id; name: string; parentId?: Id; createdAt: IsoDate; }
export interface Tag { name: string; color?: string; count: number; }
export interface BlobRow { id: string; blob: Blob; mime: string; bytes: number; createdAt: IsoDate; refCount: number; }
export interface OcrDocRow { captureId: Id; text: string; tokens: string[]; words: OcrResult['words']; wordsRef?: BlobRef; lang: string[]; indexedAt: IsoDate; }
export interface LogRow { id?: number; at: IsoDate; level: 'debug' | 'info' | 'warn' | 'error'; ns: string; jobId?: Id; msg: string; }
```

---

## 6. Settings & Presets

```ts
export interface Settings {
  schemaVersion: 1;
  general: {
    language: 'auto' | 'en' | 'tr';
    theme: 'system' | 'light' | 'dark';
    afterCapture: 'openResultTab' | 'openSidePanel' | 'downloadOnly' | 'clipboardOnly' | 'none';
    showNotifications: boolean;
    playSound: boolean;
    resultTabBehavior: 'newTab' | 'reuseTab';
    onboardingDone: boolean;
  };
  capture: CaptureOptions & { smartHideOverrides: Record<string, { disabled?: boolean; extra?: string[]; never?: string[] }> }; // global varsayılanlar + domain override'ları
  export: ExportPlan;                    // global varsayılanlar
  history: {
    enabled: boolean;                    // kapalıysa sadece geçici sonuç
    maxItems: number;                    // 1000
    maxBytes: number;                    // 2 GB
    autoCleanup: 'oldest' | 'ask' | 'never';
    keepOriginalsAfterEdit: boolean;
    thumbnailWidth: number;              // 320
    ocrAutoIndex: boolean;               // capture sonrası arka planda OCR (opt-in)
    recaptureCloseWindow: boolean;       // recapture penceresini bitince kapat
  };
  shortcuts: Record<string, string>;     // sadece görüntüleme; gerçek atama chrome://extensions/shortcuts
  privacy: {
    telemetry: boolean;                  // false
    crashReports: boolean;               // false
    embedMetadataDefault: boolean;
    clearOnUninstallNotice: boolean;
    storeIncognitoCaptures: boolean;
    policyVersionSeen?: string;
  };
  integrations: { [provider in IntegrationProvider]?: IntegrationSettings } & { proxyUrl?: Url };
  api: { enabled: boolean; allowedExtensionIds: string[]; approvedOrigins: string[] };
  editor: EditorSettings;
  presets: { defaultPresetId?: Id };
  advanced: {
    canvasLimits?: CanvasLimits;
    debugLogging: boolean;
    experimental: { cdpBackend: boolean; avif: boolean; promptApiOcr: boolean };
  };
}

export interface Preset {
  id: Id; name: string; icon?: string; builtin: boolean;
  description?: string;
  capture: DeepPartial<CaptureOptions> & { mode?: CaptureMode };
  export: DeepPartial<ExportPlan>;
  extras?: { evidence?: EvidenceOptions; bugReport?: BugReportOptions; ocrIndex?: boolean; autoTags?: string[] };
  createdAt: IsoDate; updatedAt: IsoDate;
}
```

Yerleşik presetler (`builtin:true`, 09 §9): `bug-report`, `legal-evidence`, `design-review`, `archive`, `qa-test`, `documentation`, `full-page-pdf`.

---

## 7. Hatalar

```ts
export type ErrorCode =
  | 'E_RESTRICTED_PAGE' | 'E_PERMISSION_DENIED' | 'E_RATE_LIMIT' | 'E_TAB_NOT_ACTIVE' | 'E_TAB_CLOSED'
  | 'E_WINDOW_NOT_VISIBLE' | 'E_AGENT_INJECT' | 'E_AGENT_DISCONNECTED' | 'E_TIMEOUT' | 'E_CANVAS_LIMIT'
  | 'E_MEMORY' | 'E_DEBUGGER_ATTACH' | 'E_DEBUGGER_DETACHED' | 'E_SW_RESTART' | 'E_STORAGE_QUOTA'
  | 'E_EXPORT' | 'E_ENCODE' | 'E_PDF' | 'E_DOWNLOAD' | 'E_CLIPBOARD' | 'E_NETWORK' | 'E_AUTH'
  | 'E_INTEGRATION' | 'E_SELECTOR_NOT_FOUND' | 'E_ELEMENT_TOO_LARGE' | 'E_CANCELLED' | 'E_PROTOCOL'
  | 'E_VALIDATION' | 'E_NOT_SUPPORTED' | 'E_UNKNOWN';

export interface ErrorInfo {
  code: ErrorCode;
  message: string;                       // teknik (İngilizce)
  userMessageKey: string;                // i18n anahtarı
  details?: Record<string, unknown>;
  recoverable: boolean;                  // "Tekrar dene" gösterilsin mi
  at: IsoDate;
}
```

---

## 8. Batch

```ts
export interface BatchJobInput {
  name?: string;
  source: { kind: 'urls'; urls: Url[] } | { kind: 'tabs'; tabIds: number[] } | { kind: 'sitemap'; url: Url /*P2*/ };
  mode: Exclude<CaptureMode, 'selection' | 'allTabs' | 'browserWindow'>;
  selector?: string;
  capture: DeepPartial<CaptureOptions>;
  wait: WaitConditions & { pageLoad: 'domcontentloaded' | 'load' };
  export: ExportPlan & { combine: 'none' | 'singlePdf' | 'zip' | 'zipAndPdf' };
  control: BatchControl;
  presetId?: Id;
  qa?: { enabled: boolean; thresholdPct: Percent; baselineTag: string };
}
export interface BatchControl {
  concurrency: 1 | 2 | 3;                // paralel sekme sayısı (varsayılan 1; captureVisibleTab pencere başına aktif sekme gerektirir → her paralel iş ayrı pencere)
  perItemTimeoutMs: Millis;              // 60_000
  retry: { max: number; backoffMs: Millis };   // 2 / 2000
  delayBetweenMs: Millis;                // 500
  closeTabsAfter: boolean;               // true (urls modunda)
  useIncognito: boolean;                 // false (izin gerekir)
  windowSize?: Size;                     // batch penceresi boyutu (viewport sabitleme)
  stopOnError: boolean;                  // false
  fallbackToFullPage: boolean;            // selector yoksa fullPage'e düş
  pdfChunkSize: number;                   // combined PDF parça boyutu, varsayılan 200
}
export type BatchStatus = 'queued' | 'running' | 'paused' | 'completed' | 'completedWithErrors' | 'cancelled' | 'failed';
export interface BatchJob {
  id: Id; name: string; input: BatchJobInput;
  status: BatchStatus;
  createdAt: IsoDate; startedAt?: IsoDate; finishedAt?: IsoDate;
  items: BatchItem[];
  summary: { total: number; done: number; failed: number; skipped: number };
  outputs: Array<{ kind: 'zip' | 'pdf' | 'file'; ref: BlobRef; filename: string; downloadId?: number }>;
  log: BatchLogLine[];
}
export interface BatchItem {
  id: Id; index: number; url: Url; itemName?: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'skipped' | 'cancelled';
  attempts: number;
  notBefore?: IsoDate;
  tabId?: number; windowId?: number;
  captureId?: Id; error?: ErrorInfo;
  startedAt?: IsoDate; finishedAt?: IsoDate; durationMs?: Millis;
}
export interface BatchLogLine { at: IsoDate; level: 'info' | 'warn' | 'error'; itemId?: Id; msg: string; }
export type BatchEvent = { batchId: Id; kind: 'status' | 'item' | 'log' | 'output'; job?: BatchJob; item?: BatchItem; line?: BatchLogLine; };
export interface TabSummary { tabId: number; windowId: number; url: Url; title: string; favIconUrl?: string; active: boolean; discarded: boolean; restricted: boolean; }
```

---

## 9. Editor / Annotation Modeli

```ts
export interface EditorDocument {
  version: 1;
  captureId: Id;
  base: { ref: BlobRef; size: Size };    // düzenlenmemiş görüntü (redaction sonrası YENİ base üretilir)
  canvas: { size: Size; background: string; cropRect?: Rect; rotation: 0 | 90 | 180 | 270; scale: number; };
  viewportOffset?: Point;
  zoom?: number;
  layers: Annotation[];                  // z-order = dizi sırası
  history: { undo: number; redo: number };   // sadece UI bilgisi; komut yığını bellekte
  updatedAt: IsoDate;
}

export type AnnotationType = 'arrow' | 'rect' | 'ellipse' | 'line' | 'freehand' | 'text' | 'highlight' | 'marker' | 'emoji' | 'image' | 'blur' | 'pixelate' | 'redact' | 'crop';

export interface AnnotationBase {
  id: Id; type: AnnotationType;
  rect: Rect;                            // bbox, canvas koordinatı (DevicePx)
  rotationDeg: number; opacity: number; locked: boolean; visible: boolean; name?: string;
  style: AnnotationStyle;
  createdAt: IsoDate;
}
export interface AnnotationStyle {
  stroke: string; strokeWidth: number; strokeDash?: number[];
  fill: string | 'none';
  lineCap?: 'butt' | 'round' | 'square';
  fontFamily?: string; fontSizePx?: number; fontWeight?: 400 | 600 | 700; fontStyle?: 'normal' | 'italic'; textAlign?: 'left' | 'center' | 'right';
  textBackground?: string | 'none';
  shadow?: boolean;
  arrowHead?: 'end' | 'start' | 'both' | 'none'; arrowHeadSize?: number;
  cornerRadius?: number;
}
export type Annotation =
  | (AnnotationBase & { type: 'arrow' | 'line'; from: Point; to: Point })
  | (AnnotationBase & { type: 'rect' | 'ellipse' | 'highlight' })
  | (AnnotationBase & { type: 'freehand'; points: Point[]; smoothing: number })
  | (AnnotationBase & { type: 'text'; text: string; autoSize: boolean })
  | (AnnotationBase & { type: 'marker'; number: number; shape: 'circle' | 'square' })
  | (AnnotationBase & { type: 'emoji'; emoji: string })
  | (AnnotationBase & { type: 'image'; ref: BlobRef })
  | (AnnotationBase & { type: 'blur'; radiusPx: number })          // export'ta base'e uygulanır; KALDIRILABİLİR (gizlilik için yeterli DEĞİL — UI uyarır)
  | (AnnotationBase & { type: 'pixelate'; blockPx: number })
  | (AnnotationBase & { type: 'redact'; color: string })           // COMMIT anında base piksellerini kalıcı yok eder (05 §5.2)
  | (AnnotationBase & { type: 'crop' });

export interface EditorExport { format: ExportFormat; flatten: true; includeAnnotations: boolean; scale: number; }
```

---

## 10. Diff / Evidence / Bug Report / OCR / Monitor

```ts
export interface DiffOptions {
  threshold: number;                     // pixelmatch 0..1 (0.1)
  includeAA: boolean;                    // false
  alignment: 'top' | 'none';             // farklı yüksekliklerde üstten hizala + pad
  ignoreRegions: Rect[];                 // CSS px (sayfa) — dinamik alanlar
  highlightColor: string; addedColor: string; removedColor: string;
  clusterGapPx: number;                  // değişen pikselleri bbox'lara kümeleme mesafesi (12)
  minClusterAreaPx: number;              // gürültü filtresi (64)
}
export interface DiffRequest { baseRef: BlobRef; headRef: BlobRef; options: DiffOptions; }
export interface DiffResult {
  id?: Id; baseId?: Id; headId?: Id;
  changedPixels: number; totalPixels: number; changedPct: Percent;
  regions: Array<Rect & { kind: 'changed' | 'added' | 'removed' }>;   // DevicePx
  maskRef?: BlobRef;                     // kırmızı overlay PNG (transparan)
  sideBySideRef?: BlobRef;               // opsiyonel kompozit
  sizeBase: Size; sizeHead: Size;
  durationMs: Millis; createdAt: IsoDate;
}
export interface DiffTimelineEntry { captureId: Id; createdAt: IsoDate; thumbnail: BlobRef; changedPctFromPrev?: Percent; diffId?: Id; }

export interface MonitorRule {
  id: Id; name: string; url: Url;
  request: CaptureRequest;               // mode genelde fullPage/selector
  schedule: { everyMinutes: number /*≥30*/; activeHours?: { from: string; to: string }; days?: number[] };
  diff: DiffOptions & { notifyThresholdPct: Percent };
  enabled: boolean; lastRunAt?: IsoDate; lastCaptureId?: Id; nextRunAt?: IsoDate;
  keepLast: number;
  requiresHostPermission: true;          // <all_urls> veya origin bazlı
}

export interface EvidenceOptions {
  hashAlgorithms: Array<'SHA-256' | 'SHA-512'>;
  includeSidecarJson: boolean;           // manifest.json
  includeReportPdf: boolean;             // insan-okur rapor (görüntü + metadata tablosu + hash)
  embedInImage: boolean;                 // PNG iTXt
  rfc3161Timestamp?: { enabled: boolean; tsaUrl: Url };   // opt-in; ağ erişimi gerektirir (08)
  includeHeaders: boolean;               // sayfanın response header'ları (sadece cdp varyantı / webRequest ile) — store varyantında false
  includeDomSnapshot: boolean;           // documentElement.outerHTML (sanitize edilmez, evidence bütünlüğü için ham) — opsiyonel
}
export interface EvidenceManifest {
  version: 1;
  captureId: Id; url: Url; finalUrl: Url; title: string;
  capturedAt: IsoDate; timezone: string; timezoneOffsetMin: number;
  browser: { name: string; version: string; uaFull: string; platform: string; extensionVersion: string; buildVariant: 'store' | 'cdp' };
  viewport: Size; dpr: number; zoom: number; colorScheme: 'light' | 'dark'; locale: string;
  image: { sha256: Sha256Hex; sha512?: string; sha256Embedded?: Sha256Hex; bytes: number; size: Size; format: 'png' };
  strips?: Array<{ index: number; sha256: Sha256Hex }>;
  domSnapshot?: { sha256: Sha256Hex; bytes: number };
  tsa?: { tsaUrl: Url; tokenBase64: string; genTime: IsoDate; serial: string };
  captureSettings: CaptureOptions;
  warnings: string[];
}

export interface BugReportOptions {
  includeConsole: boolean; includeNetworkErrors: boolean; includeEnvironment: boolean; includeDomPath: boolean;
  consoleLevels: Array<'error' | 'warn' | 'info' | 'log'>; maxEntries: number;   // 200
  format: 'markdown' | 'json' | 'both';
}
export interface ConsoleEntry { level: 'error' | 'warn' | 'info' | 'log' | 'debug'; text: string; at: IsoDate; source?: string; line?: number; stack?: string; }
export interface BugReport {
  version: 1; captureId: Id;
  url: Url; title: string; capturedAt: IsoDate;
  environment: { userAgent: string; uaData?: Record<string, unknown>; platform: string; language: string; viewport: Size; dpr: number; zoom: number; screen: Size; colorScheme: string; online: boolean; extensionVersion: string };
  console: ConsoleEntry[]; consoleSource: 'mainWorldTap' | 'cdp' | 'none';
  networkErrors: Array<{ url: Url; status?: number; error?: string; at: IsoDate }>;
  notes?: string;
  markdown: string;                      // hazır yapıştırılabilir rapor
}

export interface OcrRequest { src: BlobRef; lang: string[]; scale?: number; psm?: number; }
export interface OcrResult { text: string; words: Array<{ text: string; bbox: Rect /*DevicePx*/; confidence: number; line: number; block: number }>; lang: string[]; durationMs: Millis; }
export interface OcrSearchHit { captureId: Id; snippet: string; score: number; bbox?: Rect; }
```

---

## 11. Integrations

```ts
export type IntegrationProvider = 'jira' | 'linear' | 'slack' | 'notion' | 'trello' | 'github' | 'webhook' | 'gdrive' | 'dropbox' | 'onedrive';
export type FeatureKey = 'allTabs' | 'batch' | 'iframeInject' | 'integrations' | 'monitoring' | 'nativeApi' | 'incognitoBatch' | 'fileUrls' | 'notifications' | 'bugReportNetwork' | 'tsa' | 'webhook';

export interface IntegrationSettings { enabled: boolean; account?: IntegrationAccount; defaults?: Record<string, unknown>; }
export interface IntegrationAccount {
  provider: IntegrationProvider; accountId: string; displayName: string; connectedAt: IsoDate;
  auth: { kind: 'oauth'; accessToken: string; refreshToken?: string; expiresAt?: IsoDate; scopes: string[] } | { kind: 'apiToken'; token: string; baseUrl?: Url } | { kind: 'none' };
  // webhook: { url, secret, headers }
  config?: Record<string, unknown>;      // jira cloudId/site, slack teamId, github repo, notion databaseId, trello boardId/listId...
}
export interface IntegrationSendRequest {
  provider: IntegrationProvider; captureId: Id; fileRef?: BlobRef;   // edited ya da pdf
  title: string; description?: string;
  fields: Record<string, unknown>;       // provider'a özel: jira {projectKey, issueType, ...}, slack {channel}, github {owner, repo, labels}
  includeBugReport?: boolean; includeEvidence?: boolean;
}
export interface IntegrationSendResult { ok: boolean; url?: Url; externalId?: string; error?: ErrorInfo; }
export interface PermissionStatus { feature: FeatureKey; granted: boolean; missing: { permissions: string[]; origins: string[] }; rationaleKey: string; }
```

---

## 12. Filename Template Grameri

```
template   := segment*
segment    := literal | token
token      := "{" name ( ":" format )? ( "|" fallback )? "}"
name       := "domain" | "hostname" | "title" | "url" | "date" | "time" | "datetime" | "yyyy-mm-dd" | "yyyy" | "mm" | "dd" | "hh" | "min" | "ss"
            | "counter" | "viewport" | "width" | "height" | "mode" | "preset" | "tabIndex" | "batchIndex" | "batchName" | "format" | "strip" | "random" | "timezone" | "uuid"
format     := [A-Za-z0-9_\-:.]+        // counter:3 → 001 ; title:40 → ilk 40 karakter ; date:yyyymmdd ; random:6
fallback   := literal                  // değer boşsa
literal    := herhangi karakter (dosya sistemi için güvensizler "_" ile değiştirilir)
```
- Desteklenen değişkenler (kaynak dokümandakiler + ek): `{domain}` (`example.com`), `{hostname}` (`www.example.com`), `{title}` (sanitize, max 80), `{url}` (sanitize; `https://` ve `/` → `_`), `{date}` (`yyyy-mm-dd`), `{time}` (`HH-MM-SS`), `{datetime}`, `{yyyy-mm-dd}`, `{counter}` (profil genel artan, `counter:N` zero-pad), `{viewport}` (`1440x900`), `{width}`, `{height}` (çıktı DevicePx), `{mode}`, `{preset}`, `{tabIndex}`, `{batchIndex}`, `{batchName}`, `{format}` (uzantı), `{strip}` (parça no), `{random:N}`, `{timezone}`, `{uuid}`.
- Varsayılan: `{domain}_{yyyy-mm-dd}_{time}` ; batch varsayılanı: `{batchIndex:3}_{domain}_{title:40}`.
- Sanitizasyon: `\ / : * ? " < > |` ve kontrol karakterleri → `_`; baştaki/sondaki nokta ve boşluk kırpılır; Windows rezerve adlar (CON, PRN, AUX, NUL, COM1-9, LPT1-9) → `_` eki; toplam dosya adı ≤ 180 bayt (UTF-8), uzantı hariç; boş sonuç → `screenshot`.
- Uzantı otomatik eklenir (`.png` vb.); kullanıcı şablona uzantı yazarsa yoksayılır.
- `subfolder` aynı grameri kullanır; `..` ve mutlak yol reddedilir (`E_VALIDATION`).

---

## 13. Public API (externally_connectable / native messaging)

```ts
export type ApiRequest =
  | { v: 1; op: 'capture'; request: Omit<CaptureRequest, 'trigger'> & { returnAs?: 'dataUrl' | 'blobRef' | 'none' } }
  | { v: 1; op: 'batch'; input: BatchJobInput }
  | { v: 1; op: 'history.query'; query: HistoryQuery }
  | { v: 1; op: 'history.get'; id: Id; includeData?: boolean }
  | { v: 1; op: 'diff'; baseId: Id; headId: Id; options?: DiffOptions }
  | { v: 1; op: 'status'; jobId: Id };
export type ApiResponse<T = unknown> = { v: 1; ok: true; data: T } | { v: 1; ok: false; error: ErrorInfo };
```
Detay ve güvenlik: 09 §11.

---

## 14. Ek Tipler ve Genişletmeler (04–14 dokümanlarından gelen)

> Aşağıdaki alanlar yukarıdaki tiplere **eklenir** (merge). Çakışma durumunda bu bölüm geçerlidir. İlgili doküman parantezde.

```ts
// ---- 04 / 07: PDF link & metin ipuçları, dosya rolleri, arama parçacıkları
export interface CaptureRecordAux { links?: LinkRect[]; textRects?: TextRect[]; }           // (04 §5.5, 5.4)
// CaptureRecord'a: aux?: CaptureRecordAux
// TextRect.kind: 'textLine' | 'image' | 'block' | 'heading'; TextRect.text?: string; TextRect.level?: number  (PDF outline, 04 §5.9)
// CaptureFile.role: + 'ocr' | 'editorDoc'                                                  (07 §2)
export interface OcrDocRow { captureId: Id; text: string; tokens: string[]; words: OcrResult['words']; wordsRef?: BlobRef; lang: string[]; indexedAt: IsoDate; }  // IDB `ocrDocs` (07 §9.2, 09 §8)
export interface LogRow { id?: number; at: IsoDate; level: 'debug'|'info'|'warn'|'error'; ns: string; jobId?: Id; msg: string; }             // (07 §2)
// PortName: + 'history-events'
// MsgMap: + 'history.changed': { req: { kind: 'put' | 'delete' | 'clear'; ids: Id[] }; res: void }   // SW → UI push (07 §5)
// HistoryPage.items[i].matches?: Array<{ field: 'title'|'url'|'notes'|'tags'|'ocr'; snippet: string }>  (07 §9.1)
// Preset.extras.autoTags?: string[]                                                         (07 §6)
// Settings.history.recaptureCloseWindow: boolean (varsayılan true)                          (07 §11.5)
// CaptureRecord.source.editedFrom?: Id                                                      (05 §13 — "yeni kayıt olarak kaydet")

// ---- 05: Editör
export type ToolId = 'select' | 'arrow' | 'rect' | 'ellipse' | 'line' | 'freehand' | 'text' | 'highlight' | 'marker' | 'emoji' | 'image' | 'blur' | 'pixelate' | 'redact' | 'crop' | 'pan';
export type StyleField = keyof AnnotationStyle;
export interface EditorSettings {
  toolDefaults: Partial<Record<ToolId, Partial<AnnotationStyle>>>;
  recentColors: string[];                 // max 12
  shortcuts?: Record<string, string>;     // override; varsayılan tablo 05 §12
  autosaveMs: number;                     // 2000
}
// Settings.editor: EditorSettings
// EditorDocument.viewportOffset?: Point ; EditorDocument.zoom?: number  (oturum durumu)
// IDB store `editorDocs` (key: captureId) → EditorDocument                                  (05 §13, 07 §2)
// ---- 06: Batch
// BatchJobInput.qa?: { enabled: boolean; thresholdPct: Percent; baselineTag: string /* 'baseline' */ }   (09 §13)
// BatchControl.fallbackToFullPage: boolean (selector bulunamazsa fullPage'e düş; varsayılan false)       (06 §3)
// BatchControl.pdfChunkSize: number (combined PDF'te kaç öğede bir yeni dosya; varsayılan 200)            (06 §5)
// BatchItem.notBefore?: IsoDate (retry backoff)                                                         (06 §10)
// Filename token'ları: + {itemName} (URL listesinde "url | ad" sözdizimi ile verilen ad), {attempt}       (06 §6)

// ---- 08 / 09 / 14: Ayarlar
// Settings.capture.smartHideOverrides: Record<string /*domain*/, { disabled?: boolean; extra?: string[]; never?: string[] }>  (09 §3)
// Settings.integrations.proxyUrl?: Url                                                                   (09 §10)
// Settings.api: { enabled: boolean; allowedExtensionIds: string[]; approvedOrigins: string[] }            (09 §11)
// Settings.privacy.storeIncognitoCaptures: boolean (varsayılan false)                                    (08 §10)
// Settings.license?: { key: string; plan: 'free' | 'pro'; validUntil?: IsoDate; verifiedAt: IsoDate }      (14 §14)
// EvidenceManifest.image.sha256Embedded?: Sha256Hex  (iTXt gömülmüş dosyanın hash'i)                      (09 §4)
// MonitorRule.keepLast: number (varsayılan 20)                                                            (09 §12)
// FeatureKey: + 'bugReportNetwork' | 'tsa' | 'webhook'                                                    (09 §5, §4, §10)
```
