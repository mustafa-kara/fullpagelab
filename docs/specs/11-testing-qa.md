# 11 — Test ve QA

> Test piramidi, fixture site matrisi, dikiş doğrulama yöntemi, performans/bellek/rate-limit testleri, PDF/editor/batch/diff/OCR/i18n/a11y testleri, CI matrisi, kapsam hedefleri, manuel QA listesi, hata şiddeti tanımları ve REQ → AC → test izlenebilirlik matrisi. Gereksinim ID önek: `REQ-QA-*`.

İçindekiler: 1 Strateji ve piramit · 2 Araçlar ve klasör yapısı · 3 Unit · 4 Integration · 5 E2E altyapısı · 6 Fixture site matrisi · 7 Dikiş doğrulama · 8 Performans ve bellek · 9 Rate limit / cancel / restore · 10 Storage & migration · 11 PDF doğrulama · 12 Editör · 13 Batch · 14 Diff · 15 OCR · 16 i18n · 17 Erişilebilirlik · 18 Cross-browser · 19 CI matrisi ve kapsam · 20 Flaky politikası · 21 Hata şiddeti · 22 Manuel QA listesi · 23 İzlenebilirlik matrisi · 24 Kabul kriterleri

---

## 1. Strateji ve Piramit (`REQ-QA-001`)

| Katman | Oran (hedef) | Araç | Kapsam |
|---|---|---|---|
| Unit | ~70 % | Vitest | `src/lib/**`, `src/shared/**`, saf fonksiyonlar (`plan.ts`, filename template, selector generator, PDF layout, smart page break, diff clustering, sanitizer'lar, migration'lar, rate limiter, wait-condition değerlendirici) |
| Integration | ~20 % | Vitest + `fake-indexeddb` + özel `chrome` mock (`test/helpers/chrome-mock.ts`) | SW modülleri (`CaptureCoordinator`, `ExportPipeline`, `HistoryService`, `BatchRunner`, `PermissionBroker`, `SettingsStore`), offscreen worker'lar (jsdom değil, `happy-dom`/node + `OffscreenCanvas` polyfill `@napi-rs/canvas`) |
| E2E | ~10 % | Playwright (Chromium, uzantı yüklü) + yerel fixture sunucusu | Gerçek capture akışları, UI sayfaları, dikiş pixel doğrulaması, izin akışları |

`REQ-QA-002`: Her `REQ-*` en az bir testle izlenir (§23). `REQ-QA-003`: Saf algoritmalar (plan/stitch geometri) önce unit testle, sonra E2E ile doğrulanır; E2E tek başına yeterli sayılmaz.

---

## 2. Araçlar ve Klasör Yapısı (`REQ-QA-010`)
```
test/
├─ unit/                      # *.test.ts  (vitest, node env)
├─ integration/               # *.int.test.ts (vitest, happy-dom env + chrome mock + fake-indexeddb)
├─ e2e/
│  ├─ fixtures/               # playwright fixture: uzantı yükleme, SW bekleme, yardımcılar
│  ├─ specs/                  # *.e2e.ts
│  └─ reference/              # referans PNG'ler (git LFS)
├─ fixtures/sites/            # statik HTML fixture'lar (§6) — `pnpm fixtures:serve` (port 4173)
├─ helpers/ {chrome-mock.ts, idb.ts, image.ts (pixelmatch, seam), pdf.ts (pdfjs), perf.ts}
└─ perf/                      # performans senaryoları ve bütçeler (JSON)
```
- Vitest config: `environmentMatchGlobs` ile unit=node, integration=happy-dom; `coverage.provider:'v8'`.
- Playwright: `chromium.launchPersistentContext(userDataDir, { headless:false /*CI'da 'new' headless*/, args:['--disable-extensions-except=<dist>','--load-extension=<dist>', '--window-size=1440,900', '--force-device-scale-factor=2'] })`. Uzantı ID `chrome://extensions` yerine `context.serviceWorkers()`'dan alınır (`sw.url().split('/')[2]`).
- Fixture sunucusu: `sirv`/`vite preview` ile `http://127.0.0.1:4173/` ve cross-origin için ikinci origin `http://localhost:4174/` (aynı dizin).

---

