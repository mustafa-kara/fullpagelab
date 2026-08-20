# FullPageLab — Spesifikasyon Seti

> **Ürün sloganı:** *Capture, document and track the web.*
> GoFullPage kalitesinde capture engine + FireShot seviyesinde batch/PDF + güçlü editör + history/recapture/diff/evidence özellikleri.

Bu klasör, FireShot ve GoFullPage benzeri bir **Chrome Manifest V3** uzantısının *implementasyona hazır* spesifikasyonlarını içerir. Kaynak özellik listesi `_source-features.md` dosyasındadır; bu set o listedeki **tüm** maddeleri kapsar ve her birini mimari, algoritma, veri modeli, UI ve kabul kriteri seviyesine indirger.

Hedef okuyucu: implementasyonu yapacak mühendis/AI ajanı. Dokümanlar, ek soru sormadan kodlamaya başlanabilecek kadar kesin olmaya çalışır; belirsiz kalan noktalar açıkça **"Karar:"** etiketiyle verilmiş varsayılan kararlar olarak yazılmıştır.

## Uygulama durumu

Gerçekleşen kod, doğrulama sonuçları, çalışan capture modları ve kalan M1 işleri [`docs/progress.md`](../progress.md) dosyasında tutulur. Bu README doküman haritasını ve normatif spec setini, [`12-roadmap-and-milestones.md`](12-roadmap-and-milestones.md) ise planlanan milestone kırılımını tanımlar.

---

## Doküman Haritası

| # | Dosya | İçerik | Öncelik |
|---|---|---|---|
| 00 | `00-README.md` | Bu dosya: harita, terimler, kurallar | — |
| 01 | `01-product-overview.md` | Vizyon, konumlandırma, persona, rakip analizi, öncelik matrisi, non-goal'lar | P0 |
| 02 | `02-architecture.md` | MV3 mimarisi, bileşenler, mesajlaşma protokolü, state machine, depolama katmanları, izin modeli, build/tooling, repo yapısı, kod standartları | P0 |
| 03 | `03-capture-engine.md` | Capture motoru: full page, visible, selection, element/selector, scrollable container, fixed/sticky, lazy-load, iframe, infinite scroll, tiling, progress/cancel, kısayollar, context menu, delay, all tabs | P0 |
| 04 | `04-export-and-files.md` | PNG/JPEG/WebP/GIF/BMP, PDF (tüm seçenekler), clipboard, download, filename template, multi-image fallback, ZIP, print, watermark, header/footer | P0 |
| 05 | `05-editor.md` | Screenshot editörü: mimari, araçlar, gizlilik araçları (blur/pixelate/redaction), UX, kısayollar, annotation veri modeli | P1 |
| 06 | `06-batch-and-automation.md` | URL batch capture, all-tabs, wait conditions, output modları, concurrency/retry/timeout, hata logları, presets | P1 |
| 07 | `07-history-and-storage.md` | History veri modeli, IndexedDB/OPFS şeması, thumbnail, arama/filtre, bulk işlemler, kota yönetimi, recapture | P0 |
| 08 | `08-privacy-security.md` | Local-first ilkesi, izin stratejisi, CSP, tehdit modeli, redaction garantileri, telemetri/cloud opt-in | P0 |
| 09 | `09-differentiators.md` | Version compare, pixel diff, smart element hide, evidence mode, bug report mode, diff timeline, OCR search, entegrasyonlar, public API, change monitoring | P1/P2 |
| 10 | `10-ui-ux.md` | Popup, side panel, result/editor sayfası, options, history UI, onboarding, i18n, erişilebilirlik, tema | P0 |
| 11 | `11-testing-qa.md` | Test stratejisi, test site matrisi, özellik bazlı kabul kriterleri, performans bütçeleri, uyumluluk | P0 |
| 12 | `12-roadmap-and-milestones.md` | Fazlı teslimat planı; epik → iş paketi → task kırılımı; Definition of Done | P0 |
| 13 | `13-data-contracts.md` | TypeScript tipleri: CaptureRequest/Result, mesajlar, storage şemaları, settings, preset, batch job, filename template grameri; §14 diğer dokümanlardan gelen ek alanlar (merge edilir) | P0 |
| 14 | `14-release-and-store.md` | Chrome Web Store listing, izin gerekçeleri, gizlilik politikası, sürümleme, CI/CD, release checklist | P1 |

