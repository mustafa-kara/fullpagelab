# 09 — Ayrıştırıcı Özellikler (Differentiators)

> GoFullPage/FireShot'ta olmayan ya da zayıf olan özellikler: version compare, pixel diff, smart element hide, evidence mode, bug report mode, diff timeline, OCR search, presets, entegrasyonlar, public API, change monitoring, otomatik QA. Tipler `13-data-contracts.md §6, §10, §11, §13`. Gereksinim ID önek: `REQ-DIF-*`. Öncelikler bölüm başlıklarında.

İçindekiler: 1 Version Compare · 2 Pixel Diff · 3 Smart Element Hide · 4 Evidence Mode · 5 Bug Report Mode · 6 Selector Capture & Wait Conditions · 7 Recapture / Multi-URL ZIP / Diff History · 8 OCR & History Search · 9 Presets · 10 Entegrasyonlar · 11 Public API · 12 Change Monitoring · 13 Otomatik QA akışları · 14 Kabul kriterleri

---

## 1. Version Compare (P1) — `REQ-DIF-010`…`017`
**Amaç:** Aynı URL'nin iki capture'ını yan yana/üst üste karşılaştırmak (QA, regression, design review, landing page izleme, rakip takibi).

**UX (`compare.html?base=<id>&head=<id>`):**
- Giriş noktaları: history'de iki kayıt seçip "Compare"; bir kaydın sayfasında "Compare with…" → aynı `url`'e (fragment hariç, query dahil; ayar: "query'yi yoksay") sahip kayıtlar listesi (en yeni üstte); diff timeline (7.3) üzerinden.
- Görünümler (sekme): **Side-by-side** (iki pane, senkron scroll/zoom; `overflow:auto` container'lar `scroll` olayıyla oran bazlı eşlenir — farklı yükseklikte `scrollTop/scrollHeight` oranı değil **piksel** eşleme, `alignment:'top'`), **Slider** (wipe; drag ile dikey çizgi), **Onion-skin** (opacity slider 0–100), **Diff overlay** (2. bölümün `maskRef` katmanı; region listesi tıklanınca kaydır/zoom).
- Araç çubuğu: zoom (fit/100%/200%), "Swap", "Ignore regions" çizimi (2.), threshold slider, "Run diff", "Export" (side-by-side PNG / diff PNG / JSON rapor), "Open in editor" (head).
- Bilgi paneli: iki kaydın tarih, boyut, viewport, dpr; `changedPct`, bölge sayısı.
- Karar: base/head farklı genişlikteyse uyarı ("Viewport farklı: 1440 vs 1280 — piksel diff güvenilmez") ve diff yine çalışır (padding).

**Veri:** `DiffResult` `diffs` tablosuna yazılır (`baseId, headId, options hash` ile tekilleştirme; aynı parametrelerle ikinci kez hesaplanmaz).

---

## 2. Pixel Diff (P1) — `REQ-DIF-020`…`029`
`diff.worker.ts` (offscreen), `pixelmatch` ile.

**Algoritma:**
1. Girdi `DiffRequest {baseRef, headRef, options: DiffOptions}`. İki görüntü `createImageBitmap` → `OffscreenCanvas` → `ImageData`. Boyutlar farklıysa `alignment:'top'`: `W=max(wA,wB)`, `H=max(hA,hB)`; kısa olan **şeffaf sentinel** (`rgba(0,0,0,0)`) ile pad edilir; pad bölgeleri `kind:'added'` (head'de var) / `'removed'` (base'de var) olarak ayrıca işaretlenir, pixelmatch'e girmez (maske).
2. `ignoreRegions` (CSS px, sayfa koordinatı) → `× dpr` DevicePx'e çevrilir (her iki kaydın `dpr`'ı aynı olmalı; değilse head'in dpr'ına ölçeklenir) → her iki görüntüde o bölgeler aynı nötr renge boyanır (fark üretmez).
3. `pixelmatch(a.data, b.data, out.data, W, H, {threshold (0.1), includeAA (false), alpha:0.1, diffColor:[255,0,0], diffColorAlt:[0,160,255] /*anti-alias/added*/, diffMask:true})` → `changedPixels`. `diffMask:true` ile çıktı yalnız değişen pikseller (şeffaf zemin) → `maskRef` PNG.
4. **Kümeleme** (bbox üretimi): değişen pikseller `cellSize = clusterGapPx` (12) ızgaraya düşürülür (bool grid `ceil(W/cell) × ceil(H/cell)`); dolu hücreler üzerinde 8-komşuluk connected-component (iteratif BFS) → her bileşen için piksel bazlı sıkı bbox; `area < minClusterAreaPx` (64) olanlar elenir; komşu bbox'lar `clusterGapPx` içinde birbirine değiyorsa birleştirilir (tek tur). Çıktı `regions[] {x,y,width,height,kind:'changed'}` + pad bölgeleri `'added'|'removed'`.
5. `changedPct = changedPixels / (W*H − ignoredPixels) × 100`.
6. `sideBySideRef` (opsiyonel, export için): `[base | head | overlay]` yatay kompozit, 16 px boşluk, alt yazı.
7. **Performans:** `W*H > 16 M px` ise `downscale = sqrt(16M / (W*H))` ile her iki görüntü ölçeklenir (bilinear), bbox'lar geri ölçeklenir; UI'da "Diff %X ölçekte hesaplandı" notu. 2880×24 000 (69 M px) → 0.48 ölçek ≈ 1 382×11 520; pixelmatch ≈ 1–2 s. Bellek: 2 ImageData + out ≈ 3×4×W'H bayt → 16 M px'te 192 MB (bütçe 600 MB içinde).
8. Sonuç `DiffResult` (13 §10) → `diffs` store; `maskRef`/`sideBySideRef` `blobs`'ta.