## 3. Unit Testler (`REQ-QA-020`…`029`)
| Modül | Test dosyası | Başlıca vakalar |
|---|---|---|
| `capture/plan.ts` | `plan.test.ts` | tek tile, tam bölünen yükseklik, artık satır (`cropFromViewport`), yatay overflow cols>1, sticky yükseklik düşürme (`tileH_eff`), `maxTiles` aşımı → kırpma+uyarı, DPR 1/1.25/2/3, zoom ≠ 1, RTL negatif scroll, nested plan (`planNested`) element > viewport, actual<desired ack ile yeniden hesap; property-based (fast-check): ∀ plan, tile yerleşimleri birleşimi = içerik alanı, kesişim yok |
| `lib/template/filename` | `filename-template.test.ts` | her token, `counter:3`, `title:40`, fallback `|`, sanitizasyon (T6 vakaları), Windows rezerve adlar, 180 bayt kırpma, uzantı çifti, boş → `screenshot`, subfolder `..` reddi |
| `content/selector-gen` (DOM ile happy-dom) | `selector.test.ts` | id tercih, hash'li class eleme, data-testid, nth-of-type zinciri, benzersizlik doğrulama, `selectorIndex` |
| `lib/pdf/layout` | `pdf-layout.test.ts` | A4/Letter/Legal boyutları pt, `fit:width/contain`, margin, single long page 14.400 pt bölme, sayfa sayısı, link rect → pt dönüşümü (Y flip, sayfa kesişimi), header/footer token çözümü |
| `lib/pdf/page-break` | `page-break.test.ts` | DOM rect'lere göre kesim (metin satırı bölünmez), pixel ink fallback, pencere %20, hiç aday yoksa sert kesim, çok uzun tek görsel |
| `lib/diff/cluster` | `diff-cluster.test.ts` | piksel maskesi → bbox kümeleme (`clusterGapPx`), `minClusterAreaPx` filtresi, farklı yükseklik padding (added/removed), ignoreRegions |
| `lib/sanitize` | `sanitize.test.ts` | href protokol allowlist, log redaction, selector uzunluğu |
| `settings/migrations` | `migrations.test.ts` | v0→v1… her adım; bilinmeyen alan korunur; bozuk JSON → defaults |
| `capture/rate-limiter` | `rate-limiter.test.ts` | fake timers: 2/sn, backoff 750→1500→3000, 3 deneme sonrası hata |
| `batch/wait-conditions` | `wait.test.ts` | networkIdle/domQuiet değerlendirici (sahte PerformanceObserver/MutationObserver), timeout, birden fazla koşulun kesişimi |
| `lib/image/strip` | `strip.test.ts` | `stripH` hesabı (maxSide/maxArea/memoryBudget), tile sınırına yuvarlama |
| `shared/messages` | `messages.test.ts` | zod şemaları: geçerli/geçersiz payload; `v` uyuşmazlığı `E_PROTOCOL` |
| `lib/hash`, `lib/png-chunks` | | SHA-256 bilinen vektörler; iTXt yaz/oku round-trip |

`REQ-QA-021`: `src/lib/**` ve `src/shared/**` için satır kapsamı ≥ 90 %.

---

## 4. Integration Testler (`REQ-QA-030`…`036`)
- `chrome` mock: `tabs.captureVisibleTab` → fixture tile üretici (renkli ızgara, çağrı sayacı, rate-limit simülasyonu: 500 ms altı çağrıda `lastError`); `scripting.executeScript`, `runtime.connect` (in-memory Port çifti), `storage.local/session` (Map), `downloads.download` (kayıt), `permissions.*`, `alarms.*`, `offscreen.*`.
- Senaryolar:
  - `coordinator.int.test.ts`: happy path full page (sahte agent Port ile `scan/prepare/scrollTo` cevapları) → `tiles` store'da N kayıt → stitch çağrısı → `captures` kaydı → `job.done`; iptal; Port kopması → kısmi; SW restart simülasyonu (`JobStateStore` yeniden yükleme → `failed(E_SW_RESTART)` + restore enjeksiyonu).
  - `export-pipeline.int.test.ts`: PNG/JPEG/PDF/ZIP hedefleri, filename çözümü, `multiImage` davranışları, clipboard strateji zinciri (result page yok → CS → pencere).
  - `history.int.test.ts` (fake-indexeddb): CRUD, keyset pagination, filtreler, refCount ile blob silme, kota uyarı eşiği (`estimate` mock), autoCleanup `oldest`, starred korunur.
  - `batch-runner.int.test.ts`: concurrency 1/2, retry/backoff, timeout, pause/resume, cancel, `closeTabsAfter`, hata logu, combined PDF/ZIP çıktı.
  - `permission-broker.int.test.ts`: feature→izin eşlemesi, red sonrası degrade, `onRemoved` → monitor devre dışı.
  - `offscreen-stitch.int.test.ts` (node + `@napi-rs/canvas` OffscreenCanvas shim): ızgara tile'lardan stitch, strip bölme, postCrop, scaleTo.
