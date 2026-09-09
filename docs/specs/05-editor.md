# 05 — Screenshot Editor

> Capture sonrası `result.html` içinde çalışan annotation/düzenleme editörünün spesifikasyonu. Veri modeli `13-data-contracts.md §9` (`EditorDocument`, `Annotation`, `AnnotationStyle`, `EditorExport`), sayfa yerleşimi `10-ui-ux.md §4`, export pipeline `04-export-and-files.md`. Gereksinim ID önek: `REQ-EDT-*`. Öncelik: **P1** (temel araçlar + gizlilik araçları), layers/sticker/eyedropper/arbitrary rotate **P2**.

> **Uygulama durumu (2026-09-09):** P1 editörü çalışır durumdadır ve bu doküman **kodda gerçekten olan** davranışı tarif eder. Uygulanan: select, arrow, rect, ellipse, line, freehand, text, highlight, blur, pixelate, redact araçları; renk/kalınlık paleti; undo/redo; `Delete`/`Backspace` ile silme; zoom kontrolleri (in/out/fit/1:1); tam çözünürlüklü flatten + `editor.save` ile klon kayıt. Uygulanmayan (P2 / planlanan): layers paneli, marker/emoji/image/crop/pan araçları, sticker, eyedropper, serbest açı rotate, crop/resize UI, autosave, pano (copy/paste), tile'lı base render, mip seviyeleri, kısayol tablosunun büyük kısmı, redaction commit akışı. Her bölüm kendi içinde **Uygulanan** ve **Planlanan (P2)** olarak işaretlenmiştir.

İçindekiler: 1 Amaç & ilkeler · 2 Mimari (Fabric.js v6) · 3 Büyük görüntü render stratejisi · 4 Araçlar (temel) · 5 Gizlilik araçları · 6 Crop / Resize / Rotate · 7 Stil paneli · 8 Etkileşim sözleşmesi: seçim, taşıma, çoğaltma, copy/paste · 9 Undo/Redo & komut yığını · 10 Zoom/Pan · 11 Layers paneli · 12 Klavye kısayolları · 13 Kaydetme & autosave · 14 Export & flatten · 15 Erişilebilirlik · 16 Performans · 17 Test kancaları · 18 Kabul kriterleri · 19 Bilinen boşluklar

---

## 1. Amaç & İlkeler

1. **Hızlı ve hafif:** Editör result sayfasının bir panelidir; Fabric chunk `src/editor/index.ts` üzerinden **lazy-load** edilir, capture görüntüsü result sayfasının zaten çözdüğü URL'den gelir. **Uygulandı.**
2. **Non-destructive:** Annotation'lar `EditorDocument.layers` içinde ayrı bir katmandır; base görüntü hiçbir araçla değiştirilmez. Kaydetme daima **yeni bir kayıt** üretir (`saveAsNew: true`), orijinal dokunulmadan kalır. **Uygulandı.**
3. **Gizlilik garantisi:** Blur/pixelate "görsel"dir ve geri alınabilir; redaksiyon opak siyah dikdörtgen olarak çizilir ve flatten çıktısına opak yazılır. UI bunu araç seçildiğinde kalıcı bir not satırıyla ayırır (`REQ-EDT-045`). **Uygulandı.** *Not:* "kalıcı redaction commit" (base pikselleri yeniden encode etme) **uygulanmadı** — bkz. §5.2.
4. **Klavyeyle tam kullanım** ve ekran okuyucu uyumu: toolbar `role="toolbar"`, araçlar `role="radio"` + `aria-checked` + `aria-label`. **Kısmen uygulandı** — canvas üzerinde klavyeyle nesne oluşturma/gezinme yoktur (§15).
5. **Çok büyük görüntüler** (30.000+ px) için takılmadan çalışma: canvas limitlerine sığdırma ve kullanılabilir bir açılış zoom'u ile. **Uygulandı** (§3), tile'lı render ile değil.

---

## 2. Mimari (Fabric.js v6)

### 2.1 Neden Fabric.js v6
- Nesne modeli (select/transform/group), `IText` ile yerinde metin düzenleme, yerleşik kontrol handle'ları, WebGL filtreleri (`filters.Blur`, `filters.Pixelate`), `PencilBrush`, ESM + TypeScript. **Karar:** `fabric@6`. **Uygulandı.**
- Editör kodu sayfa-bağımsızdır; yalnızca `pages/result` kullanır.

### 2.2 Modül yapısı (gerçek yerleşim)

Spec'in ilk sürümü `EditorCore.ts` + `tools/` + `objects/` + `history/` + `render/` + `panels/` şeklinde derin bir ağaç öngörüyordu. Gerçek yerleşim **çok daha düzdür** ve ikiye ayrılır:

```
src/editor/                     # Yalnızca tarayıcıda çalışan Fabric kodu (lazy chunk)
├─ index.ts                     # createEditor(): dinamik import ile editor-core'u yükler
├─ editor-core.ts               # Fabric Canvas sahibi; tool dispatch, olaylar, komutlar, export
└─ fabric-bridge.ts             # toFabricOptions(annotation) → Fabric option bag

src/lib/editor/                 # Saf mantık: DOM/Fabric yok, node'da unit-test edilir
├─ annotation.ts                # ANNOTATION_STROKE, defaultStyleFor(), createAnnotation()
├─ arrow.ts                     # arrowHeadGeometry(), angleDegrees()
├─ command-stack.ts             # Command arayüzü + CommandStack (undo/redo)
├─ document.ts                  # createDocument/addLayer/updateLayer/removeLayer/moveLayer/nextMarkerNumber
├─ geometry.ts                  # normalizeRect/constrainRect/padRect/scaledRect
├─ viewport.ts                  # fitCanvasToLimits/fitZoomToViewport/initialZoomFor/clampZoom + limit sabitleri
└─ flatten.ts                   # ⚠️ ÖLÜ KOD — bkz. §14.2

src/pages/result/editor-panel.tsx   # Preact UI: toolbar, palet, zoom, save/cancel, gizlilik notu
src/background/editor/service.ts    # editor.save / editor.load işleyicisi (klon kayıt, blob retain)
src/shared/types/editor.ts          # ToolId, AnnotationType, Annotation, EditorDocument, …
```

**Bölünmenin gerekçesi (Karar):** `src/lib/editor/*` içindeki her şey saf fonksiyondur; `vitest` altında tarayıcı olmadan çalışır ve `test/unit/editor-*.test.ts` ile birebir kapsanır. Fabric'e dokunan tek dosya `editor-core.ts`'tir; yalnızca tarayıcıda çalışabilir ve `index.ts`'teki `await import('./editor-core')` sayesinde result sayfasının ilk chunk'ına girmez. `fabric-bridge.ts` ikisi arasındaki tek çeviri noktasıdır ve kendi başına test edilir.

- `panels/` yoktur: UI tek dosyadır (`editor-panel.tsx`).
- `history/` yoktur: `CommandStack` `lib/editor/command-stack.ts` içindedir.
- `render/` yoktur: viewport matematiği `lib/editor/viewport.ts`, çizim doğrudan Fabric'in kendi render'ıdır.
- `document/serializer.ts` + `migrations.ts` yoktur: model → Fabric yönü `fabricFor()` + `toFabricOptions()`, Fabric → model yönü `object:modified` / `text:editing:exited` olay işleyicileridir. **Ters yön (Fabric → Annotation) genel bir serializer değildir**, yalnızca taşıma/boyutlandırma ve metin için yazılmıştır (§19).

### 2.3 Tool dispatch (Tool arayüzü **yoktur**)

Spec'in öngördüğü `interface Tool { onPointerDown… }` ve araç başına sınıf **uygulanmadı**. Gerçekte:

```ts
// src/shared/types/editor.ts
export type ToolId = 'select' | 'arrow' | 'rect' | 'ellipse' | 'line' | 'freehand' | 'text'
  | 'highlight' | 'marker' | 'emoji' | 'image' | 'blur' | 'pixelate' | 'redact' | 'crop' | 'pan';
export type AnnotationType = Exclude<ToolId, 'select' | 'pan'>;
```

- Aktif araç `editor-core.ts` içinde tek bir `let tool: ToolId` değişkenidir; `api.setTool(next)` ile değişir.
- Çizilebilir araçlar tek bir kümede tanımlıdır:
  ```ts
  const drawableTools = new Set<AnnotationType>(['rect', 'ellipse', 'line', 'arrow', 'highlight',
    'blur', 'pixelate', 'redact', 'text', 'freehand', 'marker']);
  ```