**Kullanım alanları** (UI'da preset önerileri): QA/regression (QA Test preset + batch + diff), design review, landing page monitoring (12), rakip takibi.

---

## 3. Smart Element Hide (P1) — `REQ-DIF-030`…`039`
**Amaç:** Capture öncesi cookie banner, modal, sticky chat, reklam, floating widget, newsletter popup, sticky bar'ları otomatik kaldırmak.

**Kural kaynağı `public/assets/hide-rules.json`** (bundle; uzaktan güncelleme yok — 08):
```ts
interface HideRules {
  version: string; generatedAt: IsoDate;
  attribution: string[];                    // lisans metinleri (aşağıda)
  categories: Record<SmartHideCategory, { generic: string[]; byDomain: Record<string, string[]>; }>;
  exceptions: Record<string, string[]>;     // domain → dokunulmayacak selector'lar
}
type SmartHideCategory = 'cookieBanner' | 'modal' | 'chatWidget' | 'ad' | 'floatingWidget' | 'newsletterPopup' | 'stickyBar';
```
- `cookieBanner.generic`: **EasyList Cookie List**'ten (`https://secure.fanboy.co.nz/fanboy-cookiemonster.txt`, lisans **CC BY 3.0** — yalnızca atıf) seçilmiş düz `##selector` satırları (prosedürel `:has-text()`, `:upward()`, `:style()` satırları **alınmaz**); `domain##sel` satırları `byDomain`'e. Derleme scripti `scripts/build-hide-rules.ts` kaynak dosyadan filtreler (max 3 000 generic selector; her biri `CSS.supports('selector(...)')` ile doğrulanır). **GPL/CC BY-SA listeler (EasyList core, Fanboy Annoyance, AdGuard Annoyances, "I still don't care about cookies") kopyalanmaz** (`REQ-DIF-031`).
- Kendi listelerimiz (el ile bakımlı): CMP'ler `#onetrust-banner-sdk, #onetrust-consent-sdk, .onetrust-pc-dark-filter, #CybotCookiebotDialog, #CybotCookiebotDialogBodyUnderlay, .qc-cmp2-container, #didomi-host, #truste-consent-track, #consent_blackbar, #usercentrics-root, .osano-cm-window, .cky-consent-container, #cmplz-cookiebanner-container, .termly-consent, #iubenda-cs-banner`; chat `.intercom-lightweight-app, #intercom-container, #drift-widget, #drift-frame-controller, .crisp-client, iframe[title="chat widget"], #hubspot-messages-iframe-container, iframe#launcher, #tidio-chat, #chat-widget-container, #fc_frame`; popup `.klaviyo-form, .om-holder, .mc-modal, .mc-modal-bg, #privy-container, #hellobar-bar`.
- `ad`: yalnız bariz konteynerler (`ins.adsbygoogle, [id^="google_ads_iframe"], [id^="div-gpt-ad"]`); reklam engelleme amaçlı değil, görüntü temizliği (Web Store "single purpose" ile uyumlu metin).

**Heuristik motor (`content/smart-hide.ts`)** — kural eşleşmese de:
1. Aday: `position ∈ {fixed, sticky}` ve `z-index ≥ 100` ve görünür (`opacity>0`, bbox>0).
2. **Sticky bar:** top/bottom anchor'lı, yükseklik < %25 viewport, genişlik > %50 viewport, metninde `/cookie|consent|gdpr|çerez|kvkk|subscribe|newsletter|bülten/i` veya `class/id` eşleşmesi → `stickyBar`/`cookieBanner`. Site navbar'ları (`<nav>`, `role=navigation`, `<header>` içinde, metin eşleşmesi yok) **hariç**.
3. **Modal:** `role=dialog|alertdialog` veya `aria-modal=true` veya tam-viewport backdrop (`coversViewportPct>90`, yarı saydam arka plan) + ortalanmış içerik → `modal`; beraberinde `body{overflow:hidden}` kilidi kaldırılır (`overflow:auto !important` geçici).
4. **Chat/floating widget:** bottom-right/left köşe, alan < 400×700, `iframe` veya `id/class` `/chat|widget|launcher|messenger|support/i`.
5. Her aday `{selector, category, reason}` olarak `PreparedState.smartHidden`'a yazılır.

**Mod:** `hide` (varsayılan) → `visibility:hidden !important` (layout korunur; backdrop'lar için ek `pointer-events:none`); `remove` → `display:none !important` (sticky bar'ın kapladığı alanı geri kazanmak için; layout değişir — kullanıcı seçimi). Sticky bar için alternatif `position:static` **uygulanmaz** (Karar; sayfa kırılma riski).
**Kullanıcı kontrolü:** `SmartHideOptions.categories` (varsayılan: cookieBanner, chatWidget, newsletterPopup, stickyBar; modal/ad kapalı — modal kullanıcının çekmek istediği şey olabilir), `customSelectors`, per-domain override (`Settings.capture.smartHide` + `smartHideOverrides: Record<domain,{disabled?:boolean; extra?:string[]; never?:string[]}>` — 13'e eklenecek), capture sonrası uyarı "3 element gizlendi (cookie banner, chat)" + "Geri al ve yeniden çek".
**Asla:** consent butonlarına tıklanmaz (`REQ-DIF-036`); çerez kabul/ret kararı verilmez. Form/iframe içeriğine dokunulmaz.
**Restore:** 03 §16 ile.

---

## 4. Evidence Mode (P1/P2) — `REQ-DIF-040`…`052`
**Amaç:** Hukuki/uyum kanıtı niteliğinde, bütünlüğü doğrulanabilir capture paketi. Sektör temel çizgisi (Page Vault, WebPreserver/Pagefreezer, Hunchly): URL, zaman damgaları, yazılım sürümü, SHA-256, metadata'nın görüntü/PDF üstüne basılması, JSON sidecar, beyan sayfası; FRE 902(13)/(14) tarzı hash + sertifikasyon.

**Akış (`evidence.build {captureId, options: EvidenceOptions}`):**
1. Görüntü bayt dizisi `full` (ve varsa her `strip`) → `crypto.subtle.digest('SHA-256')` (+ opsiyonel SHA-512) → hex. DOM snapshot istenmişse capture anında CS `document.documentElement.outerHTML` (sanitize edilmez; ham) → `blobs` + hash.
2. Metadata toplama: `url` (istek), `finalUrl` (`tab.url` capture anında), redirect zinciri (`webNavigation.onCommitted` `transitionQualifiers: server_redirect` + önceki URL'ler; izin yoksa boş), `capturedAt` (UTC) + `timezone` (`Intl.DateTimeFormat().resolvedOptions().timeZone`) + offset, tarayıcı (`navigator.userAgentData.getHighEntropyValues(['platform','platformVersion','architecture','bitness','fullVersionList'])`, `userAgent`), `extensionVersion`, `buildVariant`, viewport/dpr/zoom/colorScheme/locale, `captureSettings`, `warnings` (ör. gizlenen sticky/smart-hide — kanıt bütünlüğü için **evidence preset'inde smartHide ve hideFixedElements kapalıdır**; açıksa manifest'e yazılır).
3. `EvidenceManifest` (13 §10) oluşturulur → `CaptureRecord.evidence`.
4. **Gömme:** `embedInImage` → PNG'ye `iTXt` chunk (`keyword:'ssx:evidence'`, UTF-8 JSON; `png-chunks-extract/encode` benzeri kendi minimal implementasyon `lib/image/png-chunks.ts`) — not: gömme görüntü baytlarını değiştirir; manifest'teki hash **gömme öncesi** ham PNG'ye aittir ve ayrıca gömülmüş dosyanın hash'i `image.sha256Embedded` olarak eklenir (13'e eklenecek alan). PDF'te Info dict (`Title, Subject, Keywords: sha256=…`) + `/Metadata` XMP stream (opsiyonel).
5. **Sidecar** `evidence.json` (manifest) — `includeSidecarJson`.
6. **Rapor PDF** (`includeReportPdf`, pdf.worker): Sayfa 1 kapak: başlık "Web Capture Evidence Report", tablo (URL, final URL, başlık, tarih/saat UTC + yerel + TZ, tarayıcı, uzantı sürümü/varyant, viewport/DPR/zoom, görüntü boyutu/format/bayt, SHA-256 (monospace, satır kırmalı), TSA bilgisi varsa), QR kodu **yok** (Karar). Sayfa 2..n: görüntü sayfaları (04 paged PDF kuralları, header'da URL, footer'da `sha256 kısaltma • sayfa x/y • capturedAt`). Son sayfa: **Beyan şablonu** (i18n metin): "Bu belge … tarihinde … adresinin … sürümlü uzantı ile cihazda alınmış ekran görüntüsünü içerir. Görüntünün SHA-256 özeti … dır. Uzantı görüntüyü otomatik oluşturmuş, insan müdahalesi olmamıştır. Doğrulama için: dosyanın SHA-256 özetini hesaplayın ve yukarıdaki değerle karşılaştırın." + imza alanı (ad, tarih).
7. **Bundle**: `evidence_{domain}_{yyyy-mm-dd}_{time}.zip` = `capture.png` (+strips), `evidence.json`, `report.pdf`, (ops.) `dom.html`, (ops.) `timestamp.tsr` → `CaptureFile role:'evidenceBundle'`.

**RFC 3161 zaman damgası (opt-in, `rfc3161Timestamp.enabled`):** `lib/hash/rfc3161.ts` DER `TimeStampReq {version:1, messageImprint:{hashAlgorithm: sha256 OID 2.16.840.1.101.3.4.2.1, hashedMessage}, nonce (random 64-bit), certReq:true}` üretir; `fetch(tsaUrl,{method:'POST', headers:{'Content-Type':'application/timestamp-query'}, body})` → `application/timestamp-reply` → `TimeStampResp` status kontrolü (0/1 = granted) → token (`timeStampToken` CMS) base64 + `genTime`/`serialNumber` parse (minimal ASN.1 okuyucu; tam doğrulama yapılmaz, saklanır). Varsayılan TSA listesi UI'da: `https://freetsa.org/tsr` (self-signed CA, test/kişisel), `http://timestamp.digicert.com` (ücretsiz, yaygın kabul). Host izni: `optional_host_permissions` ilgili origin (kullanıcı jestinde istenir). Ağ hatası → manifest `tsa` boş + uyarı; capture başarısız olmaz. Doğrulama talimatı rapor PDF'inde: `openssl ts -verify -data capture.png -in timestamp.tsr -CAfile <tsa-ca.pem>`.
**C2PA (P2, opsiyonel):** `@contentauth/c2pa-web` Builder ile manifest + callback signer; sertifika kullanıcıdan (PKCS#8 + cert) → self-signed "untrusted" görünür; store varyantında varsayılan kapalı.
**Doğrulama UI:** history/kayıt sayfasında "Verify integrity": blob yeniden hash'lenir, manifest ile karşılaştırılır (✓/✗), TSA token varsa `genTime` gösterilir. Dışarıdan PNG/ZIP yüklenip doğrulanabilir (`compare.html`'de "Verify file").
**İzinler:** TSA için host; redirect zinciri için `webNavigation` (opsiyonel). Bunlar yoksa alanlar `null` ve manifest `warnings`'e yazılır.

---

## 5. Bug Report Mode (P1.5) — `REQ-DIF-060`…`072`
**Amaç:** Tek pakette screenshot + URL + viewport + tarayıcı + console hataları + title + timestamp (Jam.dev/Marker.io/BugHerd benzeri).

**Veri kaynakları:**
| Veri | Kaynak | Kısıt |
|---|---|---|
| Console | **Main-world `ConsoleTap`**: Bug Report preset'i **aktif** edildiğinde `chrome.scripting.registerContentScripts([{id:'console-tap', js:['content/console-tap.main.js'], world:'MAIN', runAt:'document_start', allFrames:true, matches:['<all_urls>'], persistAcrossSessions:false}])` (host izni gerekir) → sayfa açılışından itibaren `console.log/info/warn/error/debug` sarmalanır, `window.onerror`, `unhandledrejection` dinlenir; ring buffer 500; `window.postMessage({__ssx:'console', entries})` ile isolated world'e, oradan `agent.collectConsole` ile SW'ye. Preset aktif değilse capture anında **on-demand** enjeksiyon → yalnız **enjeksiyon sonrası** loglar; UI bunu açıkça söyler: "Console geçmişi için Bug Report modunu sayfayı yüklemeden önce açın." | `cdp` varyantı: `Runtime.enable` + `Log.enable` ile geçmiş dahil (deep mode) |
| Network hataları | `chrome.webRequest.onErrorOccurred` (`details.error` ör. `net::ERR_CONNECTION_REFUSED`) + `onCompleted` `statusCode ≥ 400`, sekme bazlı filtre; izin `webRequest` + host (opsiyonel `feature:'bugReportNetwork'`) | izin yoksa boş liste + not |
| Ortam | `navigator.userAgent`, `userAgentData.getHighEntropyValues([...])`, `platform`, `language`, `innerWidth/Height`, `devicePixelRatio`, `chrome.tabs.getZoom`, `screen.width/height`, `matchMedia('(prefers-color-scheme: dark)')`, `navigator.onLine`, `connection.effectiveType`, `Intl timeZone`, uzantı sürümü | — |
| DOM path | Element modunda seçilen elementin selector'u + `outerHTML` ilk 500 karakter | — |
| Kullanıcı notu | UI textarea (`notes`) — "Beklenen / Gerçekleşen / Adımlar" şablonu | — |

**Çıktı (`bugreport.build`):** `BugReport` (13 §10) → `CaptureRecord.bugReport`; `format:'markdown'|'json'|'both'`; **bundle ZIP**: `screenshot.png`, `report.md`, `report.json`, (ops.) `console.txt`. Markdown şablonu:
```md
## Bug report — {title}
**URL:** {url}  **Captured:** {capturedAt} ({timezone})
**Browser:** {browser} {version} · {platform} · viewport {w}×{h} @{dpr}x · zoom {zoom}%
**Extension:** v{extensionVersion} ({variant})

### Notes
{notes}

### Console ({n} entries, source: {consoleSource})
| level | time | message |
|---|---|---|
…
### Network errors ({n})
…
### Environment
```json … ```
```
- Entegrasyonlara gönderimde (10) `includeBugReport:true` → açıklama alanına markdown, ZIP ek olarak.
- Gizlilik: console/network içerikleri hassas olabilir → UI önizleme + satır silme; varsayılan `consoleLevels:['error','warn']`.

---

## 6. Selector Capture & Wait Conditions — `REQ-DIF-080`
- Selector capture tamamen 03 §7.4'te (`#invoice`, `.main-content`, `[data-testid="report"]`). Popup'ta "Capture by selector…" alanı, son 10 selector geçmişi, "Test" vurgulama.
- Wait conditions: tanım 13 §3.1 `WaitConditions`; implementasyon eşlemesi 06 §4 tablosu (selector görünene/kaybolana kadar, network idle, X ms, fontlar, görseller). Tekil capture'da Options → Capture → "Gelişmiş bekleme" altında aynı form; preset'lere kaydedilir.

---

## 7. Recapture, Multi-URL ZIP, Diff History
- **Recapture** (`REQ-DIF-090`): 07 §11.5 — history kaydındaki `request` (mode, selector, rect, delay, preset, capture options, dprMode) aynen; `url` yeni sekmede açılır (host izni yoksa kullanıcı jestiyle `activeTab`: "Sayfa açıldı, hazır olunca Capture'a bas" akışı; host izni varsa otomatik), `viewport` eşleşmezse pencere boyutu düzeltilmeye çalışılır (06 §8.3), olmazsa uyarı. Yeni kayıt `source.recaptureOf` ile bağlanır → otomatik diff teklifi.
- **Multi-URL ZIP** (`REQ-DIF-091`): 06 §5 `combine:'zip'|'zipAndPdf'`.
- **Screenshot Diff History / timeline** (`REQ-DIF-092`…`095`): `diff.history {url, limit}` → aynı normalize URL'ye sahip kayıtlar kronolojik; ardışık çiftler için `changedPctFromPrev` (hesaplanmamışsa `null`, "Hesapla" butonu → `diff.run`, `downscale` ile hızlı mod). UI: `compare.html` üstünde yatay **timeline strip** (thumbnail + tarih + % rozet; renk: <1% gri, 1–10% sarı, >10% kırmızı); tıklanınca base/head seçimi. `history.html`'de URL gruplu görünüm ("Versions: 7").

---

## 8. OCR & History Search (P2) — `REQ-DIF-100`…`109`
- Motor: **Tesseract.js v6+/v7** (`relaxedsimd` WASM build), offscreen `ocr.worker.ts` içinde tek kalıcı worker (yeniden oluşturulmaz). MV3 CSP `wasm-unsafe-eval` (02). **Uzaktan indirme yok**: `worker.min.js`, `tesseract-core-*.wasm.js` ve dil verileri bundle'da; `workerPath/corePath/langPath = chrome.runtime.getURL(...)`.
- Diller (Karar): `eng` + `tur` **fast** modeller (`*.traineddata.gz`, ≈ 2–4 MB/dil) bundle; toplam bundle artışı ≈ 10–12 MB (core WASM dahil). Ek dil: kullanıcı `.traineddata(.gz)` dosyasını Options'tan yükler → OPFS `ocr/lang/` (uzaktan kod değil, veri). `Settings.history.ocrAutoIndex` (varsayılan **false**, opt-in) veya kayıt başına "Index text".
- Pipeline (`ocr.index {captureId, lang}`): görüntü (full veya strip'ler) → 2 000 px yükseklikte parçalara bölünür (tile) → her tile `recognize(img,{},{blocks:true})` (scale: DevicePx ≥ 1.5× ise 0.66 downscale → ~150 dpi eşdeğeri) → `words[] {text,bbox,confidence,line,block}` (bbox strip ofsetiyle mutlak DevicePx) → `OcrResult` birleştirme → `ocrDocs` tablosu (`OcrDocRow`, 07 §2/§9): `{captureId, text (tam metin), tokens: string[] (07 §9.3 tokenizasyonu: NFKC, `tr`/`en` locale küçültme, aksan katlamalı ek token'lar), words (bbox'lı), lang, indexedAt}`; Dexie multiEntry index `*tokens`.
- Arama (`ocr.search {q}`): sorgu tokenize → her token için `ocrDocs.where('tokens').startsWith(token)` → kesişim → skor (eşleşen token sayısı + title/url eşleşmesi bonusu) → `OcrSearchHit {captureId, snippet (±60 karakter), bbox (ilk eşleşme)}`. `history.list` `q` parametresi OCR varsa bu sonuçları birleştirir ("text match" rozeti). Sonuç sayfasında eşleşen kelimeler bbox ile vurgulanır.
- Performans: ~1–3 s / 1080p tile masaüstünde; 24 000 px sayfa ≈ 12 tile ≈ 20–40 s arka planda; UI rozet "Indexing… 40%". Batch index: kuyruk, tek seferde 1 capture.
- Deneysel (`advanced.experimental.promptApiOcr`): Chrome Prompt API (`LanguageModel.create({expectedInputs:[{type:'image'}]})`, Chrome ≥138, cihaz gereksinimleri ağır) ile "bu görüntüdeki metni yaz" — bbox yok, yalnız tam metin; varsayılan kapalı.
- Searchable PDF bağlantısı: OCR sonuçları 04 §5.6 görünmez metin katmanına beslenir (`PdfOptions.searchableText:'ocr'`).

---

## 9. Presets (P2) — `REQ-DIF-110`…`116`
`Preset` (13 §6). Yerleşikler (`builtin:true`, silinemez, "Duplicate" ile türetilir):

| id | Ad | capture | export | extras |
|---|---|---|---|---|
| `bug-report` | Bug Report | `mode:'visible'` (kullanıcı fullPage seçebilir), `hideFixedElements:'never'`, `smartHide.enabled:false`, `freezeAnimations:true`, `delayMs:0` | PNG, `targets:['history','openResult']`, filename `bug_{domain}_{yyyy-mm-dd}_{time}` | `bugReport:{includeConsole:true, includeNetworkErrors:true, includeEnvironment:true, includeDomPath:true, consoleLevels:['error','warn'], maxEntries:200, format:'both'}` |
| `legal-evidence` | Legal Evidence | `fullPage`, `hideFixedElements:'auto'` (manifest'e yazılır), `smartHide.enabled:false`, `lazyLoad.enabled:true`, `dprMode:'device'`, `includeMetadata:true` | PNG + PDF (paged A4, header `{url}`, footer `{datetime} {timezone} • {page}/{pages}`), `metadata.fields` tümü, `targets:['history','download']` | `evidence:{hashAlgorithms:['SHA-256'], includeSidecarJson:true, includeReportPdf:true, embedInImage:true, includeDomSnapshot:false, rfc3161Timestamp:{enabled:false}}` |
| `design-review` | Design Review | `fullPage`, `hideFixedElements:'auto'`, `smartHide` açık (cookie, chat, newsletter, stickyBar), `freezeAnimations:true`, `dprMode:'device'` | PNG, `openResult` (editörde açılır) | — |
| `archive` | Archive | `fullPage`, `lazyLoad` agresif (`maxWaitMs:4000`), `iframes:'injectSameOrigin'`, `includeMetadata:true` | PDF single long page + PNG, `clickableLinks:true`, `searchableText:'ocr'` (OCR varsa), metadata tam, filename `{domain}_{url:60}_{yyyy-mm-dd}` | `ocrIndex:true` |
| `qa-test` | QA Test | `fullPage`, `dprMode:'css'`, `zoomHandling:'normalizeTo100'`, `hideFixedElements:'always'`, `smartHide` açık, `freezeAnimations:true`, `wait.networkIdle:{500,8000}`, `wait.fontsReady` | PNG, `targets:['history']`, filename `{domain}_{title:40}_{viewport}` | diff önerisi açık |
| `documentation` | Documentation | `element` (picker), `hideFixedElements:'always'`, `smartHide` açık, `background:'page'` | PNG 1× (`dprMode:1.5`), editörde aç | — |
| `full-page-pdf` | Full-page PDF | `fullPage` | PDF `singleLongPage`, `clickableLinks:true`, `imageFormat:'jpeg' q0.85`, auto-download | — |

- Preset editörü (Options → Presets): form = capture + export alt formları + extras; "Test on current tab"; sıralama; kısayol ataması (en fazla 4 komut olduğundan preset kısayolu yoktur — Karar: popup'ta 1–9 tuşları preset seçer).
- Import/Export JSON: `{schema:'ssx-preset/1', presets: Preset[]}`; import'ta `zod` doğrulama; id çakışmasında yeni id.
- Popup'ta preset seçici; context menu'de "Capture with preset ▸" alt menüsü (ilk 6).

---

## 10. Entegrasyonlar (P2) — `REQ-DIF-120`…`139`
Genel: `IntegrationHub` adaptör arayüzü `{ connect(), disconnect(), send(req): IntegrationSendResult, fields(): FormSchema }`. Auth `chrome.identity.launchWebAuthFlow` (`identity` izni; redirect `https://<ext-id>.chromiumapp.org/cb`). Token'lar `storage.local` (08). Tüm API çağrıları SW'den `fetch` (CSP `connect-src` listesi 02 §7.1'e provider host'ları eklenir; host izni gerekmez — `fetch` uzantı origin'inden CORS'a tabidir; bu API'ler CORS destekler; desteklemeyenler için `optional_host_permissions`). Dosya: `fileRef` (edited/pdf) ya da `full` PNG; 20 MB üstü otomatik JPEG'e düşürme teklifi.

**Token proxy (opsiyonel backend bileşeni):** `client_secret` gerektiren sağlayıcılar (Jira 3LO, Slack OAuth v2, Notion public OAuth) için minimal serverless endpoint: `POST https://<proxy>/oauth/token-exchange {provider, code, code_verifier?, redirect_uri}` → provider token endpoint'ine secret ile gider → `{access_token, refresh_token?, expires_in, ...}` döner; **hiçbir şey saklamaz**, loglamaz; CORS `Access-Control-Allow-Origin: chrome-extension://<id>`; rate limit. `POST /oauth/refresh {provider, refresh_token}`. Proxy yoksa bu sağlayıcılar **API token yapıştırma** moduna düşer (Karar: store varyantı varsayılan olarak proxy'siz gelir; proxy URL `Settings.integrations.proxyUrl`).

| Sağlayıcı | Auth | Akış / endpoint'ler | Alanlar (UI) | Limit/Not |
|---|---|---|---|---|
| **Jira Cloud** | 3LO OAuth (proxy) **veya** Basic `email:api_token` (site URL) | `POST /rest/api/3/issue` `{fields:{project:{key}, issuetype:{name}, summary, description: ADF}}` → `POST /rest/api/3/issue/{key}/attachments` multipart `file`, header `X-Atlassian-Token: no-check`. 3LO: `auth.atlassian.com/authorize` → token (proxy) → `GET api.atlassian.com/oauth/token/accessible-resources` (cloudid) → base `api.atlassian.com/ex/jira/{cloudid}`; scopes `read:jira-work write:jira-work offline_access` | site, project (liste `GET /rest/api/3/project/search`), issue type, summary, description (bug report md → ADF dönüşümü basit: paragraph/codeBlock/table→paragraph), labels | attachment boyutu site ayarına bağlı (≥10 MB); ADF zorunlu |
| **Linear** | OAuth PKCE (in-extension; secret opsiyonel) | `linear.app/oauth/authorize` (`scope=read,write,issues:create`) → `api.linear.app/oauth/token`; GraphQL `https://api.linear.app/graphql`: `fileUpload(contentType,filename,size){uploadFile{uploadUrl assetUrl headers{key value}}}` → `PUT uploadUrl` (+headers, `Cache-Control: public, max-age=31536000`) → `issueCreate(input:{teamId,title,description:"…![](assetUrl)"})` | team (`teams` query), title, description, labels, priority | — |
| **Slack** | OAuth v2 (proxy) **veya** Bot/User token yapıştırma | `files.getUploadURLExternal(filename,length)` → `POST upload_url` (binary) → `files.completeUploadExternal(files:[{id,title}], channel_id, initial_comment, thread_ts?)`; scopes `files:write chat:write channels:read` (+`groups:read`) | channel (liste `conversations.list`), comment | `files.upload` kaldırıldı (Kasım 2025); bu akış zorunlu |
| **Notion** | Public OAuth (proxy; Basic client_id:secret) **veya** internal integration token | `POST /v1/file_uploads {filename,content_type,mode:'single_part'}` → `POST /v1/file_uploads/{id}/send` (multipart `file`) → 1 saat içinde `PATCH /v1/blocks/{page}/children` `{type:'image', image:{type:'file_upload', file_upload:{id}}}` ya da page create; header `Notion-Version` (2026-03-11) | parent page/database (search), title | single-part ≤ 20 MB (free workspace 5 MiB) → büyükse JPEG düşür |
| **Trello** | Token flow (in-extension): `trello.com/1/authorize?…&response_type=token&return_url=<chromiumapp>&callback_method=fragment` | `POST /1/cards?key&token {idList,name,desc}` → `POST /1/cards/{id}/attachments` multipart `file`, `setCover` | board → list, name, desc | API key build-time sabit |
| **GitHub Issues** | OAuth PKCE web flow veya device flow veya PAT | `POST /repos/{o}/{r}/issues {title, body, labels}` (`X-GitHub-Api-Version: 2022-11-28`). Görsel: REST'te ek yok → `PUT /repos/{o}/{r}/contents/.screenshots/{file}` (base64) → `download_url` markdown'a (`![]()`); kullanıcı "görseli repo'ya yükleme" seçeneğini kapatabilir (o zaman yalnız metin) | owner/repo, title, body, labels, upload image to repo (checkbox, path) | contents API ≤ 100 MB ama pratikte < 10 MB öner |
| **Webhook** | yok / paylaşılan secret | `POST url` multipart: `metadata` (application/json: CaptureRecord özeti + bugReport/evidence) + `image` (image/png) [+ `pdf`]; header `X-SSX-Signature-256: sha256=<HMAC-SHA256(secret, rawBody)>`, `X-SSX-Timestamp`, `X-SSX-Delivery-Id`; kullanıcı ek header'ları | URL, secret, ek header'lar, "JSON only (base64 image)" modu | host izni: webhook origin için `optional_host_permissions` (CORS belirsiz) |
| **Google Drive** | OAuth (Google PKCE/`chrome.identity.getAuthToken` Chrome'da) scope `drive.file` | `POST upload/drive/v3/files?uploadType=multipart` (multipart/related: JSON metadata + media); >5 MB → resumable (`uploadType=resumable`) | klasör seçici (basit: `files.list q="mimeType='application/vnd.google-apps.folder'"`) | — |
| **Dropbox** | OAuth PKCE | `POST content.dropboxapi.com/2/files/upload` header `Dropbox-API-Arg: {"path","mode":"add","autorename":true}` ≤ 150 MB | klasör yolu | — |
| **OneDrive** | OAuth PKCE (MSAL'siz, `login.microsoftonline.com/common/oauth2/v2.0`) scope `Files.ReadWrite` | `PUT graph.microsoft.com/v1.0/me/drive/root:/{path}:/content` ≤ 250 MB | klasör yolu | — |

- Hata yönetimi: 401 → refresh (varsa) → yeniden; yine 401 → `E_AUTH` + "Yeniden bağlan"; 429 → `Retry-After` kadar bekle (max 2); ağ → `E_NETWORK`; sağlayıcı hata gövdesi `details`. Gönderim sonucu `IntegrationSendResult.url` history kaydında "Sent to Jira: PROJ-123" rozetiyle.
- UI: result sayfasında "Send to ▸" menüsü (bağlı sağlayıcılar), form modal, son kullanılan alanlar hatırlanır; Options → Integrations bağlama/çözme, proxy URL, test butonu.

---

## 11. Public API (P2) — `REQ-DIF-140`…`147`
Kısıt: `externally_connectable.matches` manifest'te **statik** → kullanıcı tanımlı allowlist imkânsız. Karar:
1. **Store varyantı** `externally_connectable` **yok** (boş) → web sayfaları mesaj gönderemez; diğer uzantılar varsayılan olarak `onMessageExternal` ile bağlanabilir (`sender.id` allowlist: `Settings.api.allowedExtensionIds`, varsayılan boş → tümü reddedilir).
2. **Build-time first-party origin'ler**: `manifest.config.ts` `API_ORIGINS` env (ör. şirket içi QA aracı) → `externally_connectable.matches` (wildcard TLD yok; `*://app.example.com/*`). `onMessageExternal` handler: `sender.origin` allowlist + `ApiRequest` zod doğrulama + `Settings.api.enabled` + ilk kullanımda kullanıcı onayı ("app.example.com bu uzantıyı kullanmak istiyor") → `ApiResponse`. Capture isteği aktif sekme değil **gönderen sekme** için çalışır (`sender.tab.id`), host izni gerekir (activeTab yok) → izin yoksa `E_PERMISSION_DENIED`.
3. **Native messaging companion / CLI** (`nativeMessaging` opsiyonel izin): host adı `com.ssx.companion`; host manifest konumları macOS `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.ssx.companion.json`, Linux `~/.config/google-chrome/NativeMessagingHosts/`, Windows `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.ssx.companion` → `{name, description, path, type:'stdio', allowed_origins:['chrome-extension://<id>/']}`. Protokol: stdin/stdout, 4 bayt little-endian uzunluk + UTF-8 JSON; mesaj limitleri **host→uzantı 1 MB**, **uzantı→host 64 MB** → görüntüler `dataUrl` yerine parça (`chunk`) mesajlarıyla ya da host'un okuyabileceği bir dosya yoluna (`chrome.downloads` ile indirip yol bildirme) aktarılır (Karar: download + path). Uzantı `chrome.runtime.connectNative` ile kalıcı port; CLI (`ssx capture <url> --full --pdf`) companion'a localhost/IPC ile konuşur; companion uzantıya `ApiRequest` iletir. Companion bu repo'nun parçası değildir (ayrı paket; P2).
4. **Uzantı içi otomasyon**: batch dosyaları (06) ve presetler — "API" ihtiyacının çoğunu karşılar.
- `ApiRequest/ApiResponse` 13 §13; `op:'capture'` → `capture.start`; `returnAs:'dataUrl'` yalnız ≤ 32 MB; `'blobRef'` yalnız uzantı-içi anlamlı → dış istemciye `captureId` + `history.get` ile; `op:'batch'`, `op:'history.query'`, `op:'diff'`, `op:'status'`.
- Güvenlik: rate limit (10 istek/dk/origin), her istek `JobLog`'a, kullanıcı Options'ta API'yi kapatabilir, her origin için ayrı onay/iptal.

---

## 12. Change Monitoring (DIFF) — `REQ-DIF-150`…`158`
**Amaç:** Bir URL'yi periyodik yeniden çekip öncekiyle diff'leyerek değişiklikte bildirim (Visualping/Distill benzeri, ama yerel).

**Dürüst kısıtlar (UI'da açık yazılır):** (1) Yalnız Chrome açıkken çalışır; (2) `captureVisibleTab` görünür pencere ister → her çalıştırmada ayrı küçük pencere açılır (06 §8 pool, `windowSize` rule'dan), ekran dışına konulamaz, birkaç saniye ekranda görünür; (3) `chrome.alarms` minimum 30 s (Chrome ≥120) ama gerçekçi taban **30 dk** (Karar: `schedule.everyMinutes ≥ 30`, varsayılan 360); alarmlar gecikebilir, uyku sonrası toplu tetiklenebilir (tek seferde en fazla 1 rule çalışır, diğerleri sıraya); (4) host izni (`<all_urls>` veya origin) zorunlu; (5) `cdp` varyantında pencere yine gerekir (debugger da sekme ister) — fark yok.

**Akış:** `monitor.upsert(rule)` → `chrome.alarms.create('monitor:'+id,{periodInMinutes})` → `onAlarm` → `activeHours/days` kontrolü → `BatchRunner` tek öğe (06 §15) → yeni `CaptureRecord (source.monitorRuleId)` → `diff.run(lastCaptureId, newId, rule.diff)` → `changedPct > notifyThresholdPct` ise `chrome.notifications.create` ("example.com değişti: %12.4 — Görüntüle") tıklanınca `compare.html`; `rule.lastRunAt/lastCaptureId/nextRunAt` güncellenir. Başarısız çalıştırma (`E_NETWORK` vb.) 1 kez 5 dk sonra retry, sonra bir sonraki periyot; 3 ardışık hata → bildirim + rule `enabled:false`? Karar: devre dışı bırakılmaz, uyarı rozeti.
- Depolama: her çalıştırma history'ye yazar → kota büyür; rule başına `keepLast` (varsayılan 20; eski ara kayıtlar silinir, **değişiklik tespit edilenler korunur**).
- `onStartup`/`onInstalled`'da alarmlar yeniden kurulur (persist garantisi yok; `persistAcrossSessions` Chrome 150+ varsa kullanılır).
- UI: Options → Monitoring: rule listesi (URL, periyot, son çalışma, son %), "Run now", timeline'a git, düzenle (ignore regions = compare'de çizilir), sil.

---

## 13. Otomatik QA Akışları (DIFF) — `REQ-DIF-160`…`163`
- "QA Run" = batch (URL listesi, QA Test preset) + her öğe için **baseline** ile diff: baseline = aynı URL'nin `tags:['baseline']` etiketli son kaydı (kullanıcı history'de "Set as baseline"); yoksa ilk run baseline olur.
- Sonuç ekranı: tablo URL × changedPct × durum (`pass` < eşik, `fail` ≥ eşik, `new` baseline yok, `error`); tıklayınca compare. Eşik batch formunda (`qa.thresholdPct`, varsayılan 0.5).
- Export (P2): `qa-report.json` (JUnit benzeri: `{suite, runAt, cases:[{name:url, status, changedPct, diffId, captureId, baselineId, durationMs, error?}]}`) + HTML özet (yerel dosya, statik).
- Batch bitiminde "Tümünü yeni baseline yap" toplu aksiyonu.

---

## 14. Kabul Kriterleri
| ID | Kriter |
|---|---|
| AC-DIF-01 | Aynı sayfanın iki capture'ında tek bir butonun rengi değiştiğinde diff 1 bölge döner, bbox butonu ±4 px ile sarar, `changedPct` < %1. |
| AC-DIF-02 | Farklı yükseklikte (12 000 vs 13 500 px) iki görüntü diff'lenince ek 1 500 px `added` bölgesi olarak raporlanır, diğer kısım piksel bazlı karşılaştırılır, crash yok. |
| AC-DIF-03 | `ignoreRegions` ile işaretlenen saat/tarih alanı diff'e girmez (`changedPct` 0). |
| AC-DIF-04 | 69 M px görüntü çifti diff'i < 5 s (downscale), bellek < 600 MB. |
| AC-DIF-05 | Smart hide: OneTrust banner + Intercom widget + sticky newsletter bar içeren test sayfasında üçü de gizlenir, site navbar'ı kalır; consent'e tıklanmaz (sayfa cookie'si değişmez). |
| AC-DIF-06 | Smart hide `remove` modunda sticky bar'ın kapladığı alan geri kazanılır; capture sonrası restore ile sayfa eski haline döner. |
| AC-DIF-07 | Evidence bundle: `evidence.json`'daki SHA-256, `capture.png` için `shasum -a 256` ile birebir eşleşir; PNG iTXt chunk içinde manifest okunabilir; rapor PDF'te hash ve beyan sayfası var. |
| AC-DIF-08 | TSA etkinken freetsa.org'dan alınan `timestamp.tsr` `openssl ts -verify` ile doğrulanır; TSA erişilemezse capture yine tamamlanır ve manifest `warnings` içerir. |
| AC-DIF-09 | Bug report preset aktifken sayfa açılışındaki `console.error` raporda görünür; preset kapalıyken yalnız capture sonrası loglar ve UI kısıt notu gösterilir. |
| AC-DIF-10 | `report.md` şablona uyar; ZIP içinde `screenshot.png, report.md, report.json` bulunur; Jira gönderiminde md açıklamaya, ZIP eke dönüşür. |
| AC-DIF-11 | OCR: `eng+tur` ile Türkçe/İngilizce karışık 1080p görüntüde kelime doğruluğu ≥ %90 (temiz metin); `ocr.search "fatura"` ilgili kaydı bulur ve bbox vurgular; çevrimdışı çalışır (ağ isteği 0). |
| AC-DIF-12 | Yerleşik 7 preset tabloyla birebir ayarlarla gelir; preset import/export JSON round-trip kayıpsız. |
| AC-DIF-13 | Linear PKCE akışı proxy'siz tamamlanır; issue oluşur ve görsel açıklamada görünür. Slack, proxy yokken "token yapıştır" modunda `getUploadURLExternal` akışıyla dosya paylaşır. |
| AC-DIF-14 | Webhook: alıcı HMAC-SHA256'yı doğrular; `metadata` + `image` part'ları gelir. |
| AC-DIF-15 | Monitor: 30 dk periyotlu rule, Chrome açıkken çalışır, eşik üstü değişiklikte bildirim çıkar, bildirim compare sayfasını açar; `keepLast` uygulanır. |
| AC-DIF-16 | Public API: allowlist dışı origin/uzantıdan gelen mesaj `E_PERMISSION_DENIED`; izinli origin ilk kullanımda onay ister, sonra `op:'capture'` çalışır. |
| AC-DIF-17 | QA Run: 10 URL, 2'si değişmiş → tablo 8 pass / 2 fail; fail satırı compare'i açar. |

### 13'e eklenecek tipler (özet)
- `Settings.capture.smartHideOverrides: Record<string, {disabled?: boolean; extra?: string[]; never?: string[]}>`
- `EvidenceManifest.image.sha256Embedded?: Sha256Hex`
- `Settings.integrations.proxyUrl?: Url`; `Settings.api: { enabled: boolean; allowedExtensionIds: string[]; approvedOrigins: string[] }`
- `MonitorRule.keepLast: number`
- `BatchJobInput.qa?: { enabled: boolean; thresholdPct: Percent; baselineTag: string }`; `BatchControl.fallbackToFullPage`, `pdfChunkSize`; `BatchItem.notBefore?: IsoDate`; template değişkenleri `{itemName}`, `{attempt}`.
