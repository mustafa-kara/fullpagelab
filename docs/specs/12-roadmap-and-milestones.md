# 12 — Roadmap ve Milestone Kırılımı

> Fazlı teslimat planı. Her milestone: hedef, epikler, iş paketleri (WP), bağımlılıklar, çıkış kriteri (Definition of Done). İmplementasyon ajanı bu dosyayı **task listesi** olarak kullanır; her WP ilgili spec bölümüne ve REQ/AC ID'lerine referans verir. Sıra önerilen sıradır; aynı milestone içindeki WP'ler paralel yapılabilir (bağımlılık belirtilmedikçe).

Tahminler "ideal mühendis-gün" (IMG) cinsindendir ve yalnızca göreli büyüklük içindir.

---

## Güncel uygulama durumu

Gerçekleşen uygulamanın kanonik ayrıntılı raporu [`docs/progress.md`](../progress.md) dosyasındadır.

- M0 altyapı temelleri uygulanmış ve otomatik doğrulamalardan geçmiştir.
- M1 devam etmektedir; temel Visible area ve Full page akışları çalışır durumdadır.
- M1'in tam çıkış kriteri henüz karşılanmamıştır. Selection, scroll container, sticky/fixed yönetimi, tam export/history ve E2E/smoke kapsamı açık işlerdir.
- Bu bölümdeki WP tablosu planı gösterir; WP'lerin gerçekleşme durumu için ilerleme raporuna bakılmalıdır.

---

## Genel Definition of Done (her WP için)
- [ ] Kod TypeScript strict, lint temiz, `pnpm build` iki varyantta (store/cdp) geçer.
- [ ] İlgili unit testler yazıldı (lib'ler için ≥ %90 satır kapsama), E2E fixture'ı varsa eklendi (11).
- [ ] Kabul kriterleri (AC-*) manuel veya otomatik doğrulandı; sonuç PR açıklamasında.
- [ ] i18n anahtarları `en` + `tr` eklendi.
- [ ] Erişilebilirlik (klavye + ARIA) UI WP'lerinde kontrol edildi.
- [ ] Güvenlik checklist (08) maddeleri gözden geçirildi.
- [ ] Dokümantasyon: spec'ten sapma varsa spec güncellendi (`Karar:` değişikliği PR'da açıklanır).

---

## M0 — İskelet ve Altyapı (≈ 8 IMG)
**Hedef:** Boş ama çalışan uzantı; tüm context'ler ve mesajlaşma ayakta; CI yeşil.