**Okuma sırası (implementasyon için):** 00 → 01 → 02 → 13 → 03 → 04 → 07 → 10 → 08 → 11 → 12 → 05 → 06 → 09 → 14.

---

## Kapsam Özeti (kaynak dokümanla eşleme)

| Kaynak bölüm | Spec dosyası |
|---|---|
| 1. Temel Capture Özellikleri | 03 |
| 2. Export ve Dosya Özellikleri | 04 |
| 3. Screenshot Editor | 05 |
| 4. Capture Engine – Teknik Gereksinimler | 03 (+02) |
| 5. Batch Capture ve Automation | 06 |
| 6. Screenshot History | 07 |
| 7. Privacy ve Güvenlik | 08 |
| 8. Rakiplerden Ayrıştırabilecek Özellikler | 09 |
| 9. Önerilen Roadmap | 12 |
| 10. Ürün Konumlandırması | 01 |
| 11. Öncelik Matrisi | 01 (+12) |

---

## Terimler Sözlüğü

| Terim | Anlam |
|---|---|
| **SW** | Service Worker — MV3 uzantısının arka plan betiği (`background.ts`). Kalıcı değildir. |
| **CS** | Content Script — sayfaya enjekte edilen betik. *Isolated world* (varsayılan) veya *main world*. |
| **Offscreen** | `chrome.offscreen` ile açılan görünmez DOM sayfası; canvas stitching, clipboard, blob işleri burada yapılır. |
| **Extension page** | Uzantının kendi HTML sayfaları: popup, side panel, options, `result.html` (editör), `history.html`, `batch.html`. |
| **Capture job** | Tek bir capture isteğinin yaşam döngüsü (request → tiles → stitch → result). |
| **Tile** | Viewport boyutunda tek bir `captureVisibleTab` karesi (PNG dataURL/ImageBitmap). |
| **Stitch** | Tile'ların tek (veya parçalı) görüntüde birleştirilmesi. |
| **Strip** | Çok uzun sayfalarda, canvas limitini aşmamak için üretilen yatay dilim görüntüler (multi-image fallback). |
| **Backend** | Capture tekniği: `visibleTab` (scroll + `chrome.tabs.captureVisibleTab`) veya `debugger` (CDP `Page.captureScreenshot`). |
| **Preset** | Kayıtlı capture+export ayar seti (ör. "Bug Report", "Legal Evidence"). |
| **Recapture** | History'deki bir kaydın aynı parametrelerle yeniden çekilmesi. |
| **Evidence bundle** | Screenshot + metadata + SHA-256 + (opsiyonel) TSA zaman damgası paketi. |
| **DPR** | `window.devicePixelRatio`. |
| **CDP** | Chrome DevTools Protocol (`chrome.debugger`). |

---

## Yazım Kuralları (tüm dosyalar için)

1. **Gereksinim dili:** MUST / SHOULD / MAY (RFC 2119). Türkçe metinde **ZORUNLU / ÖNERİLEN / OPSİYONEL** olarak da geçebilir; aynı anlamdadır.
2. **Öncelik:** P0 (MVP), P1 (V1), P1.5, P2, DIFF (ayrıştırıcı). Bkz. `12-roadmap-and-milestones.md`.
3. **Karar etiketi:** `Karar:` ile başlayan satırlar, implementasyonun sorgulamadan uygulayacağı varsayılan tasarım kararlarıdır. Değiştirmek isteyen ürün sahibidir.
4. **Kimlikler:** Her gereksinim `REQ-<alan>-<no>` şeklinde ID alır (ör. `REQ-CAP-012`). Test ve task'lar bu ID'lere referans verir.
5. **Kod dili:** Tüm identifier, tip, mesaj adı, dosya adı **İngilizce**. UI metinleri i18n üzerinden (varsayılan `en`, ikinci dil `tr`).
6. **Ölçü birimleri:** Piksel değerleri aksi belirtilmedikçe **CSS px**; fiziksel piksel gerektiğinde `device px` yazılır. PDF ölçüleri **pt** (1/72 inch).
7. **Platform hedefi:** Chrome ≥ 120 (stable), Chromium tabanlı tarayıcılar (Edge, Brave, Arc, Opera) best-effort. Firefox/Safari non-goal (V2+ değerlendirilebilir).

