# 02 — Mimari

> Bu doküman uzantının **Manifest V3** mimarisini, bileşenlerini, mesajlaşma protokolünü, capture job yaşam döngüsünü, depolama katmanlarını, izin modelini, build/tooling ve repo yapısını tanımlar. Veri tipleri için `13-data-contracts.md`, capture algoritmaları için `03-capture-engine.md` esastır.

---

## 1. Tasarım İlkeleri

1. **Local-first.** Hiçbir görüntü/metadata kullanıcı açıkça istemeden cihazdan çıkmaz (bkz. 08).
2. **Minimum izin, bağlamsal yükseltme.** Varsayılan `activeTab`; ek yetenekler (iframe, all-tabs, batch, entegrasyon, bildirim, pano) `optional_permissions` ile çalışma anında istenir. (`debugger` opsiyonel olamadığından ayrı build varyantındadır; bkz. §7.3.)
3. **Service worker kalıcı değildir.** Tüm job state'i `chrome.storage.session`'a yazılır; SW öldürülüp yeniden başlatıldığında aktif capture job temiz restore denemesiyle `failed(E_SW_RESTART)` olur; batch job'ları IDB state'inden recovery kuralına göre `paused` veya `queued` durumuna alınır.
4. **Ağır işler ana iş parçacığında değil.** Stitching/encode/PDF/OCR/diff işleri **Offscreen document** içindeki Web Worker'larda koşar; content script asla büyük görüntü tutmaz.
5. **Her özellik bir modül.** Capture backend'leri, exporter'lar, entegrasyonlar, editör araçları plugin benzeri kayıt (registry) ile eklenir.
6. **Belirleyici (deterministic) ve test edilebilir.** Capture pipeline'ı saf fonksiyonlar + açık side-effect katmanı. Tüm mesajlar tipli ve versiyonlu.
7. **Sayfayı bozmadan çık.** Capture sırasında yapılan her DOM/stil/scroll değişikliği `finally` bloğunda geri alınır (restore guarantee).

---

## 2. Bileşen Haritası

```
┌───────────────────────────────────────────────────────────────────────────┐
│  EXTENSION PAGES (UI)                                                     │
│  popup.html   sidepanel.html   result.html(editor)   history.html         │
│  options.html batch.html       compare.html          onboarding.html      │
└───────────────┬───────────────────────────────────────────────┬───────────┘
                │ runtime.Port / sendMessage (typed)            │
┌───────────────▼───────────────────────────────────────────────▼───────────┐
│  SERVICE WORKER  (background.ts)  — Orchestrator                          │
│  • CaptureCoordinator (job state machine)   • CommandRouter (shortcuts)   │
│  • BackendRegistry {visibleTab, debugger}   • ContextMenuController       │
│  • ExportPipeline (delegates to offscreen)  • DownloadManager             │
│  • HistoryService (IndexedDB via Dexie)     • BatchRunner                 │
│  • PermissionBroker                         • IntegrationHub              │
│  • SettingsStore (storage.local)            • AlarmScheduler (monitoring) │
│  • JobStateStore (storage.session)          • ExternalApi (onMessageExt.) │
└───────┬───────────────────────┬───────────────────────┬───────────────────┘
        │ scripting.executeScript│ tabs.captureVisibleTab │ offscreen.createDocument
        │ + Port                 │ / chrome.debugger      │ + Port
┌───────▼───────────────┐  ┌────▼──────────────┐  ┌─────▼────────────────────┐
│ CONTENT SCRIPT (CS)   │  │ TARGET TAB         │  │ OFFSCREEN DOCUMENT       │
│ isolated world:       │  │ (web page)         │  │ offscreen.html           │
│ • PageAgent           │  │                    │  │ • Stitcher (worker)      │
│   - scan()            │  │                    │  │ • ImageEncoder (worker)  │
│   - prepare()/restore │  │                    │  │ • PdfBuilder (worker)    │
│   - scrollTo(step)    │  │                    │  │ • OcrEngine (worker)     │
│   - fixed el. mgmt    │  │                    │  │ • DiffEngine (worker)    │
│   - lazy-load trigger │  │                    │  │ • ClipboardWriter        │
│   - element picker UI │  │                    │  │ • ZipWriter              │
│   - progress overlay  │  │                    │  │ • ThumbnailMaker         │
│ main world (opsiyonel)│  │                    │  │                          │
│ • ConsoleTap (bug rpt)│  │                    │  │                          │
└───────────────────────┘  └────────────────────┘  └──────────────────────────┘
                                                          │
                                              ┌───────────▼───────────┐
                                              │ STORAGE               │
                                              │ IndexedDB (Dexie)     │
                                              │  - captures, blobs    │
                                              │  - batches, presets   │
                                              │  - ocrDocs, diffs     │
                                              │ OPFS (büyük dosyalar) │
                                              │ storage.local (settings)
                                              │ storage.session (jobs)│
                                              └───────────────────────┘
```