| WP | İçerik | Spec | Bağımlılık |
|---|---|---|---|
| M0-01 | Repo, pnpm, Vite + CRXJS, TS strict, ESLint/Prettier, Husky; `manifest.config.ts` (store/cdp varyant, i18n, sürüm env) | 02 §10 | — |
| M0-02 | `shared/types` + zod şemaları (13'ün tamamı, iskelet olarak) ; `shared/messages.ts` tipli `send/connect/onMessage` helper'ları; `ErrorInfo`/`ErrorCode` | 13, 02 §3 | M0-01 |
| M0-03 | SW giriş: top-level listener kaydı; `SettingsStore` (defaults + migration iskeleti); `JobStateStore` (storage.session); `log.ts` | 02 §2.1, §6 | M0-02 |
| M0-04 | Offscreen document yaşam döngüsü (`ensureOffscreen`, `hasDocument`, idle kapanış); worker havuzu + comlink; `offscreen.probeLimits` | 02 §2.3 | M0-02 |
| M0-05 | Content script iskeleti: `page-agent.ts` idempotent guard, Port bağlantısı, `agent.ping/scan/restore` | 02 §2.2, 03 §1.2 | M0-02 |
| M0-06 | Dexie şeması v1 (captures, blobs, tiles, …), OPFS helper, `BlobRef` çözümleyici; `HistoryService` CRUD | 07 | M0-02 |
| M0-07 | UI kiti + design token'ları + i18n runtime; popup/options/result/history sayfalarının boş iskeletleri; Preact kurulumu | 10 | M0-01 |
| M0-08 | Test altyapısı: Vitest + fake-indexeddb + chrome mock; Playwright `--load-extension` smoke; fixture server; GitHub Actions (lint/unit/build/e2e) | 11 | M0-01 |
| M0-09 | `_locales/en,tr` iskelet, ikonlar, store/cdp build çıktısı zip | 14 | M0-01 |

**Çıkış:** Popup açılır, "Ping" ile SW→CS→SW round-trip çalışır, offscreen probe limit döner, CI yeşil.

---

## M1 — MVP Capture (P0) (≈ 20 IMG)
**Hedef:** Full page / visible / selection / scroll container capture; sticky handling; progress/cancel; kısayol; PNG/JPG/PDF(temel)/clipboard; history; local-only.

| WP | İçerik | Spec / AC | Bağımlılık |
|---|---|---|---|
| M1-01 | `CaptureCoordinator` state machine + `JobState` + `job-events` Port + iptal; ön doğrulama (restricted pages, pencere görünürlüğü, aktif sekme doğrulama) | 03 §1, §13, §14; AC-CAP-08/10/14 | M0 |
| M1-02 | `VisibleTabBackend` + `RateLimiter` (2/s, backoff) + `tiles` store yazımı | 03 §4.3; AC-CAP-13 | M1-01 |
| M1-03 | CS `PageScanner` (metrikler, scroll container tespiti, custom scrolling root, fixed/sticky tarama, lazy sayısı) | 03 §4.1, §6.1 | M0-05 |
| M1-04 | `plan.ts` (saf): full-page plan, yatay overflow, son satır crop, nested plan iskeleti; unit testler | 03 §4.2 | — |
| M1-05 | CS `Scroller` + settle + scroll-snap/smooth override; `PagePreparer` (scrollbar gizle, animasyon durdur, medya pause); `Restorer` | 03 §4.3, §14, §16 | M1-03 |
| M1-06 | `FixedElementManager` (hideAfterFirst/hideAll/none, anchor kuralları) | 03 §6; AC-CAP-02 | M1-03 |
| M1-07 | Offscreen `stitch.worker` (ImageBitmap, crop/place, strip bölme, bellek bütçesi, tile temizliği) + `thumb.worker` | 03 §4.4, §10; AC-CAP-01/06 | M0-04 |
| M1-08 | Visible capture yolu (CS'siz çalışma dahil, chrome:// sayfalar) | 03 §3 | M1-01 |
| M1-09 | Selection overlay (Shadow DOM, Esc/Enter, rozet) + crop | 03 §5; AC-CAP-11 | M1-05 |
| M1-10 | Scroll container capture (picker `scrollContainer` modu, iç scroll planı, iç sticky) | 03 §7.3; AC-CAP-04/05 | M1-04, M1-06 |
| M1-11 | Element picker overlay (hover highlight, ↑/↓, rozet) + selector üretici (unit test) | 03 §7.1–7.2 | M1-05 |
| M1-12 | DPR/zoom normalize, gerçek ölçek doğrulama, RTL | 03 §14; AC-CAP-09 | M1-02 |
| M1-13 | Progress overlay + countdown + badge + bildirim; delay/timer | 03 §13, §2 | M1-05 |
| M1-14 | Kısayollar (`commands`), context menu ağacı, popup mod butonları | 03 §2, 10 | M1-01 |
| M1-15 | `ExportPipeline`: PNG/JPEG encode (`encode.worker`), downloads (offscreen blob URL), filename template motoru (unit test), auto-download, clipboard strateji zinciri | 04; AC-EXP-* | M1-07 |
| M1-16 | PDF temel: tek uzun sayfa + A4/Letter/Legal sayfalı, fit width, JPEG gömme, 14.400 pt bölme | 04 §5 | M1-15 |
| M1-17 | Result sayfası: görüntüleyici (zoom, strip gezinme), export paneli, metadata paneli | 10 | M1-15 |
| M1-18 | History: kayıt yazma (SW), `history.html` grid + arama/filtre temel, sil, yeniden indir, URL aç | 07 | M0-06 |
| M1-19 | Options sayfası: General/Capture/Export/Filename/History/Privacy/About sekmeleri (Settings eşlemesi) | 10 | M0-07 |
| M1-20 | Onboarding (kısayol, gizlilik cümlesi) | 10 | M0-07 |
| M1-21 | Fixture siteleri (sticky, nested scroll, gmail-like, long 30k, zoom/DPR, grid pattern) + E2E dikiş doğrulama | 11 | M0-08 |

**Çıkış:** AC-CAP-01/02/04/05/08/09/10/11/13/14, AC-EXP temel, AC-HIS temel geçer; store varyantı yüklenip kullanılabilir (iç beta).

---

## M2 — V1 (P1) (≈ 22 IMG)
**Hedef:** iframe, infinite scroll, lazy-load, editör, smart PDF, metadata, CSS selector, auto-download/klasör, smart hide (temel).

| WP | İçerik | Spec / AC | Bağımlılık |
|---|---|---|---|
| M2-01 | Lazy-load pipeline (eagerize, pre-scroll, fonts/images/networkIdle/domQuiet bekleme) + `WaitConditions` motoru | 03 §8; AC-CAP-03 | M1-05 |
| M2-02 | Infinite scroll modu (büyütme fazı, stop/limits, duplicate detection) | 03 §11; AC-CAP-07 | M2-01 |
| M2-03 | iframe: allFrames enjeksiyon, `iframe-agent`, frame capture modu, cross-origin izin akışı (PermissionBroker) | 03 §9; AC-CAP-12 | M1-10 |
| M2-04 | CSS selector capture (popup/batch formu, test butonu, index) | 03 §7.4 | M1-11 |
| M2-05 | `PermissionBroker` + Options → İzinler sekmesi | 02 §7.2, 08 | — |
| M2-06 | Smart PDF: smart page breaks (TextRect + ink analizi), margin/scale/orientation/auto, header/footer token'ları, watermark, Info/XMP metadata | 04 §5 | M1-16 |
| M2-07 | Clickable links PDF (`agent.collectLinks` → link annots) | 04 §5.5 | M2-06 |
| M2-08 | Embedded metadata (PNG iTXt, JPEG XMP), URL/timestamp overlay seçeneği (görüntüye basılı bant) | 04 §7 | M1-15 |
| M2-09 | Özel download alt klasörü + template, conflictAction, saveAs | 04 | M1-15 |
| M2-10 | Editör çekirdeği (Fabric v6): document model, seçim/taşıma/boyut, undo/redo, zoom/pan, autosave | 05 | M1-17 |
| M2-11 | Editör araçları: arrow/rect/ellipse/line/pen/text/highlight/marker/emoji, stil paneli, katmanlar, kısayollar | 05 | M2-10 |
| M2-12 | Gizlilik araçları: blur/pixelate (canlı), **redaction commit** (yıkıcı), uyarı metinleri | 05 §5.2, 08 §8 | M2-10 |
| M2-13 | Crop/resize/rotate + editörden export + "yeni kayıt / üzerine yaz" | 05 | M2-10 |
| M2-14 | Smart element hide: `hide-rules.json` (CC-BY subset + kendi listeler), heuristics, kategori ayarları, custom selectors | 09 §3 | M1-05 |
| M2-15 | Side panel | 10 | M1-17 |
| M2-16 | History gelişmiş: tag/folder/star/not, bulk işlemler, kota yönetimi, yedek export/import, editörde yeniden aç | 07 §11–13 | M1-18 |
| M2-17 | `DebuggerBackend` (cdp varyantı): captureScreenshot dilimleme, printToPDF searchable, infobar UX | 03 §15 | M1-02 |
| M2-18 | Fixture'lar: lazy IO/data-src, infinite, iframes, cookie/chat widget, modal, fonts, transform-fixed; E2E | 11 | — |

**Çıkış:** AC-CAP-03/07/12, AC-EDT-*, AC-EXP PDF gelişmiş, AC-HIS gelişmiş geçer; Web Store ilk yayın adayı (store varyantı).

---

## M3 — V1.5 (≈ 14 IMG)
**Hedef:** All-tabs, URL batch, combined PDF, searchable PDF (OCR), ZIP, retry/timeout, custom wait conditions.

| WP | İçerik | Spec / AC | Bağımlılık |
|---|---|---|---|
| M3-01 | `BatchRunner` state machine (queue, window pool, concurrency, retry/backoff, timeout, pause/resume/cancel, SW restart recovery) | 06 | M2-01, M2-05 |
| M3-02 | All-tabs akışı (`tabs` izni, sekme listesi UI, orijinal sekmeye dönüş) | 03 §12, 06 | M3-01 |
| M3-03 | `batch.html` (URL import, options, run view, loglar, retry failed, outputs) | 10, 06 | M3-01 |
| M3-04 | Combined PDF (çoklu capture → tek PDF, bookmark), ZIP (fflate streaming), zip+pdf | 04, 06 | M2-06 |
| M3-05 | OCR altyapısı: Tesseract.js bundle (eng+tur), `ocr.worker`, searchable PDF görünmez metin katmanı | 09 §8, 04 §5.6 | M2-06 |
| M3-06 | Wait conditions UI (batch + capture ayarları), selector visible/hidden | 06, 13 | M2-01 |
| M3-07 | Batch raporu (JSON/CSV), hata logları, filename batch token'ları | 06 | M3-01 |
| M3-08 | Presets (yerleşik 7 preset + preset editörü + import/export), popup preset seçici | 09 §9 | M1-19 |

**Çıkış:** AC-BAT-*, AC-EXP ZIP/combined/searchable geçer. M3 OCR kapsamı yalnızca yerel eng/tur OCR worker'ı, kullanıcı tetikli capture indeksleme ve searchable PDF görünmez metin katmanıdır; history genelinde OCR arama/otomatik indeksleme M4 kapsamındadır.

---

## M4 — V2 (≈ 16 IMG)
**Hedef:** Gelişmiş annotation, persistent searchable history (OCR index), entegrasyonlar, API.

| WP | İçerik | Spec | Bağımlılık |
|---|---|---|---|
| M4-01 | OCR history index (`ocrDocs`, tokenization, arama UI, arka plan indeksleme opt-in) | 09 §8, 07 §9 | M3-05 |
| M4-02 | Editör gelişmiş: sticker seti, image import, arrow stilleri, text background, eyedropper, klavye-only erişilebilirlik tamamlama | 05 | M2-11 |
| M4-03 | `IntegrationHub` + OAuth (identity) + token proxy spec; Linear, GitHub, Trello (PKCE/token in-extension) | 09 §10 | M2-05 |
| M4-04 | Jira, Slack, Notion (API token fallback + opsiyonel proxy), Webhook (HMAC), Google Drive/Dropbox/OneDrive | 09 §10 | M4-03 |
| M4-05 | Result/editor'dan "Send to…" UI, alan formları, gönderim sonucu linki | 10 | M4-03 |
| M4-06 | Public API: onMessageExternal (build-time origin), native messaging host spec + örnek CLI (P2) | 09 §11 | — |
| M4-07 | Evidence mode: manifest, hash, iTXt, sidecar JSON, rapor PDF, "Verify hash", TSA opt-in | 09 §4 | M2-08 |
| M4-08 | Bug report mode: ConsoleTap (main world), webRequest hataları (opsiyonel izin), ortam, markdown/JSON/ZIP; CDP deep mode (cdp varyantı) | 09 §5 | M2-05 |

---

## M5 — Differentiators (≈ 14 IMG)
**Hedef:** Recapture, compare, pixel diff, diff timeline, monitoring, QA workflows.

| WP | İçerik | Spec | Bağımlılık |
|---|---|---|---|
| M5-01 | Recapture (history → aynı URL/viewport/mod/selector/delay/preset; pencere boyutu zorlama) | 07 §11.5 | M3-01 |
| M5-02 | `diff.worker` (pixelmatch, hizalama/padding, ignore regions, kümeleme, mask/side-by-side) | 09 §2 | M0-04 |
| M5-03 | `compare.html` (side-by-side, slider, onion-skin, diff overlay, bölge listesi, senkron scroll/zoom) | 10, 09 §1 | M5-02 |
| M5-04 | Diff timeline (URL bazlı history, ardışık changedPct) | 09 §7 | M5-02 |
| M5-05 | Change monitoring (`MonitorRule`, alarms ≥ 30 dk, özel pencere, eşik bildirimi, host izni) | 09 §12 | M5-01, M5-02 |
| M5-06 | QA workflow: batch + diff + preset birleşimi, JSON rapor | 09 §13 | M5-02, M3-01 |
| M5-07 | Pro/lisans kancaları (teklif), store listing güncellemesi | 14 | — |

---

## Sürüm Eşlemesi
| Sürüm | Milestone | Kanal |
|---|---|---|
| 0.1.x | M0 + M1 | iç beta (unpacked) |
| 0.5.x | M2 | Web Store (unlisted) → public |
| 0.8.x | M3 | public |
| 1.0 | M4 | public (+ cdp varyantı self-hosted) |
| 1.x | M5 | public |

---

## Riskler ve Azaltma
| Risk | Etki | Azaltma |
|---|---|---|
| `captureVisibleTab` 2/s limiti → uzun sayfalarda yavaşlık | UX | Progress/ETA, tile yüksekliğini maksimize (scrollbar gizli tam viewport), cdp varyantı |
| Çok yüksek DPR + uzun sayfa bellek | Çökme | Strip streaming, bellek bütçesi, JPEG PDF gömme |
| Sticky tespitinin CSS çeşitliliğinde kaçırması | Tekrar eden header | Motion-based detection (P1.5), kullanıcı "hide all" seçeneği, smart-hide custom selector |
| Web Store inceleme (optional host permissions) | Yayın gecikmesi | Net gerekçe metinleri (14), varsayılan activeTab, debugger store'da yok |
| OCR bundle boyutu (~15 MB) | Paket boyutu | OCR'ı ayrı lazy chunk; yalnız eng+tur fast data; P2'de opsiyonel dil paketi |
| Entegrasyonlarda client secret gereksinimi | Backend ihtiyacı | API token fallback; proxy opsiyonel ve minimal |
| SW restart ortasında job | Yarım sonuç | storage.session state, temiz fail + retry, kısmi stitch |