- `REQ-QA-031`: Integration testler gerçek `chrome` API'si olmadan, 60 s altında çalışır.

---

## 5. E2E Altyapısı (`REQ-QA-040`…`046`)
- Playwright fixture `test/e2e/fixtures/extension.ts`: `context`, `extensionId`, `sw` (service worker handle), `openPopup()`, `triggerCapture(mode, opts)` (SW'ye `chrome.runtime.sendMessage` via `sw.evaluate`), `waitForJobDone(jobId)`, `getCaptureBlob(captureId)` (result sayfasından `fetch(blobUrl)` ya da SW `history.get` + offscreen objectUrl), `readHistory()`.
- Pencere görünür olmalı: CI'da `xvfb-run` (Linux) veya `--headless=new` (uzantı + `captureVisibleTab` destekli, Chrome ≥ 112). Karar: CI Linux'ta `--headless=new`; nightly'de macOS/Windows headed.
- Her E2E testi sonunda `sw.evaluate(() => chrome.storage.local.clear())` + IDB temizliği (fixture `afterEach`).
- Testler fixture sayfalarını `context.newPage()` ile açar, `page.bringToFront()` çağırır, capture tetikler, çıktıyı indirir (`context.on('page')` ile result sekmesi) ve `test/helpers/image.ts` ile doğrular.
- `REQ-QA-041`: E2E paketi ≤ 20 dk (paralel 4 worker). `REQ-QA-042`: Her E2E başarısızlığında Playwright trace + çıktı PNG artefakt olarak saklanır.

---

## 6. Fixture Site Matrisi (`REQ-QA-050`)
Tüm fixture'lar `test/fixtures/sites/<name>/index.html`; deterministik (rastgelelik yok, sistem fontu yerine bundle'lı `Inter` woff2), her satırda **satır numarası ve piksel ızgarası** (§7) içeren ortak `grid.css`.