- Pointer akışı üç canvas olayıyla yürür ve araca göre **dallanmaz**, tek bir ortak yol izler:
  1. `mouse:down` → `origin` kaydedilir (`select`/`pan`/`freehand` hariç).
  2. `mouse:move` → `normalizeRect(origin, pointer)` + `constrainRect(…, { lockAspect: shiftKey, fromCenter: altKey })` ile geçici bir **önizleme nesnesi** çizilir (§4.3).
  3. `mouse:up` → aynı rect ile `createAnnotation(tool, rect, …)` çağrılır, sonuç `commitAnnotation()` ile hem canvas'a hem `doc.layers`'a **tek undo adımı** olarak eklenir.
- Nesne tipine göre ayrışma yalnızca **tek bir `switch` benzeri if zinciri** olan `fabricFor(annotation)` içindedir:

  | `annotation.type` | Üretilen Fabric nesnesi |
  |---|---|
  | `rect` (ve tanınmayan her tip) | `Rect(options)` |
  | `ellipse` | `Ellipse({ …options, rx: w/2, ry: h/2 })` |
  | `arrow` | `arrowObject()` → `Group([Line, Triangle])` (§4.2) |
  | `line` | `Line([from.x, from.y, to.x, to.y], options)` |
  | `text` | `IText(text \|\| ' ', { fontSize, fontFamily, fill })` |
  | `redact` | `Rect({ …options, fill: annotation.color, opacity: 1 })` |
  | `blur` / `pixelate` | `effectObject()` → filtreli `FabricImage` (§5.1) |
  | `highlight` | `Rect({ stroke: '', opacity: 0.35, globalCompositeOperation: 'multiply' })` |

- `freehand` bu yoldan **geçmez**: `setTool('freehand')` `canvas.isDrawingMode = true` yapar ve yeni bir `PencilBrush` kurar; Fabric'in ürettiği `Path`, `path:created` olayında yakalanıp bir freehand katmanı olarak sahiplenilir (§4.2).
- Fabric nesnesi ile model arasındaki bağ `object.ssxId === annotation.id`'dir; `layerFor(object)` bu id ile `doc.layers` içinde arar.
- `mouse:up`'ta minimum boyut kontrolü: `3 / canvas.getZoom()` sahne pikselinden küçük sürüklemeler nesne üretmez (`text` ve `marker` hariç — onlar tıklamayla da oluşabilir).

### 2.4 Serileştirme
- `EditorDocument.layers: Annotation[]` tek doğruluk kaynağıdır; Fabric nesneleri bunun projeksiyonudur. Fabric `toObject()` **saklanmaz**.
- `EditorDocument.version` sabit `1`'dir; henüz migration yoktur.
- Koordinatlar **sahne (görüntü) pikselidir**; zoom yalnızca `canvas.setZoom()` ile görünümü etkiler, model koordinatlarına dokunmaz.
- `EditorDocument.canvas.scale`, `viewportOffset`, `zoom`, `cropRect`, `rotation` alanları tip sözleşmesinde vardır ama editör bunları **yazmaz/okumaz** (§19).

---

## 3. Büyük Görüntü Render Stratejisi (`REQ-EDT-010`…`014`)

