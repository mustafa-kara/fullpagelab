# 03 — Capture Engine

> Capture motorunun tüm modları, algoritmaları, kenar durumları ve kabul kriterleri. Tipler `13-data-contracts.md §3`, bileşen yerleşimi `02-architecture.md`. Gereksinim ID önek: `REQ-CAP-*`.

> **Uygulama durumu (2026-08-21):** Üretim arayüzünde çalışan modlar `fullPage` ve `visible`dır. Selection, element/selector, scroll container, iframe, infinite scroll ve all-tabs bölümleri gelecek milestone gereksinimleridir. Tam sayfa tetikleyicileri popup ve `page` bağlamındaki sağ tık eylemidir; varsayılan tam sayfa klavye kısayolu yoktur. Görünen alan için `Alt+Shift+V` aktiftir.

İçindekiler: 1 Genel akış · 2 Tetikleyiciler (popup/kısayol/context menu/timer) · 3 Visible · 4 Full page (scroll+stitch) · 5 Selection · 6 Fixed/sticky yönetimi · 7 Element / Selector / Scroll container · 8 Lazy-load · 9 iframe · 10 Çok uzun sayfalar & tiling · 11 Infinite scroll · 12 All tabs · 13 Progress/cancel/overlay · 14 DPR/zoom/RTL/diğer kenar durumları · 15 DebuggerBackend · 16 Restore garantisi · 17 Kabul kriterleri

---

## 1. Genel Akış (VisibleTabBackend)

```
[trigger] → validate(tab) → permissions → inject page-agent → scan → plan
  → prepare (+delay/countdown) → [loop: scrollTo → settle/wait → captureVisibleTab → tiles.put → progress]
  → restore → stitch (offscreen) → (postCrop) → thumbnail → history.put → export plan → UI
```

### 1.1 Ön doğrulama (`REQ-CAP-001`)
- Sekme URL'si `chrome://`, `chrome-extension://` (kendi sayfalarımız hariç), `edge://`, `about:`, `view-source:`, `https://chromewebstore.google.com/*`, `https://chrome.google.com/webstore/*` ise → `E_RESTRICTED_PAGE` (kullanıcıya: "Bu sayfa tarayıcı tarafından korunuyor; sadece *görünen alan* alınabilir" — **Not:** activeTab ile `captureVisibleTab` chrome:// sayfalarda çalışabilir ama CS enjekte edilemez → bu sayfalarda yalnızca `visible` modu sunulur).
- `file://` sayfalarda CS enjeksiyonu "Allow access to file URLs" gerektirir; kapalıysa `visible` modu + yönlendirme mesajı.
- PDF görüntüleyici sekmeleri (`application/pdf`, Chrome'un yerleşik viewer'ı): CS enjekte edilemez → yalnızca `visible`.
- Pencere minimize/görünmez ise `captureVisibleTab` "image readback failed" verir → `E_WINDOW_NOT_VISIBLE`; pencere `chrome.windows.update({focused:true, state:'normal'})` ile öne alınmaya çalışılır (sadece kullanıcı tetiklediyse).
- Sekme discard edilmişse önce `chrome.tabs.reload` + load bekleme.
- Hedef sekme aktif değilse (`allTabs`, batch): `chrome.tabs.update(tabId,{active:true})` + `chrome.windows.update(windowId,{focused:true})`; `captureVisibleTab` yalnızca pencerenin aktif sekmesini çekebilir.

