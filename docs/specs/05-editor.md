# 05 — Screenshot Editor

> Capture sonrası `result.html` içinde çalışan annotation/düzenleme editörünün spesifikasyonu. Veri modeli `13-data-contracts.md §9` (`EditorDocument`, `Annotation`, `AnnotationStyle`, `EditorExport`), sayfa yerleşimi `10-ui-ux.md §4`, export pipeline `04-export-and-files.md`. Gereksinim ID önek: `REQ-EDT-*`. Öncelik: **P1** (temel araçlar + gizlilik araçları), layers/sticker/eyedropper/arbitrary rotate **P2**.

İçindekiler: 1 Amaç & ilkeler · 2 Mimari (Fabric.js v6) · 3 Büyük görüntü render stratejisi · 4 Araçlar (temel) · 5 Gizlilik araçları · 6 Crop / Resize / Rotate · 7 Stil paneli · 8 Seçim, taşıma, çoğaltma, copy/paste · 9 Undo/Redo & komut yığını · 10 Zoom/Pan · 11 Layers paneli · 12 Klavye kısayolları · 13 Kaydetme & autosave · 14 Export · 15 Erişilebilirlik · 16 Performans · 17 Test kancaları · 18 Kabul kriterleri

---

## 1. Amaç & İlkeler

1. **Hızlı ve hafif:** Editör result sayfasının bir paneli olarak açılır; ilk etkileşim < 300 ms (Fabric chunk lazy-load, capture görüntüsü zaten bellekte).
2. **Non-destructive varsayılan:** Annotation'lar ayrı katman; base görüntü yalnızca **redaction commit** ve **resize commit** ile değişir.
3. **Gizlilik garantisi:** Blur/pixelate "görsel"dir ve geri alınabilir; *kalıcı redaction* piksel verisini yok eder. UI bunu açıkça ayırır (`REQ-EDT-050`).
4. **Klavyeyle tam kullanım** ve ekran okuyucu uyumu.
5. **Çok büyük görüntüler** (30.000+ px) için takılmadan çalışma (viewport-render stratejisi, §3).

---

## 2. Mimari (Fabric.js v6)

### 2.1 Neden Fabric.js v6
- Nesne modeli (select/transform/group), `IText` ile yerinde metin düzenleme, yerleşik kontrol handle'ları, `toObject/fromObject` serileştirme, WebGL filtreleri (`Blur`, `Pixelate`), ESM + TypeScript. Konva alternatifi değerlendirildi; Fabric'in metin ve filtre desteği daha olgun. **Karar:** `fabric@6`.
- Editör kodu `src/editor/` altında sayfa-bağımsız; `pages/result` kullanır.

### 2.2 Modül yapısı
```
src/editor/
├─ EditorCore.ts          # Fabric canvas sahibi, tool dispatch, event bus
├─ document/              # EditorDocument ↔ Fabric objeleri dönüşümü (serializer.ts, migrations.ts)
├─ tools/                 # Tool arayüzü + her araç: SelectTool, ArrowTool, RectTool, EllipseTool, LineTool, PenTool, TextTool,
│                         #   HighlightTool, MarkerTool, EmojiTool, ImageTool, BlurTool, PixelateTool, RedactTool, CropTool
├─ objects/               # Fabric alt sınıfları: SsxArrow, SsxRect, SsxEllipse, SsxLine, SsxPath, SsxText, SsxHighlight,
│                         #   SsxMarker, SsxEmoji, SsxImage, SsxRegionEffect(blur|pixelate), SsxRedact, SsxCropOverlay
├─ history/               # CommandStack (undo/redo), komutlar
├─ render/                # BaseImageRenderer (tiled), viewport transform, zoom/pan
├─ panels/                # Preact: Toolbar, StylePanel, LayersPanel, ZoomBar, ColorPicker, EmojiPicker, FontPicker
├─ shortcuts.ts  clipboard.ts  autosave.ts  export.ts  a11y.ts
└─ index.ts               # createEditor(container, doc, deps)
```

