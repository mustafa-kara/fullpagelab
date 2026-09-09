# 10 — UI / UX

> Uzantının tüm kullanıcı arayüzleri: popup, side panel, result/editor sayfası, history, compare, batch, options, onboarding, sayfa-içi overlay'ler, bildirimler, i18n, erişilebilirlik, tema ve bileşen kiti. Ayar alanları `13-data-contracts.md §6`, sayfa listesi `02-architecture.md §2.4`, editör `05-editor.md`. Gereksinim ID önek: `REQ-UI-*`.

> **Uygulama durumu (2026-09-09):** Kullanıcıya sunulan yakalama düğmeleri yalnız **Full page** ve **Visible area**dır. Selection, Element, Scrolling area ve All tabs düğmeleri çalışır hâle gelene kadar gizlidir. Tam sayfa için varsayılan klavye kısayolu yoktur; görünen alan `Alt+Shift+V`, sağ tık menüsü ise yalnız sayfa bağlamındaki **Tam sayfayı yakala** eylemini sunar. Result önizleme/format/indirme/kopyalama akışı aktiftir. **Editör uygulandı** (§4.1); gelişmiş History, side panel, compare, batch ve Options yüzeyleri hâlâ hedef tasarımdır.

İçindekiler: 1 İlkeler · 2 Popup · 3 Side panel · 4 Result sayfası · 5 History · 6 Compare · 7 Batch · 8 Options · 9 Onboarding · 10 Context menu · 11 Sayfa-içi overlay'ler · 12 Bildirimler & toast · 13 Boş/hata durumları · 14 i18n · 15 Erişilebilirlik · 16 Tema & tasarım token'ları · 17 Bileşen kiti · 18 Responsive & performans · 19 Metin/ton kılavuzu · 20 Kabul kriterleri

---

## 1. İlkeler
1. **Tek tık hedefi:** En sık işlem olan full-page capture popup'ta ilk odaklı butondur; ayrıca sağ tık menüsünden başlatılabilir.
2. **Sayfadan ayrılmadan:** Progress ve hatalar sayfa-içi overlay + action badge'de; popup kapansa da iş sürer.
3. **Sessiz ama şeffaf:** Gizlilik cümlesi görünür yerlerde; izin istekleri bağlamında ve gerekçeli.
4. **Tutarlı dil:** Aynı kavram her yerde aynı kelime (Full page / Visible area / Selection / Element / Scrolling area / All tabs).
5. **Preact + CSS modules**, token tabanlı tema; Tailwind yok; framework-dışı sayfa-içi overlay'ler (Shadow DOM, vanilla).

---

## 2. Popup (`popup.html`) (`REQ-UI-010`…`019`)

Boyut: yaklaşık 320 px genişlik, içerik yüksekliğine göre kompakt. İlk boya < 150 ms: yalnızca ayarlar ve `capture.listActive` okunur; ağır result/export bağımlılıkları popup'a import edilmez.

```
┌──────────────────────────────────────┐
│ FullPageLab                  Capture │
├──────────────────────────────────────┤
│ Durum / hata / aktif iş bilgisi      │
│ ┌──────────────┐ ┌────────────────┐  │
│ │ Full page    │ │ Visible area   │  │
│ └──────────────┘ └────────────────┘  │
│                                      │
│ Ekran görüntüleri siz yüklemeyi      │
│ seçmedikçe tarayıcınızdan çıkmaz.    │
└──────────────────────────────────────┘
```
- **Aktif mod butonları:** Full page ve Visible area. Her tıklama eksiksiz bir `CaptureRequest` üretir; başarılı başlangıçtan sonra popup kapanır ve yakalama service worker'da sürer.
- **Gelecek modlar:** Selection, Element, Scrolling area ve All tabs arayüzde görünmez; pasif/bozuk düğme olarak tutulmaz.
- **Dışa aktarım:** Format ve dosya adı seçimleri yakalama sonrasında result sayfasında yapılır; popup otomatik indirme başlatmaz.
- **Durumlar:**
  - *Restricted sayfa* (`isRestricted`): mod butonlarından yalnızca Visible etkin; üstte bilgi şeridi *"Bu sayfa korumalı; yalnızca görünen alan alınabilir."*
  - *Capturing* (aktif job varsa): üst kart `ProgressBar` + "Capturing 12/40 · 35%" + `Cancel`; mod butonları disabled.
  - *Error*: kırmızı kart (`ErrorInfo.userMessageKey`) + `Retry` + "Copy details".
- Alt bölümde yerel gizlilik cümlesi kalıcıdır.

---