| # | Fixture | Test ettiği | Beklenen |
|---|---|---|---|
| 1 | `grid-basic` | Dikiş doğruluğu, 12.000 px, 1 sütun | Referansla birebir (pixelmatch 0 fark, threshold 0.05) |
| 2 | `sticky-header` | `position:sticky` header 64 px | Header yalnız ilk tile'da |
| 3 | `fixed-header-footer` | fixed header + fixed footer + cookie bar (bottom) | Header üstte 1 kez, footer/cookie bar sadece ilk karede |
| 4 | `sticky-never` | `hideFixedElements:'never'` | Tekrar yok, tileH_eff küçülmüş, header yalnız ilk karede |
| 5 | `transform-fixed` | `transform` ebeveyn içinde fixed (containing block) | Tekrar yok (`detectByMotion` P1.5 öncesi bilinen-hata olarak işaretli) |
| 6 | `nested-scroll` | outer `overflow:auto` 80vh + inner container | Element modu iç içeriği tam alır |
| 7 | `gmail-like` | `html,body{height:100%;overflow:hidden}` + inner scroll root | Full-page otomatik doğru root |
| 8 | `chat-panel` | 500 mesaj, sticky chat header, iç scroll, `flex-direction:column-reverse` | scrollContainer modu tam yükseklik, header tekrar etmez |
| 9 | `admin-dashboard` | sidebar fixed + main scroll + sticky thead tablo | Tablo başlığı tekrar etmez |
| 10 | `modal-scroll` | `role=dialog` içi scroll, backdrop | Element modu modal içeriğini tam alır; full-page modda backdrop gizlenmez |
| 11 | `lazy-io` | 50 img IntersectionObserver ile yüklenir | Placeholder 0 |
| 12 | `lazy-data-src` | `data-src`/`data-srcset`, `loading=lazy` | Tümü yüklü |
| 13 | `lazy-slow` | Görseller 800 ms gecikmeli | `imagesLoaded` beklemesi ile tam |
| 14 | `infinite-finite` | Her scroll sonunda 20 öğe, 8 turda biter | 160 öğe; büyütme 8–11 adımda durur |
| 15 | `infinite-endless` | Sonsuz | `maxSteps`/`maxHeightCss`/Stop ile durur, uyarı |
| 16 | `iframe-same-origin` | 3.000 px yüksek iç scroll'lu same-origin iframe | "Capture this frame" tam; full-page modda görünen kısım |
| 17 | `iframe-cross-origin` | `localhost:4174` iframe | İzinsiz: görünen kısım + uyarı; izinli: tam |
| 18 | `frameset` | `<frameset>` 2 frame | Her frame listelenir, tek tek capture |
| 19 | `long-30k` | 30.000 px | Tek PNG (limit içinde, DPR 1) / strip (DPR 2) |
| 20 | `long-120k` | 120.000 px | `maxCaptureHeightCss` kesme + uyarı; limit artırılınca strip'ler, bellek bütçesi |
| 21 | `wide-page` | 3.000 px geniş | cols=3 yatay dikiş |
| 22 | `rtl` | `dir=rtl`, yatay overflow | Doğru yön, dikiş |
| 23 | `zoom-dpr` | Playwright `deviceScaleFactor` 1.25/2/3 + `chrome.tabs.setZoom` 1.5 | Dikiş ±0 px |
| 24 | `animations-video` | CSS animasyon, transition, `<video autoplay>` | Donuk, video pause; restore sonrası devam |
| 25 | `annoyances` | OneTrust/Cookiebot benzeri banner, Intercom benzeri balon, newsletter modal | smartHide açık: yok; kapalı: var |
| 26 | `fonts-webfont` | 1.5 s gecikmeli webfont | `fontsReady` ile doğru font |
| 27 | `dark-mode` | `prefers-color-scheme` | Piksel = ekran |
| 28 | `scroll-snap-smooth` | `scroll-snap-type`, `scroll-behavior:smooth` | Dikiş hatasız |
| 29 | `overflow-anchor` | Scroll sırasında üste içerik ekleme | `overflow-anchor:none` ile kayma yok |
| 30 | `vh-sections` | 5 × `100vh` bölüm | Tam yükseklik |
| 31 | `shadow-dom` | Kapalı/açık shadow root içinde sticky ve scroll | Sticky gizleme shadow içine girmez (bilinen kısıt) — test dokümante eder |
| 32 | `canvas-webgl` | Sürekli çizen canvas | Çıktı var (kare donuk değil; kabul) |
| 33 | `spa-route-change` | Capture ortasında `history.pushState` + DOM değişimi | Port kopmaz; sonuç tutarlı ya da `E_AGENT_DISCONNECTED` kısmi |
| 34 | `beforeunload-nav` | Capture ortasında `location.href` değişimi | Kısmi sonuç + hata, restore gerekmez |
| 35 | `malicious-page` | Overlay taklidi, `postMessage` pickerEvent, `getBoundingClientRect` override | AC-SEC-06; capture doğru |
| 36 | `restricted-like` | — (chrome://version gerçek sekme) | Full-page → `E_RESTRICTED_PAGE`, visible çalışır |
| 37 | `links-text` | 200 `<a>` + başlıklar | PDF link annotasyonları, smart page break |
| 38 | `selection-target` | Bilinen koordinatlı kutular | Selection ±1 px |
| 39 | `element-targets` | `#invoice`, `[data-testid=report]`, tekrarlı `.card` | Selector capture, `selectorIndex` |

`REQ-QA-051`: Yeni capture bug'ı için önce fixture eklenir (regresyon), sonra düzeltme.

---

## 7. Dikiş (Stitch) Doğrulama (`REQ-QA-060`…`063`)
- **Izgara deseni:** `grid.css` her 100 CSS px'te 1 px koyu yatay çizgi, her 50 px'te açık çizgi, sol kenarda `y` değeri metin (`data-y`), sağ kenarda 8 px'lik renk şeridi (`hsl((y/10)%360, 80%, 50%)`) — satır kimliği renkten okunur.
- **Referans üretimi:** Playwright'ın kendi `page.screenshot({fullPage:true})` çıktısı (Playwright CDP ile 16.384 px altı sayfalar için güvenilir) → `test/e2e/reference/<fixture>@<dpr>.png`; > 16 k için fixture'ı bölümler halinde çekip birleştiren yardımcı.
- **Karşılaştırma:** `pixelmatch(out, ref, diff, w, h, {threshold:0.05, includeAA:true})`; izin verilen fark oranı `≤ 0.01 %` (font antialias); sticky fixture'larda referans Playwright'tan değil, fixture'ın `?static=1` modundan (sticky'ler normal akışta) üretilir.
- **Seam dedektörü (`test/helpers/image.ts#findSeams`):** Çıktıda her tile sınırı `y_k` için `k` satırının renk şeridinden okunan `y` değeri ile beklenen `y` karşılaştırılır; ardışık iki satırda aynı `y` (tekrar) ya da atlanan `y` (boşluk) → seam hatası; rapor `{at:y_k, kind:'dup'|'gap', px}`. Hedef: 0 seam.
- `REQ-QA-063`: Seam dedektörü unit testlidir (sentetik tekrar/atlama görüntüleriyle).