### 2.3 Tool arayüzü
```ts
export interface Tool {
  id: ToolId;                                  // 'select' | AnnotationType
  cursor: string;
  onActivate(ctx: ToolContext): void;
  onDeactivate(): void;
  onPointerDown(e: ToolPointerEvent): void;    // canvas koordinatı (DevicePx), modifier'lar
  onPointerMove(e: ToolPointerEvent): void;
  onPointerUp(e: ToolPointerEvent): void;
  onKeyDown?(e: KeyboardEvent): boolean;       // true = tüketti
  defaultStyle(): Partial<AnnotationStyle>;
  stylePanelFields(): StyleField[];            // §7 — hangi kontroller görünür
}
export type ToolId = 'select' | AnnotationType;
```
- Her araç **bir komut** (`AddAnnotationCommand`) üretir; Fabric nesnesi `data.ssxId` ile `Annotation.id`'ye bağlanır.
- Sürükleme sırasında "geçici nesne" çizilir; `pointerup`'ta bbox `< 3 px` ise nesne oluşturulmaz (tıklama = bazı araçlarda varsayılan boyutlu nesne: text, marker, emoji).

### 2.4 Serileştirme
- `EditorDocument.layers: Annotation[]` tek doğruluk kaynağı; Fabric nesneleri bunun projeksiyonu. `serializer.toAnnotation(obj)` / `serializer.toFabric(ann)` çift yönlü, **unit testli**.
- Fabric `toObject()` doğrudan **saklanmaz** (kütüphane sürümüne bağımlı olmamak için). Migration: `EditorDocument.version` artırılır.
- Koordinatlar **canvas (DevicePx)**; `canvas.scale` UI ölçeği (13 §9'daki `canvas.scale`) zoom'u kaydeder.

---

## 3. Büyük Görüntü Render Stratejisi (`REQ-EDT-010`…`014`)

- **Viewport canvas:** Fabric `StaticCanvas`/`Canvas` boyutu = görünür panel boyutu (ör. 1600×900), asla görüntü boyutu değil. Fabric `viewportTransform` ile zoom/pan; nesneler görüntü koordinatında.
- **Base görüntü:** `BaseImageRenderer` Fabric `Image` nesnesi **kullanmaz**; `canvas.on('before:render')`'da alt katman olarak kendi `drawImage`'ını yapar:
  - Görüntü `≤ 16.384 px` kenar ve `≤ 268 M px` alan → tek `ImageBitmap`.
  - Aksi halde yükleme sırasında görüntü **4096×4096 tile**'lara bölünür (`createImageBitmap(blob, sx, sy, sw, sh)` ile kaynaktan kesit; `blob` decode edilebilir olmalı — strip'li sonuçlarda strip başına tile). Yalnızca viewport ile kesişen tile'lar çizilir; LRU cache (maks. ~512 MB; `tile.close()`).
  - Strip'li capture (`CaptureRecord.files[role='strip']`) editörde **tek sanal görüntü** olarak gösterilir (strip ofsetleri toplanır); export'ta tek görüntü sığmıyorsa yine strip'lenir (04 §3.4).
- **Zoom seviyeleri:** `fit`, %12.5–%800; `< %50`'de base için önceden üretilmiş mip seviyeleri (1/2, 1/4, 1/8 — offscreen'de `thumb.worker` üretir, IDB'ye yazılır) kullanılır; aliasing/yanıp sönme olmaz.
- Annotation'lar her zaman vektör olarak viewport dönüşümüyle çizilir; blur/pixelate bölgeleri §5.1.
- **Bellek bütçesi:** Editör toplam < 1 GB; 30.000×2.880 görüntüde (≈ 345 MB RGBA) tile cache ile < 600 MB.

---

## 4. Araçlar — Temel (`REQ-EDT-020`…`032`)