### 2.1 Service Worker (`src/background/`)
Tek orchestrator. Kendi içinde hiçbir ağır işlem yapmaz; tile'ları alır (dataURL string), offscreen'e aktarır. Sorumluluklar:

| Modül | Sorumluluk |
|---|---|
| `CaptureCoordinator` | `CaptureJob` state machine (bkz. §4). Backend seçer, CS ile konuşur, tile'ları offscreen'e akıtır. |
| `BackendRegistry` | `VisibleTabBackend` (varsayılan) ve `DebuggerBackend` (sadece `cdp` build varyantı). Ortak arayüz `CaptureBackend`. |
| `CommandRouter` | `chrome.commands` kısayolları → aksiyon. |
| `ContextMenuController` | Sağ tık menüsü (page/selection/link/image/frame bağlamları). |
| `ExportPipeline` | Result → format (PNG/JPEG/WebP/PDF/...) → hedef (download/clipboard/history/integration). Offscreen ile konuşur. |
| `DownloadManager` | `chrome.downloads` sarmalayıcı; filename template çözümü; conflict policy; sub-folder. |
| `HistoryService` | Dexie üzerinden CRUD, arama, kota yönetimi, thumbnail. SW ve extension page'ler aynı DB'ye erişebilir; yazma **sadece SW** üzerinden (Karar). |
| `BatchRunner` | URL listesi/tab listesi batch'lerini yürütür; concurrency, retry, timeout. |
| `PermissionBroker` | `chrome.permissions.request/contains/remove`; UI'ya gerekçe metni sağlar. |
| `SettingsStore` | `storage.local` üzerinde versiyonlu `Settings`; migration. |
| `JobStateStore` | `storage.session` üzerinde aktif job'lar; SW restart sonrası recovery. |
| `AlarmScheduler` | `chrome.alarms` ile zamanlanmış recapture (monitoring, DIFF). |
| `IntegrationHub` | Jira/Linear/Slack/… adaptörleri; OAuth via `chrome.identity.launchWebAuthFlow`. |
| `ExternalApi` | `runtime.onMessageExternal` (externally_connectable) + native messaging (P2). |
| `Telemetry` | Sadece opt-in; varsayılan kapalı (bkz. 08). |

### 2.2 Content Script (`src/content/`)
- **Enjeksiyon:** Statik `content_scripts` **kullanılmaz** (Karar). `src/content/page-agent.ts`, build sırasında extension kökünde deterministik `content/page-agent.js` çıktısına bundle edilir; çözülmemiş import bırakan build başarısızdır. CS, ihtiyaç anında `chrome.scripting.executeScript({target:{tabId, allFrames?}, files:['content/page-agent.js']})` ile enjekte edilir (activeTab ile uyumlu). İdempotent: `window.__ssx_agent_v1` guard'ı; ikinci enjeksiyon sadece "ping" döner.
- **Iletişim:** `chrome.runtime.connect({name:'page-agent:<jobId>'})` ile Port; Port kopması = job iptal/SW restart sinyali.
- **Modüller:** `PageScanner` (metrikler, scroll container'lar, fixed/sticky elementler, iframe'ler), `PagePreparer` (scrollbar gizleme, animasyon durdurma, lazy-load tetikleme, smart-hide), `Scroller` (adım adım scroll + settle bekleme), `FixedElementManager`, `ElementPicker` (hover highlight + seçim), `SelectionOverlay` (dikdörtgen seçim), `ProgressOverlay` (Shadow DOM), `Restorer`.
- **Main-world script** (`content/console-tap.js`): sadece Bug Report modunda `world:'MAIN'` ile enjekte edilir; `console.error/warn` ve `window.onerror/unhandledrejection`'ı yakalayıp `window.postMessage` ile isolated world'e iletir.
- CS **hiçbir zaman** tile görüntüsü tutmaz; sadece metrik ve komut.

### 2.3 Offscreen Document (`src/offscreen/`)
- `chrome.offscreen.createDocument({url:'offscreen.html', reasons:['BLOBS','CLIPBOARD','DOM_PARSER','WORKERS'], justification:'...'})`. `WORKERS`, offscreen worker havuzu için geçerli Chrome reason değeridir. Tek instance; SW `hasDocument` kontrolü ile yeniden kullanır; 5 dk inaktivite sonrası kapatılır (Karar).
- İçinde Web Worker havuzu (`navigator.hardwareConcurrency - 1`, min 1, max 4):
  - `stitch.worker.ts` — tile'ları `ImageBitmap`'e çevirir, `OffscreenCanvas`'ta birleştirir; limit aşımında strip üretir.
  - `encode.worker.ts` — PNG/JPEG/WebP (`convertToBlob`), GIF (gifenc), BMP (custom), büyük PNG için satır-bazlı `fast-png`.
  - `pdf.worker.ts` — `pdf-lib` ile PDF; sayfalama, header/footer, link annotation, metadata, watermark.
  - `ocr.worker.ts` — Tesseract.js (lazy import; dil verisi `assets/ocr/*.traineddata.gz`, uzak indirme YOK).
  - `diff.worker.ts` — pixelmatch + bbox clustering.
  - `zip.worker.ts` — fflate streaming zip.