---

## Teknoloji Özeti (detay: 02)

- **Dil/derleme:** TypeScript 5.x, strict mode. Bundler: **Vite + `@crxjs/vite-plugin`** (Karar). Paket yöneticisi: pnpm.
- **UI:** Preact (+ Signals) — küçük bundle, React ekosistemi uyumu (Karar). CSS: vanilla CSS modules + design token'ları; Tailwind kullanılmaz.
- **Durum/iletişim:** Tipli mesaj protokolü (`13-data-contracts.md`), `chrome.runtime.Port` + `sendMessage`.
- **Depolama:** IndexedDB (Dexie) + OPFS (büyük blob'lar), `chrome.storage.local` (settings), `chrome.storage.session` (job state).
- **Görüntü işleme:** OffscreenCanvas, `createImageBitmap`, WebCodecs (ImageDecoder) varsa; büyük görüntüler için satır-bazlı PNG encoder (`fast-png`/`UPNG`) fallback.
- **PDF:** `@cantoo/pdf-lib` (image-PDF, link annotation, OCR görünmez metin katmanı, metadata); `Page.printToPDF` yalnızca `cdp` build varyantında.
- **Editör:** Fabric.js v6 (Karar) üzerinde özel araç katmanı.
- **OCR:** Tesseract.js (bundle içinde, ayrı lazy chunk; eng+tur; opt-in). **Diff:** pixelmatch. **ZIP:** fflate (streaming).
- **Test:** Vitest (unit), Playwright (E2E, uzantı yüklü Chromium), görsel regresyon için kendi test sitesi seti.

---

## Kilit Mimari Kararlar (hızlı bakış; detay 02/08)

1. **Manifest V3**, varsayılan izinler: `activeTab, scripting, storage, unlimitedStorage, downloads, offscreen, contextMenus, alarms, sidePanel`. `<all_urls>` host izni **opsiyonel** ve bağlamsal (iframe/batch/monitoring).
2. **`debugger` izni opsiyonel olamaz** → iki build varyantı: `store` (Web Store, debugger yok; varsayılan) ve `cdp` (self-hosted/enterprise; `DebuggerBackend`, `Page.printToPDF`, CDP console log). Tüm özellikler `store` varyantında da çalışır (OCR text layer, main-world console tap ile).
3. Capture motoru: scroll + `chrome.tabs.captureVisibleTab` (2 çağrı/sn limiti; ≥ 500 ms aralık), tile'lar IndexedDB'de, stitching **offscreen document** içindeki worker'larda; canvas limiti (kenar 16.384 / alan 268 M px güvenli varsayılan, runtime probe) aşılırsa **strip** üretimi.
4. Sticky/fixed: `hideAfterFirst` (ilk tile'da görünür, sonra `visibility:hidden`); iç scroll container'lar ve custom scrolling root otomatik tespit.
5. SW kalıcı değil: job state `storage.session`; Port'lar ve API çağrıları SW'yi canlı tutar; yapay keepalive yok.
6. Depolama: Dexie (`ssx`) + OPFS (> 50 MB), `storage.local` ayarlar; yazma yalnız SW üzerinden; OCR için `ocrDocs` (capture başına satır + multiEntry tokens).
7. Export: `pdf-lib` (JPEG gömme, link annot, görünmez OCR metin katmanı), canvas-sız satır-bazlı PNG (oversize), `fflate` ZIP; downloads için blob URL offscreen'de üretilir.
8. Pano görüntü yazımı: result sayfası → aktif sekme CS → küçük uzantı penceresi zinciri (offscreen odaksız olduğu için görüntü yazamaz).
9. Editör Fabric.js v6; **redaction yıkıcıdır** (base piksel yeniden yazılır), blur/pixelate yalnızca görsel.
10. Local-first; telemetri/cloud/integration yalnızca opt-in; entegrasyonlarda PKCE mümkün olanlar uzantı içinde, secret gerektirenler API token ya da opsiyonel token proxy.