---

## 8. Performans ve Bellek (`REQ-QA-070`…`075`)
Bütçeler `02 §9`'dan; `test/perf/budgets.json`:
```json
{ "visibleCaptureMs": 400, "fullPage10kMs": 15000, "stitch10kMs": 3000, "stitchPeakMb": 600, "swHeapMb": 100, "popupFirstPaintMs": 150, "history5kListMs": 300, "coreBundleKb": 1536 }
```
- Ölçüm: E2E'de `performance.now()` SW içinde (`sw.evaluate`), job `startedAt/finishedAt`; stitch süresi offscreen `StitchResult.durationMs`; bellek `performance.measureUserAgentSpecificMemory()` (offscreen, cross-origin isolated gerekmez uzantı sayfasında) + `chrome://memory` yerine `process.memoryUsage` yerine Playwright CDP `Performance.getMetrics` (`JSHeapUsedSize`) ile sekme/SW hedefleri.
- Bundle: `scripts/check-bundle-size.ts` build sonrası `dist/` chunk boyutlarını bütçeyle karşılaştırır (OCR/diff/pdf lazy chunk'lar hariç core).
- Popup ilk boya: Playwright `page.goto(chrome-extension://<id>/popup.html)` + `performance.getEntriesByType('paint')`.
- History 5k: integration testte 5.000 sahte kayıt ekleyip `history.list` süresi.
- Bütçe aşımı CI'da **uyarı** (PR yorumu), `main`'de nightly'de **hata**. (`REQ-QA-071`)
- Bellek sızıntısı: 20 ardışık full-page capture sonrası offscreen heap ilk ölçümün 1.5 katını aşmamalı; `tiles` store boş olmalı. (`REQ-QA-072`)

---

## 9. Rate Limit, Cancel, Restore (`REQ-QA-080`…`084`)
- Rate limit: integration mock 500 ms altı çağrıda hata; coordinator 0 kullanıcı hatası ile 40 tile tamamlar; E2E'de gerçek Chrome ile 40 tile capture'da `E_RATE_LIMIT` yüzeye çıkmaz (log'da retry sayısı raporlanır).
- Cancel: E2E `grid-basic` capture'ı %30'da `capture.cancel` → 300 ms içinde `job.cancelled`; `tiles` boş; sayfa DOM snapshot'ı (aşağıda) eşit.
- Restore doğrulama (`test/helpers/dom-snapshot.ts`): capture öncesi/sonrası `document.documentElement.outerHTML` (dinamik `data-ssx-*` yok olmalı), tüm elementlerin `getComputedStyle` `position/visibility/display/animation-play-state`, `scrollTop` tüm scrollable'larda, `document.styleSheets.length`, `video.paused`. Fark → test hatası. Hem başarılı capture hem cancel hem de Port kopması senaryolarında.
- Esc tuşu ile iptal (E2E `page.keyboard.press('Escape')`).

---

## 10. Storage ve Migration (`REQ-QA-090`…`093`)
- Dexie şema versiyonları için `migrations.int.test.ts`: v1 verisi seed → upgrade → alanlar doğru; blob refCount tutarlılığı; OPFS eşik (>50 MB → OPFS) mock `navigator.storage.getDirectory` (memfs tabanlı shim).
- Kota: `navigator.storage.estimate` mock ile %85/%95 eşikleri → uyarı mesajı / autoCleanup tetik.
- Yetim temizliği: `tiles` içinde jobId'si aktif olmayan kayıtlar SW start'ta silinir.
- `Clear all data` sonrası tüm store'lar boş (AC-SEC-10 ile ortak).

---

## 11. PDF Doğrulama (`REQ-QA-100`…`105`)
`test/helpers/pdf.ts`: `pdfjs-dist` (legacy build, node) ile yeniden ayrıştırma.
- Sayfa sayısı beklenenle eşit (A4 portrait, 12.000 px @ 0.75 pt → N sayfa hesaplanır).
- Sayfa boyutları pt (A4 595.28×841.89 ±0.1; single long page ≤ 14.400).
- Link annotasyonları: `page.getAnnotations()` → `Subtype:'Link'`, URL allowlist, rect'ler sayfa sınırında; `links-text` fixture'ında ≥ 190 link.
- Metin katmanı: `searchableText:'ocr'` ile `page.getTextContent()` fixture'daki bilinen cümleyi içeriyor (OCR toleransı: Levenshtein ≤ %10); `'none'` ile boş.
- Header/footer token'ları (`{page}/{pages}`, `{url}`) metin olarak mevcut.
- Metadata: `getMetadata()` Title/Subject/CreationDate.
- Smart page break: `links-text` fixture'ında hiçbir metin satırı iki sayfaya bölünmez — doğrulama: sayfa sınırı `y`'leri, fixture'ın satır bbox listesiyle (DOM'dan `agent.collectText` ile üretilen JSON) kesişmez.
- Watermark: belirli pikselde alfa karışımı (render edip `pdfjs` canvas → pixel).
- Dosya boyutu: 10 sayfa JPEG q0.85 PDF < 4 MB (FireShot şikayetine karşı bütçe).
- pdf-lib ile yeniden `PDFDocument.load` → hata yok (yapısal geçerlilik); ayrıca `qpdf --check` CI'da varsa (opsiyonel).

---

## 12. Editör Testleri (`REQ-QA-110`…`114`)
- Unit: annotation model serileştirme round-trip; redact commit → base piksel değişimi ve orijinal blob silinmesi; undo/redo yığını; crop/rotate geometri.
- Playwright UI (`result.html?id=<seed>`): her araç için çiz → `EditorDocument` state doğrula → export PNG'de beklenen piksel (ör. kırmızı ok bbox'ında kırmızı piksel oranı > %5); blur/pixelate bölgesinde varyans düşüşü; redact bölgesi tamamen `#000`; klavye kısayolları (V/A/R/T/B…, Ctrl+Z/Y, Delete, Ctrl+C/V, Ctrl+D); zoom/pan; katman sırası; 5.000×20.000 görüntüde editör açılış < 2 s ve 60 fps'e yakın pan (frame süresi p95 < 32 ms).
- Erişilebilirlik: araç çubuğu `role=toolbar`, `aria-pressed`, klavye ile araç seçimi (§17).