## 3. Side Panel (`sidepanel.html`) (`REQ-UI-020`…`024`)
- Min 320 px genişlik; popup içeriğinin dikey, kalıcı versiyonu + **Preview** bölümü: son capture'ın tam önizlemesi (zoom-to-fit, scroll), hızlı aksiyonlar (Copy / Download / Edit / Delete), strip'ler için sayfalama.
- `general.afterCapture:'openSidePanel'` ise capture bitince `chrome.sidePanel.open({tabId})` (kullanıcı jesti gerektirdiği için job kullanıcı jestiyle başlatılmışsa; değilse badge + bildirim).
- Progress bölümü aktif job'ları listeler (`job-events` Port).
- Panel sekme bağımsızdır (`setOptions` global); "Pin to this tab" P2.

---

## 4. Result Sayfası (`result.html?id=<captureId>`) (`REQ-UI-030`…`045`)

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ ← History   example.com — Page title                    [Edit] [Export ▾] ⋯   │ ← üst bar
│ 2880×18.400 · Full page · 2026-08-19 13:04 · 3.2 MB · PNG        ⟳ Recapture  │ ← meta şeridi
├───────────────────────────────────────┬───────────────────────────────────────┤
│                                       │ EXPORT                                │
│                                       │ Format  ● PNG ○ JPEG ○ WebP ○ PDF     │
│         [ viewer / editor canvas ]    │ Quality ────●──── 92                  │
│                                       │ Scale   ● Device (2×) ○ CSS (1×)       │
│   zoom: fit | 100% | +  −             │ Filename {domain}_{yyyy-mm-dd}_{time}  │
│                                       │ ▸ PDF options (size, breaks, links…)   │
│   ‹ strip 1/3 ›  (strip'li sonuç)     │ [⬇ Download] [⧉ Copy] [🖨 Print]       │
│                                       ├───────────────────────────────────────┤
│                                       │ SEND TO   [Jira] [Linear] [Slack] [+]  │
│                                       ├───────────────────────────────────────┤
│                                       │ MORE                                   │
│                                       │ ◫ Compare with previous (3 found)      │
│                                       │ 🐞 Bug report  ⚖ Evidence bundle       │
│                                       │ 🔍 OCR index   🏷 Tags: [qa] [+]        │
│                                       ├───────────────────────────────────────┤
│                                       │ DETAILS  url, viewport, DPR, zoom,     │
│                                       │ backend, duration, warnings (2) ▾      │
└───────────────────────────────────────┴───────────────────────────────────────┘
```
- **Viewer modu:** görüntü fit-to-width; tıkla → %100 (GoFullPage alışkanlığı), tekerlek + Ctrl zoom; strip'li sonuçlarda strip navigasyonu + "Show as one" (sanal birleştirme).
- **Edit** → aynı sayfada editör açılır (05); `Done` ile viewer'a döner. URL `#edit`.
- **Export paneli:** `ExportPlan` alanları; PDF seçenekleri accordion (mode, page size, orientation, fit, margins, smart breaks, clickable links, searchable text [none/OCR], header/footer, watermark). Her kontrol `Settings.export` varsayılanını gösterir; "Save as default" linki.
- **Send to:** bağlı entegrasyonlar buton; bağlı değilse "+" → Options/Integrations. Gönderim diyaloğu provider alanlarını (proje, kanal, vs.) içerir; sonuçta dış link toast'ı.
- **Compare with previous:** aynı URL için önceki kayıt sayısı; tıklayınca `compare.html?base=<prev>&head=<id>`.
- **Bug report / Evidence:** modallar (opsiyonlar → `bugreport.build` / `evidence.build`) → indirme + history dosyası.
- **Warnings:** `CaptureRecord.warnings` sarı rozet; tıklayınca liste ve "Recapture with: hide fixed elements: never" gibi öneri aksiyonları.
- `⋯` menü: Open original URL, Copy URL, Rename, Move to folder, Delete, Open in new window, Report issue (local log copy).
- `general.resultTabBehavior:'reuseTab'` → mevcut result sekmesi güncellenir.

---

### 4.1 Editör paneli (uygulandı, 2026-09-09)

**Düzenle** düğmesi viewer'ı editör paneliyle değiştirir; panel aynı ızgara hücresini kullanır, export paneli yerinde kalır. Ayrıntılı davranış `05-editor.md`.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ↖ ↗ ▭ ◯ ╱ ✎ T ▤ ◌ ▓ ■ │ ●●●●●● ▬▬▬▬ │ ↶ ↷ │ − 68% + ⛶ 1:1     [Vazgeç][Kaydet] │ ← tek satır
├──────────────────────────────────────────────────────────────────────────────┤
│ Bulanıklaştırma geri alınabilir. Hassas veriler için Karart aracını kullanın. │ ← yalnız uyaran araçlarda
├──────────────────────────────────────────────────────────────────────────────┤
│                        [ editör tuvali, kaydırılabilir ]                      │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Tek satır zorunluluğu.** Araç adları yazıyla verildiğinde çubuk üç satıra çıkıp yakalamayı sayfanın altına itiyordu; araçlar `title` + `aria-label` taşıyan ikonlara çevrildi (123 px → 47 px). Erişilebilir ad çeviriden gelmeye devam eder.
- **Daraltma sırası.** Pencere daraldıkça sırasıyla ayraçlar, sabit zoom düğmeleri ve swatch boyutları küçülür (`1400px`, `1200px`, `1050px`). Editör açıkken `result-layout` 1250 px altında tek sütuna düşer; viewer'ın kendi 900 px kırılma noktası çubuğu 632 px'lik bir sütuna sıkıştırıp üç satıra döndürüyordu.
- **Gizlilik notu** kalıcı bir satır değildir: yalnız blur/pixelate/redact seçiliyken ve vurgulu (sarı) biçimde görünür. Diğer araçlarda "orijinal korunuyor" bilgisi sessiz stildedir.
- **Stil kontrolleri** (renk + kalınlık) blur/pixelate/redact seçiliyken devre dışıdır; bu araçların görünümü gizlilik garantisinin kendisidir (`REQ-EDT-050`).

## 5. History (`history.html`) (`REQ-UI-050`…`064`)

```
┌──────────┬────────────────────────────────────────────────────────────────────┐
│ FILTERS  │ 🔍 Search title, URL, text…            [Grid ▦ | List ☰]  Sort ▾   │
│ Date     ├────────────────────────────────────────────────────────────────────┤
│ ○ Today  │ ☐ Select all · 248 items                                            │
│ ○ 7 days │ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐              │
│ ○ 30 d   │ │thumb │ │thumb │ │thumb │ │thumb │ │thumb │ │thumb │              │
│ ○ Custom │ │ex.com│ │docs… │ │app.io│ │…     │ │…     │ │…     │              │
│ Domain   │ │Full·2m│ │Elem… │ │PDF   │ │      │ │      │ │      │              │
│ ☐ ex.com │ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘              │
│ ☐ app.io │  … (VirtualGrid)                                                    │
│ Mode     ├────────────────────────────────────────────────────────────────────┤
│ Format   │ [3 selected]  ⬇ Download  ⧉ ZIP  🗑 Delete  🏷 Tag  📁 Move  ◫ Compare│ ← bulk bar
│ Tags     ├────────────────────────────────────────────────────────────────────┤
│ Folders  │ Storage: ███████░░░ 1.2 GB / 2 GB   [Manage]                         │
│ ★ Starred│                                                                    │
└──────────┴────────────────────────────────────────────────────────────────────┘
```
- Sorgu `HistoryQuery` → `history.list` (keyset pagination, `VirtualGrid`/`VirtualList`); arama 250 ms debounce; OCR indeksli kayıtlarda snippet gösterimi.
- Kart: thumbnail (320 px WebP), domain+favicon, mode rozeti, format rozeti, relative time, boyut; hover aksiyonlar (Open, Copy, Download, ⋯). Liste görünümünde sütunlar: thumb, title, domain, mode, size, date, tags.
- **Detail drawer** (sağdan, kart tıklayınca tek tık önizleme; çift tık result sayfası): büyük önizleme, metadata tablosu (`CaptureRecord`), tags/notes/folder düzenleme, aksiyonlar: Open, Edit, Download, Copy, **Recapture** (`history.recapture`; overrides diyaloğu: "same settings" / "adjust…"), **Compare** (aynı URL'li diğer kayıtları listeler), Open original URL, Evidence/Bug report varsa indir, Delete.
- **Bulk bar:** seçim ≥1'de görünür: Download (ayrı dosyalar), ZIP, Delete (onay modalı: "N capture silinecek, geri alınamaz"), Tag, Move to folder, Compare (tam 2 seçiliyse), Export PDF (combined).
- **Storage meter:** `history.stats`; %85 sarı, %95 kırmızı; Manage → Options/History.
- Klavye: ok tuşları grid gezinme, `Space` seç, `Enter` aç, `Delete` sil, `/` arama odak.
- Boş durum: illüstrasyon + "Take your first screenshot" + kısayol.

---

## 6. Compare (`compare.html?base=&head=`) (`REQ-UI-070`…`078`)
- Üst bar: iki kaydın seçicileri (aynı URL'li kayıtlar dropdown; "Pick from history…"), `Swap`, `Run diff` (otomatik çalışır), ayarlar (threshold, include AA, ignore regions çiz, alignment).
- Görünüm modları (segmented): **Side by side** (senkron scroll/zoom), **Slider** (dikey bölme sürgüsü), **Onion skin** (opaklık slider), **Diff overlay** (maskRef kırmızı; changed/added/removed renkleri), **Regions** listesi (sağ panel: `DiffResult.regions` bbox, tıklayınca oraya scroll; "Ignore this region" ekler).
- Özet şeridi: "12.4% changed · 37 regions · 1.8 s".
- **Timeline** (alt): `diff.history{url}` — thumbnail şeridi, her geçişte `changedPctFromPrev` rozeti; iki thumb seç → yükle.
- Aksiyonlar: Export diff (PNG overlay / side-by-side kompozit / JSON), Save as history file (`role:'diff'`), Create monitor rule (09).
- Farklı yüksekliklerde pad edilen alan taralı gösterilir.

---

## 7. Batch (`batch.html`) (`REQ-UI-080`…`092`)
- **Yeni batch formu:** kaynak sekmesi: *URLs* (textarea, satır başına URL; yapıştır/CSV-TXT dosya import; geçersizler satır içi kırmızı; duplicate uyarısı; max 500, aşınca uyarı), *Open tabs* (pencere/tüm pencereler, checkbox listesi `tabs.listForCapture`), *Sitemap* (P2). Mod (`fullPage/visible/selector/element`), selector alanı + "Test on current tab", capture seçenekleri (delay, hide fixed, smart hide, lazy), bekleme (`pageLoad`, networkIdle, selectorVisible, fixed delay), çıktı (format, combine: none/single PDF/ZIP/zip+pdf, filename template önizlemeli), kontrol (concurrency 1–3, timeout, retry, delay between, close tabs after, window size, stop on error), preset seçimi. İzin kartı: URL batch için `<all_urls>` host izni gerekçesi + buton.
- **Çalıştırma görünümü:** başlık: durum rozeti, ilerleme "37/120 · 2 failed · ETA 4 m", butonlar Pause/Resume/Cancel. Tablo: #, URL, status (ikon+renk), süre, deneme, sonuç (thumbnail/hata kodu), aksiyonlar (Open, Retry, Skip). Alt: log paneli (`BatchLogLine`, seviye filtresi, kopyala). Bittiğinde **Outputs** kartı: ZIP/PDF/dosya listesi + Download; "Retry failed (N)".
- Geçmiş batch'ler listesi sol tarafta (`batch.list`); tekrar çalıştır ("Run again").
- Kullanıcı batch sırasında tarayıcıyı kullanırsa pencere/sekme odak kaybı uyarısı (batch ayrı pencerede çalışır; 06).

---

## 8. Options (`options.html`) (`REQ-UI-100`…`125`)
Sol dikey sekmeler; her sekme `Settings` alt ağacına eşlenir; değişiklikler anında kaydedilir (`settings.set`, debounce 300 ms), "Saved" toast; "Reset section" ve "Reset all".

```
┌────────────┬──────────────────────────────────────────────────────────────┐
│ General    │ General                                                        │
│ Capture    │ Language        [Auto ▾]                                       │
│ Export/PDF │ Theme           ○ System ● Light ○ Dark                        │
│ Filename   │ After capture   [Open result tab ▾]                            │
│ Editor     │ Notifications   [x] show   [ ] sound                           │
│ History    │ Result tab      ● New tab ○ Reuse tab                          │
│ Presets    │ Shortcuts       Visible area Alt+Shift+V [Change in Chrome ↗]   │
│ Integr.    │                                                                │
│ Permissions│                                                                │
│ Privacy    │                                                                │
│ Advanced   │                                                                │
│ About      │                                                                │
└────────────┴──────────────────────────────────────────────────────────────┘
```
| Sekme | Alan → `Settings` yolu | Kontrol | Varsayılan |
|---|---|---|---|
| General | `general.language` | Select auto/en/tr | auto |
| | `general.theme` | Segmented | system |
| | `general.afterCapture` | Select | openResultTab |
| | `general.showNotifications` / `playSound` | Toggle | true / false |
| | `general.resultTabBehavior` | Radio | newTab |
| | `shortcuts` (salt okunur) | Liste + link `chrome://extensions/shortcuts` | — |
| Capture | `capture.backend` | Select auto/visibleTab(/debugger yalnız cdp) | auto |
| | `capture.delayMs` / `countdownOverlay` | Number (s) / Toggle | 0 / true |
| | `capture.hideFixedElements` | Radio auto/always/never | auto |
| | `capture.hideScrollbars` / `freezeAnimations` / `pauseMedia` | Toggle | true/true/true |
| | `capture.smartHide.*` | Toggle + kategori checkbox'ları + custom selector textarea + mode | enabled false; tüm kategoriler; hide |
| | `capture.lazyLoad.*` | Toggle grubu + sayı alanları | enabled true, preScroll true, step=viewport, dwell 100, forceEager true, waitImagesDecode true, waitFonts true, maxWait 1500 |
| | `capture.wait.*` | Accordion: fixed delay, network idle (idle 500/max 5000), DOM quiet (300/3000), selector visible/hidden, fonts, images | kapalı (sadece lazyLoad kendi beklemeleri) |
| | `capture.infinite.*` | maxSteps 100, maxHeight 100000, maxDuration 120000, dwell 800, stopWhenNoGrowth 3, duplicateDetection true, manualStop true | |
| | `capture.iframes` | Radio pixelsOnly/injectSameOrigin/injectAll | injectSameOrigin |
| | `capture.dprMode` | Radio device/css/custom(number) | device |
| | `capture.zoomHandling` | Radio | normalizeTo100 |
| | `capture.limits.*` | Advanced accordion: maxCaptureHeightCss 50000, maxTiles 200, maxDurationMs 180000, stepSettleMs 150, maxOutputPixels, maxStripHeightPx, memoryBudgetMb 600 | |
| | `capture.background` / `includeMetadata` | Radio / Toggle | page / false |
| Export/PDF | `export.targets` | Checkbox grubu | history, openResult |
| | `export.format` | Segmented | png |
| | `export.image.*` | jpegQuality slider 0.92, webpQuality 0.9, pngCompression select, maxWidth/Height, scale, stripAlpha | |
| | `export.pdf.*` | Tüm `PdfOptions` alanları (mode, pageSize, orientation, fit, margins, scale, smartPageBreaks true, breakSearchWindowPct 20, imageFormat jpeg, imageQuality 0.85, clickableLinks true, searchableText none, ocrLang, headerFooter builder (sol/orta/sağ token chip'leri), watermark, metadata, outline, maxSinglePageHeightPt 14400) | |
| | `export.multiImage` | Radio zip/separate/pdfPages | zip |
| | `export.watermark` | Toggle + alanlar | kapalı |
| | `export.metadata` | Toggle + alan checkbox'ları | kapalı |
| | `export.download.*` | auto false, saveAs false, subfolder text (template), conflictAction select uniquify | |
| Filename | `export.filename` | Template input + token chip'leri (tıkla-ekle) + canlı önizleme (örnek değerlerle) + doğrulama hatası | `{domain}_{yyyy-mm-dd}_{time}` |
| Editor | `editor.toolDefaults`, `editor.recentColors`, shortcuts (P2), fontlar | Panel | — |
| History | `history.enabled` / `maxItems` 1000 / `maxBytes` 2 GB / `autoCleanup` / `keepOriginalsAfterEdit` true / `thumbnailWidth` 320 / `ocrAutoIndex` false | Toggle/number/select | |
| | Veri yönetimi | "Clear history" (onay), "Export all (ZIP)", storage meter, "Request persistent storage" durumu | |
| Presets | CRUD liste; yerleşikler düzenlenemez ama "Duplicate"; preset editörü = Capture+Export formlarının alt kümesi + extras | | |
| Integrations | Her `IntegrationProvider` için kart: Connect/Disconnect, hesap adı, varsayılan alanlar (proje/kanal/repo…), test gönderimi; webhook: URL, secret, header'lar | | |
| Permissions | Tüm `FeatureKey` için satır: açıklama (rationaleKey), durum, Grant/Revoke | | |
| Privacy | `privacy.telemetry` false, `crashReports` false, `embedMetadataDefault`, `clearOnUninstallNotice`; gizlilik metni; "Delete all data" (history+settings+tokens) | | |
| Advanced | `advanced.debugLogging`, `experimental.*`, canvas limits (probe sonucu + "Re-probe"), "Export diagnostics", "Reset all settings" | | |
| About | sürüm, build varyantı, lisanslar, changelog, destek linki, kısayol yardımı | | |

---

## 9. Onboarding (`onboarding.html`) (`REQ-UI-130`…`133`)
Kurulumda (`runtime.onInstalled reason:'install'`) açılır; 3 adım, atlanabilir:
1. **Hoş geldin:** ürün özeti ve Chrome araç çubuğunda uzantıyı sabitleme ipucu. Tam sayfa için var olmayan bir kısayol kartı gösterilmez.
2. **Gizlilik:** büyük metin: *Screenshots never leave your browser unless you choose to upload them.* + izin açıklaması (activeTab nedir) + `navigator.storage.persist()` isteği butonu.
3. **Dene:** CTA, `onboarding.openDemo` ile normal HTTP(S) örnek sayfasını yeni sekmede açar. Kullanıcı popup'taki Full page düğmesiyle veya sayfada sağ tıklayıp **Tam sayfayı yakala** eylemiyle ilk sonucu oluşturur. `general.onboardingDone=true` kaydedilir.

Uygulanan tasarım, kurulum sekmesini tam sayfa ve responsive bir tanıtım akışına dönüştürür. Sol rayda marka mesajı ve 3 adımlı ilerleme, sağ içerik alanında karşılama önizlemesi, gizlilik kartları ve ilk yakalama aksiyonu bulunur. Her adımda tek bir birincil CTA vardır; "Turu atla" da `general.onboardingDone=true` yazar ve tamamlanma ekranını gösterir.

- Karşılama adımı: tam sayfa/akıllı/yerel özellik kartları ve Chrome yapboz menüsünden sabitleme ipucu; klavye kısayolu kartı yoktur.
- Gizlilik adımı: `privacy_tagline` metni, yerel işleme ve kullanıcı tetiklemeli izin açıklaması, `navigator.storage.persist()` butonu ve varsayılanı kapalı `privacy.telemetry` anahtarı.
- Dene adımı: `settings.set` ile tamamlanmayı kaydeder, ardından `onboarding.openDemo` ile yakalanabilir örnek sayfayı açar; Chrome tarafından korunan onboarding uzantı sayfasında capture başlatmaz.
- Responsive ve erişilebilirlik: 920 px altında ray yatay adıma döner, 620 px altında içerik tek kolona iner; klavye focus ring'leri, `aria-live`, anlamlı etiketler, minimum 44 px hedefler ve `prefers-reduced-motion` desteği vardır.
- Metinler `public/_locales/en/messages.json` ve `public/_locales/tr/messages.json` içindeki `onboarding_*` anahtarlarından gelir; onboarding sayfası ayar diline göre `lang` niteliğini günceller.

---

## 10. Context Menu (`REQ-UI-140`)
```
 [ikon] FullPageLab
  └─ Tam sayfayı yakala           (page)
```
Menü yalnız `contexts:['page']` için oluşturulur. Diğer capture modları uygulanmadan menüye eklenmez. Restricted sayfalarda tıklama anlaşılır bir hata üretir; visible fallback'i popup üzerinden sunulur.

---

## 11. Sayfa-İçi Overlay'ler (Content Script, Shadow DOM) (`REQ-UI-150`…`158`)
- Tüm overlay'ler `<ssx-root>` host elementinde **closed Shadow DOM**; `all: initial` reset; z-index `2147483647`; sayfa fontlarından bağımsız (`system-ui`); `prefers-color-scheme` izlenir.
- **Progress overlay:** sağ üst 280×72 kart: ikon, faz metni ("Capturing… 12/40"), ince progress bar, ETA, `Cancel` (ve infinite'te `Stop`). Capture anında gizlenir; capture çağrısından önce görünürlük değişikliğinin iki temiz compositor frame ile ekrana işlendiği doğrulanır (03 §13). `role="status"`, `aria-live="polite"`.
- **Countdown overlay:** ekran ortasında 120 px daire, kalan saniye, "Press Esc to cancel"; 1 s'de bir azalır; son 1 s'de solar; capture öncesi tamamen kaldırılır.
- **Selection overlay:** tam ekran yarı saydam karartma (`rgba(0,0,0,.35)`), seçim alanı şeffaf + 1 px beyaz/2 px mavi çerçeve, köşe handle'ları (P1.5: seçim sonrası ayarlama), boyut rozeti (`1200×640`), büyüteç yok; alt merkezde ipucu "Drag to select · Enter capture · Esc cancel".
- **Element picker:** hover'da 2 px mavi outline + `rgba(0,122,255,.08)` dolgu, rozet `div#main.content · 1200×3400` (+ "scrollable ↕" etiketi), ipucu şeridi "Click to capture · ↑/↓ parent/child · Esc cancel". Scroll container modunda yalnızca scrollable'lar vurgulanır, diğerleri gri.
- **Infinite scroll bandı:** progress kartında "Loading more… step 12 · 34.000 px" + Stop.
- Tüm overlay'ler `pointer-events` kurallarıyla sayfa etkileşimini bloklar (selection/picker) ya da bloklamaz (progress).

---

## 12. Bildirimler & Toast (`REQ-UI-160`…`163`)
- `chrome.notifications` (ayar açıksa): capture done (thumbnail `image` tipi, butonlar: Open / Copy), error, batch finished, monitor change detected.
- Uzantı sayfalarında `Toast` (alt orta, 4 s, en fazla 3, `aria-live`): "Copied", "Saved", "Downloaded ➜ filename", hatalar (kalıcı, kapatılabilir, "Details").
- Action badge: capture sırasında `%`, hata `!` kırmızı, batch çalışırken `▶`.

---

## 13. Boş / Hata Durumları (`REQ-UI-170`)
| Durum | Görünüm |
|---|---|
| History boş | İllüstrasyon + CTA + kısayol |
| Arama sonucu yok | "No results for 'x'" + filtreleri temizle |
| Storage dolu | Kırmızı banner + "Free up space" (en eskileri sil önerisi) |
| İzin reddedildi | Sarı kart + gerekçe + "Grant" |
| Restricted sayfa | Bilgi şeridi + Visible önerisi |
| Capture hatası | `ErrorInfo` → başlık (ne oldu) + açıklama (ne yapabilirsin) + Retry + Copy details |
| Entegrasyon bağlantısı koptu (401) | Kart: "Reconnect" |
| Offline (entegrasyon) | Gönderim butonu disabled + tooltip |

---

## 14. i18n (`REQ-UI-180`…`185`)
- `public/_locales/{en,tr}/messages.json`; `default_locale:'en'`. Anahtar adlandırma: `ui.<page>.<id>` (ör. `ui.popup.fullPage`, `ui.result.export.download`), ortak: `common.*`, hatalar: `error.<E_CODE>.title` / `.body`, izin gerekçeleri: `perm.<FeatureKey>`, CS overlay: `overlay.*`, manifest: `appName`, `appDesc`, `cmd*`.
- Yardımcı `t(key, subs?)` → `chrome.i18n.getMessage`; CS içinde de çalışır. Çoğul: `ui.history.count.one` / `.other` (Intl.PluralRules ile seçim); sayı/tarih `Intl.*` ile locale'e göre.
- Metinler UI'da **asla** hardcode edilmez (lint kuralı: JSX'te çıplak string yasak).
- RTL gerekmez (en/tr); yine de `dir` attribute'u korunur.

---

## 15. Erişilebilirlik (WCAG 2.1 AA) (`REQ-UI-190`…`197`)
- Tüm etkileşimli öğeler klavyeyle erişilebilir; görünür focus halkası (`--focus-ring`); mantıksal DOM sırası; `Tab` tuzağı yalnızca modallarda (focus trap + `Esc`).
- ARIA: butonlar `aria-label` (ikon-only), segmented `role="radiogroup"`, tabs `role="tablist"`, toast `aria-live`, progress `role="progressbar"` + `aria-valuenow`.
- Kontrast ≥ 4.5:1 metin, ≥ 3:1 UI bileşenleri (token'lar buna göre seçildi); renk tek başına anlam taşımaz (ikon/metin eşlik eder).
- Hareket: `prefers-reduced-motion` → animasyonlar kapalı. Yazı boyutu `rem`, %200 zoom'da kırılmaz.
- Thumbnail'lara anlamlı `alt` (title + domain + tarih).
- Otomatik test: `axe-core` Playwright entegrasyonu her sayfada sıfır "serious/critical".

---

## 16. Tema & Tasarım Token'ları (`REQ-UI-200`…`204`)
`src/ui/tokens.css`:
```css
:root {
  --font-sans: Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-mono: "Roboto Mono", ui-monospace, Menlo, monospace;
  --fs-xs: 11px; --fs-sm: 12px; --fs-md: 13px; --fs-lg: 15px; --fs-xl: 18px; --fs-2xl: 24px;
  --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px; --sp-5: 24px; --sp-6: 32px;
  --radius-sm: 6px; --radius-md: 10px; --radius-lg: 14px;
  --shadow-1: 0 1px 2px rgb(0 0 0 / .08); --shadow-2: 0 4px 16px rgb(0 0 0 / .12);
  --bg: #ffffff; --bg-2: #f5f6f8; --bg-3: #eceef2; --fg: #15171a; --fg-2: #4b5059; --fg-3: #7a808b;
  --border: #e1e4ea; --primary: #2f6fed; --primary-fg: #fff; --danger: #d93025; --warn: #c77700; --success: #1e8e3e;
  --focus-ring: 0 0 0 3px rgb(47 111 237 / .35);
}
:root[data-theme="dark"], :root:not([data-theme="light"]) { /* @media (prefers-color-scheme: dark) ile */
  --bg: #17191d; --bg-2: #1f2227; --bg-3: #292d34; --fg: #eef0f3; --fg-2: #b5bac4; --fg-3: #858c98;
  --border: #30353d; --primary: #5b8cff; --shadow-1: 0 1px 2px rgb(0 0 0 / .4); --shadow-2: 0 4px 16px rgb(0 0 0 / .5);
}
```
- `general.theme` → `document.documentElement.dataset.theme` (`system` ise attribute kaldırılır, media query çalışır).
- İkonlar: tek sprite (`src/ui/icons.tsx`, 20 px grid, `currentColor`).
- Inter woff2 bundled (latin + latin-ext; Türkçe karakterler dahil).

---

## 17. Bileşen Kiti (`src/ui/`) (`REQ-UI-210`)
`Button` (variant primary/secondary/ghost/danger; size sm/md; loading; icon), `IconButton` (tooltip zorunlu), `Select` (native `<select>` stillendirilmiş), `Toggle` (switch, `role="switch"`), `Slider` (+ sayı alanı), `Segmented`, `Tabs`, `Dialog` (modal, focus trap, `Esc`), `Toast`/`ToastHost`, `Tooltip` (hover+focus, 400 ms), `Menu` (dropdown, ok tuşları), `ProgressBar` (determinate/indeterminate), `Badge`, `Card`, `VirtualGrid`/`VirtualList` (windowing), Form primitives: `Field` (label+help+error), `TextInput`, `NumberInput`, `Textarea`, `Checkbox`, `RadioGroup`, `ColorSwatch`, `TokenChips` (filename/header-footer), `KeyCap` (kısayol gösterimi), `EmptyState`, `ErrorCard`, `PermissionCard`, `StorageMeter`, `Thumbnail`.
Her bileşen: props tipli, CSS module, dark/light, klavye, Storybook yerine `pages/_kitchen-sink.html` (dev only).

---

## 18. Responsive & Performans (`REQ-UI-220`…`224`)
- Popup: 360 px sabit genişlik; yükseklik içerik; 600 px'i aşınca iç scroll (recent listesi kısalır).
- Side panel: min 320 px; ≥ 480 px'te iki sütun (aksiyonlar yanda).
- Result/History/Options: akışkan; < 900 px'te sağ paneller alta iner (accordion).
- Popup/side panel bundle < 60 KB gz; ağır modüller dinamik import; görüntüler `loading="lazy"`, thumbnail'lar WebP.
- History 5.000 kayıt: ilk boya < 300 ms (virtualization), arama < 150 ms.

---

## 19. Metin / Ton Kılavuzu (`REQ-UI-230`)
- Kısa, eylem odaklı, ikinci tekil (EN: "Capture full page"; TR: "Tam sayfayı yakala"). Başlık büyük harf yok (sentence case).
- Gizlilik cümlesi kelimesi kelimesine: **"Screenshots never leave your browser unless you choose to upload them."** (TR: "Ekran görüntüleri siz yüklemeyi seçmedikçe tarayıcınızdan asla çıkmaz.")
- Hata metinleri iki parça: ne oldu + ne yapılabilir; suçlayıcı değil ("Bu sayfa korumalı" ✓, "Yanlış sayfa seçtiniz" ✗).
- İzin gerekçeleri: hangi veri, neden, ne zaman ("Sekme başlıklarını yalnızca 'Tüm sekmeler' özelliği çalışırken okuruz.").
- Sayılar: `Intl.NumberFormat`, boyut `1.2 MB`, zaman relative ("2 min ago") + tooltip'te tam tarih.

---

## 20. Kabul Kriterleri
| ID | Kriter |
|---|---|
| AC-UI-01 | Popup ilk boya < 150 ms (Lighthouse/perf trace), bundle < 60 KB gz; Fabric/pdf-lib popup'ta yüklenmiyor |
| AC-UI-02 | Popup yalnız çalışan Full page ve Visible area modlarını gösterir; her ikisi eksiksiz `CaptureRequest` üretir; restricted sayfada yalnızca Visible etkin ve bilgi şeridi görünür |
| AC-UI-03 | Capture sırasında popup yeniden açılınca progress ve Cancel görünür; iptal 300 ms içinde overlay'i kaldırır |
| AC-UI-04 | Result sayfası: export paneli tüm `ExportPlan` alanlarını sunar; PDF accordion tüm `PdfOptions` alanlarını içerir; strip'li sonuçta navigasyon çalışır |
| AC-UI-05 | History: 5.000 kayıtla akıcı scroll; arama/filtre/sort `HistoryQuery` ile eşleşir; bulk bar işlemleri çalışır; storage meter doğru |
| AC-UI-06 | Compare: 4 görünüm modu + regions listesi + timeline çalışır; ignore region eklenince diff yeniden koşar |
| AC-UI-07 | Batch: geçersiz URL satır içi işaretlenir; çalışma görünümü canlı güncellenir; retry failed çalışır |
| AC-UI-08 | Options: §8 tablosundaki her alan görünür, varsayılanı doğru, değişiklik `settings.set` ile kalıcı; Reset çalışır |
| AC-UI-09 | Onboarding ilk kurulumda açılır, 3 adım tamamlanınca `onboardingDone=true`, tekrar açılmaz |
| AC-UI-10 | Tüm sayfalar axe-core "serious/critical" = 0; tüm akışlar klavye-only tamamlanabilir |
| AC-UI-11 | Dark/light/system tema geçişi anında uygulanır; kontrast oranları AA |
| AC-UI-12 | `tr` locale'de UI'da İngilizce hardcode metin yok (lint + görsel kontrol) |
| AC-UI-13 | Sayfa-içi overlay'ler sayfa CSS'inden etkilenmez (agresif CSS'li test sitesinde doğru görünür) ve capture'larda görünmez |