**Uygulanan yaklaşım (tile'sız):** Base görüntü tek bir Fabric `FabricImage`'tır ve `canvas.backgroundImage` olarak atanır. `StaticCanvas`, `before:render` hook'u, `BaseImageRenderer`, tile cache, LRU ve mip seviyeleri **uygulanmadı** (P2).

### 3.1 Canvas limitlerine sığdırma — `fitCanvasToLimits()`
```ts
export const CANVAS_MAX_SIDE = 16_384;      // Chromium'un kenar limiti
export const CANVAS_MAX_AREA = 268_435_456; // …ve toplam alan limiti
```
- Tam sayfa capture'lar rutin olarak `CANVAS_MAX_SIDE`'ı aşar (uzun bir makale kolayca 17.000 px'e ulaşır). Limiti aşan bir canvas **sessizce boş bir yüzey** döndürür, hata vermez.
- `fitCanvasToLimits(image, { maxSide, maxArea })` hem kenar hem alan kısıtını uygulayıp bir `zoom` döndürür; editör bu zoom'u üst sınır olarak kullanır.
- **Retina düzeltmesi (kritik):** Fabric backing store'u cihaz piksel oranıyla çarpar. Bu yüzden limitler `retina = canvas.getRetinaScaling()` ile bölünerek geçilir:
  ```ts
  const retina = canvas.getRetinaScaling() || 1;
  const fitted = fitCanvasToLimits(natural, { maxSide: CANVAS_MAX_SIDE / retina, maxArea: CANVAS_MAX_AREA / (retina * retina) });
  ```
  Bu olmadan DPR 2 olan makinelerde limit içinde görünen bir capture gerçekte iki katı bir backing store talep eder ve boş canvas'a düşer.

### 3.2 Açılış zoom'u — `initialZoomFor()`
- **Karar:** Tam sayfa capture **genişlikten** sığdırılır, yükseklikten değil.
- Gerekçe: 34.000 px yüksekliğindeki bir capture'ı yükseklikten sığdırmak ~%6'ya iner; bu ölçekte görüntü bir küçük resimdir ve 4 px'lik bir fırça bir cihaz pikselinden incedir — düzenlenemez.
- `initialZoomFor(image, viewport)` önce tümünü sığdırmayı dener (`fitZoomToViewport`); sonuç `MIN_WORKABLE_ZOOM = 0.25` altına düşerse yalnızca **genişliği** sığdıran zoom'a geçer, yükseklik sahnenin kaydırmasına taşar. Üst sınır her zaman `1`'dir (küçük bir capture büyütülmez).
- Uygulanan açılış: `Math.min(fitted.zoom, initialZoomFor(natural, viewport))`.
- `clampZoom(zoom, { minZoom: 0.05, maxZoom: 4 })` kullanıcı zoom'unu %5–%400 arasına kısar ve `NaN`'ı minimuma çevirir.

### 3.3 Base boyutunun kaynağı
- `EditorDocument.canvas.size` capture metadata'sından gelir ve pipeline yuvarlama/yeniden ölçekleme yaptığında dosyayla **uyuşmaz**. Bu yüzden gerçek boyut **decode edilen bitmap'ten** okunur (`baseImage.width/height`), metadata yalnızca yedektir. Aksi halde canvas bir boyutta kurulup görüntü başka boyutta çizilir ve görünür alan boş kalır.
- Sahne koordinatları görüntü pikselinde kaldığı için `baseImage.scaleX/scaleY` doğal boyuta göre ayarlanır.

### 3.4 Base görüntünün kaynağı (URL sözleşmesi)
- `EditorDeps.imageUrl` verilmişse editör onu kullanır ve **revoke etmez** (URL çağıranındır). Verilmemişse `resolveBlob(doc.base.ref)` ile kendi object URL'ini üretir ve `dispose()`'da revoke eder.
- Bu ayrım zorunludur: history kapalıyken capture'lar session store'da yaşar ve `resolveBlob` bunları okumayı reddeder. Result sayfası URL'i zaten çözdüğü için `imageUrl` olarak geçer.
- `FabricImage.fromURL` başarısız olursa (decode/boyut hatası) editör **açılmaz**; `EditorPanel` `data-testid="editor-load-error"` ile hatayı gösterir. Önceden boş ama kullanılabilir görünen bir canvas kalıyordu.

### 3.5 Strip'li capture — **Planlanan (P2)**
- Strip'li capture'ın editörde tek sanal görüntü olarak birleştirilmesi uygulanmadı. Editör, result sayfasının o an gösterdiği tek dosyayı açar.

---

## 4. Araçlar — Temel (`REQ-EDT-020`…`032`)

### 4.1 Araç envanteri

Toolbar'daki sıra `editor-panel.tsx`'teki `tools` dizisidir:

```ts
const tools: ToolId[] = ['select', 'arrow', 'rect', 'ellipse', 'line', 'freehand', 'text',
  'highlight', 'blur', 'pixelate', 'redact'];
```

| Araç | Durum | Etkileşim | Varsayılan stil (`defaultStyleFor`) | Stil kontrolleri |
|---|---|---|---|---|
| **Select** `↖` | ✅ Uygulandı | Tıkla seç, sürükle taşı, boyutlandırma handle'ları (Fabric), boş alanda kutu seçim (`canvas.selection = true`) | — | Devre dışı |
| **Arrow** `↗` `type:'arrow'` | ✅ Uygulandı | Başlangıçtan bitişe sürükle | stroke `#FF1493`, strokeWidth 4, `arrowHead:'end'`, `arrowHeadSize:12`, lineCap round | Renk, kalınlık |
| **Rectangle** `▭` `type:'rect'` | ✅ Uygulandı | Sürükle (`Shift` kare, `Alt` merkezden) | stroke `#FF1493`, strokeWidth 3, fill `none` | Renk, kalınlık |
| **Ellipse** `◯` `type:'ellipse'` | ✅ Uygulandı | Sürükle (bbox → `rx/ry`) | Rect ile aynı | Renk, kalınlık |
| **Line** `╱` `type:'line'` | ✅ Uygulandı | Sürükle | stroke `#FF1493`, 3, round, `arrowHead:'none'` | Renk, kalınlık |
| **Freehand** `✎` `type:'freehand'` | ✅ Uygulandı | Basılı tutup çiz (Fabric `PencilBrush`) | stroke `#FF1493`, 4, round | Renk, kalınlık (fırçaya doğrudan yazılır) |
| **Text** `T` `type:'text'` | ✅ Uygulandı | Sürükle → `IText` oluşur ve **düzenleme başlar** (`enterEditing` + `selectAll`) | `#111111`, `Inter`, 24 px, 600 | Renk, "kalınlık" → `fontSizePx = max(12, strokeWidth × 6)` |
| **Highlight** `▤` `type:'highlight'` | ✅ Uygulandı | Sürükle | fill `#FFEB3B` | Renk (fill'e uygulanır) |
| **Blur** `◌` `type:'blur'` | ✅ Uygulandı | Sürükle | `radiusPx: 16` | **Yok** (kasıtlı) |
| **Pixelate** `▓` `type:'pixelate'` | ✅ Uygulandı | Sürükle | `blockPx: 12` | **Yok** (kasıtlı) |
| **Redact** `■` `type:'redact'` | ✅ Uygulandı | Sürükle | `color: '#000000'`, opacity 1 | **Yok** (kasıtlı) |
| **Marker** `①` `type:'marker'` | ⚠️ Kısmî — **toolbar'da yok** | `drawableTools` içinde ve `nextMarkerNumber()` çalışır, ancak `tools` dizisinde olmadığı için UI'dan seçilemez; `fabricFor()` de marker için özel bir nesne üretmez (düz `Rect`'e düşer) | fill `#FF1493`, 16 px | — |
| **Emoji / sticker** `☺` `type:'emoji'` | ❌ Planlanan (P2) | Tip ve varsayılan stil tanımlı; picker, `fabricFor()` dalı ve toolbar girişi yok | — | — |
| **Image** `❑` `type:'image'` | ❌ Planlanan (P2) | Tip tanımlı; dosya/pano yolu yok | — | — |
| **Crop** `⌗` `type:'crop'` | ❌ Planlanan (P2) | Bkz. §6 | — | — |
| **Pan** `✚` | ❌ Planlanan (P2) | `ToolId` içinde ve pointer akışında dışlanıyor, ama toolbar'da yok ve pan davranışı yazılmadı | — | — |

- `toolGlyphs` haritası 16 `ToolId`'nin hepsi için glif tanımlar; bu, `tools` dizisi genişlediğinde UI'ın hazır olması içindir — **glif varlığı aracın çalıştığı anlamına gelmez.**
- Erişilebilir ad `chrome.i18n` üzerinden gelir. `_locales/*/messages.json` yalnızca toolbar'daki 11 araç için `ui_editor_tool_*` anahtarı içerir; marker/emoji/image/crop/pan için çeviri **yoktur** — envanterin bağımsız bir doğrulaması.
- **Hit testing:** `perPixelTargetFind` / `targetFindTolerance` ayarlanmadı; Fabric varsayılanı geçerlidir.
- **Snapping:** Uygulanmadı (P2).
- Sürükleme bitince araç Select'e **dönmez**; aynı araçla ardışık çizim yapılabilir (Karar korundu).

### 4.2 Özel nesne inşası

**Arrow — `Group([Line, Triangle])`.** Fabric'in ok primitifi yoktur. Geometri `src/lib/editor/arrow.ts` içindedir ve node'da unit-test edilir:
- `arrowHeadGeometry(from, to, size)` üçgenin üç köşesini ve **kısaltılmış gövde ucunu** (`shaftEnd`) döndürür; gövde başın içine girip taşmasın diye kısaltılır. Baş uzunluğu asla okun kendisinden uzun olmaz ve sıfır uzunlukta sürüklemede `NaN` üretmez (yön yoksa sağa bakar).
- `headSize = max(style.arrowHeadSize ?? 12, strokeWidth × 3)`.
- Baş bir `Triangle`'dır, `Polygon` değil: **Karar** — `Polygon` noktalarını kendi orijinine yeniden tabanlar, dolayısıyla mutlak koordinatlar yanlış yere düşer. `Triangle` merkezinden döndürülür; tepesi `-Y`'ye baktığı için `angleDegrees(from, to) + 90` uygulanır.
- Gövde ve baş bir `Group` içine alınır; ok taşınınca baş gövdeye kaynaklı kalır.
- Spec'in eski "tek `fabric.Path`" kararı **uygulanmadı**; geçerli karar `Group`'tur.

**Freehand — `PencilBrush` + `path:created`.**
- `setTool('freehand')` → `canvas.isDrawingMode = true`, yeni `PencilBrush` (renk ve kalınlık toolbar stilinden).
- Fabric strokes'u kendi `Path` nesnesi olarak ekler. `path:created` içinde: path'in bounding rect'inden bir `freehand` annotation üretilir, `path.ssxId` bağlanır, Fabric'in eklediği path **kaldırılıp** komut yığını üzerinden yeniden eklenir — böylece stroke da diğer annotation'lar gibi undo edilebilir ve kaydedilir.
- `mouse:down/move/up` yolları freehand için erken çıkar; aksi halde her stroke ayrıca bir dikdörtgen bırakırdı.
- **Bilinen sınır:** Modelde `points` yalnızca **iki nokta** (bbox köşeleri) tutar; gerçek eğri sadece Fabric `Path` nesnesinde yaşar. Douglas-Peucker basitleştirme, `smoothing` uygulaması ve basınç duyarlılığı **uygulanmadı** (§19).

**Text — `IText`.**
- Oluşturulduğu anda `selectable`/`evented` geçici olarak açılır, `setActiveObject` + `enterEditing()` + `selectAll()` çağrılır; aksi halde imleç hiç görünmez ve kutuya yazılamaz.
- `text:editing:exited` olayında yazılan metin `updateLayer(doc, id, { text })` ile modele yazılır. Boş bırakılan kutu **silinir** (görünmez ama tıklanabilir bir nesne bırakmamak için).

### 4.3 Canlı önizleme (`REQ-EDT-030`)
- `mouse:move` sırasında geçici bir nesne çizilir ve bırakışta gerçek annotation ile **değiştirilir**. Önizleme nesnesi `selectable: false, evented: false, excludeFromExport: true` taşır ve `mouse:up`'ta `clearPreview()` ile kaldırılır.
- Önizleme normalde `fabricFor(draft)` ile gerçek görünümü kullanır.
- **İstisna — blur/pixelate:** Her pointer hareketinde bölgeyi yeniden kesip filtrelemek çok pahalıdır. Bu iki araç, kaplayacakları alanı **yarı saydam bir dolgu** olarak önizler (`fill: '#1b2a41'`, `opacity: 0.45`, kesikli beyaz çerçeve). Boş bir kontur önizlemesi sonucun hiçbirini göstermiyordu.

---

## 5. Gizlilik Araçları (`REQ-EDT-040`…`056`)

### 5.1 Blur `type:'blur'` ve Pixelate `type:'pixelate'` — ✅ Uygulandı

**Uygulanan algoritma (`regionPatch` + `effectObject`):**
1. `regionPatch(rect)` capture'ın o dikdörtgen altındaki piksellerini **kendi `<canvas>`'ına** kopyalar. Annotation rect'i sahne koordinatındadır; kaynak bitmap farklı boyutta olabileceği için kırpma `scaleX = sourceWidth / natural.width` ile kaynağın piksel uzayına çevrilir — yoksa efekt kullanıcının sürüklediği yerden başka bir yere düşer.
2. Bu patch bir `FabricImage` olur; `filters` dizisine `filters.Blur` veya `filters.Pixelate` konur ve `applyFilters()` çağrılır.
3. Patch canvas'ı tam olarak bölge boyutunda olduğu için nesne `scaleX/scaleY = 1` ile konumlandırılır; `objectCaching: false`.

**Neden bölge kopyalanıyor (Karar — kritik):**
- Fabric'in `applyFilters()`'ı `cropX`/`cropY`'yi **yok sayar** ve kaynağın tamamını işler. Paylaşılan base görüntüyü filtrelemek, küçük bir bölge için **tüm tam sayfa capture'ı** işlemek demektir — yavaş.
- Dahası Fabric'in blur'u kaynak genişliğine göre ölçeklenir, yani blur şiddeti **capture boyutuna bağlı** hale gelir. Bölgeyi önce dışarı kopyalamak hem maliyeti hem şiddeti yalnızca bölgeye bağlar.
- Bu yüzden filtre parametreleri de bölgeye göre normalize edilir: blur `blur: min(1, radiusPx / 100)` (Fabric blur'u piksel yarıçapı değil, oran ister), pixelate `blocksize: max(2, round(blockPx))`.

**Taşıma sırasında yeniden kesme (`refreshEffect`) — gizlilik açısından zorunlu:**
- Efekt bölgesi, üzerinde oluşturulduğu piksellerin bir **anlık görüntüsüdür**. Taşınınca/boyutlandırılınca bu pikseller yanına taşınırsa, hem gizlemesi gereken içerik başka bir yerde ortaya çıkar hem de altında kalan yeni içerik açıkta kalır.
- Bu yüzden `object:modified` içinde blur/pixelate katmanları yeni konumlarından **yeniden kesilir**, filtre yeniden uygulanır. Undo yolunda da aynı yeniden kesme yapılır.

**Kapsam:** Efekt yalnızca **base görüntüye** uygulanır; altındaki diğer annotation'lar bulanmaz (Karar korundu — basit ve öngörülebilir).

**Uyarı (`REQ-EDT-045`) — ✅ Uygulandı:** Blur veya pixelate seçildiğinde toolbar altındaki kalıcı not satırı (`data-testid="editor-privacy-note"`, `.warn`) `ui.editor.blurWarning` metnini gösterir: *"Bulanıklaştırma geri alınabilir. Hassas veriler için Karart aracını kullanın."* Redact seçildiğinde `ui.editor.redactWarning`. Başka bir araç seçiliyken satır `ui.editor.keepOriginal` ile orijinalin korunduğunu söyler. Export diyaloğundaki uyarı ve "Redaction'a çevir" kısayolu **uygulanmadı** (P2).

**Önizleme:** §4.3 — yarı saydam dolgu, gerçek efekt değil.

### 5.2 Redaction / blackout `type:'redact'` — ✅ Kısmen uygulandı

**Uygulanan:**
- Dikdörtgen sürükle → opak siyah `Rect` (`fill: annotation.color`, `opacity: 1`). Stil kontrolleri bu araç için **kasıtlı olarak devre dışıdır**: görünümü bir tercih değil, garantinin kendisidir.
- Redaksiyon flatten çıktısına opak olarak yazılır: `toDataUrl()` canvas'ı olduğu gibi render ettiği için kaydedilen PNG'de bölge tek düze siyahtır (§14.1, e2e ile doğrulanır).
- Kaydetme daima yeni bir kayıt ürettiği için orijinal capture dosyası **değişmeden kalır**.

**Uygulanmayan (P2 / planlanan):**
- "Pending" durumu (kırmızı çerçeveli çapraz taralı önizleme) yoktur; redaksiyon çizilir çizilmez son görünümündedir.
- **Commit akışı yoktur:** "Apply redactions (N)" butonu, onay modalı, base görüntünün yeniden encode edilmesi, `EditorDocument.base` değişimi, komut yığınının temizlenmesi ve `keepOriginalsAfterEdit` ayarı **uygulanmadı**.
- Commit edilmeden export denemesinde çıkan modal yoktur.
- Redaksiyon rengi seçimi ve etiket metni ("REDACTED") yoktur.
- `REQ-EDT-055` (commit sonrası thumbnail yeniden üretimi, eski thumbnail silinmesi, OCR index tazelenmesi) **uygulanmadı**. Kaydetme sırasında `makeThumbnail` bağımlılığı vardır ama üretim yapılandırmasında `undefined` döndürür ve klon orijinalin thumbnail'ini paylaşır (refCount `retain` ile).

> **Sonuç:** Bugünkü redaksiyon *çıktı düzeyinde* güvenlidir (kaydedilen görüntüde piksel kurtarılamaz), *belge düzeyinde* değildir (`EditorDocument` hâlâ orijinal base'i işaret eder ve düzenleme tekrar açılırsa redaksiyon bir katman olarak kaldırılabilir). Bu ayrım UI'da açıkça yazılıdır.

---

## 6. Crop / Resize / Rotate (`REQ-EDT-060`…`068`) — ❌ Planlanan (P2)

Bu bölümün tamamı **uygulanmadı**; hedef tasarım olarak korunur.

- **Crop:** `SsxCropOverlay`, oran presetleri, `EditorDocument.canvas.cropRect` yazımı ve export'ta uygulanması. Bugün `cropRect` tipte vardır ama hiçbir yerde yazılmaz veya okunmaz.
- **Resize:** "Resize image" diyaloğu ve export-time `EditorExport.scale`. Bugün `toDataUrl()` daima doğal çözünürlükte üretir; ölçek parametresi yoktur.
- **Rotate:** 90° adımlı `canvas.rotation` yoktur; `EditorDocument.canvas.rotation` her zaman `0` kalır. Serbest açı da yoktur.
- **Nesne bazlı rotate:** Fabric'in kendi rotate handle'ı select aracında **çalışır** ve açı `object:modified` üzerinden `rotationDeg` olarak modele yazılır. Bu, bölümdeki tek uygulanmış parçadır.

---

## 7. Stil Paneli (`REQ-EDT-070`…`076`)

**Uygulanan — `EditorStyle` yalnızca iki alandır:**
```ts
export interface EditorStyle { color: string; strokeWidth: number; }
```

- **Renk paleti (6 renk):** `#FF1493 #FF3B30 #FFCC00 #34C759 #0A84FF #111111`. Kısa tutulması bilinçlidir: toolbar'ın tek satıra sığması gerekir, her ek swatch Save'i ikinci satıra iter (e2e ile korunur).
- **Varsayılan çizgi rengi `ANNOTATION_STROKE = '#FF1493'`** (magenta). **Karar:** annotation'ın rastgele sayfa içeriği üzerinde okunur kalması gerekir; kırmızı, web'de yaygın kırmızı UI üzerinde kaybolur. Güçlü magenta sayfa kromunda ve fotoğrafta neredeyse hiç görülmez. (Spec'in eski `#FF3B30` varsayılanı değişmiştir; `#FF3B30` palette ikinci renk olarak durur.)
- **Kalınlık presetleri:** `[2, 4, 8, 14]`. Slider yoktur.
- **Stilin araçlara dağıtımı — `styleOverrideFor(type)`:**

  | Tip | Uygulanan alan |
  |---|---|
  | `highlight`, `marker` | `fill` ← renk |
  | `text` | `fill` ← renk, `fontSizePx` ← `max(12, strokeWidth × 6)` |
  | `redact`, `blur`, `pixelate` | **hiçbiri** (boş override) |
  | diğerleri (`rect`, `ellipse`, `line`, `arrow`, `freehand`) | `stroke` ← renk, `strokeWidth` ← kalınlık |

- **Neden redact/blur/pixelate stillenemez (Karar):** Redaksiyon opak siyah kalmak zorundadır; blur ve pixelate capture'ın kendi piksellerini gösterir, dolayısıyla bir renk veya kalınlığın üzerinde çalışacağı bir şey yoktur. UI'da bu araçlar seçiliyken swatch ve kalınlık butonları `disabled` olur (`unstyledTools = {select, blur, pixelate, redact}`) ve kalınlık önizleme çubuğu gri boyanır.
- **Seçime uygulama:** `setStyle()` yalnızca "bundan sonra çizilecekler" için değil, **seçili nesneler** için de çalışır; stil hem Fabric nesnesine hem `doc.layers`'a yazılır. `redact`/`blur`/`pixelate` katmanları bu döngüde atlanır.
- **Freehand fırçası:** `setStyle()` aktif `freeDrawingBrush`'un rengini ve genişliğini de günceller.

**Uygulanmayan (P2):** eyedropper, hex/RGB girişi, "Recent colors", opaklık kaydırıcısı, dolgu kontrolü, ok başı seçimi, kesik çizgi, gölge, köşe yarıçapı, font/hizalama/kalın-italik seçicileri, `toolDefaults` hatırlama ("Set as default"/"Reset"), `aria-live` stil bildirimi. `AnnotationStyle` tipinde bu alanların çoğu tanımlıdır ama UI'dan erişilemez.

---

## 8. Etkileşim Sözleşmesi: Seçim, Taşıma, Copy/Paste (`REQ-EDT-080`…`088`)

### 8.1 Çizim araçları mevcut annotation'ları hareketsizleştirir (**Karar — güncel**)

Bu, editörün en önemli etkileşim kuralıdır ve yakın zamanda değişmiştir:

```ts
// setTool(next) içinde
setObjectsInteractive(next === 'select');
```

- **Select aracı aktifken:** tüm kilitlenmemiş annotation'lar `selectable = true, evented = true`'dur; tıklanır, taşınır, boyutlandırılır.
- **Herhangi bir çizim aracı aktifken:** tüm annotation'lar `selectable = false, evented = false` yapılır ve aktif seçim bırakılır. Böylece **mevcut bir şeklin üzerine yeni şekil çizilebilir.**
- **Neden:** Önceki yaklaşım tersine işliyordu — basış bir nesnenin üzerine denk gelirse çizim bastırılıyordu. Sonuç: daha önce annotation konmuş her alan **çizilemez** hale geliyordu. Taşımak select aracının işidir.
- **Kilitli katmanlar** her iki durumda da hareketsiz kalır: kararı araç değil, model (`layer.locked`) verir.
- Yeni bir annotation eklendiğinde (`commitAnnotation`, `path:created`) `setObjectsInteractive(tool === 'select')` yeniden çağrılır, böylece yeni nesne de o anki araca uygun durumda doğar.
- **İstisna — Text:** Metin kutusu oluşturulduğu anda düzenlenebilmesi için `selectable`/`evented` değerleri o nesne için geçici olarak açılır (§4.2).

### 8.2 Uygulanan diğer davranışlar
- Taşıma/boyutlandırma: Fabric'in kendi handle'ları (select aracıyla). Sonuç `object:modified` içinde `scaledRect()` ile okunur ve modele yazılır — Fabric bir yeniden boyutlandırmayı `width/height` yerine `scaleX/scaleY`'de tutar, dolayısıyla ham `width` okumak nesnenin **oluşturulduğu** boyutu verirdi.
- Arrow ve line taşınırken bbox değil **uç noktalar** taşınır: `from`/`to` deltayla kaydırılır.
- Silme: `Delete` / `Backspace`. Dinleyici `canvasElement.ownerDocument` üzerindedir ve `dispose()`'da kaldırılır. Metin düzenlenirken (`IText.isEditing`) tuşlar metne aittir, silme çalışmaz. Çoklu seçimde `getActiveObjects()`'in tamamı silinir (her biri ayrı bir undo adımı).
- `Shift` (oran kilidi) ve `Alt` (merkezden çiz) çizim sırasında `constrainRect()` üzerinden çalışır.

### 8.3 Uygulanmayan (P2)
Ok tuşlarıyla taşıma, `Ctrl/Cmd+D` çoğaltma, `Alt+sürükle` kopyalayarak taşıma, dahili/sistem panosu copy-paste, pano'dan görüntü yapıştırma, hizalama/dağıtma, grup/ungroup, `Ctrl/Cmd+A`.

---

## 9. Undo / Redo & Komut Yığını (`REQ-EDT-090`…`094`)

**Uygulanan — `src/lib/editor/command-stack.ts`:**
```ts
export interface Command { label: string; do(): void; undo(): void; merge?(next: Command): boolean; }
export class CommandStack {
  constructor(private readonly max = 200) {}
  get canUndo/canRedo/depth/undoLabel/redoLabel;
  push(c: Command): void;  // c.do() çalıştırır, redo dalını atar
  undo(): void; redo(): void; clear(): void;
}
```

- **Kayıtlı komutlar (yalnızca üç tür):**
  | Etiket | Nerede | Kapsam |
  |---|---|---|
  | `Add <type>` | `commitAnnotation()`, `path:created` | Nesneyi canvas'a ve `doc.layers`'a ekler/kaldırır |
  | `Move <type>` | `object:modified` | Rect + rotasyon (+ arrow/line uçları) günceller; blur/pixelate için yeniden kesme yapar |
  | `Delete <type>` | `deleteObject()` | Nesneyi ve katmanı kaldırır/geri koyar |
- Stil değişikliği, metin düzenlemesi ve sıra değişikliği için **komut yoktur** — bunlar doğrudan uygulanır ve geri alınamaz (§19).
- `push` yeni bir komut geldiğinde redo yığınını temizler; yığın `max = 200` derinlikte kırpılır.
- **`merge` kullanılmıyor:** Arayüzde tanımlı, `CommandStack` içinde çağrılıyor ve unit-test'i var, ancak `editor-core.ts`'teki hiçbir komut `merge` tanımlamıyor. Ayrıca **sıralaması ince bir şekilde yanlış**: `push()` önce `command.do()`'yu çalıştırıp sonra `previous.merge(command)` kontrolünü yapıyor; birleştirme kabul edilirse komutun etkisi zaten uygulanmış olur ve önceki komutun `undo()`'su bunu geri alamayabilir. Kullanılmadığı için bugün zararsızdır; sürükleme ara adımlarını birleştirmek gerektiğinde önce bu düzeltilmelidir.
- UI: toolbar'da undo/redo butonları (`↶`/`↷`). Buton etiketleri sabittir; `undoLabel`/`redoLabel` tooltip'e bağlanmamıştır. `Ctrl/Cmd+Z` kısayolu **yoktur**.
- Yığın yalnızca bellektedir; panel kapanınca kaybolur.

---

## 10. Zoom / Pan (`REQ-EDT-100`…`104`)

**Uygulanan:**
- Toolbar'da dört kontrol: **Uzaklaştır** (`zoom / 1.25`), yüzde göstergesi, **Yakınlaştır** (`zoom × 1.25`), **Sığdır** (`fitZoom()`), **1:1** (`setZoom(1)`).
- `applyZoom(zoom)` `clampZoom` ile %5–%400 arasına kısar, canvas boyutunu `natural × zoom` olarak yeniden kurar ve `canvas.setZoom()` çağırır. Sahne koordinatları görüntü pikselinde kalır.
- `fitZoom()` **açılış zoom'uyla birebir aynı hesabı** yapar (`min(fitted.zoom, initialZoomFor(...))`). **Karar:** Editörün açıldığı ölçekten farklı bir yere sıçrayan bir "Sığdır" kafa karıştırıcı olurdu ve uzun bir capture için kullanılamaz bir küçük resim verirdi.
- Görünür sahne boyutu panelden gelir: `EditorPanel` `.editor-stage`'in kutusunu ölçüp 40 px pay bırakarak `deps.viewport` olarak geçer.

**Uygulanmayan (P2):** `Ctrl/Cmd + tekerlek` ile imleç odaklı zoom, pinch, `+`/`-`/`0`/`1`/`2` kısayolları, `Space`+sürükle veya orta tuşla pan, minimap, zoom/pan durumunun belgeye kaydedilmesi. Yatay/dikey kaydırma tarayıcının `.editor-stage` overflow'una bırakılmıştır.

---

## 11. Layers Paneli (`REQ-EDT-110`…`115`) — ❌ Planlanan (P2)

**Uygulanmadı.** Panel, satır listesi, görünürlük/kilit ikonları, sürükle-bırak sıralama, yeniden adlandırma, sağ tık menüsü ve "Background" satırı yoktur.

Modeldeki altyapı **hazırdır**: `Annotation` üzerinde `visible`, `locked`, `name` alanları; `moveLayer(doc, id, toIndex)` z-order fonksiyonu (unit-test'li, henüz **çağrılmıyor**); `fabric-bridge` `locked → selectable/evented` çevirisini yapar ve `setObjectsInteractive()` kilidi gözetir. Eksik olan yalnızca UI ve bunu bir komuta bağlamaktır.

---

## 12. Klavye Kısayolları (`REQ-EDT-120`)

**Uygulanan — tamamı bu kadardır:**

| Kısayol | İşlev | Not |
|---|---|---|
| `Delete` / `Backspace` | Seçili annotation'ları sil | Metin düzenleme modunda devre dışı |
| `Esc` | Metin düzenlemesini bitir | Fabric `IText`'in kendi davranışı |
| `Tab` / `Shift+Tab` | Toolbar butonları arasında gezinme | Tarayıcı varsayılanı; canvas nesneleri arasında değil |

**Planlanan (P2) — aşağıdaki tablo hedeftir, bugün hiçbiri bağlı değildir:** araç harf kısayolları (`V A R E L P T H N M B X K C`), `Ctrl/Cmd+Z` / `Ctrl/Cmd+Shift+Z` / `Ctrl+Y`, `Ctrl/Cmd+C/V/D/X`, `Ctrl/Cmd+A`, `Ctrl/Cmd+S`, `Ctrl/Cmd+E`, `Ctrl/Cmd+Shift+C`, `Space`+sürükle, `+ - 0 1 2`, `Ctrl/Cmd+]`/`[` ve `Ctrl/Cmd+Shift+]`/`[` (z-order), `Ctrl/Cmd+Alt+]`/`[` (rotate 90°), `Ctrl/Cmd+Alt+I` (resize), `Ctrl/Cmd+G` / `Ctrl/Cmd+Shift+G`, `Shift+?`, ok tuşları / `Shift+ok`, `Ctrl/Cmd+Shift+K` (apply redactions).

Uygulandığında geçerli olacak kurallar korunur: kısayollar metin düzenleme sırasında (`IText.isEditing`) devre dışıdır; Mac'te `Cmd`, diğerlerinde `Ctrl`; özelleştirme (`Settings.editor.shortcuts`) P2.

---

## 13. Kaydetme & Autosave (`REQ-EDT-130`…`135`)

### 13.1 Kaydetme — ✅ Uygulandı

Akış:
```
[Kaydet] → handle.toDataUrl()  (tam çözünürlük PNG, §14.1)
        → sendMessage('editor.save', { captureId, doc, flattened, saveAsNew: true })
        → background/index.ts  case 'editor.save'
        → createEditorService().save()
        → result sayfası ?id=<yeni kayıt> ile yeniden yüklenir
```

`src/background/editor/service.ts` içinde `save()`:
1. `dataUrlToBlob(flattened.dataUrl)` → `putBlob()` → yeni `BlobRef`.
2. `role: 'edited'`, `format: 'png'` bir `CaptureFile` üretilir (`id: 'edited-<createId()>'`).
3. **`saveAsNew: true` (UI'ın gönderdiği tek değer):**
   - Kayıt `structuredClone` ile klonlanır, yeni `id`, yeni `createdAt`/`updatedAt`.
   - Klonun dosyaları: orijinalin `edited` **olmayan** dosyaları + yeni edited dosyası.
   - `source.editedFrom = record.id` yazılır — klonun hangi capture'dan türediğini bu alan söyler.
   - **Blob refCount:** Klon orijinalin blob'larını işaret ettiği için devralınan her dosya için `retain(file.ref)` çağrılır; yeni thumbnail üretilmediyse `retain(record.thumbnail)` da yapılır. Bu olmadan iki kayıttan birinin silinmesi diğerinin hâlâ ihtiyaç duyduğu pikselleri düşürürdü.
   - `history.put(clone)` + `saveDoc({ ...doc, captureId: cloneId })`.
4. **`saveAsNew: false` (servis destekler, UI kullanmaz):** `history.replaceFile()` ile edited dosyası aynı kaydın üzerine yazılır, thumbnail varsa güncellenir, belge aynı `captureId` altına kaydedilir.
5. `EditorDocument` her iki durumda da IDB `editorDocs` store'una yazılır (`captureId` anahtar).

**Result viewer'ın edited tercihi:** `resultFiles(record)` önce `role === 'edited'` dosyaları arar ve varsa **yalnızca onları** döndürür. Gerekçe: hem `edited` hem `full` strip index'i taşımaz, dolayısıyla sıralama ikisini berabere bırakıyordu ve düzenlenmemiş capture kazanıyordu — başarılı bir kaydetme hiçbir şey yapmamış gibi görünüyordu.

### 13.2 Belgenin yüklenmesi — ⚠️ Boşluk

`editor.load` mesajı tanımlı, background'da bağlı ve `editorService.load()` ile IDB'den okuyor; unit-test'i de var. **Ancak result sayfası bunu hiç çağırmıyor:** `main.tsx` editörü her açışta `createDocument({ captureId, base: { ref: currentFile.ref, size: record.size } })` ile **sıfırdan boş bir belge** kuruyor. Sonuç: bir capture'ı yeniden düzenlemek, kaydedilmiş katmanları geri getirmez; yalnızca (edited dosyası varsa) düzleştirilmiş görüntünün üzerine yeniden çizim yapılır. Spec'in "History'den 'Open in editor': `editorDocs` varsa yüklenir" maddesi **uygulanmamıştır**.

### 13.3 Autosave — ❌ Planlanan (P2)

`autosave.ts`, 2 s debounce, `pagehide` flush, `beforeunload` uyarısı ve `BroadcastChannel('ssx-editor')` sekme kilidi **uygulanmadı**. Panel kapanırsa kaydedilmemiş her şey kaybolur; "Vazgeç" butonu bunu onaysız yapar. `Settings.history.keepOriginalsAfterEdit` ayarı da yoktur — orijinalin korunması bir ayar değil, `saveAsNew: true` sabitinin sonucudur.

---

## 14. Export & Flatten (`REQ-EDT-140`…`146`)

### 14.1 Uygulanan export yolu — `EditorHandle.toDataUrl()`

Tek export yolu budur ve kaydetme sırasında çağrılır:

```ts
toDataUrl(): string   // PNG data URL, capture'ın doğal çözünürlüğünde
```

Uygulama, ekrandaki zoom'u dışarıda bırakmak için canvas'ı geçici olarak sıfırlar:
1. Mevcut `zoom`, `width`, `height` ve `viewportTransform` saklanır.
2. `setViewportTransform([1,0,0,1,0,0])` + `setDimensions(natural)` + `renderAll()`.
3. `canvas.toDataURL({ format: 'png', multiplier: 1 })`.
4. `finally` bloğunda boyut, transform ve zoom geri yüklenir.

**Neden saf `multiplier: 1/zoom` yaklaşımı başarısız oldu (Karar):** `applyZoom()` yalnızca `setZoom()` çağırmaz, aynı zamanda **canvas boyutunu da** `natural × zoom` olarak değiştirir. Fabric ise export'a o anki viewport dönüşümünü zaten pişirir. İki ölçekleme birbiriyle çakışıyor, annotation'lar çerçevenin dışına düşüyordu. Viewport'u sıfırlayıp canvas'ı doğal boyuta kurmak tek tutarlı çözümdür.

Bu yol tüm annotation'ları Fabric'in **canlı render'ıyla** düzleştirir; yani ekranda görülen ile kaydedilen aynı kod yolundan geçer. Önizleme nesneleri `excludeFromExport: true` taşıdığı için çıktıya girmez.

### 14.2 `src/lib/editor/flatten.ts` — ⚠️ ÖLÜ KOD (bilinen tutarsızlık)

`flatten.ts`, `FlattenContext` (2D context'in kullandığı alt kümesi) üzerine yazılmış bağımsız bir `drawAnnotations()` implementasyonudur. **Üretim kodunda hiçbir yerden import edilmez** — tek tüketicisi kendi unit-test'i olan `test/unit/editor-flatten.test.ts`'tir. Export gerçekte §14.1'deki Fabric yolundan geçer.

Daha da önemlisi, canlı render yolundan **birkaç noktada ayrışır**; bu yüzden "yedek export yolu" olarak da güvenilir değildir:

| Konu | `flatten.ts` | Canlı yol (`editor-core.ts`) |
|---|---|---|
| `blur` / `pixelate` | **Desteklenmez** — `default` dalına düşer ve hiçbir şey çizmez | `regionPatch` + Fabric filtresi |
| `highlight` | Düz `fillRect`, blend modu yok | `globalCompositeOperation: 'multiply'`, `opacity: 0.35` |
| Ok başı | `Math.PI / 7` açıklıkta elle çizilen üçgen | `arrowHeadGeometry()` + döndürülmüş Fabric `Triangle` |
| `freehand` | `points` dizisini birleştirir — model yalnızca **2 nokta** tuttuğu için **düz bir çizgi** çizer | Fabric `Path` (gerçek stroke) |
| `marker` | Rozet + numara çizer | `fabricFor()` marker dalı yok; düz `Rect`'e düşer |
| `text` | `fillText` ile tek satır | `IText` (çok satır, düzenlenebilir) |

**Karar (açık): bu tutarsızlık çözülmeli.** İki seçenek: (a) `flatten.ts` ve testi silinir, canlı Fabric render'ı tek doğruluk kaynağı kalır; (b) `flatten.ts` offscreen worker export'u için canlı yolla eşitlenir (blur/pixelate desteği, multiply blend, aynı ok geometrisi, freehand noktalarının modelde saklanması) ve aralarındaki eşdeğerlik pixelmatch ile test edilir. Karar verilene kadar `flatten.ts` **export pipeline'ı değildir** ve öyle belgelenmemelidir.

### 14.3 Uygulanmayan (P2)
Editör içinden export diyaloğu (`Ctrl/Cmd+E`), format/kalite/ölçek seçimi, `EditorExport.scale`, `includeAnnotations` anahtarı, cropRect/rotation uygulaması, canvas limitini aşan çıktılarda strip strip render, offscreen `encode.worker`, panoya flatten PNG kopyalama, `document.fonts.load` ile font garantisi. Editör çıktısı her zaman tek bir PNG'dir ve normal export pipeline'ı (`04-export-and-files.md`) kaydedilmiş `edited` dosyasını girdi olarak alır: `export/pipeline.ts` açıkça istenen bir strip index'i yoksa `role === 'edited'` dosyasını `full`/`strip`'e tercih eder.

---

## 15. Erişilebilirlik (`REQ-EDT-150`…`155`)

**Uygulanan:**
- Toolbar `role="toolbar"` + `aria-label`; hazır olana kadar `aria-busy="true"` ve `data-ready="false"`.
- Araç butonları `role="radio"` + `aria-checked` içinde bir `role="radiogroup"`; erişilebilir ad çevrilmiş `ui.editor.tool.*` metnidir, glif `aria-hidden="true"`.
- Renk ve kalınlık kontrolleri de `radiogroup`/`radio`; stillenemeyen araçlarda `disabled`.
- Zoom kontrolleri `role="group"` + `aria-label`, her buton çevrilmiş `aria-label` taşır.
- Gizlilik notu kalıcı bir metin satırıdır; kaydetme sonrası toast `role="status" aria-live="polite"`; yükleme hatası `role="alert"`.

**Uygulanmayan (P2):** canvas'a `role="application"` + `aria-label`, seçim değişiminde `aria-live` duyurusu ("Arrow 2 selected, 320×40 at 100,200"), klavyeyle nesne oluşturma/taşıma/boyutlandırma, nesneler arası `Tab` gezinme, roving tabindex, kısayol tooltip'leri, `prefers-reduced-motion` ele alımı.

---

## 16. Performans (`REQ-EDT-160`…`164`)

**Uygulanan optimizasyonlar:**
- `new Canvas(el, { renderOnAddRemove: false })` — toplu değişikliklerde her ekleme render tetiklemez; render `requestRenderAll()` ile birleştirilir.
- `preserveObjectStacking: true` — seçim z-order'ı bozmaz.
- Blur/pixelate bölge kopyalama (§5.1) maliyeti tüm capture yerine yalnızca bölgeye bağlar.
- Blur/pixelate önizlemesi gerçek efekt yerine yarı saydam dolgudur (§4.3).
- Canvas limit + retina sığdırması (§3.1) çok büyük capture'larda tahsis hatasını önler.
- Fabric chunk'ı lazy-load edilir; result sayfasının ilk yüklemesine girmez.

**Ölçülmüş hedef yoktur.** Aşağıdaki tablo **hedef** olarak korunur; bugün otomatik bir performans testi yoktur (e2e yalnızca çok büyük capture'ların açıldığını ve kullanılabilir bir zoom'a düştüğünü doğrular).

| Metrik | Hedef | Durum |
|---|---|---|
| Editör açılışı (2880×20.000) | < 800 ms ilk çizim | Ölçülmüyor |
| Sürükleme/boyutlandırma, 200 annotation | ≥ 60 fps | Ölçülmüyor |
| Blur bölge güncelleme (800×600) | < 80 ms yeniden hesap | Ölçülmüyor; cache yok, taşımada yeniden kesilir |
| Undo/redo | < 50 ms | Ölçülmüyor |
| Autosave | — | Autosave yok |
| Flatten export 2880×20.000 PNG | < 6 s | Ölçülmüyor; ana iş parçacığında `toDataURL` |

`objectCaching` blur/pixelate için kasıtlı olarak **kapalıdır** (filtreli patch her yeniden kesmede değişir). `pointermove` olayları `requestAnimationFrame`'e birleştirilmez; her hareket önizleme nesnesini yeniden kurar.

---

## 17. Test Kancaları (`REQ-EDT-170`)

**Uygulanan — `window.__ssxEditor` yoktur.** Bunun yerine `EditorPanel` DOM'a gizli test göstergeleri yazar; testler böylece boyanan pikseller yerine **kaydedilecek belge durumu** üzerinde de doğrulama yapabilir:

| Kanca | İçerik |
|---|---|
| `[data-testid="editor-toolbar"][data-ready="true"]` | Editör açıldı ve araçlar kullanılabilir |
| `[data-testid="editor-object-count"]` | `doc.layers.length` |
| `[data-testid="editor-doc-text"]` | Text katmanlarının metinleri, `\|` ile birleşik |
| `[data-testid="editor-doc-rect"]` | Her katmanın yuvarlanmış `x,y`'si, `\|` ile birleşik |
| `[data-testid="editor-privacy-note"]` | Aktif araca göre gizlilik metni (`.warn` sınıfı blur/pixelate/redact'te) |
| `[data-testid="editor-load-error"]` | Base görüntü yüklenemedi |
| `[data-testid="editor-zoom-value"]`, `editor-zoom-in/out/fit/actual` | Zoom durumu ve kontrolleri |
| `[data-testid="editor-save"]`, `editor-cancel`, `editor-style` | Commit ve stil bölgeleri |
| `[data-tool="<id>"]`, `[data-color="<hex>"]`, `[data-width="<n>"]` | Araç ve stil seçicileri (yerelleştirmeden bağımsız) |

**Unit testler (`test/unit/`, node + vitest):** `editor-annotation`, `editor-arrow`, `editor-command-stack`, `editor-document`, `editor-fabric-bridge`, `editor-geometry`, `editor-viewport`, `editor-panel`, `editor-service`, `editor-messages`, `editor-flatten` (ölü kodu test eder, §14.2).

**E2E (`test/e2e/editor.spec.ts`, Playwright + gerçek eklenti):** §18.

**Uygulanmayan:** `runCommand`/`selectIds`/`exportFlattened` kancaları, serializer round-trip testi, blur/pixelate determinizm hash'i, flatten ↔ canlı render pixelmatch eşdeğerliği, bellek bütçesi ölçümü.

---

## 18. Kabul Kriterleri

Aşağıdaki tablo **`test/e2e/editor.spec.ts`'in fiilen doğruladığı** davranışlardır. Testler capture fixture'larının renk bantları üzerinde ekran görüntüsü ve canvas piksel örneklemesiyle çalışır; belge durumu §17'deki gizli göstergelerden okunur.

| ID | Kriter | Doğrulama |
|---|---|---|
| AC-EDT-01 | `arrow, rect, ellipse, line, freehand, highlight, blur, pixelate, redact` araçlarının her biri sahnede **görünür bir değişiklik** üretir (≥ %0.2 piksel değişimi) | Araç başına parametreli e2e |
| AC-EDT-02 | Freehand **pointer'ı izler**, dikdörtgen çizmez: stroke'un kendi bbox'ı içinde sol bacak ve taban boyanır, L'nin hiç uğramadığı sağ üst köşe **boş kalır** | Magenta stroke rengi taranarak |
| AC-EDT-03 | Arrow'un **ucunda bir baş** vardır: en kalın dikey kesit, gövde kesitinin **2 katından fazladır** | Sütun sütun tarama |
| AC-EDT-04 | Blur ve pixelate altlarındaki capture piksellerini **gerçekten değiştirir** (boş kontur değil) | Efekt öncesi/sonrası karşılaştırma |
| AC-EDT-05 | Taşınan bir blur bölgesi **yeni konumundan yeniden kesilir**: yeni bandın rengiyle arasındaki fark < 60 (eski pikselleri taşımaz) | Canvas piksel örneklemesi |
| AC-EDT-06 | Blur/pixelate/highlight/redact **sürükleme sırasında bölgeyi doldurur**: bölgenin ortasındaki piksellerin > %50'si değişir | Basılı tutulan sürükleme |
| AC-EDT-07 | Şekil **pointer basılıyken görünür**: bırakmadan önce sahne ≥ %0.2 değişir | Rect ile |
| AC-EDT-08 | Bir çizim aracı aktifken mevcut annotation **taşınmaz**; aynı sürükleme select aracıyla **taşır** | `editor-doc-rect` karşılaştırması |
| AC-EDT-09 | Mevcut bir şeklin **üzerine** yeni şekil çizilebilir: dolu bir redact üzerine ok çizmek nesne sayısını 1 → 2 yapar | `editor-object-count` |
| AC-EDT-10 | Select ile bir annotation taşımak **ikinci bir nesne oluşturmaz** | `editor-object-count` sabit kalır |
| AC-EDT-11 | Seçili annotation `Delete` ile silinir (sayı 1 → 0) | Klavye |
| AC-EDT-12 | Text aracı **yazmayı kabul eder**; yazılan metin **belgeye** girer (`editor-doc-text === 'Gizli'`) | Klavye + gizli gösterge |
| AC-EDT-13 | Yazılmadan bırakılan **boş metin kutusu silinir** (sayı 0'a döner) | `Escape` sonrası |
| AC-EDT-14 | Annotation taşımak **belgeyi** günceller, yalnızca canvas'ı değil | `editor-doc-rect` değişir |
| AC-EDT-15 | Seçilen renk ve kalınlık **çizilene uygulanır**: mavi piksel > 0 ve varsayılan magenta **hiç çizilmez** | `#0A84FF` + genişlik 14 |
| AC-EDT-16 | Capture **sahneye sığmış olarak** açılır (canvas genişliği ≤ sahne genişliği); zoom-in yüzdeyi artırır, Sığdır açılış değerine döner, 1:1 tam %100 verir | Zoom kontrolleri |
| AC-EDT-17 | 34.000 px'lik bir tam sayfa capture **kullanılamaz bir küçük resim olarak açılmaz**: zoom ≥ %25 | `very-long.html` fixture |
| AC-EDT-18 | Capture editörde **gerçekten görünür** (sahne düz beyaz değil, beyaz payı < %0.6 ve ≥ 4 farklı renk) — `very-long.html @ DPR 1`, `long.html @ DPR 2`, `very-long.html @ DPR 2` | Retina/limit regresyonu |
| AC-EDT-19 | History **kapalıyken** (session store) alınan capture editörde açılır; yükleme hatası görünmez | `settings.set` + fixture |
| AC-EDT-20 | Kaydetme **yeni bir kayıt** üretir (URL'deki `id` değişir) ve viewer edited görüntüyü gösterir | Klon + `?id=` değişimi |
| AC-EDT-21 | Kaydedilen görüntü **annotation'ları içerir** (redaksiyondan gelen siyah piksel payı > %5) ve **doğal çözünürlüğü korur** (genişlik ≥ 1600) | `toDataUrl()` regresyonu |
| AC-EDT-22 | Blur/pixelate seçilince "geri alınabilir", redact seçilince "kalıcı" uyarısı görünür; metinler `chrome.i18n`'den çözülür (en/tr) | Gizlilik notu |
| AC-EDT-23 | Toolbar 1600×900'de **tek satıra** sığar (< 64 px), 1100×800'de kompakt kalır (< 100 px) ve sahne toolbar'ın en az 3 katı yükseklik alır | Yerleşim regresyonu |

**Hâlâ karşılanmayan eski kabul kriterleri** (ilgili özellik uygulanmadığı için): redaction commit sonrası base'in değişmesi ve undo yığınının temizlenmesi; crop non-destructive apply/reset; 200 ardışık komutun sürükleme başına tek komuta birleşmesi; copy/paste; kısayol tablosunun tamamı; bellek < 1 GB ölçümü; autosave sonrası yenilemede belgenin aynı gelmesi; marker numaralandırma ve "Renumber"; klavye-only tam akış.

---

## 19. Bilinen Boşluklar ve Tutarsızlıklar

Dürüstlük gereği tek yerde toplanmıştır; her biri bir sonraki iterasyonun girdisidir.

1. **`flatten.ts` ölü koddur** ve canlı render yolundan ayrışır (§14.2). Ya silinmeli ya da eşitlenip gerçekten kullanılmalıdır.
2. **Layers paneli yoktur** (§11). Model desteği hazır, `moveLayer()` hiç çağrılmıyor.
3. **Kısayol yoktur** — `Delete`/`Backspace` dışında (§12). `Ctrl/Cmd+Z` bile yok; undo yalnızca butonla.
4. **Autosave yoktur** (§13.3). Panel kapanınca kaydedilmemiş her şey kaybolur, üstelik "Vazgeç" onay istemez.
5. **`editor.load` çağrılmıyor** (§13.2). Kaydedilmiş `EditorDocument` diske yazılıyor ama editör onu asla geri yüklemiyor; her açılış boş bir belgeyle başlıyor.
6. **Pano yoktur** (§8.3): copy/paste/duplicate, sistem panosundan görüntü yapıştırma.
7. **Crop/resize/rotate UI yoktur** (§6). `canvas.cropRect`, `canvas.rotation`, `canvas.scale`, `viewportOffset`, `zoom` alanları tipte var ama editör hiçbirini yazmıyor.
8. **Marker, emoji, image, crop, pan araçları erişilemez** (§4.1). `marker` `drawableTools` içinde ve `nextMarkerNumber()` çalışıyor, ama toolbar'da yok ve `fabricFor()` bir marker rozeti üretmiyor — düz dikdörtgene düşüyor. `emoji`/`image` yalnızca tip düzeyinde var.
9. **`updateLayer` yalnızca iki yola bağlı:** taşıma/boyutlandırma (`object:modified`) ve metin (`text:editing:exited`) — bir de seçime stil uygulama. Görünürlük, kilit, ad, z-order, opaklık değişiklikleri modele hiç yazılmıyor çünkü onları değiştirecek UI yok.
10. **`CommandStack.merge` kullanılmıyor ve sırası ince biçimde yanlış** (§9): `push()` birleştirme kontrolünden **önce** `do()` çalıştırıyor. Sürükleme ara adımlarını birleştirmek gerektiğinde önce düzeltilmeli.
11. **Freehand modeli eğriyi kaybediyor** (§4.2): `points` yalnızca iki bbox köşesi tutuyor. Kaydedilen görüntü doğru (Fabric `Path` render ediliyor) ama belge, stroke'u yeniden üretmeye yetmiyor — ki bu, madde 5 çözüldüğünde ilk patlayacak yerdir.
12. **Stil ve metin değişiklikleri geri alınamaz** (§9): bunlar için komut üretilmiyor.
13. **Redaksiyon belge düzeyinde kalıcı değil** (§5.2): çıktı güvenli, `EditorDocument` hâlâ orijinal base'i işaret ediyor.
14. **Performans hedefleri ölçülmüyor** (§16); `toDataURL` ana iş parçacığında çalışıyor.
15. **Strip'li capture'lar editörde birleştirilmiyor** (§3.5): yalnızca o an görüntülenen tek dosya açılıyor.