- `ClipboardWriter` (offscreen'de **sadece metin**: `document.execCommand('copy')` ile; görüntü için offscreen belge odaklı olmadığından `navigator.clipboard.write` başarısız olur). Görüntü panoya yazımı için strateji zinciri (SW `ExportPipeline` yönetir): (1) açık/odaklı `result.html` varsa orada `navigator.clipboard.write([new ClipboardItem({'image/png': blob})])`; (2) yoksa aktif sekmenin content script'ine `agent.clipboardWrite {dataUrl}` → CS `fetch(dataUrl)→blob→navigator.clipboard.write` (`clipboardWrite` izni + sayfa odaklı; kullanıcı jesti gerekmez); (3) o da olmazsa küçük bir `clipboard.html` extension penceresi (`chrome.windows.create type:'popup', focused:true`) açılır, yazar ve kapanır. Chrome pano için yalnızca `image/png` (+ `text/plain`, `text/html`) kabul eder; JPEG kopya istendiğinde PNG'ye çevrilir.
- Büyük veriler SW ↔ Offscreen arasında **dataURL/ArrayBuffer mesajı ile değil**, IndexedDB/OPFS üzerinden referansla taşınır (Karar): tile'lar SW tarafından `tiles` store'a `{jobId, index, blob}` olarak yazılır, offscreen oradan okur. Bu, SW bellek baskısını ve mesaj boyutu sınırını (~64MB) önler.

### 2.4 Extension Pages (`src/pages/`)
| Sayfa | Amaç |
|---|---|
| `popup.html` | Hızlı capture menüsü (Full page / Visible / Selection / Element / Scrollable area / All tabs / Delay), preset seçici, son 3 capture, ayarlara link. |
| `sidepanel.html` | Popup'ın kalıcı versiyonu + capture sonrası hızlı önizleme (Chrome ≥ 114 `chrome.sidePanel`). |
| `result.html` | Capture sonucu + **editör** + export paneli. Her capture yeni sekmede açılır (ayar: sekme / side panel / sadece indir). |
| `history.html` | Galeri, filtre/arama, bulk işlemler, recapture, compare'e gönder. |
| `compare.html` | Version compare + pixel diff görünümü, timeline. |
| `batch.html` | URL batch oluşturma/izleme, loglar, yeniden çalıştırma. |
| `options.html` | Tüm ayarlar, presetler, entegrasyonlar, izinler, veri yönetimi. |
| `onboarding.html` | İlk kurulum: kısayol, izinler, gizlilik açıklaması. |

Sayfalar Preact ile yazılır; ortak UI kiti `src/ui/`.

---

## 3. Mesajlaşma Protokolü

### 3.1 Kanallar
| Kanal | Kullanım |
|---|---|
| `chrome.runtime.sendMessage` (request/response) | Kısa, tek seferlik komutlar (ör. `settings.get`, `history.list`). |
| `chrome.runtime.connect` Port | Uzun süreli akışlar: CS `page-agent:<jobId>`, offscreen `offscreen`, UI sayfalarının job progress aboneliği `job-events`. |
| `chrome.tabs.sendMessage` | SW → CS tek seferlik komut (Port yoksa). |
| `chrome.storage.session` + `onChanged` | Job state yayını (UI'lar progress'i buradan da izleyebilir; Port düşerse toparlanma). |
| `window.postMessage` | Main-world ↔ isolated-world (sadece ConsoleTap). |
| `runtime.onMessageExternal` | Public API (externally_connectable origin'leri). |

### 3.2 Zarf (envelope)
Tüm mesajlar `13-data-contracts.md §2`'deki `Msg<T>` zarfını kullanır:
```ts
interface Msg<K extends keyof MsgMap> { v: 1; type: K; id: string; payload: MsgMap[K]['req']; }
interface Reply<K> { v: 1; type: K; id: string; ok: true; payload: MsgMap[K]['res'] } | { v:1; type:K; id:string; ok:false; error: ErrorInfo }
```
- `type` string'leri `'<domain>.<action>'` (örn. `capture.start`, `agent.scan`, `offscreen.stitch`).
- Her `Msg` `id` (nanoid) taşır; Port üzerinde cevaplar `id` ile eşlenir.
- Hatalar `ErrorInfo { code: ErrorCode; message; details?; recoverable: boolean }`.
- **Versiyon:** `v` uyuşmazlığında alıcı `E_PROTOCOL` döner.

### 3.3 Başlıca mesaj akışları
**Full-page capture (happy path):**
```
UI → SW        capture.start {request}
SW → SW        job = new CaptureJob(); JobStateStore.put(job)
SW → tab       scripting.executeScript(page-agent)   (activeTab)
CS → SW        connect('page-agent:<jobId>')
SW → CS        agent.scan {}                         → PageMetrics
SW → CS        agent.prepare {plan}                  → PreparedState (hidden els, scroll container, etc.)
loop over scroll plan:
  SW → CS      agent.scrollTo {x,y,stepIndex}        → {actualX, actualY, settled:true}
  SW           tabs.captureVisibleTab → dataURL        (rate limit bekleme)
  SW → IDB     tiles.put({jobId, index, blob, rect})
  SW → UI      job.progress {done,total,phase}
SW → CS        agent.restore {}
SW → OFF       offscreen.stitch {jobId, layout}      → {imageRefs[], width, height, strips}
SW → OFF       offscreen.thumbnail {ref}             → thumbRef
SW → IDB       captures.put(record)
SW → UI        job.done {captureId}
SW             tabs.create(result.html?id=...)       (ayar'a göre)
```
**İptal:** UI → SW `capture.cancel {jobId}` → SW Port üzerinden CS'e `agent.abort` → restore → job `cancelled`; offscreen'e `offscreen.abort {jobId}`; tile'lar silinir.

**SW restart sırasında:** SW yeniden başlar → `JobStateStore.listActive()` → durumu `capturing` olan job'lar için sekmeye `agent.ping` → cevap yoksa `failed(E_SW_RESTART)`, restore denemesi için `agent.restore` yeniden enjekte edilir. (Karar: resume değil, temiz fail + kullanıcıya "Tekrar dene" — basitlik.)

---

## 4. CaptureJob State Machine

```
 idle ──start──▶ preparing ──▶ capturing ──▶ stitching ──▶ exporting ──▶ done
                    │              │             │             │
                    └──cancel/err──┴─────────────┴─────────────┴──▶ cancelled | failed
                                                    (her durumda: restore → cleanup)
```
| Durum | Giriş koşulu | Yapılanlar | Zaman aşımı |
|---|---|---|---|
| `preparing` | request doğrulandı, izinler var | CS enjekte, scan, prepare, (delay/timer burada bekler) | 30 s (+delay) |
| `capturing` | scroll plan hazır | adım adım scroll+capture; progress | adım başına 10 s; toplam `limits.maxDurationMs` |
| `stitching` | tüm tile'lar yazıldı | offscreen stitch, strip bölme, thumbnail | 60 s |
| `exporting` | görüntü hazır | auto-download/clipboard/history/integration | 120 s |
| `done` | — | UI bildirimi, result sayfası | — |
| `cancelled` | kullanıcı | restore, tile temizliği | — |
| `failed` | hata | restore, tile temizliği, `ErrorInfo` | — |

Job kaydı (`JobState`, bkz. 13) her geçişte `storage.session`'a yazılır; UI'lar `job-events` Port'u ve `storage.onChanged` ile izler.

---

## 5. Capture Backend Soyutlaması

```ts
interface CaptureBackend {
  readonly id: 'visibleTab' | 'debugger';
  canHandle(req: CaptureRequest, metrics: PageMetrics): Promise<BackendSupport>; // {ok, reasons[]}
  capture(ctx: JobContext): AsyncIterable<TileEvent>;   // yields {index, rect, blob|dataUrl}
  abort(jobId: string): Promise<void>;
}
```
- **`VisibleTabBackend` (varsayılan, P0):** scroll + `chrome.tabs.captureVisibleTab(windowId,{format:'png'})`. Hız sınırı: saniyede en fazla 2 çağrı (Chrome `MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND`); coordinator çağrılar arasına ≥ 500 ms koyar ve `E_RATE_LIMIT` (quota exceeded) hatasında üstel geri çekilme (750→1500→3000 ms, 3 deneme) uygular.
- **`DebuggerBackend` (P1, sadece `cdp` build varyantında):** `chrome.debugger.attach({tabId},'1.3')` → `Page.getLayoutMetrics` (cssContentSize) → `Page.captureScreenshot({format:'png', captureBeyondViewport:true, clip:{x,y,width,height,scale:1}, fromSurface:true})`; gerekirse `Emulation.setDeviceMetricsOverride` + `Emulation.setScrollbarsHidden`. Avantaj: sticky sorunu yok, çok hızlı, rate limit yok. Kısıtlar: tek shot **16.384 px** (compositor max texture) ile sınırlı → 16.384 px'i aşan sayfalarda `clip` ile dilimleyerek çoklu shot + stitch; `setDeviceMetricsOverride` `vh`, IntersectionObserver ve `position:fixed` düzenini değiştirir (tercihen clip yaklaşımı, override sadece lazy-load tetikleme için kısa süreli). Infobar kullanıcı tarafından kapatılırsa `onDetach(canceled_by_user)` → job `visibleTab`'a düşer. Bu backend ayrıca `Page.printToPDF` (seçilebilir metin + canlı linkli PDF; `printBackground:true`, `preferCSSPageSize`, `generateDocumentOutline`, `transferMode:'ReturnAsStream'` + `IO.read`) ve Bug Report için `Runtime.consoleAPICalled`/`Log.entryAdded` sağlar.
- **Karar (varyant):** `BUILD_VARIANT=store` (varsayılan, Web Store) **debugger içermez**; tüm özellikler `visibleTab` + OCR text layer + main-world ConsoleTap ile sunulur. `BUILD_VARIANT=cdp` (self-hosted/enterprise/"Pro" kanalı) manifest'e `debugger` ekler ve `DebuggerBackend`, `printToPDF`, CDP console log özelliklerini açar. Kod tarafında `features.cdp` bayrağı (`env.ts`) ile tree-shake edilir; UI'da CDP'ye bağlı seçenekler varyant yoksa hiç gösterilmez.
- Backend seçimi `CaptureCoordinator.selectBackend(req, metrics, settings, permissions)`.

---

## 6. Depolama Katmanları

| Katman | Ne | Neden |
|---|---|---|
| `chrome.storage.local` | `Settings` (versiyonlu), presets (küçük), integration token'ları (şifreli değil — Chrome profil izolasyonuna güvenilir; bkz. 08), onboarding state | Senkron okuma kolaylığı, tüm context'lerden erişim |
| `chrome.storage.session` | Aktif `JobState[]`, geçici OAuth state, son kullanılan mod | SW restart'a dayanıklı, profil kapatınca silinir |
| **IndexedDB** (Dexie, DB adı `ssx`) | `captures` (metadata), `blobs` (görüntü/PDF blob'ları, ≤ 50 MB/kayıt), `tiles` (geçici), `batches`, `batchItems`, `diffs`, `ocrDocs`, `editorDocs`, `tags`, `folders`, `presets` (büyük) | Yapısal sorgu, indeks, blob desteği |
| **OPFS** (`navigator.storage.getDirectory()`) | > 50 MB blob'lar (çok uzun sayfa PDF'leri, ZIP'ler), evidence bundle'lar | IDB'de dev blob'lar yavaş; OPFS streaming yazma |
| `unlimitedStorage` izni | Manifest'te statik (uyarı üretmez) | history büyüyebilir |

`JobStateStore` başlangıçta `chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })` çağırır; içerik scriptleri ve web sayfaları job state okuyamaz. SW her `await` sınırında state'i yazar. SW yeniden başladığında aktif capture job'ı temiz restore denemesiyle `failed(E_SW_RESTART)` olur; batch job'ları IDB'den `paused`/`queued` recovery kuralına göre yeniden başlatılır.

- Kota: `navigator.storage.estimate()` ile izlenir; `%85` doluluk → UI uyarısı; `%95` → otomatik temizlik politikası (ayar: en eskiyi sil / kullanıcıya sor). `navigator.storage.persist()` onboarding'de istenir.
- Şema migration: Dexie `version(n).stores().upgrade()`; her migration 11'deki testlerle doğrulanır.
- Detaylı şema: `07-history-and-storage.md` ve `13-data-contracts.md`.

---

## 7. İzin Modeli

### 7.1 `manifest.json` (hedef)
```jsonc
{
  "manifest_version": 3,
  "name": "__MSG_appName__",
  "default_locale": "en",
  "minimum_chrome_version": "120",
  "permissions": [
    "activeTab", "scripting", "storage", "unlimitedStorage",
    "downloads", "offscreen", "contextMenus", "alarms", "sidePanel"
  ],
  "optional_permissions": [
    "tabs",            // all-tabs capture, batch (URL/title okumak için)
    "clipboardWrite",  // content-script üzerinden pano yazımı (jest dışı)
    "notifications",   // tamamlanma/hata/batch/monitoring bildirimi (opsiyonel)
    "webRequest",      // bug-report network errors (opsiyonel)
    "identity",        // entegrasyon OAuth
    "webNavigation",   // iframe ağacı (getAllFrames)
    "nativeMessaging"  // CLI/companion (P2)
  ],
  // "debugger" OPSİYONEL OLAMAZ (Chrome kısıtı). Sadece `BUILD_VARIANT=cdp` build'inde
  // "permissions" listesine eklenir; varsayılan (store) build'de YOKTUR. Bkz. §5 ve §7.3.
  "optional_host_permissions": ["<all_urls>"], // batch & cross-origin iframe & monitoring
  "background": { "service_worker": "background.js", "type": "module" },
  "action": { "default_popup": "popup.html", "default_icon": {...} },
  "side_panel": { "default_path": "sidepanel.html" },
  "commands": {
    "capture-full-page": { "suggested_key": {"default":"Alt+Shift+P"}, "description":"__MSG_cmdFullPage__" },
    "capture-visible":   { "suggested_key": {"default":"Alt+Shift+V"}, "description":"__MSG_cmdVisible__" },
    "capture-selection": { "suggested_key": {"default":"Alt+Shift+S"}, "description":"__MSG_cmdSelection__" },
    "capture-element":   { "description":"__MSG_cmdElement__" }   // kısayolu kullanıcı atar (max 4 suggested)
  },
  "content_security_policy": {
    "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; img-src 'self' data: blob:; connect-src 'self' https://*.atlassian.net https://api.linear.app https://slack.com https://api.notion.com https://api.trello.com https://api.github.com https://www.googleapis.com"
  },
  "web_accessible_resources": [{ "resources": ["assets/fonts/*","assets/picker/*"], "matches": ["<all_urls>"] }],
  "externally_connectable": { "matches": [] }  // public API açılınca kullanıcı tanımlı origin'ler eklenemez; bkz. 09 §11
}
```
**Notlar:**
- `activeTab` + `scripting` ile kullanıcı jesti (popup, kısayol, context menu) sonrası aktif sekmeye enjekte edilebilir ve `captureVisibleTab` çağrılabilir; `<all_urls>` host izni **istenmez** (Web Store incelemesi ve kullanıcı güveni).
- Cross-origin iframe içeriği `captureVisibleTab` ile zaten piksel olarak yakalanır; iframe **içinde scroll/prepare** gerekirse (`allFrames:true`) host izni gerekir → PermissionBroker bağlamsal ister (bkz. 03 §9).
- `debugger` izni **opsiyonel izin olarak istenemez** (Chrome: `debugger`, `declarativeNetRequest`, `devtools`, `proxy` vb. optional olamaz). Manifest'e statik eklenirse kurulumda "Access the page debugger backend" + "Read and change all your data on all websites" uyarısı çıkar ve attach süresince tüm sekmelerde "… started debugging this browser" infobar'ı görünür (kapatılamaz; kullanıcı *Cancel* derse `onDetach: canceled_by_user`). Bu yüzden §7.3'teki build-varyant stratejisi uygulanır.
- `externally_connectable.matches` manifest'te statik olmak zorunda; public API için yaklaşım 09 §11'de.

### 7.2 PermissionBroker akışı
1. Özellik tetiklenir → `requires(feature)` → eksik izin listesi.
2. Kullanıcı jesti içindeyse doğrudan `chrome.permissions.request`; değilse UI'da "İzin gerekli" kartı ve buton.
3. Reddedilirse özellik degrade edilir (ör. iframe içi scroll olmadan devam) ve `E_PERMISSION_DENIED` loglanır.
4. Options → İzinler sekmesinde tüm opsiyonel izinler görülebilir/geri alınabilir (`permissions.remove`).

### 7.3 Build varyantları ve izin matrisi
| Yetenek | `store` varyantı | `cdp` varyantı |
|---|---|---|
| Full/visible/selection/element/scroll-container capture | `visibleTab` backend | `debugger` (tercih) → `visibleTab` fallback |
| Searchable PDF | OCR (Tesseract.js) görünmez metin katmanı (`04 §5.6`) | `Page.printToPDF` (native metin + link) **veya** OCR katmanı |
| Clickable-link PDF | DOM `<a>` rect haritası → pdf-lib link annotation | aynı + printToPDF doğal linkleri |
| Bug report console logs | main-world `ConsoleTap` (enjeksiyondan **sonraki** loglar + `performance`/`window.onerror`) | CDP `Runtime.enable` + `Log.enable` (geçmiş mesajlar dahil) |
| Infobar | yok | attach süresince var |
| Manifest `permissions` | `activeTab, scripting, storage, unlimitedStorage, downloads, offscreen, contextMenus, alarms, sidePanel` | + `debugger` |

---

## 8. Hata Yönetimi

- Tüm hatalar `ErrorCode` enum'u (13 §7) ile sınıflandırılır: `E_RESTRICTED_PAGE` (chrome://, Web Store, file:// izinsiz), `E_RATE_LIMIT`, `E_TAB_NOT_ACTIVE`, `E_AGENT_INJECT`, `E_TIMEOUT`, `E_CANVAS_LIMIT`, `E_MEMORY`, `E_PERMISSION_DENIED`, `E_DEBUGGER_ATTACH`, `E_SW_RESTART`, `E_STORAGE_QUOTA`, `E_EXPORT`, `E_NETWORK`, `E_CANCELLED`, `E_UNKNOWN`.
- Kullanıcıya gösterilen metinler i18n; her kod için "ne oldu / ne yapabilirsin" çifti.
- `captureVisibleTab` tipik hata mesajları eşlenir: *"The 'activeTab' permission is not in effect"* → `E_PERMISSION_DENIED`; *"Cannot access contents of url"* → `E_RESTRICTED_PAGE`; *"exceeds MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND"* → `E_RATE_LIMIT`.
- Kısmi başarı: stitching sırasında limit aşılırsa job **başarısız sayılmaz**; `strips[]` ile multi-image sonucu döner ve UI bilgilendirir.
- Her job için `JobLog` (ring buffer 200 satır) tutulur; hata durumunda "Teknik detayları kopyala" butonu.

---

## 9. Performans ve Kaynak Bütçeleri

| Metrik | Hedef |
|---|---|
| Viewport capture (tek tile) uçtan uca | < 400 ms |
| 10.000 px yüksek sayfa full-page (1440×900 viewport, DPR 2) | < 15 s (visibleTab), < 4 s (debugger) |
| Stitch 10.000×1440 @DPR2 | < 3 s, peak bellek < 600 MB (offscreen) |
| SW heap | < 100 MB (tile blob'ları IDB'de) |
| Popup açılış | < 150 ms (ilk boya) |
| History 5.000 kayıt listeleme | < 300 ms (indeksli sorgu, sanal liste) |
| Bundle boyutu | core < 1.5 MB; OCR/diff/PDF lazy chunk'lar |

Limitler (`Settings.limits` ile ayarlanabilir, varsayılanlar): `maxCaptureHeightCss=50_000`, `maxTiles=200`, `maxDurationMs=180_000`, `maxInfiniteScrollSteps=100`, `stepSettleMs=150`, `lazyLoadWaitMs=1500`, `canvasMaxSidePx=16_384` ve `canvasMaxAreaPx=268_435_456` (16.384²) güvenli varsayılanlar; ilk çalıştırmada `canvas-size` tarzı probing ile gerçek limitler ölçülür ve `storage.local.canvasLimits`'e yazılır (Chrome 73+: kenar 65.535, alan 268.435.456; Firefox 122+: 32.767 / 23.168²; Safari iOS alan 4.096²). Tarayıcı oversize canvas'ta **hata vermez, sessizce boş çizer** → stitcher limiti aşan her çıktıyı önceden strip'lere böler (03 §10).

---

## 10. Build, Tooling ve Repo Yapısı

### 10.1 Stack
- TypeScript 5.x `strict`, `noUncheckedIndexedAccess`.
- Vite 5 + `@crxjs/vite-plugin` (HMR'li uzantı geliştirme). Alternatif: WXT — Karar: CRXJS.
- Preact 10 + `@preact/signals`; routing gerekmez (sayfa başına app).
- `dexie`, `@cantoo/pdf-lib`, `fflate`, `pixelmatch`, `tesseract.js` (lazy), `fabric` v6 (editor), `nanoid`, `zod` (runtime mesaj/ayar doğrulama), `comlink` (worker RPC).
- Lint/format: ESLint (typescript-eslint, import order), Prettier. Husky + lint-staged.
- Test: Vitest (+ `fake-indexeddb`, `jest-chrome`/özel `chrome` mock), Playwright (`--load-extension`), test sitesi `test/fixtures/sites/*` (statik HTML'ler: sticky header, nested scroll, lazy images, infinite scroll, iframes, RTL, zoom, DPR).
- CI: GitHub Actions — lint, unit, build, e2e (headed Chromium `--headless=new` uzantı destekler), `web-ext lint` benzeri manifest doğrulaması, zip artefaktı.

### 10.2 Repo yapısı
```
chrome-screenshot-extension/
├─ specs/                         # bu dokümanlar
├─ manifest.config.ts             # CRXJS manifest üretimi (i18n, sürüm env'den)
├─ vite.config.ts
├─ package.json  pnpm-lock.yaml  tsconfig*.json  .eslintrc.cjs
├─ public/
│  ├─ _locales/{en,tr}/messages.json
│  ├─ icons/ (16,32,48,128 + action states)
│  └─ assets/ocr/ (traineddata, lazy)  assets/fonts/  assets/hide-rules.json
├─ src/
│  ├─ background/
│  │  ├─ index.ts                 # SW giriş: listener kaydı (top-level, sync)
│  │  ├─ capture/ {coordinator.ts, job.ts, plan.ts, backends/{visible-tab.ts, debugger.ts}, rate-limiter.ts}
│  │  ├─ export/ {pipeline.ts, download-manager.ts, filename-template.ts, targets/*}
│  │  ├─ history/ {service.ts, quota.ts}
│  │  ├─ batch/ {runner.ts, queue.ts, wait-conditions.ts}
│  │  ├─ permissions/broker.ts   commands.ts   context-menus.ts   alarms.ts
│  │  ├─ integrations/ {hub.ts, oauth.ts, jira.ts, linear.ts, slack.ts, notion.ts, trello.ts, github.ts, webhook.ts, gdrive.ts}
│  │  ├─ external-api.ts          # onMessageExternal + native messaging
│  │  └─ settings/ {store.ts, migrations.ts, defaults.ts}
│  ├─ content/
│  │  ├─ page-agent.ts            # giriş (idempotent)
│  │  ├─ scanner.ts preparer.ts scroller.ts fixed-elements.ts lazy-load.ts smart-hide.ts
│  │  ├─ element-picker.ts selection-overlay.ts progress-overlay.ts restorer.ts
│  │  ├─ iframe-agent.ts          # allFrames enjeksiyonunda alt frame davranışı
│  │  └─ console-tap.main.ts      # MAIN world
│  ├─ offscreen/
│  │  ├─ index.ts  offscreen.html
│  │  └─ workers/ {stitch.worker.ts, encode.worker.ts, pdf.worker.ts, ocr.worker.ts, diff.worker.ts, zip.worker.ts, thumb.worker.ts}
│  ├─ pages/ {popup, sidepanel, result, history, compare, batch, options, onboarding}/ (index.html, main.tsx, *.module.css)
│  ├─ editor/                     # Fabric tabanlı editör çekirdeği (pages/result kullanır)
│  ├─ ui/                         # ortak bileşenler, tokens.css, icons
│  ├─ shared/
│  │  ├─ messages.ts              # MsgMap, Msg/Reply, typed send/connect helpers
│  │  ├─ types/ (capture.ts, export.ts, history.ts, settings.ts, batch.ts, preset.ts, errors.ts)
│  │  ├─ db/ (schema.ts, dexie.ts, opfs.ts)
│  │  ├─ i18n.ts  log.ts  ids.ts  geometry.ts  env.ts
│  └─ lib/ (image/, pdf/, ocr/, diff/, zip/, hash/, template/)   # saf, DOM-bağımsız yardımcılar (unit test yoğun)
├─ test/ {unit/, e2e/, fixtures/sites/, helpers/}
└─ scripts/ {build-zip.ts, gen-icons.ts, check-manifest.ts}
```

### 10.3 Kod standartları
- SW giriş dosyasında tüm `chrome.*.addListener` çağrıları **top-level ve senkron** (MV3 event kaydı kuralı).
- SW yaşam döngüsü: 30 s olaysızlıkta sonlanır; tek bir olay/çağrı 5 dk'yı aşarsa sonlanır. Açık `runtime.Port` (Chrome 114+), offscreen mesajları (109+) ve her `chrome.*` API çağrısı (110+) zamanlayıcıyı sıfırlar → capture döngüsü doğal olarak canlı kalır. `setInterval` tabanlı yapay keepalive **yapılmaz** (Karar); bunun yerine her await noktasında state `storage.session`'a yazılır ve 5 dk'yı aşabilecek işler (batch, OCR) offscreen'e devredilip SW sadece olay bazlı ilerler.
- Her modülün tek bir export edilmiş `create*()` factory'si olur; bağımlılıklar enjekte edilir (test edilebilirlik).
- `zod` şemaları `shared/types` ile beraber yaşar; mesaj alıcıları payload'ı parse eder.
- Log: `log.ts` — seviye (`debug|info|warn|error`), namespace, dev build'de console, prod'da ring buffer (job log'a akar).
- Erişilebilirlik ve i18n tüm UI bileşenlerinde zorunlu (10).
- Lifecycle listener'ları (`runtime.onInstalled`, `runtime.onStartup`, `runtime.onUpdateAvailable`, `permissions.onRemoved`, `alarms.onAlarm`) SW girişinde top-level ve senkron kaydedilir. Günlük GC/monitor alarmları yalnızca ihtiyaç varsa kurulur; yapay keepalive interval'ı kullanılmaz. `onUpdateAvailable`, aktif job'lar bitene veya güvenli recovery durumuna gelene kadar reload'ı erteler.

---

## 11. Güvenlik Notları (özet; detay 08)
- Remote code yok; tüm WASM/JS bundle içinde. CSP `wasm-unsafe-eval` sadece OCR için.
- Sayfadan gelen tüm veriler (title, url, selector sonuçları) UI'da **text** olarak render edilir, asla `innerHTML`.
- Content script Shadow DOM (closed) ile UI çizer; sayfa CSS'inden izole.
- Entegrasyon token'ları `storage.local`'da; "Tüm verileri sil" bunları da siler.
- Evidence hash'leri `crypto.subtle.digest('SHA-256')`.

---

## 12. Açık Noktalar / Gelecek
- WebCodecs `ImageEncoder` standardı olgunlaşınca encode.worker'da kullanılabilir.
- Firefox MV3 portu: `browser.*` polyfill, offscreen yok → background page fallback (V2+).
- Safari Web Extension: `captureVisibleTab` sınırlamaları (non-goal).
