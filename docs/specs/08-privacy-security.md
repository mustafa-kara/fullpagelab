# 08 — Privacy ve Güvenlik

> Local-first ilkesi, veri envanteri, izin stratejisi, CSP/remote-code uyumu, content script izolasyonu, tehdit modeli, redaction garantileri, telemetri/cloud opt-in kuralları, incognito, veri saklama/silme, güvenli varsayılanlar, PR güvenlik kontrol listesi, bağımlılık/supply-chain politikası. Gereksinim ID önek: `REQ-SEC-*`. Tipler `13-data-contracts.md`.

İçindekiler: 1 Temel ilke · 2 Veri envanteri · 3 İzin stratejisi · 4 Bağlamsal izin akışları · 5 CSP ve remote-code · 6 Content script izolasyonu · 7 Tehdit modeli · 8 Redaction garantileri · 9 Telemetri / crash / cloud · 10 Incognito · 11 Saklama, silme, şifreleme · 12 Güvenli varsayılanlar · 13 PR güvenlik kontrol listesi · 14 Bağımlılık ve supply chain · 15 Kabul kriterleri

---

## 1. Temel İlke (`REQ-SEC-001`)

**Varsayılan olarak screenshot'lar cihazdan ayrılmaz.** Hiçbir görüntü, URL, başlık, OCR metni veya metadata; kullanıcı açıkça bir dış hedef (entegrasyon, webhook, TSA, cloud) seçmeden ağa gönderilmez.

Kullanıcıya gösterilen tam cümle (i18n anahtarı `privacy.tagline`):
- `en`: **"Screenshots never leave your browser unless you choose to upload them."**
- `tr`: **"Ekran görüntüleri siz yüklemeyi seçmedikçe tarayıcınızdan asla çıkmaz."**

Bu cümle onboarding'de, Options → Privacy sekmesinde, Web Store açıklamasında ve gizlilik politikasında **aynen** yer alır (REQ-SEC-002). Kod tarafında bu ilke `IntegrationHub`, `Telemetry`, `EvidenceBuilder(tsa)` ve `ExternalApi` dışındaki hiçbir modülün `fetch`/`XMLHttpRequest`/`navigator.sendBeacon` kullanmamasıyla garanti edilir; ESLint kuralı `no-restricted-globals` ile `fetch` bu dört modül dışında yasaklanır (`REQ-SEC-003`; istisna listesi `eslint.config.js` içinde açık).

---

## 2. Veri Envanteri (`REQ-SEC-010`)

| Veri | Nerede | Cihazdan çıkar mı? | Ne zaman / nasıl | Silinme |
|---|---|---|---|---|
| Görüntüler (full/strip/edited/pdf) | IndexedDB `blobs`, OPFS (>50 MB) | Hayır (varsayılan) | Yalnızca kullanıcı: download (yerel disk), clipboard (yerel), entegrasyon/webhook/cloud (opt-in, her gönderim kullanıcı eylemi) | History silme, Clear all, uninstall |
| Thumbnail (320 px WebP) | IndexedDB `blobs` | Hayır | — | Kayıtla birlikte |
| Capture metadata (`CaptureRecord`: url, title, domain, boyut, mod, ayarlar, tarih) | IndexedDB `captures` | Hayır (varsayılan) | Entegrasyona gönderimde başlık/URL kullanıcı onayıyla mesaj gövdesine eklenir | Kayıtla birlikte |
| Geçici tile'lar | IndexedDB `tiles` | Hayır | — | Job bitince/hatada hemen; SW start'ta yetim temizliği |
| Settings / presets | `chrome.storage.local` | Hayır | — | Reset / Clear all / uninstall |
| Aktif job state | `chrome.storage.session` | Hayır | — | Profil kapanınca |
| Entegrasyon token'ları (`IntegrationAccount.auth`) | `chrome.storage.local` (**asla** `storage.sync`) | Hayır — sadece ilgili sağlayıcının API'sine `Authorization` header'ı olarak | Kullanıcı "Connect" yaptıktan sonra her gönderimde | Disconnect, Clear all |
| OCR metin indeksi | IndexedDB `ocrDocs` | Hayır | — | Kayıtla birlikte / OCR index temizle |
| Diff sonuçları, monitor kuralları | IndexedDB `diffs`, `monitors` | Hayır | — | İlgili silme |
| Evidence manifest (hash, UA, viewport, TZ) | IndexedDB `captures.evidence`, sidecar JSON (download) | Yalnızca TSA seçildiyse **sadece hash** (görüntü değil) TSA sunucusuna gider | `EvidenceOptions.rfc3161Timestamp.enabled` | Kayıtla birlikte |
| Bug report (console, env) | IndexedDB `captures.bugReport` | Hayır (entegrasyona eklenmesi kullanıcı onaylı) | — | Kayıtla birlikte |
| Job/batch logları | `storage.session` ring buffer, IndexedDB `batches.log` | Hayır; "Copy diagnostics" kullanıcı panoya kopyalar | — | — |
| Telemetri (opt-in) | Gönderilmez (varsayılan) | Evet, **yalnızca** opt-in; içerik §9 | — | Opt-out anında durur |