Ortak: tüm şekil araçları `Shift` = oran kilidi (kare/daire/45° açı), `Alt` = merkezden çiz, `Esc` = iptal/araçtan çık (Select'e döner), sürükleme bitince araç **Select'e dönmez** (aynı aracı tekrar kullanma; `Karar`), çift `Esc` → Select.

| Araç | Etkileşim | Handle'lar | Varsayılan stil | Stil paneli alanları | Kısıt/not |
|---|---|---|---|---|---|
| **Select (V)** | Tıkla seç, sürükle taşı, `Shift`+tık çoklu, boş alanda sürükle = kutu seçim | 8 resize + rotate handle (Fabric) | — | Seçili nesnenin alanları | Kilitli nesne seçilir ama düzenlenemez |
| **Arrow (A)** `type:'arrow'` | Başlangıçtan bitişe sürükle | `from`/`to` uç handle'ları (özel, 2 adet) + ortadan taşıma | stroke `#FF3B30`, strokeWidth 4, `arrowHead:'end'`, `arrowHeadSize:3×strokeWidth`, lineCap round | Renk, kalınlık (1–24), ok başı (end/start/both/none), çizgi stili (düz/kesik), gölge | `SsxArrow extends fabric.Group`? **Karar:** tek `fabric.Path` (gövde + baş) yeniden hesaplanır; hit-area gövde üzerinde ±6 px |
| **Rectangle (R)** `type:'rect'` | Sürükle | 8 + rotate | stroke `#FF3B30`, strokeWidth 3, fill `none`, cornerRadius 0 | Renk, kalınlık, dolgu (none/renk + opaklık), köşe yarıçapı (0–32), kesik çizgi, gölge | |
| **Ellipse (E)** `type:'ellipse'` | Sürükle (bbox) | 8 + rotate | Rect ile aynı | Renk, kalınlık, dolgu, kesik, gölge | |
| **Line (L)** `type:'line'` | Sürükle | 2 uç handle | stroke `#FF3B30`, 3, round | Renk, kalınlık, kesik, uç şekli (butt/round/square) | Arrow ile aynı sınıf, `arrowHead:'none'` |
| **Freehand pen (P)** `type:'freehand'` | Basılı tutup çiz; `points[]` toplanır, `smoothing` (0–1, varsayılan 0.5) ile Catmull-Rom/Bezier basitleştirme (Douglas-Peucker ε=1.5 px) | bbox 8 + rotate (nokta düzenleme yok) | stroke `#FF3B30`, 4, round/round | Renk, kalınlık (1–32), opaklık, yumuşatma | Pointer `pressure` varsa kalınlığa ×(0.5–1.5) uygulanır (opsiyonel, varsayılan kapalı) |
| **Text (T)** `type:'text'` | Tıkla → `IText` oluşur ve düzenleme başlar; sürükle → sabit genişlikli `Textbox` (`autoSize:false`, satır kaydırma) | 8 (IText'te yalnızca yatay genişlik) + rotate | fontFamily `Inter`, 24 px, 600, `#111111`, `textBackground:'none'`, `textAlign:'left'` | Font (liste), boyut (8–200), kalın/italik, hizalama, renk, arka plan (none/renk+opaklık), kontur (stroke 0–4 + renk), gölge | Boş metinle düzenleme bitince nesne silinir. `Enter` yeni satır, `Esc` düzenlemeyi bitirir, `Ctrl/Cmd+Enter` bitirir |
| **Highlight (H)** `type:'highlight'` | Sürükle (dikdörtgen) | 8 | fill `#FFEB3B`, opacity 0.4, stroke none, `globalCompositeOperation:'multiply'` | Renk (sarı/yeşil/pembe/mavi/özel), opaklık (0.1–0.8), köşe yarıçapı | Multiply blend ile metin okunur kalır |
| **Numbered marker (N)** `type:'marker'` | Tıkla → sayı rozeti; sürükle → rozet + ok ucu (P2) | taşıma + 4 köşe (ölçek) | shape `circle`, 32 px çap, fill `#FF3B30`, sayı beyaz 600 16 px | Şekil (daire/kare), renk, boyut (20–64), başlangıç sayısı, yazı rengi | **Auto-increment:** `number = max(existing)+1`; bir marker silinince diğerleri **yeniden numaralandırılmaz** (Karar); stil panelinde "Renumber" butonu sırayla (z-order) yeniden numaralandırır; sayı çift tıkla düzenlenebilir |
| **Emoji / sticker (M)** `type:'emoji'` | Araç seçilince picker açılır; tıkla → 64 px yerleştir; sürükle → boyut | 4 köşe (oran kilitli) + rotate | 64 px | Boyut, opaklık, yansıtma (yatay) | Emoji: Unicode, `Noto Color Emoji` bundled subset (P1: sistem emoji fontu; P2: bundled). Picker verisi `assets/emoji/emoji.json` (kategori, keyword, EN/TR arama). **Sticker seti** (P2): `assets/stickers/*.svg` (ok, onay, çarpı, yıldız, "NEW", "BUG", "TODO" rozetleri, el işaretleri) → `type:'image'` |
| **Image (I)** `type:'image'` | Dosya/pano'dan yapıştır | 4 köşe + rotate | — | Opaklık | `BlobRef` ile saklanır; max 10 MB |

- **Hit testing:** Fabric `perPixelTargetFind` sadece freehand/arrow için açık (`targetFindTolerance: 6`).
- **Snapping:** Taşırken diğer nesne kenarlarına ve canvas merkezine ±4 px snap (Alt basılıysa kapalı), P1.5.

---

## 5. Gizlilik Araçları (`REQ-EDT-040`…`056`)

### 5.1 Blur (B) `type:'blur'` ve Pixelate (X) `type:'pixelate'`
- Etkileşim: dikdörtgen sürükle; `rect` + `radiusPx` (blur, 4–64, varsayılan 16) / `blockPx` (pixelate, 4–64, varsayılan 12).
- **Canlı render:** `SsxRegionEffect` nesnesi `_render(ctx)` içinde **base görüntünün** ilgili bölgesini alır ve efekti uygular:
  - Blur: `tmp = OffscreenCanvas(rect)`; `tmp.ctx.filter = 'blur(Rpx)'`; bölgeyi `drawImage` (kenar artefaktı için rect'i her yönde `R` px genişletip sonra kırp); sonuç `ctx.drawImage(tmp, rect)`.
  - Pixelate: bölgeyi `rect/block` boyutuna `drawImage` ile küçült (`imageSmoothingEnabled=false`), sonra geri büyüt.
  - Sonuç bitmap **cache'lenir** (rect/param/zoom değişmediği sürece); taşıma sırasında 30 fps throttle ile yeniden hesaplanır.
  - Efekt yalnızca **base görüntüye** uygulanır; altındaki annotation'lar bulanmaz (Karar — basit ve öngörülebilir; "tüm katmanları bula" P2).
- Export'ta flatten sırasında aynı algoritma tam çözünürlükte uygulanır (§14).
- **Uyarı:** Stil panelinde kalıcı not: *"Bulanıklaştırma geri alınabilir ve bazı durumlarda tersine çevrilebilir. Hassas veriler için **Kalıcı karartma** kullanın."* (`REQ-EDT-045`). Export diyaloğunda blur/pixelate varsa aynı uyarı + "Redaction'a çevir" kısayolu.

### 5.2 Kalıcı redaction / blackout (K) `type:'redact'`
- Etkileşim: dikdörtgen sürükle (çoklu bölge tek seferde: `Shift` ile ekleme). Oluşturulan `redact` nesneleri önce **bekleyen (pending)** durumdadır: kırmızı çerçeveli, çapraz taralı siyah önizleme; taşınabilir/silinebilir, undo'ya tabidir.
- **Commit:** Toolbar'da "Apply redactions (N)" butonu veya `Ctrl/Cmd+Shift+K`. Onay modalı: *"N bölge kalıcı olarak karartılacak. Bu işlem geri alınamaz; orijinal pikseller bu kopyadan silinir."* + seçenek *"Orijinali history'de sakla"* (`Settings.history.keepOriginalsAfterEdit`, varsayılan açık → yeni history kaydı oluşturur, orijinal dokunulmaz kalır).
- **Commit semantiği (Karar):**
  1. Offscreen `offscreen.crop`/yeni `offscreen.redact` işlemi: base görüntü tile'ları okunur, her `redact.rect` **opak** `fillRect(color)` ile üzerine yazılır, yeni PNG encode edilir → yeni `BlobRef` (`EditorDocument.base` değişir). Eski base blob, `keepOriginalsAfterEdit` kapalıysa silinir; açıksa orijinal `CaptureRecord` aynen kalır ve düzenleme **yeni kayıt** üzerinde ilerler (`history.update` değil `history.put` clone).
  2. `redact` annotation'ları `layers`'tan kaldırılır (artık piksel veride). `CommandStack` **tamamen temizlenir** (undo/redo yığını sıfırlanır) — commit sonrası geri alma yoktur (`REQ-EDT-052`). Modal bunu söyler.
  3. Blur/pixelate cache'leri geçersiz kılınır.
- Commit yapılmadan export denenirse: modal *"Bekleyen N karartma var. Uygula ve dışa aktar / Uygulamadan (geçici olarak uygulanmış biçimde) dışa aktar / İptal"*. **Geçici biçimde** export'ta flatten yine opak doldurur (çıktı dosyası güvenlidir) ancak `EditorDocument` hâlâ orijinal base'i tutar; UI bunu açıkça belirtir.
- Redaction rengi: siyah varsayılan; stil panelinde renk (siyah/beyaz/özel) ve opsiyonel etiket metni ("REDACTED", beyaz 600) — etiket base'e **yazılır**.
- Export/kopya çıktılarında redaction alanı **her zaman** tam opak; alpha 1; JPEG'de kenar artefaktı kabul edilir (içerik kurtarılamaz).
- `REQ-EDT-055`: Thumbnail (history) commit sonrası yeniden üretilir; eski thumbnail silinir (sızıntı önlemi). OCR index'i varsa ilgili kayıt için yeniden üretilir veya silinir.

---

## 6. Crop / Resize / Rotate (`REQ-EDT-060`…`068`)

- **Crop (C):** Araç seçilince `SsxCropOverlay` (karartma + 8 handle'lı dikdörtgen + üçte bir ızgarası, boyut rozeti). Oran presetleri: serbest, 1:1, 4:3, 16:9, 3:2, 9:16, özel. `Enter`/"Apply" → `EditorDocument.canvas.cropRect` güncellenir (**non-destructive**): viewport kırpılan alanı gösterir, dışarıda kalan annotation'lar saklı kalır; Crop aracına tekrar girilince mevcut crop genişletilebilir ("Reset crop"). Export'ta cropRect uygulanır. Sayısal giriş (x, y, w, h) stil panelinde.
- **Resize:** "Resize image" diyaloğu (menü/kısayol `Ctrl/Cmd+Alt+I`): genişlik/yükseklik (px, %), oran kilidi, presetler (%50, %25, 1920 px genişlik, 1280, 800, özel), yeniden örnekleme `imageSmoothingQuality:'high'`. **Karar:** Resize **export-time** parametresidir (`EditorExport.scale` / `ImageEncodeOptions.maxWidthPx`); base değişmez, annotation koordinatları dokunulmaz. Kullanıcı "Apply to image" derse destructive commit (offscreen'de base yeniden örneklenir, tüm annotation koordinatları aynı oranla ölçeklenir, komut yığını temizlenmez — tek `ResizeCommand` undo edilebilir, çünkü eski base ref tutulur).
- **Rotate:** 90° adımlar (`Ctrl/Cmd+]`, `Ctrl/Cmd+[`) → `canvas.rotation` (0/90/180/270) non-destructive; annotation'lar beraber döner (görünüm dönüşümü). Yatay/dikey flip P2. Serbest açı (P2) export-time.
- Annotation'ların kendi rotate handle'ı (nesne bazlı) her zaman vardır (§4).

---

## 7. Stil Paneli (`REQ-EDT-070`…`076`)
- Seçili nesne(ler) veya aktif aracın varsayılanı düzenlenir. Çoklu seçimde ortak alanlar gösterilir, farklı değerler "—".
- **Renk seçici:** 12'lik palet (`#FF3B30 #FF9500 #FFCC00 #34C759 #00C7BE #007AFF #5856D6 #AF52DE #FF2D55 #111111 #FFFFFF #8E8E93`), "Recent" 8 renk (`storage.local.editor.recentColors`), hex/RGB girişi, opaklık kaydırıcı, **eyedropper** (P2: `EyeDropper` API varsa, yoksa canvas'tan örnekleme).
- **Kalınlık presetleri:** 1, 2, 3, 4, 6, 8, 12, 16 + slider (1–32); önizleme çizgisi.
- **Dolgu:** none / solid (renk+opaklık). Highlight için yalnızca renk+opaklık.
- **Ok başı:** end / start / both / none; boyut auto (3×) / S/M/L.
- **Font:** Inter, Roboto, Roboto Mono, Noto Sans, Georgia, Comic Neue (bundled woff2, `assets/fonts/`), sistem fontları (`system-ui`); boyut presetleri 12/16/20/24/32/48/64 + giriş; kalın/italik; hizalama; arka plan; kontur; gölge.
- **Araç varsayılanlarını hatırla:** Her araçta son kullanılan stil `storage.local.editor.toolDefaults[toolId]` — "Set as default" butonu ve "Reset".
- Panel `aria-live="polite"` ile değişiklikleri bildirir.

---

## 8. Seçim, Taşıma, Çoğaltma, Copy/Paste (`REQ-EDT-080`…`088`)
- Taşıma: sürükle; ok tuşları 1 px, `Shift+ok` 10 px. Boyutlandırma handle'lar; `Shift` oran, `Alt` merkez.
- Silme: `Delete`/`Backspace` (metin düzenleme modunda değilken).
- Çoğaltma: `Ctrl/Cmd+D` → +16 px ofsetle kopya; `Alt+sürükle` kopyalayarak taşır.
- Copy/Paste: `Ctrl/Cmd+C/V` — dahili pano (`clipboard.ts`, Annotation JSON) **ve** sistem panosuna `text/plain` olarak `ssx-annotations:<json>` yazılır; başka editör sekmesine yapıştırılabilir. Sistem panosunda görüntü varsa (`image/png`) `Ctrl/Cmd+V` → `type:'image'` annotation. Yapıştırma imleç konumuna (son pointer) ortalanır.
- Hizalama (çoklu seçim): sola/sağa/üste/alta/merkez, eşit dağıt (P2).
- Grup/ungroup (P2).
- Çoklu seçim üstünde stil değişikliği tümüne uygulanır (tek komut).

---

## 9. Undo / Redo & Komut Yığını (`REQ-EDT-090`…`094`)
```ts
interface Command { label: string; do(): void; undo(): void; merge?(next: Command): boolean; }
class CommandStack { push(c: Command): void; undo(): void; redo(): void; clear(): void; canUndo: boolean; canRedo: boolean; max = 200; }
```
- Komutlar: Add/Remove/Modify(Annotation patch)/Reorder/StyleChange/Crop/Rotate/Resize/Group. Sürükleme boyunca ara durumlar **tek** Modify komutuna `merge` edilir (pointerup'ta kapanır); stil slider'ları 300 ms debounce ile merge.
- Metin düzenleme: düzenleme oturumu tek komut.
- `Ctrl/Cmd+Z` / `Ctrl/Cmd+Shift+Z` (ve `Ctrl+Y` Windows). UI: toolbar undo/redo butonları tooltip'te komut etiketi ("Undo: Add arrow").
- Redaction commit → `clear()` (§5.2).
- Yığın yalnızca bellekte; sayfa yenilenince autosave'den belge gelir, yığın boş.

---

## 10. Zoom / Pan (`REQ-EDT-100`…`104`)
- Zoom: `Ctrl/Cmd + tekerlek` (imleç odaklı), `+`/`-`, `0` = fit, `1` = %100, `2` = %200; trackpad pinch (`wheel` + `ctrlKey`). Aralık %12.5–%800; kademeler 12.5/25/33/50/67/75/100/150/200/300/400/800.
- Pan: `Space`+sürükle, orta tuş, iki parmak kaydırma (wheel without ctrl), kaydırma çubukları (UI overlay). Görüntü panelden küçükse ortalanır.
- Minimap (P2) sağ altta, > 3× görüntü/panel oranında otomatik görünür.
- Zoom/pan durumu `EditorDocument.canvas.scale` + `viewportOffset` (session) — kayıt edilir.

---

## 11. Layers Paneli (`REQ-EDT-110`…`115`) — P2 (temel liste P1)
- Sağ tarafta daraltılabilir panel; her annotation bir satır: tür ikonu, ad (`name` ya da otomatik "Arrow 3"), görünürlük göz ikonu (`visible`), kilit (`locked`), sürükle-bırak sırala (z-order = dizi sırası), çift tık yeniden adlandır, sağ tık menü (çoğalt, sil, en öne/arkaya).
- Çoklu seçim paneli canvas ile senkron. Klavye: `Ctrl/Cmd+]`/`[` (bir öne/arkaya), `Ctrl/Cmd+Shift+]`/`[` (en öne/arkaya) — **Not:** rotate kısayoluyla çakışmaması için rotate `Ctrl/Cmd+Alt+]`/`[` olarak değiştirilmiştir (bkz. §12 tablosu; bu tablo esastır).
- Base görüntü panelde "Background" satırı (kilitli, silinemez).

---

## 12. Klavye Kısayolları (`REQ-EDT-120`)
| Kısayol | İşlev |
|---|---|
| `V` | Select |
| `A` | Arrow |
| `R` | Rectangle |
| `E` | Ellipse |
| `L` | Line |
| `P` | Freehand pen |
| `T` | Text |
| `H` | Highlight |
| `N` | Numbered marker |
| `M` | Emoji/sticker |
| `B` | Blur |
| `X` | Pixelate |
| `K` | Redact (pending) · `Ctrl/Cmd+Shift+K` Apply redactions |
| `C` | Crop · `Enter` apply · `Esc` cancel |
| `Ctrl/Cmd+Z` / `Ctrl/Cmd+Shift+Z` (`Ctrl+Y`) | Undo / Redo |
| `Delete` / `Backspace` | Sil |
| `Ctrl/Cmd+C` / `V` / `D` / `X` | Copy / Paste / Duplicate / Cut |
| `Ctrl/Cmd+A` | Tümünü seç |
| `Ctrl/Cmd+S` | Kaydet (history'ye) |
| `Ctrl/Cmd+E` | Export diyaloğu |
| `Ctrl/Cmd+Shift+C` | Panoya kopyala (flatten PNG) |
| `Space`+sürükle | Pan |
| `+` / `-` / `0` / `1` / `2` | Zoom in / out / fit / 100% / 200% |
| `Ctrl/Cmd+]` / `[` , `Ctrl/Cmd+Shift+]` / `[` | Bir öne/arkaya · En öne/arkaya |
| `Ctrl/Cmd+Alt+]` / `[` | Rotate 90° sağ / sol |
| `Ctrl/Cmd+Alt+I` | Resize diyaloğu |
| `Ctrl/Cmd+G` / `Ctrl/Cmd+Shift+G` | Group / Ungroup (P2) |
| `Shift+?` | Kısayol yardımı |
| Ok tuşları / `Shift+ok` | 1 px / 10 px taşı |
| `Esc` | İptal / düzenlemeyi bitir / Select'e dön |
- Kısayollar metin düzenleme sırasında devre dışı (IText `isEditing`). Mac'te `Cmd`, diğerlerinde `Ctrl`; UI platforma göre gösterir. Özelleştirme P2 (`Settings.editor.shortcuts`).

---

## 13. Kaydetme & Autosave (`REQ-EDT-130`…`135`)
- `autosave.ts`: her değişiklikte 2 s debounce (maks. 10 s'de bir zorunlu) → `EditorDocument` IDB `editorDocs` store'una (`captureId` anahtar) yazılır; blob'lar (image annotation) `blobs`'a. Sayfa kapanırken `pagehide`'da senkron son flush (`beforeunload` uyarısı yalnızca flush başarısızsa).
- "Save" (`Ctrl/Cmd+S`): flatten edilmiş PNG üretilir → `CaptureRecord.files` içine `role:'edited'` eklenir (önceki edited üzerine yazılır), thumbnail güncellenir, toast "Saved". `EditorDocument` da kalır (tekrar düzenlenebilir — non-destructive).
- **Save as new** (menü): `CaptureRecord` klonlanır (`recaptureOf` değil, `source.editedFrom: captureId` — 13'e eklenecek alan), yeni kayıt edited + doc ile; orijinal dokunulmaz. `keepOriginalsAfterEdit` açıkken ilk kayıt otomatik "save as new" davranır (Karar) ve UI "Orijinal korunuyor" rozetini gösterir.
- History'den "Open in editor": `editorDocs` varsa yüklenir, yoksa `full`/`strips` base ile yeni doc.
- Çakışma: aynı capture iki sekmede açıksa ikinci sekme "salt okunur" uyarısı (`BroadcastChannel('ssx-editor')` ile kilit, 5 s heartbeat).

---

## 14. Export (`REQ-EDT-140`…`146`)
- Export diyaloğu (result sayfasındaki export paneliyle aynı bileşen): format (`ExportFormat`), kalite, ölçek (`EditorExport.scale`: 0.25–2; %100 varsayılan; DevicePx/CSS seçimi), **annotation'ları dahil et** (kapalıysa yalnızca base + redaction), filename template, hedef (download/clipboard/PDF/integration).
- Flatten algoritması (offscreen `encode.worker` + editör render kodu paylaşımlı `lib/image/flatten.ts`): cropRect → rotation → base (tile'lar) → blur/pixelate bölgeleri (tam çözünürlük) → redact (pending dahil, opak) → annotation'lar z-order (Fabric `StaticCanvas` ile offscreen; > limit boyutlarda strip strip render, her strip için `viewportTransform` ofseti) → encode. Görüntü canvas limitlerini aşarsa 04 §3.4 strip kuralları.
- `export.run({captureId, plan, editedRef})`: editör flatten sonucunu `BlobRef` olarak verir, pipeline gerisini yapar (PDF, watermark, metadata, download).
- Panoya kopya: flatten PNG → result sayfası odaklı olduğundan `navigator.clipboard.write` doğrudan.
- Yazı tipleri flatten sırasında `document.fonts.load` ile garanti edilir (offscreen'de `FontFace` ile aynı woff2'ler yüklenir).

---

## 15. Erişilebilirlik (`REQ-EDT-150`…`155`)
- Tüm araçlar/paneller klavye ile erişilebilir; toolbar `role="toolbar"` + roving tabindex; araç butonları `aria-pressed`, tooltip + kısayol.
- Canvas `role="application"` + `aria-label`; seçili nesne değişince `aria-live` bölgesinde "Arrow 2 selected, 320×40 at 100,200". Klavyeyle nesne oluşturma: araç seç → `Enter` canvas merkezine varsayılan boyutta ekler → ok tuşları/`Shift` ile taşı/boyutlandır (`Alt+ok` boyut).
- Nesneler arası `Tab`/`Shift+Tab` gezinme (z-order).
- Renk seçici kontrast uyarısı yok (görsel işaretleme aracı); UI krom WCAG AA.
- Hareket azaltma: `prefers-reduced-motion` → panel animasyonları kapalı.

---

## 16. Performans (`REQ-EDT-160`…`164`)
| Metrik | Hedef |
|---|---|
| Editör açılış (Fabric chunk + doc yükleme, 2880×20.000 görüntü) | < 800 ms ilk çizim |
| Sürükleme/boyutlandırma, 200 annotation, 4K canvas | ≥ 60 fps (Fabric `renderOnAddRemove:false`, `requestRenderAll` birleştirme, `objectCaching:true`) |
| Blur bölge güncelleme (800×600, r=16) | < 16 ms cache'li, < 80 ms yeniden hesap |
| Undo/redo | < 50 ms |
| Autosave (200 annotation) | < 30 ms serileştirme, ana iş parçacığında jank yok |
| Flatten export 2880×20.000 PNG | < 6 s (offscreen) |
- `pointermove` olayları `requestAnimationFrame`'e birleştirilir; `getBoundingClientRect` çağrıları cache'lenir.

---

## 17. Test Kancaları (`REQ-EDT-170`)
- `window.__ssxEditor` (yalnızca `import.meta.env.DEV`/`e2e` build'lerinde): `getDocument()`, `runCommand(name, args)`, `selectIds([])`, `exportFlattened(opts): Promise<Blob>`.
- Unit: serializer round-trip (her AnnotationType), CommandStack merge, arrow path hesabı, Douglas-Peucker, blur/pixelate deterministik çıktı (sabit girdi → hash), flatten ile canlı render eşdeğerliği (pixelmatch < %0.5 fark).
- E2E (Playwright): araç kullanım akışları, kısayollar, redaction commit sonrası orijinal piksel kurtarılamazlığı (export PNG'de bölge tamamen tek renk), autosave/reload, büyük görüntü açma (30.000 px) bellek < 1 GB.

---

## 18. Kabul Kriterleri
| ID | Kriter |
|---|---|
| AC-EDT-01 | Her araç (§4) fare ve klavye ile nesne oluşturur; stil paneli alanları tabloya uygun; varsayılanlar doğru |
| AC-EDT-02 | Redaction commit sonrası export edilen PNG/JPEG/PDF'te bölge %100 opak tek renk; `EditorDocument.base` yeni ref; undo yığını boş; thumbnail güncel |
| AC-EDT-03 | Blur/pixelate bölgesi canlı güncellenir, export'ta aynı sonuç (pixelmatch < %1); panelde kalıcılık uyarısı görünür |
| AC-EDT-04 | Crop non-destructive: apply → export kırpılmış; crop'a tekrar girip reset → tam görüntü ve tüm annotation'lar yerinde |
| AC-EDT-05 | 200 ardışık komut undo/redo sırası bozulmadan geri/ileri alınır; sürükleme tek komut |
| AC-EDT-06 | Copy/paste: aynı sekme, başka editör sekmesi ve sistem panosundan görüntü yapıştırma çalışır |
| AC-EDT-07 | Kısayol tablosundaki (§12) tüm kombinasyonlar çalışır; metin düzenleme sırasında harf kısayolları tetiklenmez |
| AC-EDT-08 | 30.000×2.880 görüntü açılır, zoom/pan akıcı (≥ 45 fps), bellek < 1 GB |
| AC-EDT-09 | Autosave: düzenleme → 3 s bekle → sekme yenile → belge aynı |
| AC-EDT-10 | Marker'lar 1'den artar, silme yeniden numaralandırmaz, "Renumber" sıralı numaralandırır |
| AC-EDT-11 | Klavye-only kullanıcı: araç seç, nesne ekle, taşı, stil değiştir, kaydet, export (fare yok) |
| AC-EDT-12 | `keepOriginalsAfterEdit` açıkken ilk Save yeni history kaydı üretir, orijinal değişmez |