---

## 13. Batch Testleri (`REQ-QA-120`…`123`)
- E2E: 12 fixture URL'lik batch (`concurrency:1`, sonra `2`), `wait.networkIdle`, `export.combine:'zipAndPdf'` → ZIP içinde 12 PNG + 1 PDF (12 sayfa); `filename` `{batchIndex:3}_{domain}_{title:40}`; 2 URL kasıtlı 404/timeout → `completedWithErrors`, `retryFailed` sonrası biri başarılı; `pause/resume/cancel`; sekmeler kapatıldı (`closeTabsAfter`); izin kartı (host izni) akışı.
- All-tabs: 5 sekme açık, 1'i chrome://, 1'i discarded → 4 capture, log'da 1 atlanan; aktif sekme geri yüklendi.
- Combined PDF sayfa sırası = giriş sırası.

---

## 14. Diff Testleri (`REQ-QA-130`…`133`)
- Unit (pixelmatch + cluster): sentetik çiftler — aynı (0 %), 1 bölge değişmiş (bbox ±2 px), alt kısım eklenmiş (added region), ignoreRegions içinde değişiklik yok sayılır, antialias gürültüsü (includeAA:false) filtrelenir; farklı genişlik/yükseklik `alignment:'top'` ile pad edilir ve uyarı üretir; yalnızca geçersiz/boş boyutlar → `E_VALIDATION`.
- E2E `compare.html`: iki history kaydı → overlay/side-by-side/slider görünümleri, changedPct rozeti; `diff.history` timeline 3 kayıt.
- Monitoring: `chrome.alarms` mock ile kural tetiklenir → recapture → diff → eşik üstü bildirim (integration).

---

## 15. OCR (`REQ-QA-140`…`142`)
- Smoke: `fonts-webfont` fixture'ının 1 tile'ı → `offscreen.ocr` (eng) → bilinen cümle Levenshtein ≤ %10, süre < 6 s (CI), worker yeniden kullanımı (ikinci çağrı < 2 s).
- M3 `offscreen.ocr` integration: 3 capture tile'ı indekslenir ve searchable PDF'e aktarılır; M4 `ocr.search` integration: 3 history kaydı indekslenmiş, sorgu doğru kaydı döndürür, snippet ve bbox içerir.
- Dil verisi bundle'dan yüklendiği (hiç dış origin `fetch` yok) assert edilir; OCR worker yalnızca `chrome.runtime.getURL('assets/ocr/...')` altındaki paket içi verileri kullanır.