`REQ-SEC-011`: Envanter `options.html` → Privacy → "What we store" bölümünde insan-okur tablo olarak gösterilir.
`REQ-SEC-012`: Hassas metadata (URL, title, OCR metni, console logları, kullanıcı notları) **hiçbir** otomatik süreçle sunucuya gönderilmez; telemetri şeması bu alanları tip düzeyinde içeremez (§9).

---

## 3. İzin Stratejisi (`REQ-SEC-020`…`029`)

### 3.1 İlkeler
- En az yetki: varsayılan kurulumda **host izni yok**, `<all_urls>` yok. Kurulum uyarısı yalnızca "Read your browsing history"... gibi metinler çıkmasın diye `tabs` dahi opsiyoneldir.
- `activeTab` + `scripting`: kullanıcı jesti (toolbar tıklaması, kısayol, context menu, side panel) o sekme için geçici erişim verir; navigasyon/sekme kapanınca düşer. Full-page capture'ın tamamı bu modelle çalışır (`REQ-SEC-020`).
- `debugger` opsiyonel olamaz → **store build'inde yoktur** (02 §7.3). `cdp` varyantı self-hosted dağıtılır (14).
- Her opsiyonel izin, yalnızca o özellik ilk kullanıldığında, kullanıcı jesti içinde istenir; reddedilince özellik degrade olur, uygulama çalışmaya devam eder (`REQ-SEC-021`).
- Options → Permissions sekmesi: verilmiş tüm opsiyonel izinler listelenir ve tek tıkla geri alınabilir (`chrome.permissions.remove`) (`REQ-SEC-022`).

### 3.2 İzin tablosu ve gerekçe metinleri
Aşağıdaki metinler hem Web Store "permission justification" alanında hem uygulama içi izin kartında (i18n `perm.<key>.rationale`) kullanılır.

| İzin | Tür | Ne açar | Gerekçe (EN, store + in-app) |
|---|---|---|---|
| `activeTab` | statik | Tıklanan sekmede capture + content script | "Lets the extension capture and scroll the page you're currently looking at, only after you click the icon, press the shortcut or use the context menu. Access ends when you leave the page." |
| `scripting` | statik | Page agent enjeksiyonu | "Needed to inject the small helper script that scrolls the page, hides sticky headers and measures content during a capture. Runs only on the tab you triggered." |
| `storage` | statik | Settings, job state | "Stores your preferences and the capture in progress locally." |
| `unlimitedStorage` | statik | History blob'ları | "Screenshots are large; this lets your local screenshot history grow beyond the default quota. Everything stays on your device." |
| `downloads` | statik | Dosya kaydetme, filename template, alt klasör | "Saves screenshots and PDFs to your Downloads folder with the file name pattern you choose." |
| `offscreen` | statik | Stitch/encode/PDF/OCR worker'ları | "Processes images (stitching, encoding, PDF) in a hidden extension page so the browser stays responsive." |
| `contextMenus` | statik | Sağ tık menüsü | "Adds 'Capture…' entries to the right-click menu." |
| `alarms` | statik | Zamanlanmış recapture/monitoring, kota bakımı | "Schedules optional periodic recaptures for change monitoring and runs housekeeping on local storage." |
| `sidePanel` | statik | Side panel UI | "Shows the capture panel and previews in Chrome's side panel." |
| `tabs` | opsiyonel | All-tabs capture, batch (URL/title okuma, sekme listesi) | "Required only for 'Capture all tabs' and batch capture, to read tab titles/URLs and switch between tabs. Requested when you first use these features." |
| `clipboardWrite` | opsiyonel | Sayfa içinden panoya görüntü yazma (result sekmesi açılmadan) | "Lets 'Copy to clipboard' work instantly from the page, without opening a result tab." |
| `notifications` | opsiyonel | Capture/batch/monitoring tamamlandı ve hata bildirimleri | "Shows an optional local notification when a capture, batch or monitoring check finishes. No page content is sent anywhere." |
| `webRequest` | opsiyonel | Bug Report modunda ağ hataları ve HTTP ≥400 kayıtları | "Used only when you enable network details in Bug Report mode to record failed requests for the selected tab. No request bodies are collected." |
| `identity` | opsiyonel | OAuth (Jira/Linear/Slack/Notion/Trello/GitHub/Drive…) | "Used only to sign in to a third-party service you choose to connect (e.g. Jira, Slack). No account data is collected by the extension." |
| `webNavigation` | opsiyonel | iframe ağacı (`getAllFrames`) | "Needed to capture the inside of iframes on complex pages. Requested when you choose 'Capture this frame'." |
| `nativeMessaging` | opsiyonel (P2) | CLI/companion | "Enables the optional local command-line companion. Never used unless you install it." |
| `optional_host_permissions: <all_urls>` | opsiyonel | Batch URL capture (sekmeyi biz açıyoruz, jest yok), cross-origin iframe içi, monitoring | "Batch capture and change monitoring open pages on their own, so they can't rely on a click per page. Grant this only if you use those features; you can limit it to specific sites or revoke it anytime." |
| `debugger` | **sadece `cdp` varyantı**, statik | CDP backend, native printToPDF, console history | Store build'ine girmez. cdp varyantı açıklaması: "Uses Chrome's DevTools protocol for faster, sharper full-page captures and PDFs with selectable text. Chrome shows a 'started debugging' bar during capture." |

