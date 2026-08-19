# 04 — Export ve Dosya Özellikleri

> Capture sonucunun (tek görüntü ya da strip'ler) PNG/JPEG/WebP/AVIF/GIF/BMP/PDF'e dönüştürülmesi, panoya kopyalanması, indirilmesi, ZIP'lenmesi, yazdırılması ve dosya adı şablonları. Tipler `13-data-contracts.md §4` (`ExportPlan`, `PdfOptions`, `DownloadOptions`, `EncodeRequest`, `PdfBuildRequest`, `ZipRequest`, `ExportResult`), mimari `02-architecture.md §2.3` (offscreen worker'ları). Gereksinim ID önek: `REQ-EXP-*`.

İçindekiler: 1 ExportPipeline · 2 Görüntü encoder'ları · 3 Clipboard · 4 Download & klasör & auto-download · 5 PDF · 6 Multi-image fallback · 7 Gömülü metadata · 8 Watermark · 9 Print · 10 ZIP / batch export · 11 Filename template motoru · 12 Boyut/performans · 13 Kabul kriterleri

---

## 1. ExportPipeline (SW `background/export/pipeline.ts`) — `REQ-EXP-001`…`009`

### 1.1 Girdi/çıktı
- Girdi: `ExportRequest { captureId, plan: ExportPlan, stripIndex?, editedRef? }` ya da capture sonunda `CaptureCoordinator` tarafından `CaptureRecord` + `CaptureRequest.export`.
- Kaynak görüntü seçimi: `editedRef` varsa o; yoksa `CaptureRecord.files` içinde `role:'edited'` (en yeni) → `'full'` → `'strip'[]`. (Karar: editör kaydı varsa export varsayılan olarak düzenlenmiş halidir; UI'da "Orijinali dışa aktar" seçeneği.)
- Çıktı: `ExportResult { files[], warnings[] }`.

### 1.2 Hedef sırası (deterministik)
`plan.targets` içindeki sıraya bakılmaksızın şu sırayla işlenir (Karar): `history` → `clipboard` → `download` → `print` → `integration` → `openResult`. Gerekçe: önce kalıcı kayıt (veri kaybı olmasın), sonra kullanıcıya anında geri dönüş (pano), sonra dosya sistemi, en son UI.
- `history` hedefi capture tarafında zaten yapılmışsa (record var) atlanır; sadece yeni dosya (`pdf`, `edited`) `CaptureRecord.files`'a eklenir.
- `openResult`: `Settings.general.afterCapture` ile birleşir (`openResultTab` / `openSidePanel` / `downloadOnly` / `clipboardOnly` / `none`).

### 1.3 Akış
```
resolveSource(captureId, editedRef)           → BlobRef | BlobRef[] (strips)
if format ∈ image formats:
    if strips.length > 1 && plan.multiImage == 'pdfPages' → format = pdf (bkz §6)
    for each (strip|full) → offscreen.encode {src, format, options, watermark, metadata}   → BlobRef
else if format == 'pdf':
    links = (plan.pdf.clickableLinks && record.links) ; textRects = record.textRects ; ocr = plan.pdf.searchableText=='ocr' ? offscreen.ocr(...) : undefined
    offscreen.pdf {images, options, links, textRects, ocr, context}                        → BlobRef
filename(s) = FilenameTemplate.resolve(plan.filename, ctx)  (+ "_part{strip}" strip'lerde, §11)
for target in ordered targets: run(target) ; hatalar toplanır (bir hedef diğerini engellemez)
return ExportResult
```
- `links`/`textRects`: capture sırasında `CaptureOptions`/`ExportPlan` PDF istiyorsa `agent.collectLinks`/`agent.collectText` çağrılır ve `CaptureRecord.aux` altında saklanır (**13'e eklenecek:** `CaptureRecord.aux?: { links?: LinkRect[]; textRects?: TextRect[] }`). Sonradan PDF export isteğinde bunlar yoksa PDF link'siz üretilir + `warnings:['links-unavailable']` (sayfa artık açık olmayabilir).
- Her hedef hatası `ErrorInfo` olarak `warnings`'e ve job log'a yazılır; `download` hatası `E_DOWNLOAD`, pano `E_CLIPBOARD`, PDF `E_PDF`, encode `E_ENCODE`.
- Zaman aşımı: export fazı toplam 120 s (02 §4); PDF+OCR için 300 s (offscreen içinde sürer, SW sadece sonucu bekler; SW 5 dk sınırı için bekleme `storage.session` + offscreen → SW `job.progress` mesajlarıyla bölünür).

---

## 2. Görüntü Encoder'ları (offscreen `encode.worker.ts`) — `REQ-EXP-010`…`019`

| Format | Öncelik | Yöntem | Notlar |
|---|---|---|---|
| PNG | P0 | `OffscreenCanvas.convertToBlob({type:'image/png'})` | Kayıpsız, alpha korunur. Canvas limiti aşılıyorsa canvas-sız yol (§2.2). |
| JPEG | P0 | `convertToBlob({type:'image/jpeg', quality})` | Alpha yok → önce `background` (beyaz varsayılan) ile düzleştir (`stripAlpha:true` zorunlu). `jpegQuality` 0.92. |
| WebP | P1 | `convertToBlob({type:'image/webp', quality})` | Chrome destekler; `webpQuality` 0.9. Lossless için `quality:1` (Chrome lossless değil; not: UI'da "near-lossless"). |
| AVIF | P2 (deneysel) | `convertToBlob({type:'image/avif'})` — Chrome 124+ | Dönen `blob.type` kontrol edilir; `image/avif` değilse `E_NOT_SUPPORTED` → UI seçeneği gizlenir (`advanced.experimental.avif`). |
| GIF | P2 | `gifenc` (`quantize` + `applyPalette` + `GIFEncoder`) | Tek kare, 256 renk, `dither:false` varsayılan. 8k px üstü yükseklikte yavaş → önce `maxHeightPx` ile uyarı. |
| BMP | P2 | Özel writer: 54 bayt header (BITMAPINFOHEADER), 24-bit BGR, satırlar 4 bayta pad, bottom-up | Alpha düzleştirilir. Dosya = `w*h*3 + pad` (sıkıştırmasız; 2880×24000 ≈ 207 MB → UI uyarır). |

### 2.1 Ortak adımlar
1. `src` BlobRef → `createImageBitmap(blob)`.
2. `maxWidthPx`/`maxHeightPx`/`scale` → hedef boyut; `imageSmoothingQuality:'high'`; boyut küçültme tek adımda (downscale > 2× ise iki kademeli — kalite).
3. Alpha düzleştirme (JPEG/BMP/GIF): `ctx.fillStyle = background; fillRect` sonra `drawImage`.
4. Watermark (§8) ve (PNG/JPEG) gömülü metadata (§7) uygulanır.
5. `convertToBlob` → `blobs` store'a yazılır → `BlobRef`.
- `bitmap.close()` her durumda (`finally`).

### 2.2 Canvas-sız PNG (oversize tek dosya) — `REQ-EXP-015`
Strip'ler varken kullanıcı **tek PNG** istediyse (`multiImage` ayarından bağımsız "Tek dosya olarak birleştir" butonu) ve toplam yükseklik canvas limitini aşıyorsa:
1. Her strip `createImageBitmap` → `OffscreenCanvas(stripW, stripH)` → `getImageData` (strip ≤ limit olduğu için güvenli) → RGBA satırları.
2. Satır bazlı PNG yazıcı (`lib/image/png-stream.ts`): IHDR (8-bit RGBA, color type 6) → her satır için filtre baytı (0 = None; P1.5'te Sub/Up adaptif) → `fflate` `Zlib` streaming (`push(chunk)`), IDAT chunk'ları ≤ 1 MB parçalarla `Blob` parts listesine; CRC32 her chunk için.
3. Sonunda IEND; `new Blob(parts, {type:'image/png'})`.
- Bellek: bir strip'in RGBA'sı + zlib penceresi; 50 MB strip ile < 200 MB peak.
- Uyarı metni: "Bazı görüntüleyiciler > 30.000 px görüntüleri açamayabilir."
- JPEG/WebP için canvas-sız encoder yok → oversize'da bu formatlar strip olarak kalır (Karar).

---

## 3. Clipboard — `REQ-EXP-020`…`024`
- Chrome pano yazımı yalnızca `image/png` (+ `text/plain`, `text/html`) kabul eder → JPEG/WebP çıktısı istense bile panoya **PNG** gider (UI: "Panoya PNG olarak kopyalandı").
- Strip'ler varsa: varsayılan ilk strip + uyarı; `export.copy {stripIndex}` ile tek tek. (Karar: strip'leri birleştirip canvas-sız PNG'yi panoya koymak denenmez — pano büyük blob'larda yavaş/başarısız.)
- Strateji zinciri (02 §2.3): (1) odaklı `result.html` → `navigator.clipboard.write([new ClipboardItem({'image/png': blob})])`; (2) aktif sekme CS `agent.clipboardWrite {dataUrl}` (CS'de `dataUrlToBlob` ile yerel `atob`/`Uint8Array` dönüşümü → `clipboard.write`; `clipboardWrite` opsiyonel izni varsa jest gerekmez; yoksa `NotAllowedError` → adım 3); (3) `clipboard.html` mini popup penceresi (`chrome.windows.create({url, type:'popup', width:320, height:120, focused:true})`), yazınca `window.close()`.
- Bellek sınırı: > 100 MB PNG panoya yazılmaz → `E_CLIPBOARD` + "Görüntü pano için çok büyük; indirildi" (otomatik download fallback, Karar).
- Metin kopyalama (URL, markdown bug report): offscreen `offscreen.clipboardText` (`textarea` + `execCommand('copy')`).
- Bildirim: badge `✓` 2 s + (ayar açıksa) `chrome.notifications`.

---

## 4. Download, Klasör, Auto-download — `REQ-EXP-030`…`039`

### 4.1 `DownloadManager`
```ts
async function download(ref: BlobRef, filename: string, opts: DownloadOptions): Promise<number /*downloadId*/>
```
1. SW'de `URL.createObjectURL` **yok** → `offscreen.objectUrl {src}` ile offscreen blob URL üretir (offscreen belge yaşadığı sürece geçerli). Blob 2 MB altındaysa alternatif olarak data URL kullanılabilir (Karar: her zaman blob URL; data URL yalnızca offscreen açılamazsa fallback).
2. `chrome.downloads.download({ url, filename: join(subfolder, filename), saveAs: opts.saveAs, conflictAction: opts.conflictAction })`.
3. `chrome.downloads.onChanged` ile `state: complete|interrupted` izlenir; tamamlanınca `offscreen.revokeUrl`. 60 s içinde tamamlanmazsa yine revoke edilmez (büyük dosya); `interrupted` → `E_DOWNLOAD` (`error` alanı loglanır: `FILE_FAILED`, `USER_CANCELED` vb.; `USER_CANCELED` hata sayılmaz).
4. `onDeterminingFilename` **kullanılmaz** (Karar: tek dinleyici kısıtı ve diğer uzantılarla çakışma).
5. `downloadId` `CaptureFile`'a yazılır (`history` "tekrar indir" için `chrome.downloads.show` / yeniden download).

### 4.2 Klasör kısıtı
- Chrome uzantıları yalnızca **Downloads klasörünün altına** yazabilir; mutlak yol, `..`, boş segment → API hatası. `DownloadOptions.subfolder` template destekler (`Screenshots/{domain}`), çözümlendikten sonra her segment sanitize edilir (§11), `..`/`.`/boş segment → `E_VALIDATION`.
- UX metni (Options): "Chrome uzantıları yalnızca İndirilenler klasörünün altına kaydedebilir. Farklı bir konum için Chrome ayarlarından İndirilenler klasörünü değiştirin ya da 'Kaydetmeden önce sor'u açın." + `chrome://settings/downloads` linki.
- `saveAs:true` → kullanıcı diyalogda istediği yeri seçer (bu, "özel klasör" isteğinin Chrome'daki tek tam çözümü).

### 4.3 Auto-download
- `DownloadOptions.auto:true` → capture bitince `ExportPlan.format` ile doğrudan indir; `afterCapture:'downloadOnly'` ise result sekmesi açılmaz (GoFullPage "Auto-download" davranışı).
- Strip'ler: `multiImage` `separate` → `name_part01.png`…; `zip` → tek zip; `pdfPages` → PDF.
- Başarısız auto-download sonrası result sekmesi açılır ve hata gösterilir (veri kaybı olmasın).

---

## 5. PDF — `REQ-EXP-040`…`069`

### 5.1 Kütüphane
- **Karar:** `@cantoo/pdf-lib` (pdf-lib'in bakımlı fork'u; aynı API). Worker içinde (`pdf.worker.ts`) çalışır; `save()` tek `Uint8Array` döner → `blobs`/OPFS.
- Görüntü gömme: varsayılan **JPEG** (`embedJpg`, passthrough, hızlı, küçük); `imageFormat:'png'` seçilirse `embedPng` (pdf-lib PNG'yi JS'te decode+Flate eder — yavaş; 20 MP üzeri PNG'de uyarı).
- `cdp` varyantında `searchableText:'native'` → `Page.printToPDF` (03 §15) sonucu doğrudan kullanılır; `paged` modda `paperWidth/Height` inch, `printBackground:true`, `preferCSSPageSize:false`, `displayHeaderFooter` + `headerTemplate/footerTemplate` HTML, `transferMode:'ReturnAsStream'` + `IO.read` (base64 parçalar) → Blob. `singleLongPage` native modda `paperHeight = contentHeight` (max 200 in) ile tek sayfa. Native PDF görüntü-tabanlı değildir (metin+link doğal).

### 5.2 Birimler ve sayfa boyutları
- 1 CSS px = 0.75 pt (96 dpi). `scale` çarpanı: `pt = css * 0.75 * scale`. Görüntü DevicePx'i CSS genişliğe göre yerleştirilir (`cssWidth` → pt); DPR yalnızca çözünürlük sağlar.

| `PdfPageSize` | Portrait (pt) |
|---|---|
| A3 | 841.89 × 1190.55 |
| A4 | 595.28 × 841.89 |
| A5 | 419.53 × 595.28 |
| Letter | 612 × 792 |
| Legal | 612 × 1008 |
| Tabloid | 792 × 1224 |
| `{widthPt,heightPt}` | özel (3–14.400) |
| `auto` | tek uzun sayfa: `w = cssWidth*0.75*scale + margins`, `h = cssHeight*0.75*scale + margins` |

- `orientation:'landscape'` genişlik/yükseklik yer değiştirir; `'auto'` → görüntü en-boy oranı > 1 ise landscape.

### 5.3 Tek uzun sayfa (`mode:'singleLongPage'`)
- PDF/ISO 32000 sayfa kenarı ≤ **14.400 pt** (200 in). `h > maxSinglePageHeightPt` ise: (a) `scale` düşürülerek sığıyorsa (min 0.25) ölçek düşür; (b) yine sığmıyorsa **otomatik böl**: her biri ≤ 14.400 pt olan ardışık "uzun sayfalar" (sayfa sayısı = ceil(h/14.400)), `warnings:['split-long-page']`. `UserUnit` (PDF 1.6) ile tek sayfa **kullanılmaz** (Karar; Acrobat dışı görüntüleyicilerde "dimensions out of range" uyarısı).
- Görüntü tek `drawImage`; strip'ler alt alta aynı sayfaya (her strip ayrı `embedJpg`, dikişte 0 pt boşluk).

### 5.4 Çok sayfalı (`mode:'paged'`) ve smart page breaks
1. İçerik alanı: `contentW = pageW - mL - mR`, `contentH = pageH - mT - mB - (headerFooter ? 2*hfHeight : 0)`.
2. `fit:'width'` → `s = contentW / (cssWidth*0.75)`; görüntü yüksekliği pt `imgH = cssHeight*0.75*s`. `fit:'contain'` → görüntü tek sayfaya sığacak şekilde (`min(contentW/w, contentH/h)`), sayfa sayısı 1.
3. Sayfa pencereleri: `y0 = 0`; döngü: `yEnd = y0 + contentH/s` (CSS px). `smartPageBreaks` kapalıysa kesim `yEnd`. Açıksa **en iyi kesim** aranır: pencere `[yEnd - contentH/s * breakSearchWindowPct/100, yEnd]` (varsayılan son %20):
   - **DOM ipuçları** (`TextRect[]` — `agent.collectText` capture sırasında toplanmış; `kind: textLine|image|block`): bir `y` adayı, hiçbir `textLine`/`image` rect'ini bölmüyorsa "temiz"; adaylar = pencere içindeki rect alt kenarları + (varsa) blok alt kenarları; en büyük `y` (en az boşluk) seçilir; temiz aday yoksa →
   - **Piksel analizi**: pencere satırları için "ink" skoru = `Σ|pixel - bgColor| > 24` sayısı (görüntü downscale edilerek — genişlik 400 px'e — hızlandırılır; `bgColor` = sayfa kenar örneklerinin modu); ink = 0 olan en alttaki ≥ 3 ardışık satır bandının ortası; yoksa min-ink satırı; yoksa `yEnd`.
   - Güvenlik: kesim `y0 + 0.4 * contentH/s`'nin altına inemez (çok küçük sayfalar olmasın).
4. Her sayfa: görüntüden `[y0, yCut)` bölgesi `drawImage` ile **kaynak kırpma** yerine, pdf-lib'de kırpma `page.pushOperators(clip)` veya daha basiti: her sayfa için offscreen'de bölge crop'lanıp ayrı JPEG olarak embed edilir (Karar: **sayfa başına crop+embed** — bellek sabit, PDF görüntüleyici performansı iyi). `y0 = yCut`.
5. Header/footer, linkler, OCR metni, watermark sayfa başına uygulanır (aşağıda).
- Bellek stratejisi: görüntü `ImageBitmap` olarak bir kez açılır; sayfa başına `OffscreenCanvas(contentW_px, pageH_px)` → JPEG → `embedJpg` → canvas serbest. `pdfDoc` bellekte büyür (sayfa başına JPEG); 200 sayfa × 300 KB ≈ 60 MB kabul edilebilir. Strip'ler sırayla açılır (aynı anda 1 strip).

### 5.5 Tıklanabilir linkler (`clickableLinks`)
- Kaynak: `LinkRect[]` (CSS px, sayfa koordinatı; capture alanı `origin`'e göre normalize edilmiş; `frameId` ≠ 0 olanlar iframe rect'i ile ötelenmiş olarak gelir).
- Dönüşüm: sayfa `p` için `rectPt = { x: mL + (r.x * 0.75 * s), yTop: mT + hfH + ((r.y - y0_p) * 0.75 * s), w: r.width*0.75*s, h: r.height*0.75*s }` → PDF koordinatı alt-sol orijinli: `y1 = pageH - yTop - h`, `y2 = pageH - yTop`. Sayfa sınırlarında kırpma (`[y0_p, yCut_p)` ile kesişim; kesişim yüksekliği < 2 px ise atla). Bir link iki sayfaya bölünüyorsa iki annotation.
- Annotation: `Subtype:'Link', Rect, Border:[0,0,0], A:{S:'URI', URI}`; `page.node.set(Annots, [...])` (mevcut diziye push). `href` `javascript:`/`data:` ise atlanır; göreli URL'ler capture anında absolute'a çevrilmiştir (CS `a.href` property).
- Header/footer'daki `{url}` de tıklanabilir link olarak eklenir.

### 5.6 Aranabilir/seçilebilir metin (`searchableText:'ocr'`)
- Her sayfanın JPEG'i (ya da tüm görüntü bir kez, bbox'lar sayfaya bölünür — Karar: **tam görüntü bir kez OCR**, `offscreen.ocr`, sonuç `OcrResult.words[]` DevicePx) → her kelime için görünmez metin: `page.pushOperators(setTextRenderingMode(TextRenderingMode.Invisible))` (render mode 3) → `page.drawText(word.text, {x, y, size, font: Helvetica})`.
  - `size = bboxH_pt * 0.9`; yatay uyum için `horizontalScale = bboxW_pt / font.widthOfTextAtSize(text, size) * 100` (`Tz` operatörü). Latin dışı karakterler Helvetica'da yoksa `NotoSans` subset (`assets/fonts/NotoSans-Regular.ttf`, `fontkit` ile `embedFont`, `subset:true`).
  - `confidence < 40` kelimeler atlanır (Karar) — arama kalitesi.
- OCR dil: `ocrLang` (varsayılan `['eng']`, UI'da `tur` seçilebilir; dil verisi bundle içinde `eng`, `tur`; diğerleri P2).
- Süre bütçesi: 10k px sayfa ≈ 10–20 s; progress "Metin tanınıyor… %40".
- Not: `'native'` yalnız `cdp` varyantı (§5.1).

### 5.7 Header / footer
- `PdfHeaderFooter` alanları; token çözümü §11 motoruyla aynı (`{page}`/`{pages}` sayfa bağlamı): `{title}`, `{url}`, `{domain}`, `{date}`, `{time}`, `{datetime}`, `{page}`, `{pages}`, `{timezone}`, `{text:…}`.
- Çizim: `fontSizePt` (8), `color` (#666), `heightPt` (24) içinde sol/orta/sağ hizalı; uzun `{url}` ortadan `…` ile kısaltılır (genişlik hesapla: `font.widthOfTextAtSize`).
- Varsayılan preset "Documentation": header `{title}` | footer sol `{url}`, sağ `{page}/{pages}`, orta `{datetime}`.
- Tek uzun sayfa modunda da header/footer üst/alt şeride çizilir (`{pages}=1`).

### 5.8 Watermark
§8 — PDF'te her sayfaya `drawText`/`drawImage` (`opacity`, `rotate`), `position:'tile'` → sayfa boyunca ızgara.

### 5.9 Metadata
- Info dict: `setTitle(title || filename)`, `setSubject(url)`, `setKeywords(['screenshot', domain, ...tags])`, `setAuthor(user optional)`, `setCreator('<AppName> <version>')`, `setProducer('<AppName> (pdf-lib)')`, `setCreationDate/ModificationDate(capturedAt)`.
- XMP (`/Metadata` stream, `application/xml`): `dc:title`, `dc:source` (URL), `xmp:CreateDate`, `xmp:CreatorTool`, özel ns `ssx:` → `captureMode`, `viewport`, `dpr`, `sha256`, `timezone`. `EmbeddedMetadataOptions.enabled` false ise yalnızca Title/Creator/Producer.
- Outline (P2): `TextRect` ile birlikte toplanan `h1/h2` (`agent.collectText` `kind:'heading'` — **13'e eklenecek:** `TextRect.kind` birleşimine `'heading'` ve `text?: string; level?: number`) → `pdfDoc.catalog` outline ağacı (pdf-lib low-level).

### 5.10 Çoklu capture → tek PDF (all tabs / batch / history bulk)
- `PdfBuildRequest.images[]` birden fazla capture içerir; `combineStrategy:'appendPages'`: her capture kendi `context`'i (URL/title) ile sırayla `paged` ya da `singleLongPage` kurallarıyla eklenir; header `{title}`/`{url}` capture bazında; `{pages}` toplam. Bölüm başı sayfa numarası bookmark (outline P2) olarak eklenir.
- Kaynak: `history.export {ids, format:'pdf'}`, batch `export.combine:'singlePdf'`, allTabs.
- Bellek: capture'lar sırayla açılır; 100 sekme × 10k px için ~ 200–400 MB peak; ilerleme bildirimi capture bazında.

### 5.11 PDF uyumluluk
- Üretilen PDF 1.7; Chrome PDF viewer, Preview, Acrobat Reader'da test (11). Tek uzun sayfa 14.400 pt'ta Acrobat uyarısı yok.
- FireShot'ın "footer reklam" davranışı **yapılmaz**; hiçbir zorunlu damga eklenmez.

---

## 6. Multi-image Fallback — `REQ-EXP-070`…`074`
- Stitcher strip ürettiyse (03 §10) `ExportPlan.multiImage`:
  - `separate` → her strip ayrı dosya `name_part01.ext` … (`{strip}` token'ı zero-pad 2; kullanıcı şablona `{strip}` koymadıysa otomatik `_part{strip:2}` eklenir).
  - `zip` → tek `name.zip` (§10).
  - `pdfPages` → her strip bir PDF sayfası (`singleLongPage` kuralı strip bazında; ya da `paged` seçiliyse normal sayfalama — strip'ler art arda tek görüntü gibi ele alınır).
- Result sayfası: strip'ler dikey sıralı tek görünüm (sanal scroll); "Tek PNG olarak birleştir" (§2.2) butonu; her strip için ayrı indir/kopyala.
- History kaydı: `files[] role:'strip' index:n`.

---

## 7. Gömülü Metadata — `REQ-EXP-080`…`084`
`EmbeddedMetadataOptions.fields` ile seçilen alanlar (`url, title, timestamp, timezone, viewport, dpr, userAgent, sha256, captureMode, appVersion`):
- **PNG**: `iTXt` chunk'ları (UTF-8): anahtarlar `Source URL`, `Title`, `Creation Time` (RFC 1123 + ISO), `Software`, ve tek JSON `ssx:metadata`. Uygulama: `png-chunks-extract` → IHDR'dan sonra `png-chunk-text`/özel iTXt üretici ile ekle → `png-chunks-encode`. `tEXt` yerine `iTXt` (Unicode). Büyük PNG'lerde chunk işlemi `Blob` parçalı (IHDR sonrası ekleme: ilk 8+25 bayt + yeni chunk'lar + kalan; tam parse gerekmez).
- **JPEG**: APP1 XMP paketi (`http://ns.adobe.com/xap/1.0/\0` + RDF/XML; `dc:source`, `xmp:CreateDate`, `xmp:CreatorTool`, `ssx:*`). EXIF yazılmaz (Karar; XMP yeterli, EXIF kütüphanesi gereksiz). SOI'den sonra APP0'ın ardına eklenir.
- **WebP**: RIFF `XMP ` chunk + `VP8X` bayrağı (P2); öncesinde metadata gömülmez + uyarı.
- **PDF**: §5.9.
- `sha256`: görüntü **metadata eklenmeden önceki** baytların hash'i (evidence tutarlılığı: 09 §5); metadata içinde `image.sha256` olarak yazılır.
- Varsayılan: `Settings.privacy.embedMetadataDefault` = **false** (gizlilik — URL paylaşılan görüntüde sızmasın); "Documentation"/"Legal Evidence" presetlerinde true.

---

## 8. Watermark — `REQ-EXP-090`…`093`
- `WatermarkOptions { kind:'text'|'image', text|imageRef, position, opacity, fontSizePx, color, marginPx, rotateDeg }`.
- Görüntüde: encode adımında `ctx.globalAlpha = opacity`, metin `fontSizePx` (`system-ui`), `position` köşe/merkez; `'tile'` → `rotateDeg` (-30 varsayılan) ile 2×fontSize aralıklı ızgara. Görüntü watermark `drawImage` (max genişlik %25).
- Şablon token'ları metinde çözülür (`{domain} {date} {url}`).
- PDF'te §5.8. Watermark düzleştirilir (kaldırılamaz).

---

## 9. Print — `REQ-EXP-100`…`102`
- `print` hedefi: PDF üretilir (`plan.pdf` varsayılan `paged A4 fit width`), `print.html?ref=<blobKey>` extension sayfası açılır (`chrome.tabs.create`), sayfa PDF'i `<embed type="application/pdf">` içinde göstermek yerine **görüntüyü sayfalara bölünmüş `<img>` öğeleri** olarak render eder (`@page { size: A4; margin: 0 }`, her sayfa `break-after: page`) ve `window.print()` çağırır — Chrome'un yazdırma önizlemesi açılır, kullanıcı yazıcı/PDF seçer. (Karar: PDF blob'u embed + print, Chrome'da güvenilir değil; görüntü-tabanlı sayfa akışı güvenilir.)
- `chrome.printing` API yalnızca ChromeOS → kullanılmaz.

---

## 10. ZIP / Batch Export — `REQ-EXP-110`…`114`
- `fflate` `Zip` streaming (`zip.worker.ts`): her entry `ZipPassThrough` (level 0 — PNG/JPEG/PDF zaten sıkıştırılmış) ya da `ZipDeflate(level 6)` (JSON/MD/BMP). Çıkış parçaları `Blob` parts → tek `Blob`; > 500 MB'ta OPFS'e streaming yazım (`createWritable`).
- Entry adları §11 ile çözülür; çakışmalar `-2`, `-3` eki ile benzersizleştirilir; yol ayırıcı `/` (alt klasör: `{domain}/…`).
- İçerik: görüntüler/PDF'ler + (ayar) `manifest.json` (capture listesi: url, title, capturedAt, sha256, filename) + batch log (`batch.log.txt`).
- Kaynaklar: strip'ler (`multiImage:'zip'`), history bulk export, batch `combine:'zip'|'zipAndPdf'`, evidence bundle (09).
- Bellek bütçesi: sabit (~50 MB) — entry'ler sırayla okunur.

---

## 11. Filename Template Motoru (`lib/template/filename.ts`) — `REQ-EXP-120`…`129`
Gramer: `13 §12`. Saf fonksiyon, unit test yoğun.

### 11.1 Bağlam
```ts
interface TemplateContext {
  url: string; title: string; capturedAt: Date; timezone: string;
  width: number; height: number;             // çıktı DevicePx
  viewport: Size; mode: CaptureMode; preset?: string; format: string;
  tabIndex?: number; batchIndex?: number; batchName?: string; itemName?: string; attempt?: number; strip?: number;
  counter: () => number;                     // lazy: yalnızca kullanılırsa artar
  page?: number; pages?: number;             // PDF header/footer bağlamı
}
```

### 11.2 Çözümleme algoritması
1. Tokenize: `{name(:format)?(|fallback)?}`; bozuk `{` literal kalır.
2. Her token için değer üret (tablo aşağıda); `format` uygula; boşsa `fallback`; hâlâ boşsa `""`.
3. Birleştir, **segment sanitize** (dosya adı): `[\\/:*?"<>|\x00-\x1F]` → `_`; ardışık `_`/boşluk tekile indir; baş/son `. ` kırp; Windows rezerve adlar (`CON PRN AUX NUL COM1-9 LPT1-9`, büyük/küçük) → `name_`; UTF-8 ≤ 180 bayt (sonu grapheme sınırında kes); boşsa `screenshot`.
4. Uzantı ekle (`.{format}`; `jpeg`→`.jpg`); kullanıcı şablon sonunda `.png`/`.pdf` gibi yazdıysa kaldırılır.
5. `subfolder` için aynı süreç segment segment; `..`, `.`, boş → `E_VALIDATION`; ayırıcı `/` (Chrome `\`'ı da kabul eder ama normalize edilir).

| Token | Değer | Örnek |
|---|---|---|
| `{domain}` | eTLD+1 yaklaşık: hostname'den `www.` kırp (Karar: PSL bundle edilmez; `www.` dışı alt alanlar korunur) | `example.com` |
| `{hostname}` | tam host | `www.example.com` |
| `{title}` | `document.title` sanitize; `title:40` ilk 40 karakter | `Pricing - Example` |
| `{url}` | şema kırpılmış, `/`→`_`, `?`/`#` → `_`, max 100 | `example.com_pricing` |
| `{date}` / `{yyyy-mm-dd}` | yerel tarih | `2026-08-19` |
| `{time}` | `HH-MM-SS` yerel | `14-05-09` |
| `{datetime}` | `yyyy-mm-dd_HH-MM-SS` | |
| `{yyyy} {mm} {dd} {hh} {min} {ss}` | parçalar | |
| `{date:yyyymmdd}` | özel format: `yyyy mm dd HH MM SS` harfleri | `20260819` |
| `{counter}` / `{counter:4}` | profil genel sayaç (`storage.local.filenameCounter`), atomik artış; zero-pad | `0042` |
| `{viewport}` | `WxH` CSS | `1440x900` |
| `{width}` `{height}` | çıktı DevicePx | `2880` |
| `{mode}` `{preset}` `{format}` | | `fullPage`, `bug-report`, `png` |
| `{tabIndex}` `{batchIndex}` `{batchName}` | | `003` (`:3`) |
| `{strip}` | parça no (1-tabanlı) | `01` |
| `{random:N}` | `crypto.getRandomValues` base36 | `k3f9zq` |
| `{timezone}` | IANA, `/`→`-` | `Europe-Istanbul` |
| `{uuid}` | `crypto.randomUUID()` | |

- Sayaç: `storage.local.filenameCounter` ≥ 1; `settings.reset` sıfırlamaz (Options'ta ayrı "Sayacı sıfırla").
- Önizleme: Options/popup şablon alanı altında canlı örnek çıktı (sahte bağlam).
- Örnekler: `{domain}_{yyyy-mm-dd}_{time}` → `example.com_2026-08-19_14-05-09.png`; batch `{batchIndex:3}_{domain}_{title:40}` → `001_example.com_Pricing - Example.png`; strip'li `…_part01.png`.
- Geçersiz token adı → literal bırakılır + Options'ta uyarı.

---

## 12. Boyut ve Performans Bütçeleri — `REQ-EXP-130`
| İş | Hedef |
|---|---|
| 2880×24.000 PNG encode | < 4 s, peak < 500 MB |
| Aynı görüntü JPEG 0.92 | < 2.5 s; ~3–6 MB |
| Paged A4 PDF, 30 sayfa, JPEG 0.85, smart breaks | < 6 s (OCR hariç); dosya ~ 4–8 MB |
| OCR tam sayfa (eng) 10k px | 10–20 s (arka plan, iptal edilebilir) |
| ZIP 50 dosya × 5 MB | < 5 s, bellek < 100 MB |
| Clipboard PNG 20 MB | < 1 s |
| Filename resolve | < 1 ms |

Tahmini boyutlar UI'da gösterilir (format seçiminde): PNG ≈ `w*h*0.9` bayt (UI ekranları), JPEG ≈ `w*h*0.25*q`, WebP ≈ JPEG×0.7.

---

## 13. Kabul Kriterleri
| ID | Kriter |
|---|---|
| AC-EXP-01 | Full-page sonucu PNG/JPEG/WebP olarak indirilir; JPEG'te alpha düzleşmiş (siyah arka plan yok) |
| AC-EXP-02 | `{domain}_{yyyy-mm-dd}_{time}` varsayılanı doğru dosya adı üretir; `Screenshots/{domain}` alt klasörüne kaydeder; `..` reddedilir |
| AC-EXP-03 | Strip'li sonuç `separate/zip/pdfPages` üç modda da tam içerikle teslim edilir; `_part01..` sıralı |
| AC-EXP-04 | "Tek PNG olarak birleştir" 2880×60.000 görüntüyü canvas-sız üretir, bellek < 300 MB, dosya geçerli (pngcheck) |
| AC-EXP-05 | Panoya kopyalama result sayfası kapalıyken de çalışır (CS → popup pencere zinciri) |
| AC-EXP-06 | Tek uzun PDF: 9.000 px sayfa tek sayfa; 25.000 px sayfa 14.400 pt kuralıyla otomatik 2 sayfa + uyarı |
| AC-EXP-07 | Paged A4 smart breaks: test sayfasında hiçbir metin satırı iki sayfaya bölünmez (TextRect ile doğrulama); kapalıyken bölünür |
| AC-EXP-08 | Clickable links: test sayfasındaki 20 link PDF'te doğru konumda (±3 pt) ve tıklanınca doğru URL; sayfa sınırına denk gelen link iki sayfada |
| AC-EXP-09 | OCR searchable PDF: "Lorem ipsum" araması Chrome viewer ve Preview'da eşleşir ve doğru konumu vurgular |
| AC-EXP-10 | Header/footer `{page}/{pages}`, `{url}`, `{datetime}` doğru; URL tıklanabilir |
| AC-EXP-11 | Watermark metin/görsel 5 pozisyon + tile; PDF ve PNG'de görünür; opacity doğru |
| AC-EXP-12 | PNG iTXt metadata `exiftool` ile okunur; JPEG XMP `dc:source` doğru; PDF Info/XMP doğru; `embedMetadataDefault=false` iken hiçbir URL gömülmez |
| AC-EXP-13 | All-tabs (5 sekme) tek PDF: 5 bölüm, header title'ları doğru, toplam `{pages}` doğru |
| AC-EXP-14 | Print: A4 önizleme sayfa sayısı PDF ile aynı; kenar boşluğu 0 |
| AC-EXP-15 | ZIP: 50 PNG + manifest.json; unzip doğrulaması; bellek < 100 MB |
| AC-EXP-16 | GIF/BMP export açılır ve doğru boyutta; BMP > 100 MB'ta uyarı |
| AC-EXP-17 | Download `interrupted` → result sayfasında hata + "Tekrar indir"; `USER_CANCELED` sessiz |
| AC-EXP-18 | Auto-download + `downloadOnly` modunda result sekmesi açılmaz; hata olursa açılır |