---

## 16. i18n (`REQ-QA-150`…`152`)
- `test/unit/i18n.test.ts`: `_locales/en/messages.json` anahtar kümesi == `tr` anahtar kümesi; placeholder sayıları eşit; boş string yok; kodda kullanılan `t('key')`/`__MSG_key__` anahtarları (regex tarama) `en`'de mevcut; kullanılmayan anahtar uyarı.
- Her `ErrorCode` için `userMessageKey` hem `en` hem `tr`'de var.
- Playwright: `--lang=tr` ile popup'ta Türkçe metin.

---

## 17. Erişilebilirlik (`REQ-QA-160`…`162`)
- `@axe-core/playwright` her extension page'de (popup, sidepanel, result/editor boş & dolu, history, compare, batch, options, onboarding): `serious`/`critical` ihlal 0.
- Klavye: popup'ta Tab sırası, capture butonları `Enter/Space`; picker `Esc`; overlay `Cancel` odaklanabilir.
- Kontrast: design token testleri (10'daki renk çiftleri WCAG AA ≥ 4.5:1) unit.

---

## 18. Cross-browser Smoke (`REQ-QA-170`)
- Nightly: Edge (stable channel, `channel:'msedge'`) ve Brave (yerel kurulum, `executablePath`) ile 5 temel E2E (visible, full-page grid, selection, PDF, history). Hata → issue, release blocker değil (best-effort).

---

## 19. CI Matrisi ve Kapsam (`REQ-QA-180`…`184`)
| Job | Tetik | Runner | Adımlar |
|---|---|---|---|
| `lint-typecheck` | PR/push | ubuntu | eslint, tsc, manifest check, i18n test |
| `unit-integration` | PR/push | ubuntu | vitest + coverage (Codecov) |
| `e2e-linux` | PR/push | ubuntu (`--headless=new`, 1440×900, DPR 2 via flag) | Playwright, trace on failure |
| `e2e-mac` / `e2e-win` | nightly + release | macos-latest / windows-latest (headed) | Tam E2E + perf bütçeleri hard |
| `perf-budgets` | nightly | ubuntu | §8; regresyon yorumu |
| `cross-browser` | nightly | macos | §18 |
| `build-release` | tag | ubuntu | reproducible build, zip, SHA, artefakt (14) |
- Kapsam: `src/lib/**`+`src/shared/**` ≥ 90 %, toplam ≥ 75 %; `vitest --coverage.thresholds` ile zorlanır (`REQ-QA-181`).
- PR "required checks": lint-typecheck, unit-integration, e2e-linux (`REQ-QA-182`).

---

## 20. Flaky Test Politikası (`REQ-QA-190`)
- Playwright `retries:1` sadece CI'da; ikinci denemede geçen test "flaky" etiketi alır ve `flaky.json`'a otomatik yazılır (raporlayıcı).
- 7 gün içinde 3+ flaky → `test.fixme` ile karantina + issue (owner, son tarih 2 hafta); karantinadaki test sayısı ≤ 5 (üst sınır aşılırsa release blocker).
- Zaman bazlı bekleme (`waitForTimeout`) yasak; durum bazlı bekleme (`expect.poll`, job event).

---

## 21. Hata Şiddeti (`REQ-QA-200`)
| Şiddet | Tanım | Örnek | SLA |
|---|---|---|---|
| S0 Blocker | Veri kaybı, güvenlik/gizlilik ihlali, kurulum/çalışmama, crash | Redact geri alınabiliyor; history siliniyor; izinsiz ağ isteği | Hotfix 24 s |
| S1 Critical | Ana akış çalışmıyor (full-page/visible/PDF/download) yaygın sitelerde | Sticky header tekrarı çoğu sitede | Sonraki patch (≤ 1 hafta) |
| S2 Major | Özellik belirli koşulda bozuk, workaround var | Belirli CMS'te lazy görsel boş | Sonraki minor |
| S3 Minor | Kozmetik, küçük UX | Rozet hizası | Backlog |
Release kriteri: açık S0/S1 = 0.

---

## 22. Manuel QA Listesi (her release) (`REQ-QA-210`)
1. Temiz profil kurulum: izin diyaloğu metni, onboarding, kısayollar çalışıyor.
2. 10 gerçek site seti (haber sitesi, e-ticaret ürün sayfası, Gmail, Slack web, ChatGPT, GitHub PR, Notion sayfası, Google Docs, YouTube, Twitter/X timeline): full-page, visible, selection, element; sticky/lazy/infinite gözle doğrulama.
3. PDF: A4 çok sayfa, tek uzun sayfa, linkler tıklanıyor (Acrobat + Chrome viewer + Preview), metin seçilebilir (OCR açık).
4. Clipboard: result sayfasından, popup "Copy" ile, kısayolla → Slack/Docs'a yapıştır.
5. Download: filename template, alt klasör, saveAs, conflict.
6. History: arama/filtre/bulk/recapture/compare; 1 GB+ veriyle performans.
7. Batch 20 URL + all-tabs; izin kartları; iptal.
8. Editör tüm araçlar + redact + export; büyük görüntü.
9. Options tüm sekmeler; reset; Clear all; izin geri alma.
10. i18n `tr` UI turu; dark/light tema; 200 % sistem ölçeği; dar pencere (popup 360 px).
11. Incognito davranışı; chrome:// sayfa hataları; file:// (izinsiz/izinli).
12. Güncelleme senaryosu: önceki sürümden yükseltme → migration, history korunmuş.
13. Kaldır/yeniden kur: veri silindi notu doğru.

---

## 23. İzlenebilirlik Matrisi (`REQ-QA-220`)
- Konvansiyon: her test dosyasında `// @req REQ-CAP-020 REQ-CAP-021` ve her `test()` adında ilgili AC: `test('AC-CAP-02 sticky header appears once', …)`.
- `scripts/traceability.ts`: tüm `specs/*.md`'den `REQ-[A-Z]+-\d+` ve `AC-[A-Z]+-\d+` çıkarır, `test/**`'ü tarar, `reports/traceability.md` üretir: REQ → AC → test dosyası(ları) → son CI durumu; kapsanmayan REQ/AC listesi. CI'da kapsanmayan P0 REQ varsa uyarı; release'de hata.
- Şablon:

| REQ | Açıklama | AC | Test dosyası | Katman | Durum |
|---|---|---|---|---|---|
| REQ-CAP-020 | Full-page scroll+stitch | AC-CAP-01 | `test/e2e/specs/capture-fullpage.e2e.ts`, `test/unit/plan.test.ts` | E2E, Unit | ✅ |
| REQ-CAP-040 | Fixed/sticky yönetimi | AC-CAP-02 | `test/e2e/specs/sticky.e2e.ts` | E2E | ✅ |
| REQ-SEC-081 | Redact kalıcı | AC-SEC-07 | `test/unit/editor/redact.test.ts`, `test/e2e/specs/editor-redact.e2e.ts` | Unit, E2E | ✅ |
| … | | | | | |

- Test dosyası adlandırma: `test/<layer>/<alan>/<konu>.(test|int.test|e2e).ts`; alan = `capture|export|editor|history|batch|diff|security|ui|i18n|a11y|perf`.

---

## 24. Kabul Kriterleri
| ID | Kriter |
|---|---|
| AC-QA-01 | `pnpm test` (unit+integration) temiz ortamda < 3 dk, kapsam eşikleri sağlanır |
| AC-QA-02 | `pnpm e2e` Linux CI'da < 20 dk; 39 fixture'ın tamamı için en az bir E2E senaryosu mevcut |
| AC-QA-03 | `grid-basic` 12.000 px @DPR2 çıktısında seam dedektörü 0 hata, pixelmatch fark ≤ 0.01 % |
| AC-QA-04 | Perf bütçeleri nightly'de raporlanır; aşım `main`'de hata üretir |
| AC-QA-05 | `reports/traceability.md` üretilir; P0 REQ'lerin %100'ü en az bir testle eşleşir |
| AC-QA-06 | Karantinadaki flaky test sayısı ≤ 5 |
| AC-QA-07 | axe-core: tüm extension sayfalarında serious/critical ihlal 0 |
| AC-QA-08 | i18n anahtar eşitliği testi geçer (`en` ≡ `tr`) |
| AC-QA-09 | PDF doğrulama: link annotasyonları, sayfa boyutları, metin katmanı (OCR) testleri geçer |
| AC-QA-10 | Restore DOM snapshot eşitliği başarılı/cancel/kopma senaryolarının üçünde de sağlanır |