`REQ-SEC-023`: `PermissionBroker.requires(feature)` eşlemesi (`FeatureKey` → izin listesi):
```ts
const FEATURE_PERMISSIONS: Record<FeatureKey, { permissions: string[]; origins: string[] }> = {
  allTabs:       { permissions: ['tabs'], origins: [] },
  batch:         { permissions: ['tabs'], origins: ['<all_urls>'] },   // UI'da "sadece şu siteler" seçeneği → origins daraltılır
  iframeInject:  { permissions: ['webNavigation'], origins: ['<all_urls>'] },   // ya da frame origin'i (`https://frame-host/*`)
  integrations:  { permissions: ['identity'], origins: [] },            // API origin'leri CSP connect-src'te; host izni gerekmez (fetch CORS ile)
  monitoring:    { permissions: ['tabs'], origins: ['<all_urls>'] },   // ya da kural URL origin'i
  notifications: { permissions: ['notifications'], origins: [] },
  bugReportNetwork: { permissions: ['webRequest'], origins: ['<all_urls>'] },
  tsa:           { permissions: [], origins: [] },                         // tsa origin'i kullanıcı jestinde bağlamsal host izni ister
  webhook:       { permissions: [], origins: [] },                         // webhook origin'i kullanıcı jestinde bağlamsal host izni ister
  nativeApi:     { permissions: ['nativeMessaging'], origins: [] },
  incognitoBatch:{ permissions: [], origins: [] },                      // kullanıcı chrome://extensions'ta "Allow in Incognito" açmalı; UI yönlendirir
  fileUrls:      { permissions: [], origins: [] },                      // "Allow access to file URLs" ayarı; UI yönlendirir
};
```
`REQ-SEC-024`: `iframeInject`, `monitoring`, `bugReportNetwork`, `tsa` ve `webhook` için önce **dar origin** (`https://<host>/*`) istenir; kullanıcı "tüm siteler" seçerse `<all_urls>`. `PermissionBroker.requires(feature, context?)` dinamik olarak seçilen origin'i `missing.origins` içine koyar; statik `FEATURE_PERMISSIONS` yalnızca API izin adlarını ve varsayılan fallback'i tanımlar.

### 3.3 Neden `<all_urls>` varsayılan değil
- Kurulum uyarısı ("Read and change all your data on all websites") güveni ve dönüşümü düşürür; rakip FireShot'ın bu yüzden şikayet aldığı raporlanmıştır.
- Web Store incelemesi "narrowest permissions" ister; activeTab tüm P0 akışları için yeterlidir.
- Batch/monitoring gibi jestsiz akışlar için kullanıcı özelliği açarken bilinçli karar verir.

---