### 1.2 Enjeksiyon (`REQ-CAP-002`)
```ts
await chrome.scripting.executeScript({ target:{tabId, frameIds:[0]}, files:['content/page-agent.js'], injectImmediately:true });
```
- Agent `window.__ssx_agent_v1` guard'ı ile idempotent; versiyon farkıysa kendini yeniler.
- Agent, `chrome.runtime.connect({name:`page-agent:${jobId}`})` ile Port açar; SW `onConnect` ile eşler. Port `onDisconnect` → SW: sayfa navigasyonu/yenileme → `E_AGENT_DISCONNECTED` (varsa kısmi tile'larla "kısmi sonuç" sun).
- CS'ye `jobId` `chrome.scripting.executeScript({func:(id)=>window.__ssx_jobId=id, args:[jobId]})` ile geçirilir ya da Port adından okunur.

---

## 2. Tetikleyiciler

| Tetik | Mekanizma | Not |
|---|---|---|
| Toolbar ikonu | `action.default_popup` — popup'ta mod seçimi | Popup açıkken capture başlarsa popup kapanır; progress overlay sayfada görünür |
| Kısayol | `chrome.commands.onCommand` (`capture-visible`, varsayılan `Alt+Shift+V`) | Şu anda yalnız görünen alan komutu kayıtlıdır. Tam sayfa için varsayılan `Alt+Shift+P` komutu yoktur. Gelecek komutlar ancak ilgili mod çalışır hâle geldiğinde manifestte açılır. |
| Sağ tık | `chrome.contextMenus` (`contexts: ['page']`) | Şu anda yalnız *Tam sayfayı yakala* eylemi vardır. Visible/selection/element/frame/delay/history menüleri gelecek kapsamındadır ve kullanıcıya gösterilmez. |
| Side panel | `sidepanel.html` | Kalıcı; capture sonrası önizleme |
| Timer | `CaptureOptions.delayMs` | Countdown overlay (Shadow DOM), `Esc` iptal. Delay boyunca kullanıcı menü/hover açabilir; capture delay bitince başlar |
| Batch/API/Monitor | programatik | `trigger` alanı ile işaretlenir |

`REQ-CAP-003`: Her tetikleyici `CaptureRequest` üretir ve aynı `CaptureCoordinator.start()` yolundan geçer.

---

## 3. Visible Capture (`REQ-CAP-010`)
1. Validate → erişilebilen normal HTTP(S) sayfalarında CS enjekte ederek scrollbar/animasyon/fixed katman hazırlığını **best-effort** uygula. Hazırlık başarısızsa visible yakalama yine denenir; restricted sayfalarda CS olmadan devam edilir.
2. `chrome.tabs.captureVisibleTab(windowId,{format:'png'})` → dataURL.
3. `dprMode` / `zoomHandling` uygula (14).
4. Result: tek tile = sonuç; offscreen'de sadece (gerekirse) ölçek/metadata.
- Hedef süre < 400 ms.

---

## 4. Full-Page Capture — Scroll + Stitch (`REQ-CAP-020`…`029`)

### 4.1 Scan
CS `agent.scan`:
- `scrollingElement = document.scrollingElement ?? document.documentElement`.
- `document.size = {scrollWidth, scrollHeight}` — fakat bazı sayfalarda `html/body { height:100%; overflow:hidden }` ve asıl scroll bir iç `div`dedir. Tespit: `scrollHeight - clientHeight < 2` **ve** viewport'un ≥ %60'ını kaplayan `isScrollable` bir element varsa → `scrollingElement:'custom'`, `primaryScrollContainer` = alanı en büyük scrollable (derinliği en sığ olan tercih). Full-page modunda bu container scroll root olur (Gmail, SPA dashboard'lar).
- Scrollable tespiti: `overflowY ∈ {auto,scroll,overlay}` ve `scrollHeight > clientHeight + 1` ve element görünür (`offsetParent != null` veya `position:fixed`) ve `clientHeight ≥ 50`.
- Fixed/sticky tarama (bkz. 6). Performans: `document.querySelectorAll('*')` yerine `TreeWalker` + `getComputedStyle` sadece `position` okunarak; 20k eleman için < 150 ms hedef; > 50k elemanda tarama `body > * > *` derinlik 6 ile sınırlanır.
- `lazyImages`, `iframes`, `direction`, `colorScheme`.

### 4.2 Plan (`plan.ts`, saf fonksiyon; unit test)
Girdi: `PageMetrics`, `CaptureOptions`, hedef alan (`origin`, `content`), viewport (CSS), `dpr`, `zoom`.
- `tileW = viewport.width`, `tileH = viewport.height` (CSS). Fixed elementler gizleniyorsa tam viewport; **gizlenmiyorsa** (`hideFixedElements:'never'`) üst/alt sticky yükseklikleri kadar *effective* tile yüksekliği küçültülür: `tileH_eff = tileH - topStickyH - bottomStickyH` ve crop ona göre (tekrarı önler).
- `rows = ceil(content.height / tileH_eff)`, `cols = ceil(content.width / tileW)` (yatay overflow varsa ve kullanıcı ayarı `captureHorizontalOverflow` açıksa; varsayılan açık, en fazla 5 sütun).
- Her adım: `scrollTo = {x: origin.x + col*tileW, y: origin.y + row*tileH_eff}`. **Son satır/sütun**: sayfa sonunda istenen scroll'a ulaşılamaz; gerçek scroll `ScrollAck.actual`'dan okunur ve `cropFromViewport` dinamik hesaplanır: `cropY = (desiredY - actualY) * dpr`, `cropH = tileH_eff*dpr - cropY`. Yani plan "istek", gerçek crop "ack"e göre. Overlap kullanılmaz (Karar) — drift yok çünkü her tile'ın yerleşimi actual scroll'a göre hesaplanır.
- `placeAt = {(scrollTo.x - origin.x)*dpr, (scrollTo.y - origin.y)*dpr}` (actual'a göre düzeltilir).
- Tile sayısı `limits.maxTiles`'ı aşarsa: önce `maxCaptureHeightCss`'e kırp ve uyarı; kullanıcı Options'ta artırabilir.

### 4.3 Döngü
```
for step of plan.steps:
  ack = agent.scrollTo(step)            // CS: root.scrollTo + settle
  if ack.documentNow.height > plan.content.height + 50 → plan.extend()  (lazy-load büyümesi; max limitlere kadar)
  await rateLimiter.acquire()           // ≥ 500 ms aralık (2 çağrı/sn)
  dataUrl = await captureVisibleTab()
  tiles.put({jobId,index,blob: dataUrlToBlob(dataUrl), step: {...step, cropFromViewport: recomputed(ack)}})
  progress(index+1, total)
  if cancelled → break
```
- **Settle** (CS `scrollTo`): `root.scrollTo({left,top,behavior:'instant'})` → `await raf(); await raf();` → `settleMs` (150) bekle → varsa `WaitConditions` (ör. `imagesLoaded inViewportOnly`) → `actual` döndür. Scroll-snap CSS'i geçici kapatılır (`scroll-snap-type:none !important` inject).
- **Smooth scroll** `html{scroll-behavior:smooth}` geçersiz kılınır (`auto !important`).
- **Sticky**: ilk tile sonrası `afterFirstTile:true` ile `FixedElementManager.hide()` (6).
- `captureVisibleTab` hata metni "quota exceeded" → bekle+tekrar (max 3); "Cannot access contents" → `E_RESTRICTED_PAGE`; "image readback failed"/"unknown error" → pencere görünürlüğünü düzelt, 2 kez tekrar, sonra `E_WINDOW_NOT_VISIBLE`.
- Her adım `storage.session` job state günceller (`tilesWritten`).

### 4.4 Stitch (offscreen `stitch.worker.ts`)
- Giriş: `StitchRequest`. Çıkış boyutu `content*dpr` (DevicePx). Limit kontrolü (10); sığıyorsa tek `OffscreenCanvas`, değilse strip'ler.
- Her tile: `createImageBitmap(blob)` → `ctx.drawImage(bitmap, crop.x, crop.y, crop.w, crop.h, place.x, place.y, crop.w, crop.h)` → `bitmap.close()`. Tile'lar IDB'den sırayla okunur; bellekte aynı anda ≤ 2 bitmap.
- `postCrop` (element/selection) → ikinci canvas ya da doğrudan çıktı hesaplarında ofset.
- `scaleTo` (dprMode css) → `drawImage` ölçekli; `imageSmoothingQuality:'high'`.
- Çıktı PNG (`convertToBlob({type:'image/png'})`) → `blobs` store; `StitchResult`.
- Tile temizliği: başarı/hata fark etmeksizin `tiles.where('jobId')...delete()`.

### 4.5 Yatay overflow
- Sayfa `scrollWidth > innerWidth` ise ve `captureHorizontalOverflow` açık → cols>1, satır-major tarama. Çoğu sayfada `cols=1`.

---

## 5. Selection Capture (`REQ-CAP-030`)
1. CS `SelectionOverlay`: tam-ekran Shadow DOM overlay (`position:fixed; inset:0; z-index:2147483647; cursor:crosshair`), karartma + seçim dikdörtgeni + boyut rozeti; `Esc` iptal; `Enter`/mouseup onay; sürükleme sırasında overlay, **pencere kenarına yaklaşınca auto-scroll** (selection viewport'tan büyük olabilir) — Karar: V1'de auto-scroll yok; seçim viewport içi; sayfa koordinatına çevrilir. Viewport'tan büyük alan için kullanıcı *element* modunu kullanır. (P1.5: auto-scroll).
2. Seçim bitince overlay kaldırılır (capture'da görünmemesi için `visibility:hidden` + 2 raf), `rect` sayfa koordinatında SW'ye gider.
3. SW: `rect` viewport içindeyse tek `captureVisibleTab` + offscreen `crop` (DevicePx = rect*dpr). Değilse (P1.5) full-page plan `origin=rect.xy, content=rect.size` ile.
4. Sonuç: kırpılmış görüntü; history `mode:'selection'`, `request.target.rect` saklanır (recapture).

---

## 6. Fixed / Sticky Element Yönetimi (`REQ-CAP-040`…`046`)

### 6.1 Tespit
- `getComputedStyle(el).position ∈ {fixed, sticky}`; ayrıca `position:absolute` olup `html/body` ile `overflow:hidden` iç container'a bağlı "sahte sticky"ler (scroll root custom ise root'un çocuklarından `position:sticky/fixed` olanlar).
- Her biri için `anchor` hesaplanır: bbox üst kenarı ≤ 2 px ve yükseklik < viewport*0.5 → `top`; alt kenar ≥ viewportH-2 → `bottom`; tam viewport'u kaplayan (`coversViewportPct>90`) → `full` (modal/overlay/backdrop).
- `isTransparentOverlay`: `opacity==0` veya `pointer-events:none` ve arka planı şeffaf → dokunulmaz (görünmez zaten).
- Sticky eleman şu an "yapışık" mı? `sticky` elementler yalnızca scroll sonrası viewport kenarına yapışır. Sadelik için tüm `sticky` elementler sticky kabul edilir; ama `hideAfterFirst` ile ilk karede normal konumlarında görünürler (çoğu sayfada header zaten en üsttedir) — doğru sonuç.

### 6.2 Stratejiler (`PreparePlan.fixedStrategy`)
| Strateji | Davranış | Ne zaman |
|---|---|---|
| `hideAfterFirst` (varsayılan, `auto`) | İlk tile normal çekilir (header/footer görünür), sonraki tile'larda tüm fixed/sticky elemanlar `visibility:hidden !important` (layout korunur; `display:none` reflow yapar ve sticky placeholder kaybolur) | Klasik sticky navbar/footer |
| `hideAll` | Tüm tile'larda gizle | Kullanıcı isterse (cookie bar'lar vb.) |
| `none` | Hiç dokunma, tile yüksekliğini sticky yükseklikleri kadar küçült (4.2) | `hideFixedElements:'never'`; header'ı her karede isteyenler için **değil**; tekrar yok ama header sadece ilk karede |
| `absolutize` | `position:absolute` + mevcut top/left → sayfa akışında tek kez | Header'ın içeriğin üzerine binmemesi için ek seçenek (P1.5); CSS bağımlı, riskli |

- `anchor:'bottom'` elemanlar (sticky footer, cookie bar, chat balonu) ilk tile'da **da** gizlenir mi? Karar: ilk tile'da görünür bırak, ancak son tile'da da görünür (footer gerçek yerinde değilse iki kere çıkar) → son tile'da tekrar gizle: kural = `bottom` anchor'lı elemanlar sadece **ilk** tile'da görünür; `top` anchor'lı elemanlar sadece ilk tile'da; `full` (modal/backdrop) hiçbir tile'da gizlenmez (kullanıcının çektiği şey modal olabilir) — smart-hide açıksa kategori eşleşirse gizlenir.
- Gizleme `el.style.setProperty('visibility','hidden','important')` + orijinal inline `visibility` `data-ssx-restore` ile saklanır; `!important` zaten olan stiller için class + injected `<style>` (`.ssx-hide-<jobId>{visibility:hidden!important}`) kullanılır.
- Gizlenen elemanların içindeki `position:fixed` torunlar (dropdown) zaten görünmez.
- **Backdrop-filter/blur header**: gizlenince altındaki içerik görünür → doğru.
- **Sayfa başında scroll padding**: `scroll-padding-top` etkilemez (programatik scrollTo).

### 6.3 Uyarılar
- Result'ta "N sticky element ilk kareden sonra gizlendi" bilgisi; kullanıcı `hideFixedElements:'never'` ile yeniden çekebilir.

---

## 7. Element / Selector / Scroll Container Capture (`REQ-CAP-050`…`059`)

### 7.1 Element picker
- `agent.pickStart({mode:'element'})`: Shadow DOM overlay; `mousemove` → `elementFromPoint` (overlay `pointer-events:none`, seçimde `click` için overlay yakalar) → highlight kutusu + rozet (`div#main.content 1200×3400`). `↑/↓` ebeveyn/çocuk gezme, `Esc` iptal, tıkla seç. `mode:'scrollContainer'` ise sadece `isScrollable` elemanlar (veya en yakın scrollable atası) vurgulanır.
- Seçimde `ElementInfo` + `selector` üretilir; overlay kaldırılır; SW `CaptureRequest{mode:'element', target:{selector}}` ile devam eder.

### 7.2 Selector üretimi (recapture için kararlı)
Sıra: `#id` (benzersiz ve sayısal/otomatik görünmüyorsa: `/^[a-z][\w-]*$/i` ve `!/\d{4,}/`) → `[data-testid]`/`[data-test]`/`[data-cy]`/`[name]`/`[aria-label]` → `tag.class1.class2` (max 2 anlamlı class; `css-xyz123`, `sc-`, `jsx-`, hash'li class'lar elenir) + `:nth-of-type(n)` ebeveyn zinciri (kök `body`'ye kadar veya benzersizleşince). `document.querySelectorAll(sel).length===1` doğrulaması; değilse `selectorIndex`.

### 7.3 Element capture algoritması
1. Hedef: `agent.getElementRect(selector)` → `ElementInfo` (sayfa koordinatı). Bulunamazsa `E_SELECTOR_NOT_FOUND`.
2. `el.scrollIntoView({block:'start', inline:'start', behavior:'instant'})` sonrası `rect` tekrar ölçülür (sticky header altında kalma durumu: `origin.y` sayfa koordinatı olduğundan sorun yok; ancak header elemanın üstünü **örter** → fixedStrategy `hideAll` uygulanır, Karar: element modunda `hideAll` varsayılan, ilk tile dâhil — element kendisi fixed ise hariç).
3. Element **scrollable değilse**: full-page planı `origin = rect.xy`, `content = rect.size` ile (sayfa scroll edilir). Element viewport'a sığıyorsa tek tile + crop.
4. Element **scrollable ise** (`scrollContainer` modu veya `isScrollable` ve kullanıcı "içini de al" dediyse — Karar: `element` modunda scrollable element otomatik **iç içerik** olarak alınır, rozet "scrollable" gösterir):
   - Capture alanı: `content = {width: el.scrollWidth, height: el.scrollHeight}` (CSS), görünür pencere `clientSize`.
   - Adım: önce sayfa scroll'u ile element viewport'a getirilir (`scrollIntoView`); element `clientRect` viewport içinde sabit kalır (sayfa artık scroll edilmez; element `position` ne olursa olsun). Her adımda `el.scrollTo(x,y)` ve tile'dan `el.getBoundingClientRect()` bölgesi crop edilir (`cropFromViewport = elClientRect ∩ viewport`, DevicePx).
   - Element viewport'tan **büyükse** (clientHeight > innerHeight): iki seviyeli plan — dış döngü sayfa scroll'u (element parçası), iç döngü element scroll'u. Karar: V1'de element clientRect viewport'tan büyükse sadece viewport'la kesişen kısım kullanılır ve dış döngü element yüksekliği kadar sayfa scroll yapar (nested plan üretici `planNested()`); unit test zorunlu.
   - İç scroll container'ın kendi sticky başlıkları (tablo thead sticky, chat header): `FixedElementManager` container **içindeki** `sticky` elemanlara da aynı `hideAfterFirst` kuralını uygular.
   - Lazy-load iç container için de geçerlidir (chat geçmişi yukarı scroll'da yüklenir — infinite modunda yön `up` desteklenir: `InfiniteScrollOptions.direction:'down'|'up'`, chat uygulamaları için P1.5).
5. Sonuç `postCrop` ile kırpılır; `background:'transparent'` istenmişse (P2) DOM-to-image fallback (html-to-image) **yalnızca** element modunda opsiyonel — varsayılan değil (doğruluk sorunları).

### 7.4 Selector capture (`REQ-CAP-055`)
- Kullanıcı girdisi CSS selector (`#invoice`, `.main-content`, `[data-testid="report"]`); popup/batch formunda "Test" butonu → CS `getElementRect` ile eşleşme sayısı + highlight.
- Geçersiz selector → `E_VALIDATION`; 0 eşleşme → `E_SELECTOR_NOT_FOUND`; >1 → `selectorIndex` (varsayılan 0) ve uyarı.
- Akış 7.3 ile aynı.

### 7.5 Desteklenen uygulama tipleri (test matrisi 11)
Chat uygulamaları (WhatsApp Web, Slack, ChatGPT), admin paneller (AdminLTE, Ant Design Pro), dashboard'lar (Grafana), Gmail, scroll edilen modal/drawer (MUI Dialog `overflow:auto`), iç içe container'lar (outer overflow + inner overflow), sticky thead tablolar, `overflow:hidden` body + inner scroll (Notion/Jira).

---

## 8. Lazy Loading (`REQ-CAP-060`…`066`)
`PagePreparer.lazyLoad()` sırası (toplam `maxWaitMs` bütçesi içinde):
1. **Eagerize:** `img[loading="lazy"], iframe[loading="lazy"]` → `loading="eager"`; `img[data-src]`/`[data-lazy-src]`/`[data-original]` → `src` (orijinali `data-ssx-restore-src`'ye); `data-srcset` → `srcset`; `<source data-srcset>`; `background-image` lazy kütüphaneleri (lozad, lazysizes `.lazyload` → `.lazyloaded` tetikleme) için `class` ekleme denenmez (Karar: sadece attribute tabanlı).
2. **Pre-scroll:** scroll root'u `preScrollStepCss` adımlarla baştan sona (ve sona ulaşınca başa) `preScrollDwellMs` bekleyerek gezer → IntersectionObserver tabanlı lazy içerikler tetiklenir. Overlay "Sayfa hazırlanıyor…" gösterir. Sayfa boyu büyürse (`documentNow`) plan büyütülür (limite kadar).
3. **Bekleme:** `document.fonts.ready` (timeout 1500), viewport'taki `img.decode()` (her tile öncesi `imagesLoaded inViewportOnly`), `networkIdle` (PerformanceObserver `resource` girişleri son `idleMs` (500) boyunca yoksa ve `performance.getEntriesByType('resource')` artmıyorsa), `domQuiet` (MutationObserver `quietMs` 300).
4. Kullanıcı ayarı `capture delay` (CaptureOptions.delayMs) her zaman ek olarak uygulanabilir.
- Placeholder/blur-up görseller (`next/image`): decode sonrası `img.complete && naturalWidth>0` kontrolü; `srcset` değişimi için tekrar bekleme (max 2 tur).
- Infinite scroll sayfalarda pre-scroll **kapalıdır** (yoksa sonsuz yükler); infinite modu kendi döngüsüne sahiptir.

---

## 9. iframe (`REQ-CAP-070`…`075`)
- `captureVisibleTab` piksel bazlı olduğundan iframe içeriği **görünen haliyle** zaten yakalanır (`iframes:'pixelsOnly'`). Sorun: iframe'in **kendi içi scroll'u** (yüksek iframe içinde gizli içerik) ve iframe içindeki sticky/lazy.
- `injectSameOrigin` (varsayılan): `chrome.scripting.executeScript({target:{tabId, allFrames:true}})` — activeTab ile aynı-origin frame'lere enjeksiyon çalışır; cross-origin frame'ler için host izni gerekir → olmadan sessizce atlanır. Alt frame agent'ı (`iframe-agent.ts`) kendi frame'inde scan/prepare/scroll yapar; üst agent `IframeInfo.rect` ile koordinat dönüşümü sağlar.
- `injectAll`: `optional_host_permissions <all_urls>` (veya o origin) istenir (PermissionBroker, kullanıcı jestiyle). Verilirse cross-origin frame'ler de hazırlanır; reddedilirse `injectSameOrigin` gibi devam + uyarı.
- **Frame capture modu** (`mode:'iframe'`, context menu "Capture this frame"): hedef frame `frameId` (`info.frameId` context menu'den); iframe elementi üst belgede bulunur (`IframeInfo` eşleşmesi `src`/rect ile) → element capture akışı, fakat scroll iç frame'in `scrollingElement`'i üzerinden (alt agent'a `agent.scrollTo` frame'e yönlendirilir: `chrome.tabs.sendMessage(tabId,msg,{frameId})`). Frame viewport'tan yüksekse iki seviyeli plan: iframe elementini sayfa içinde konumlandır + içini scroll et (7.3'teki nested plan).
- Frameset (`<frameset>`): her `<frame>` ayrı frame olarak listelenir; "Capture all frames as one" P2.
- iframe içindeki sticky'ler alt agent tarafından yönetilir; iframe'in kendisi sticky ise üst agent.

---

## 10. Çok Uzun Sayfalar & Tiling (`REQ-CAP-080`…`086`)
- Limit kaynağı: `CanvasLimits` (probe; varsayılan kenar 16.384 / alan 268.435.456). Çıktı `W×H` DevicePx: `H > maxSide` veya `W*H > maxArea` ise **strip** modu: `stripH = min(maxSide, floor(maxArea / W))`, `stripH` **tile sınırına** yuvarlanır (bir tile iki strip'e bölünmesin; gerekirse tile crop ile bölünür — basitlik için crop destekli).
- Streaming stitch: strip'ler tek tek üretilir; her strip bitince PNG'e encode edilip `blobs`'a yazılır ve canvas serbest bırakılır → peak bellek ≈ bir strip + 2 tile.
- Bellek bütçesi (`memoryBudgetMb`, 600): `W*stripH*4 bytes` bütçeyi aşarsa stripH küçültülür.
- **Tek-dosya isteği** (kullanıcı PNG tek dosya istiyor ve strip'ler oluştu): (a) canvas-sız satır-bazlı PNG encoder (`fast-png`/özel streaming zlib) ile strip'ler tek PNG'ye birleştirilir (bellek: bir satır bloğu + zlib; P1.5), (b) olmazsa `multiImage` ayarına göre ZIP / ayrı dosyalar / PDF sayfaları. Uyarı: çoğu görüntüleyici > 30.000 px görüntüleri yavaş açar.
- PDF: strip'ler sayfa sayfa eklenir (`pdf-lib`), tek uzun sayfa modunda 14.400 pt sınırı (04 §5.3).
- `maxCaptureHeightCss` aşılırsa: capture `maxCaptureHeightCss`'de durur, `warnings: ['truncated']`, UI "Sayfa 50.000 px'de kesildi — Ayarlar'dan artırabilirsin".
- Canvas `getContext` null dönerse (GPU bellek) → stripH yarıya, 3 deneme → `E_CANVAS_LIMIT`.

---

## 11. Infinite Scroll (`REQ-CAP-090`…`097`)
Mod `infinite`:
1. prepare (lazy pre-scroll kapalı).
2. Döngü: `agent.infiniteStep({stepIndex, dwellMs})` → CS: `root.scrollTo(0, root.scrollHeight)` (en alta) → `dwellMs` bekle (+ `networkIdle` kısa) → `{documentHeight, grew, reachedEnd}`.
   - Aynı anda tile capture **yapılmaz**; önce büyütme fazı ("Loading more… (12 steps, 34.000 px)"), sonra normal full-page capture fazı (4). Gerekçe: adım adım capture + büyüme birlikte drift yaratır. (Alternatif olarak eş zamanlı capture `infinite.captureWhileScrolling` P2.)
   - Durma: `stopWhenNoGrowth` ardışık adım büyümediyse; `maxSteps`; `maxHeightCss`; `maxDurationMs`; kullanıcı overlay **Stop capture** (`capture.infiniteStop`) → büyütme fazı biter, capture fazı başlar; `Esc`/Cancel → tamamen iptal.
   - `duplicateDetection`: büyütme fazında her adımda en alt viewport'un küçük bir `captureVisibleTab` örneği **alınmaz** (rate limit); bunun yerine DOM tabanlı: son 3 adımda `root.scrollHeight` ve son 200 elementin `outerHTML.length` hash'i aynıysa "büyümüyor". Capture fazında ise ardışık tile'ların perceptual hash'i (offscreen, 16×16 dHash) eşitse `warnings` (örn. sonsuz spinner).
3. Capture fazı: full-page planı yeni yükseklikle; limitler (10) geçerli.
4. "Load more" butonlu sayfalar: P2 — `infinite.clickSelector` ile her adımda buton tıklatma.

---

## 12. All Tabs (`REQ-CAP-100`…`104`)
- İzin: `tabs` (URL/title okumak için) → PermissionBroker.
- `tabs.listForCapture` → UI'da sekme listesi (checkbox, restricted işaretli, discarded işaretli).
- Akış `BatchRunner` ile (`source.kind:'tabs'`): sırayla her sekmeyi aktif yapar (`chrome.tabs.update`, pencere odak), load bekler, capture, sonra **orijinal aktif sekmeye döner**. Kullanıcı bu sırada tarayıcıyı kullanmamalı → overlay + bildirim "Sekmeler sırayla yakalanıyor, lütfen bekleyin".
- Output: ayrı dosyalar / tek combined PDF / ZIP (06).
- Discarded sekmeler reload edilir (ayar), restricted sekmeler atlanır (log).

---

## 13. Progress, Cancel, Overlay (`REQ-CAP-110`…`115`)
- CS `ProgressOverlay` (closed Shadow DOM, `position:fixed; top:16px; right:16px; z-index:2147483647`), capture **sırasında görünür kalır ama tile'larda görünmemeli** → her `captureVisibleTab` öncesi overlay `visibility:hidden` yapılır ve iki temiz compositor frame beklenir; capture sonrasında görünürlük geri alınır. Action badge ilerlemeyi ayrıca gösterebilir.
- Overlay içeriği: faz metni, `done/total`, ETA, **Cancel** (her zaman), **Stop** (infinite). `Esc` = Cancel (CS keydown listener, capture boyunca).
- İptal: SW `capture.cancel` → CS `agent.abort` → restore → tiles sil → `job.cancelled`. İptal sonrası kısmi sonuç **sunulmaz** (Karar; basitlik); ancak `E_AGENT_DISCONNECTED`/timeout'ta kısmi stitch sunulur ("Partial").
- Popup kapandığında job devam eder (SW'de). Popup/side panel yeniden açılınca `capture.listActive` ile progress gösterir.
- Bildirim (`chrome.notifications`, ayar açıksa): tamamlandı / hata.

---

## 14. DPR, Zoom, RTL ve Diğer Kenar Durumları (`REQ-CAP-120`…`129`)
- **DPR:** `captureVisibleTab` fiziksel piksel döner (CSS × DPR × zoom). Tüm crop/place hesapları `dpr` ile çarpılır; tile gerçek boyutu (`ImageBitmap.width`) beklenenle karşılaştırılır; fark ±2 px'i aşarsa **gerçek** ölçek = `bitmap.width / viewport.width` olarak yeniden hesaplanır (Windows kesirli DPR 1.25/1.5 yuvarlama hataları).
- **Zoom:** `chrome.tabs.getZoom(tabId)` ≠ 1 ise: `zoomHandling:'normalizeTo100'` (varsayılan) → `chrome.tabs.setZoom(tabId,1)` capture süresince, sonunda geri (`setZoomSettings` scope `per-tab` ise yan etki yok); `'keep'` → ölçek `dpr*zoom` olarak kullanılır.
- **dprMode:** `device` (varsayılan; Retina'da 2×), `css` (1× — küçük dosya), sayı (örn. 1.5 → downscale).
- **RTL** sayfalar: `scrollX` negatif olabilir; `origin.x` hesapları `Math.abs` yerine `scrollingElement.scrollLeft` gerçek değerleriyle; yatay overflow planı sağdan sola.
- **`overflow-anchor`/scroll anchoring:** scroll sırasında içerik yukarıdan eklenirse kayma; `overflow-anchor:none !important` inject edilir.
- **Scrollbar:** `::-webkit-scrollbar{display:none!important}` + `html{scrollbar-width:none!important}` inject; overlay scrollbar'lar (macOS) zaten yakalanmaz. Scrollbar gizlenince layout genişler (`innerWidth` değişir) → scan **scrollbar gizlendikten sonra** yapılır.
- Scrollbar stili ana belgeyle birlikte erişilebilen same-origin iframe belgelerinin `head` bölümüne de eklenir. Restore sırasında ana belge ve her iframe için eklenen style düğümleri ayrı ayrı kaldırılır; cross-origin frame erişim hataları yakalamayı durdurmaz.
- **Animasyon/transition:** `*,*::before,*::after{animation-play-state:paused!important; transition:none!important; caret-color:transparent!important}`; `<video>` pause (ayar), GIF'ler durdurulamaz (bilinen kısıt). `prefers-reduced-motion` etkisiz.
- **Hover state:** overlay `pointer-events` sayesinde hover tetiklemez; fare sayfa üzerindeyse hover efektleri yakalanabilir (bilinen kısıt; delay+hover = özellik).
- **Focus/caret:** `caret-color:transparent`; seçili metin (selection) highlight'ı kalır → `document.getSelection().removeAllRanges()` yapılmaz (kullanıcı seçimi kanıt olabilir) — Karar: dokunulmaz.
- **Dark mode / forced colors:** yakalanan piksel = ekran; ekstra iş yok.
- **Çok geniş sayfalar (`scrollWidth >> innerWidth`)**: 4.5.
- **Pencere yeniden boyutlandırma** capture sırasında: `resize` olayı → job `E_VALIDATION("viewport changed")` → kullanıcıya "Capture sırasında pencere boyutu değişti, tekrar deneyin".
- **Sekme değişimi** capture sırasında (kullanıcı başka sekmeye tıklar): `captureVisibleTab` başka sekmeyi çeker! Önlem: her çağrıdan önce `chrome.tabs.query({active:true,windowId})` ile `tabId` doğrulanır; farklıysa job duraklar, `chrome.tabs.update(tabId,{active:true})` ile geri döner (1 kez), tekrar olursa `E_TAB_NOT_ACTIVE`.
- **Sayfa `beforeunload`/navigasyon**: Port kopar → kısmi sonuç.
- **`position:fixed` + `transform` ebeveyn**: fixed çalışmaz (containing block) → tespit `position` değil, bbox'ın scroll boyunca sabit kalıp kalmadığı; hideAfterFirst genelde yeterli; ek: `agent.scan` 2. kez farklı scroll'da ölçüp `rect.top` değişmeyenleri `fixedElements`'e ekler (P1.5, `detectByMotion`).
- **Çok yüksek DPR + geniş ekran (5K)**: alan limiti çabuk dolar → strip (10).
- **Ses/odak**: capture kullanıcı odak kaybına neden olmaz.

---

## 15. DebuggerBackend (sadece `cdp` varyantı) (`REQ-CAP-130`…`135`)
1. `chrome.debugger.attach({tabId},'1.3')`; `onDetach(canceled_by_user|target_closed)` → fallback `visibleTab`/fail.
2. `Page.enable`, `Page.getLayoutMetrics` → `cssContentSize` (+ `cssVisualViewport`).
3. prepare adımları yine CS ile (sticky gizleme gerekmez — `captureBeyondViewport` tek render; ama lazy-load için pre-scroll gerekir).
4. `contentHeight*dpr ≤ 16.384` ise tek `Page.captureScreenshot({format:'png', captureBeyondViewport:true, clip:{x:0,y:0,width,height,scale:1}})`; aşıyorsa dilimler: `clip.y` adımlarla (her dilim ≤ 16.384/dpr CSS px) → tile gibi `tiles` store → stitch. Not: `captureBeyondViewport` ile sayfa fiilen scroll edilmez; `position:fixed` elemanlar **ilk viewport'ta** bir kez render edilir (istenen davranış). Bazı sayfalarda (`100vh` hero'lar) `setDeviceMetricsOverride` gerekirse kullanıcı ayarı `cdp.extendViewport`.
5. `Emulation.setScrollbarsHidden({hidden:true})`. Bitince `Emulation.clearDeviceMetricsOverride`, `chrome.debugger.detach`.
6. Element/selector: `DOM.getBoxModel` ile rect → `clip`.
7. Hız: 10k px sayfa ≈ 1–3 s. Bellek: base64 ≈ 1.33× PNG; 16k dilimler ~ 100–200 MB geçici.
8. Her attach/detach ve infobar UI'da bilgilendirilir ("Hızlı mod açık: Chrome üstte bir uyarı çubuğu gösterir").

---

## 16. Restore Garantisi (`REQ-CAP-140`)
`Restorer` yığını (LIFO): scroll pozisyonları (root + tüm dokunulan container'lar), gizlenen elementlerin stilleri/class'ları, inject edilen `<style>` etiketleri, eagerize edilen img attribute'ları (Karar: **geri alınmaz** — yüklenmiş görsel zararsız; ama `data-ssx-restore-src` temizlenir), pause edilen medya (`play()` sadece daha önce oynuyorsa), zoom, overlay'ler, event listener'lar, `__ssx_jobId`. `agent.restore` idempotent; `pagehide`'da da çalışır; SW restart sonrası yeniden enjekte edilen agent `data-ssx-*` izlerini tarayıp temizler.

---

## 17. Kabul Kriterleri (özet; tam test matrisi 11)
| ID | Kriter |
|---|---|
| AC-CAP-01 | 1440×900 viewport, DPR 2, 12.000 px sayfa: full-page çıktısı 2880×24.000, tile dikişleri pixel-perfect (test sitesi ızgara deseni; dikişlerde satır tekrarı/atlaması 0) |
| AC-CAP-02 | Sticky header+footer test sayfasında header yalnız üstte, footer yalnız en altta/ilk karede bir kez; tekrar yok |
| AC-CAP-03 | Lazy-image sayfasında (50 img, IntersectionObserver) tüm görseller yüklü; placeholder oranı 0 |
| AC-CAP-04 | Gmail benzeri `overflow:hidden body` + inner scroll sayfası: full-page modu otomatik doğru root'u seçer ve tüm içeriği alır |
| AC-CAP-05 | Chat paneli (500 mesaj, iç scroll) element/scrollContainer modunda tam yükseklikte yakalanır; sticky chat header tekrar etmez |
| AC-CAP-06 | 120.000 px sayfa: `maxCaptureHeightCss` 50.000'de kesilir, uyarı verir; limit 200.000 yapılınca strip'ler üretir, bellek < 800 MB, crash yok |
| AC-CAP-07 | Infinite scroll test sayfası (her adımda 20 öğe, 8 adımda biter): büyütme fazı 8–11 adımda durur, sonuç tüm öğeleri içerir; Stop butonu çalışır |
| AC-CAP-08 | İptal (Esc/Cancel) 300 ms içinde sayfayı orijinal haline döndürür (scroll, stiller, overlay yok) |
| AC-CAP-09 | Zoom %150 ve DPR 1.25 (Windows) kombinasyonunda dikiş hatası yok |
| AC-CAP-10 | chrome:// sayfada full-page seçilince anlaşılır hata + visible önerisi |
| AC-CAP-11 | Selection: seçilen alan ±1 px doğrulukla kırpılır |
| AC-CAP-12 | Same-origin iframe (yüksek, iç scroll) "Capture this frame" ile tam yakalanır; cross-origin iframe izinsizken görünen kısmı alınır ve uyarı verir |
| AC-CAP-13 | captureVisibleTab rate limit hatası hiç kullanıcıya yansımaz (retry) |
| AC-CAP-14 | Capture sırasında sekme değiştirilirse job hatalı tile üretmez (aktif sekme doğrulaması) |