## 4. Bağlamsal İzin Akışları (`REQ-SEC-030`)
1. Özellik tetiklenir → `permissions.check {feature}` → `PermissionStatus`.
2. `granted:false` ise extension UI izin kartı: başlık, gerekçe (`rationaleKey`), "Allow" (popup/options/result gibi kullanıcı jesti taşıyan extension sayfasında `chrome.permissions.request`), "Not now". Service worker yalnızca kontrol/route eder; izin isteme çağrısını başlatmaz. Kart `missing.permissions` ve `missing.origins`'i madde madde listeler.
3. Kabul → özellik devam; red → degrade yolu (örn. iframe: `pixelsOnly` + uyarı; batch: özellik kullanılamaz, kart kalır).
4. `chrome.permissions.onRemoved` dinlenir: monitoring kuralları `enabled:false` yapılır ve kullanıcıya bildirilir.
5. İzin kartı asla otomatik tekrar açılmaz; "Not now" kaydedilir (`storage.local.permissionPromptsDismissed[feature]`), özellik tekrar tıklanınca yine çıkar.

---

## 5. CSP ve Remote-Code Uyumu (`REQ-SEC-040`…`045`)
- `content_security_policy.extension_pages`: `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' <entegrasyon API origin'leri> <TSA origin'leri>; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'`. `'unsafe-inline'` yalnızca style için (Fabric/Preact inline style); script için **asla**. (`REQ-SEC-040`)
- `connect-src` allowlist manifestte statik; webhook hedefleri kullanıcı tanımlı olduğundan `connect-src` ile çatışır → Karar: webhook ve özel TSA URL'leri için `connect-src https:` eklenir (yalnızca https), http webhook reddedilir. (`REQ-SEC-041`)
- Remote code yasağı: tüm JS/WASM bundle içinde; Tesseract core WASM ve `*.traineddata.gz` `public/assets/ocr/` altında paketlenir (uzaktan indirme yok — bundle boyutu için yalnızca `eng` + `tur` varsayılan, diğer diller ayrı "language pack" sürümleriyle — **ayrı uzantı sürümü**, uzaktan yükleme değil). `eval`, `new Function`, `setTimeout(string)` yasak (ESLint `no-eval`, `no-implied-eval`, `no-new-func`). (`REQ-SEC-042`)
- `wasm-unsafe-eval` sadece OCR/encoder WASM'ları için; PR şablonunda gerekçe zorunlu. (`REQ-SEC-043`)
- `WaitConditions.customJs: never` — kullanıcı tanımlı JS çalıştırılmaz (hem policy hem güvenlik). (`REQ-SEC-044`)
- `web_accessible_resources` minimum: picker/overlay fontları ve ikonlar; `use_dynamic_url:true`. (`REQ-SEC-045`)

---

## 6. Content Script İzolasyonu (`REQ-SEC-050`…`056`)
- Tüm CS UI'ları (`ProgressOverlay`, `SelectionOverlay`, `ElementPicker`, countdown) tek bir host elementin **closed Shadow DOM**'u içinde; host `<ssx-root>` custom tag, `all:initial` + kendi CSS'i, `z-index:2147483647`. Sayfa CSS'i overlay'i etkileyemez, sayfa JS'i shadow root'a erişemez (closed). (`REQ-SEC-050`)
- CS, sayfadan gelen hiçbir string'i `innerHTML`/`insertAdjacentHTML` ile işlemez; rozet metni (`tag#id.class`) `textContent` ile. ESLint `no-unsanitized` kuralı CS ve UI'da aktif. (`REQ-SEC-051`)
- CS'nin `window`'a eklediği tek şey `__ssx_agent_v1` ve `__ssx_jobId` (isolated world — sayfa göremez). Main-world `ConsoleTap` ise `window.__ssx_consoleTap` kullanır ve sadece `postMessage` ile `{source:'ssx-console-tap', nonce}` yayar; isolated world nonce doğrular. (`REQ-SEC-052`)
- CS, SW'den gelen mesajları `chrome.runtime.onMessage`/Port ile alır; `sender.id === chrome.runtime.id` kontrolü zorunlu (başka uzantılar `externally_connectable` ile CS'e ulaşamaz ama savunma derinliği). (`REQ-SEC-053`)
- Sayfanın `window.postMessage`'ı CS'yi etkileyemez; CS yalnızca ConsoleTap nonce'lu mesajları dinler. (`REQ-SEC-054`)
- Enjekte edilen `<style id="ssx-style-<jobId>">` ve tüm `data-ssx-*` izleri restore'da kaldırılır (03 §16). (`REQ-SEC-055`)
- CS, sayfa prototiplerini (Array/Element) değiştirmez; `Element.prototype.getBoundingClientRect` gibi fonksiyonların sayfa tarafından override edilmiş olabileceği göz önünde bulundurulur → kritik ölçümler `Object.getOwnPropertyDescriptor` ile **değil** (isolated world'ün kendi prototipleri temizdir) — isolated world zaten ayrı JS dünyasıdır; not olarak kalsın. (`REQ-SEC-056`)

---

## 7. Tehdit Modeli (`REQ-SEC-060`…`072`)

| # | Tehdit | Etki | Önlem |
|---|---|---|---|
| T1 | Kötü niyetli sayfa picker/overlay'i taklit eder (sahte "Capture" butonu) | Kullanıcı yanıltılır | Overlay closed Shadow DOM; tıklamalar sadece bizim shadow içinde; picker seçimi yalnızca CS'nin kendi overlay'inden SW'ye gider; sayfa `postMessage` ile `pickerEvent` üretemez (`REQ-SEC-060`) |
| T2 | Sayfa, uzantıya mesaj göndererek capture başlatır/verileri okur | Veri sızıntısı | `onMessageExternal` yalnızca `externally_connectable.matches` origin'lerinden; store build'inde liste **boş**; SW her mesajda `sender.id`/`sender.origin` doğrular; CS'den gelen mesajlar `sender.tab.id === job.tabId` ile eşlenir (`REQ-SEC-061`) |
| T3 | Sayfa, uzantı storage'ını/IDB'sini okur | — | Mümkün değil (origin izolasyonu); `storage.session` `setAccessLevel` **TRUSTED_CONTEXTS** (varsayılan) kalır (`REQ-SEC-062`) |
| T4 | Popup clickjacking | — | Popup/side panel sayfa içinde iframe'lenemez (`frame-ancestors 'none'`, Chrome zaten engeller) |
| T5 | Selector injection (kullanıcı/batch girdisi) | CS'de hata/DoS | `document.querySelector` try/catch → `E_VALIDATION`; selector uzunluğu ≤ 1000; sadece CSS selector — XPath yok (`REQ-SEC-063`) |
| T6 | Filename/path traversal (`{title}` içinde `../`, `C:\`, null byte) | Downloads dışına yazma | 13 §12 sanitizer; `subfolder` `..`/mutlak yol reddi; `chrome.downloads` zaten göreli yol zorlar; unit test seti (`REQ-SEC-064`) |
| T7 | PDF link injection (`javascript:`, `data:`, `file:` href) | Okuyucuda kod çalışması | `LinkRect.href` yalnızca `http:`, `https:`, `mailto:`, `tel:` (URL parse + protocol allowlist); diğerleri atılır (`REQ-SEC-065`) |
| T8 | OCR metni / sayfa başlığı ile UI XSS | UI'da script | Tüm render `textContent`/Preact text node; `dangerouslySetInnerHTML` yasak (ESLint) (`REQ-SEC-066`) |
| T9 | Entegrasyon token hırsızlığı | Hesap erişimi | Token `storage.local` (profil içi), `sync`'e yazılmaz; loglara yazılmaz (`log.ts` redaction: `/token|secret|authorization/i` anahtarlarını `***` yapar); Disconnect token'ı siler ve mümkünse sağlayıcıda revoke eder (`REQ-SEC-067`) |
| T10 | Webhook SSRF (kullanıcı `http://169.254.169.254`, `http://localhost`) | İç ağ erişimi | Sadece `https:`; hostname özel aralıklarda/`localhost`/`.local`/`.internal` ise uyarı ve açık onay (engel değil — kullanıcının kendi makinesi) (`REQ-SEC-068`) |
| T11 | Kötü niyetli uzantı bizim SW'ye `runtime.sendMessage` atar | Yetkisiz işlem | `externally_connectable` tanımlı olduğunda diğer uzantılar bağlanamaz; `onMessageExternal` her zaman `sender.id` allowlist (`REQ-SEC-069`) |
| T12 | Evidence manifest sahteciliği | Kanıt değeri düşer | Hash görüntü üzerinden hesaplanır; manifest kendi hash'ini içerir; TSA token hash'i bağlar; UI "bu kayıt cihazda üretildi, kanıt zinciri için TSA kullanın" açıklaması (`REQ-SEC-070`) |
| T13 | Batch'te uzantı kendi açtığı sayfalarda phishing/auto-login sayfalarına düşer | Kullanıcı oturumu kullanılır | Batch sekmeleri kullanıcının mevcut profilinde açılır (bilinçli seçim, cookie'li sayfalar için gerekli); `useIncognito` seçeneği; ön uyarı metni (`REQ-SEC-071`) |
| T14 | Büyük sayfa ile bellek DoS | Tarayıcı çökmesi | Limitler (`CaptureLimits`), strip'leme, memory budget (`REQ-SEC-072`) |

---

## 8. Redaction Garantileri (`REQ-SEC-080`…`086`)
- **Blur/pixelate tersine çevrilebilir olabilir** (düşük blur yarıçapı, küçük blok, OCR/ML ile geri kazanım). UI: blur/pixelate aracı seçilince tek seferlik ipucu: "Hassas bilgi için *Redact* kullanın — blur geri alınabilir." (`REQ-SEC-080`)
- **Redact** (`Annotation.type:'redact'`): commit anında base bitmap'in o bölgesi opak renkle `fillRect` edilir ve **yeni base** üretilir; orijinal base bellekten ve (ayara göre) depodan silinir. Redact katmanı sonradan taşınamaz/silinemez; undo yalnızca commit öncesi. Export'ta redact her zaman uygulanmış haldedir; "include annotations:false" bile redact'ı kaldıramaz. (`REQ-SEC-081`)
- `Settings.history.keepOriginalsAfterEdit`: `true` (varsayılan) → düzenlenmiş kopya ayrı `CaptureFile{role:'edited'}`; **redact içeren** düzenlemelerde kullanıcıya sorulur: "Orijinali de sil?" (varsayılan evet) — redaction'ın amacı orijinalin kalmamasıdır. (`REQ-SEC-082`)
- Redact sonrası thumbnail **yeniden üretilir** (eski thumbnail hassas bölgeyi içerebilir) ve OCR indeksi o kayıt için silinir/yeniden çalıştırılır. (`REQ-SEC-083`)
- Evidence: redact edilmiş görüntü farklı hash üretir; evidence manifest'i olan bir kaydı düzenlemek yeni bir kayıt (`recaptureOf`/`editedFrom`) oluşturur, orijinal evidence kaydı değişmez. (`REQ-SEC-084`)
- Blur/pixelate için minimum güvenli değerler: blur ≥ 12 px, pixelate blok ≥ 16 px önerilir; daha düşükte uyarı rozeti. (`REQ-SEC-085`)
- Redact rengi `#000` varsayılan, `#fff` ve özel renk; desen yok (desen geri analiz kolaylaştırır). (`REQ-SEC-086`)

---

## 9. Telemetri, Crash Raporları, Cloud (`REQ-SEC-090`…`097`)
- Telemetri **varsayılan kapalı**; onboarding'de opsiyonel toggle (önceden işaretli DEĞİL). (`REQ-SEC-090`)
- Açıksa gönderilen şema (tip düzeyinde kısıtlı, `TelemetryEvent`): `{ appVersion, browser: {name, major}, os, locale, event: 'capture'|'export'|'error', mode, format, durationBucket, sizeBucket, errorCode, stripsBucket }` — **URL, title, domain, metin, görüntü, dosya adı, selector yok**. Zod şeması ile gönderim öncesi doğrulanır; bilinmeyen alan → event düşürülür. (`REQ-SEC-091`)
- Endpoint: tek origin (`https://telemetry.<domain>/v1/events`), `connect-src`'te; toplu ve en fazla günde 1 gönderim; `navigator.sendBeacon` değil `fetch` (kontrol için). Kullanıcı ID yok; rastgele günlük rotasyonlu `sessionSalt` (kalıcı ID yok). (`REQ-SEC-092`)
- Crash raporları (stack trace) **kapalı**; açılırsa stack trace'ler dosya yolu/satır dışında veri içermez; hata mesajlarından URL ve dosya adı regex ile temizlenir. Karar: V1'de crash raporlama **uygulanmaz**; bunun yerine "Copy diagnostics" (14). (`REQ-SEC-093`)
- Cloud upload (Drive/Dropbox/OneDrive/webhook): her gönderim kullanıcı eylemidir; "her capture'ı otomatik yükle" ayarı varsa ilk açılışta açık onay diyaloğu + Options'ta kalıcı gösterge. (`REQ-SEC-094`)
- Store listing ve gizlilik politikası: telemetri opt-in olduğu, ne toplandığı, hiçbir ekran görüntüsünün toplanmadığı açıkça yazılır (14). (`REQ-SEC-095`)
- Entegrasyon gönderimlerinde önizleme: gönderilecek görüntü + metin + metadata listesi kullanıcıya gösterilir, "Send" ile onaylanır. (`REQ-SEC-096`)
- Uzantı hiçbir zaman arka planda güncelleme/duyuru için ağa çıkmaz; "What's new" yerel sayfadır. (`REQ-SEC-097`)

---

## 10. Incognito (`REQ-SEC-100`…`103`)
- Manifest `"incognito": "spanning"` (Karar): tek SW; incognito sekme `tab.incognito === true`. `split` modu batch/monitoring state'ini ikiye böler ve offscreen tekilliği ile çatışır.
- Incognito sekmelerden alınan capture'lar **history'e yazılmaz** (varsayılan); sonuç sekmesi açılır, indirme/pano çalışır; `Settings.privacy.storeIncognitoCaptures:false` (ayar eklenir). (`REQ-SEC-100`)
- Incognito'da thumbnail/OCR üretilmez; result sekmesi kapanınca geçici blob'lar silinir. (`REQ-SEC-101`)
- Incognito sekmesinden entegrasyon gönderimi yapılabilir (kullanıcı eylemi) ama "incognito" rozeti gösterilir. (`REQ-SEC-102`)
- Kullanıcı "Allow in Incognito" açmamışsa uzantı orada çalışmaz; batch `useIncognito` seçeneği bu durumda devre dışı ve yönlendirme gösterir. (`REQ-SEC-103`)

---

## 11. Saklama, Silme, Şifreleme (`REQ-SEC-110`…`116`)
- **Clear all data** (Options → Privacy): IDB tüm store'lar, OPFS dizini, `storage.local`, `storage.session`, entegrasyon token'ları (önce best-effort revoke), alarms, monitor kuralları. İki aşamalı onay; işlem sonunda `StorageStats` sıfır gösterilir. (`REQ-SEC-110`)
- Seçici silme: history kaydı silinince `blobs.refCount` düşürülür, 0 → blob silinir; OPFS dosyası silinir; OCR indeks satırları silinir. (`REQ-SEC-111`)
- Otomatik temizlik (`Settings.history.autoCleanup`) yalnızca kota/maxItems aşımında; `starred` kayıtlar otomatik silinmez. (`REQ-SEC-112`)
- Uninstall: Chrome uzantı origin'inin IDB/OPFS/storage'ını siler; onboarding ve Options'ta not: "Uzantıyı kaldırırsanız tüm geçmiş silinir — önce dışa aktarın." `chrome.runtime.setUninstallURL` **kullanılmaz** (ağ). (`REQ-SEC-113`)
- Şifreleme: Karar — uygulama düzeyinde şifreleme **yok**; tarayıcı profili ve OS disk şifrelemesine güvenilir. Gerekçe: anahtar yönetimi (parola unutma = veri kaybı) ve performans. P2: opsiyonel passphrase ile `AES-GCM` (WebCrypto, PBKDF2 310k iter) blob şifreleme ve kilitli history. (`REQ-SEC-114`)
- Veri dışa aktarım (`history.export` + "Export all as ZIP" + settings JSON) — taşınabilirlik. (`REQ-SEC-115`)
- Loglar kişisel veri içermez: URL'ler loglarda `origin` düzeyine indirgenir (`https://example.com/…`), dosya adları hash'lenir (`debugLogging:true` ise tam). (`REQ-SEC-116`)

---

## 12. Güvenli Varsayılanlar (`REQ-SEC-120`)

| Ayar | Varsayılan |
|---|---|
| `privacy.telemetry` | `false` |
| `privacy.crashReports` | `false` |
| `privacy.embedMetadataDefault` (PNG/PDF içine URL/zaman gömme) | `false` (kullanıcı "document/evidence" presetlerinde açar; paylaşılan görüntüde URL sızıntısını önler) |
| `privacy.storeIncognitoCaptures` | `false` |
| `history.ocrAutoIndex` | `false` |
| `integrations.*.enabled` | `false` |
| `export.download.saveAs` | `false` (Downloads/alt klasör) |
| `capture.iframes` | `injectSameOrigin` |
| `capture.smartHide.enabled` | `false` (kullanıcı açar; içerik değiştirme kullanıcı kararı) |
| Optional izinler | hiçbiri |
| `externally_connectable.matches` | boş |
| Webhook protokolü | yalnızca https |
| Editör redact rengi | `#000` |
| `history.keepOriginalsAfterEdit` | `true` (redact hariç; redact'ta sorulur) |

---

## 13. PR Güvenlik Kontrol Listesi (`REQ-SEC-130`)
Her PR şablonunda işaretlenmesi zorunlu:
- [ ] Yeni `fetch`/ağ çağrısı yok **veya** §1'deki izinli modüllerden birinde ve `connect-src` güncellendi.
- [ ] Yeni izin eklenmedi **veya** `manifest.config.ts` + §3 tablo + store gerekçesi güncellendi.
- [ ] Sayfadan/kullanıcıdan gelen string'ler `textContent` ile render ediliyor; `innerHTML`/`dangerouslySetInnerHTML` yok.
- [ ] Mesaj handler'ları payload'ı `zod` ile parse ediyor; `sender` doğrulanıyor.
- [ ] Dosya adı/yol üreten kod `sanitizeFilename`/`sanitizeSubfolder` kullanıyor.
- [ ] Loglara token/URL/içerik yazılmıyor (`log.ts` redaction'dan geçiyor).
- [ ] Yeni bağımlılık: lisans (MIT/Apache/BSD/CC-BY), boyut, `postinstall` yok, `pnpm audit` temiz.
- [ ] Content script değişikliği: restore (`Restorer`) güncellendi; Shadow DOM dışına DOM yazılmıyor.
- [ ] Editör/redact değişikliği: redact commit davranışı testleri geçiyor.

---

## 14. Bağımlılık ve Supply Chain (`REQ-SEC-140`…`145`)
- `pnpm-lock.yaml` commit'li; CI `pnpm install --frozen-lockfile`. (`REQ-SEC-140`)
- Sürümler `^` yerine **tam pin** (`"pdf-lib": "1.17.1"`); Renovate/Dependabot haftalık PR. (`REQ-SEC-141`)
- `pnpm audit --audit-level=high` CI'da zorunlu; `.npmrc` `ignore-scripts=true` (postinstall yasak; gereken paketler için açık allowlist `pnpm.onlyBuiltDependencies`). (`REQ-SEC-142`)
- Build tekrar üretilebilir: `SOURCE_DATE_EPOCH`, deterministic chunk adları (Vite `build.rollupOptions.output` hash'leri içerik bazlı), zip girdileri sıralı ve zaman damgası sabit; CI iki kez build edip `sha256sum` karşılaştırır. (`REQ-SEC-143`)
- Üçüncü parti kodlar (Tesseract WASM, traineddata) `scripts/vendor-check.ts` ile beklenen SHA-256 listesine (`vendor.lock.json`) karşı doğrulanır. (`REQ-SEC-144`)
- Lisans raporu (`pnpm licenses list`) release artefaktına eklenir; GPL/AGPL bağımlılık yasak (EasyList Cookie CC-BY alt kümesi attribution ile, `NOTICES.md`). (`REQ-SEC-145`)

---

## 15. Kabul Kriterleri
| ID | Kriter |
|---|---|
| AC-SEC-01 | Temiz kurulumda manifest `permissions` yalnızca statik liste; `host_permissions` yok; Chrome kurulum diyaloğunda "all websites" uyarısı çıkmaz |
| AC-SEC-02 | Full-page capture sırasında ağ izleyici (DevTools → SW Network) hiçbir dış istek göstermez |
| AC-SEC-03 | Batch ilk kullanımda izin kartı çıkar; red sonrası uygulama çalışır durumda kalır; Options → Permissions'tan verilen izin geri alınabilir |
| AC-SEC-04 | `{title}` = `../../etc/passwd` ve `CON` olan dosya adları `_` ile sanitize edilir; `subfolder:'../x'` `E_VALIDATION` |
| AC-SEC-05 | `javascript:alert(1)` href'li link PDF'e annotation olarak girmez |
| AC-SEC-06 | Sayfa, `window.postMessage` ile `pickerEvent` taklidi yaparak capture tetikleyemez (E2E fixture `malicious-page.html`) |
| AC-SEC-07 | Redact uygulanıp kaydedilen görüntüde orijinal pikseller hiçbir export yolundan (PNG/JPEG/PDF/clipboard/thumbnail) geri elde edilemez; orijinal blob silinmiş |
| AC-SEC-08 | Telemetri kapalıyken `Telemetry` modülü hiç `fetch` çağırmaz (unit mock); açıkken gönderilen payload şemada URL/title alanı içermez |
| AC-SEC-09 | Incognito sekmeden capture history'e yazılmaz |
| AC-SEC-10 | "Clear all data" sonrası IDB store'ları, OPFS, storage.local boş; token'lar yok |
| AC-SEC-11 | ESLint `no-unsanitized`, `no-eval`, `no-restricted-globals(fetch)` kuralları CI'da hata üretiyor ve mevcut kod temiz |
| AC-SEC-12 | İki ardışık CI build'inin zip SHA-256'sı eşit |
| AC-SEC-13 | Webhook URL'si `http://` ise reddedilir; `https://10.0.0.5` ise uyarı + açık onay ister |
