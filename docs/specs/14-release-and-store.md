# 14 — Release ve Chrome Web Store

> Web Store listing gereksinimleri, izin gerekçe metinleri, gizlilik politikası taslağı, veri kullanımı beyanı, tek-amaç uyumu, inceleme riskleri, sürümleme, build varyantları ve CI/CD, release checklist, güncelleme/migration stratejisi, destek kanalları, tanılama, kurumsal dağıtım, monetizasyon önerisi. Gereksinim ID önek: `REQ-REL-*`.

> **Yayın durumu (2026-08-21):** Store metni yalnız mevcut `fullPage` ve `visible` yakalama, sonuç önizleme ve kullanıcı onaylı PNG/JPEG/WebP/PDF dışa aktarımını vaat eder. Selection, element, scrolling area, all-tabs, editör, gelişmiş History, OCR, batch, compare ve entegrasyon iddiaları ilgili özellikler tamamlanıp doğrulanmadan listing'e eklenmez. Aşağıdaki ileri seviye izin ve monetizasyon bölümleri gelecek sürüm planıdır; 0.1.0 listing vaadi değildir.

İçindekiler: 1 Listing · 2 İzin gerekçeleri · 3 Gizlilik politikası · 4 Veri kullanımı beyanı · 5 Tek amaç · 6 İnceleme riskleri · 7 Sürümleme · 8 Build varyantları ve CI/CD · 9 Release checklist · 10 Güncelleme stratejisi · 11 Destek ve issue şablonları · 12 Tanılama (telemetri-siz) · 13 Kurumsal dağıtım · 14 Monetizasyon önerisi · 15 Kabul kriterleri

---

## 1. Web Store Listing (`REQ-REL-001`…`008`)

| Alan | Değer / kural |
|---|---|
| Ad | `__MSG_appName__` — **"FullPageLab — Full Page Screenshot"** (≤ 45 karakter) |
| Kısa açıklama (≤ 132) | "Capture full pages or the visible area, preview locally, then export PNG, JPG, WebP or PDF." |
| Tek-amaç beyanı | "Capturing full-page and visible-area screenshots of web pages and exporting them locally in user-selected formats." |
| Kategori | Productivity → Tools |
| Diller | `en` (varsayılan), `tr`; listing metinleri `store/listing/{en,tr}.md` |
| Ekran görüntüleri | 5 adet, **1280×800** (veya 640×400) PNG/JPEG; sırasıyla: (1) popup'taki Full page/Visible area, (2) tam sayfa progress, (3) result önizleme, (4) format ve dosya adı seçenekleri, (5) onboarding gizlilik anlatımı. Tarayıcı çerçevesi dahil edilmez; gerçek UI, sahte veri yok |
| Küçük promo | **440×280** |
| Marquee promo | **1400×560** (opsiyonel, featured için) |
| İkon | 128×128 PNG (store), manifestte 16/32/48/128 |
| Kaynak marka varlıkları | `src/img/fullpagelabicon.png` uzantı ikonu için; `src/img/fullpagelabstore.png` mağaza/listing görseli için |
| Web sitesi / destek URL | `https://<domain>/`, `https://<domain>/support` |
| Gizlilik politikası URL | `https://<domain>/privacy` (zorunlu — veri kullanımı beyanı için) |
| Detaylı açıklama | Şablon aşağıda |

**Açıklama şablonu (EN, `store/listing/en.md`):**
```
FullPageLab captures long web pages or the current visible area and opens a local preview before saving anything.

✔ Full-page and visible-area capture
✔ Handles common sticky headers, lazy-loaded content and page scrollbars
✔ Preview before download; no automatic save
✔ Export PNG, JPG, WebP or PDF
✔ Copy the result or print from the result page
✔ Visible-area keyboard shortcut and full-page right-click action

Privacy first: Screenshots never leave your browser unless you choose to upload them. No account required. No analytics unless you opt in.

Permissions explained: <link to /privacy#permissions>
```
`REQ-REL-004`: Açıklamada abartı ("best", "#1") ve rakip adı kullanılmaz. `REQ-REL-005`: "What's new" bölümü her sürümde güncellenir (≤ 300 karakter).

---

## 2. İzin Gerekçe Metinleri (Developer Dashboard) (`REQ-REL-010`)
Her izin için dashboard "Permission justification" alanına **birebir** girilecek paragraflar (08 §3.2 ile aynı kaynak `store/permissions.en.json`):

- **activeTab** — "Used to capture and scroll the page the user is currently viewing, only in response to a user gesture (toolbar click, keyboard shortcut or context menu). Access is limited to that tab and ends on navigation."
- **scripting** — "Injects a small helper script into the active tab (activeTab) to measure the page, scroll it step by step, temporarily hide sticky headers and show a progress overlay. The script is removed and all changes are reverted after capture."
- **storage** — "Stores user preferences, local result references and in-progress capture state locally."
- **unlimitedStorage** — "Screenshots and PDFs are stored in the local screenshot history (IndexedDB/OPFS). Full-page images are large, so the default quota is insufficient. No data is synced or uploaded."
- **downloads** — "Saves captured images and PDFs to the user's Downloads folder using the configured file name pattern and optional subfolder."
- **offscreen** — "Image stitching, encoding and PDF generation run in an offscreen document so the service worker and the page stay responsive."
- **contextMenus** — "Adds a full-page capture action to the page context menu."
- **alarms** — "Runs storage housekeeping and, if the user creates a monitoring rule, schedules periodic recaptures of a URL for change detection."
- **sidePanel** — "Provides a persistent capture panel and quick preview in Chrome's side panel."
- **Optional: tabs** — "Requested only when the user uses 'Capture all tabs' or batch capture, to list tab titles/URLs and activate tabs one by one."
- **Optional: clipboardWrite** — "Lets the user copy a screenshot to the clipboard directly from the page without opening a result tab."
- **Optional: notifications** — "Shows an optional local notification when a capture, batch or monitoring check finishes. No page content is sent anywhere."
- **Optional: webRequest** — "Used only when you enable network details in Bug Report mode to record failed requests for the selected tab. No request bodies are collected."
- **Optional: identity** — "Used only to sign in (OAuth) to a third-party service the user explicitly connects (Jira, Linear, Slack, Notion, Trello, GitHub, Google Drive)."
- **Optional: webNavigation** — "Requested when the user captures the inside of an iframe, to enumerate frames of the tab."
- **Optional: nativeMessaging** — "Enables an optional local command-line companion the user installs separately."
- **Optional host permission `<all_urls>`** — "Requested only for batch URL capture, cross-origin iframe capture and change monitoring, where the extension opens pages itself and a per-page user gesture is not possible. The user can grant a narrower origin or revoke at any time in Options."
- **Remote code** — "No. All JavaScript and WebAssembly (OCR engine and language data) are bundled in the package."

`REQ-REL-011`: `scripts/check-manifest.ts` manifestteki izin kümesi ile `store/permissions.en.json` anahtarlarını karşılaştırır; fark CI hatasıdır.

**0.1.0 yayın kapısı:** Mevcut manifestte gelecek kapsam için bulunan `sidePanel`, `alarms`, optional permissions ve `<all_urls>` optional host izni, Store paketi hazırlanırken çalışan bir kullanıcı akışıyla gerekçelendirilmiyorsa kaldırılmalıdır. Gelecekte kullanılacak bir özelliği anlatan gerekçe, kullanılmayan izni 0.1.0 paketinde tutmak için yeterli değildir.

---

## 3. Gizlilik Politikası Taslağı (`REQ-REL-020`)
Barındırılan URL zorunlu; bölümler:
1. Özet (08 §1 cümlesi).
2. Toplanan veriler: **yok** (varsayılan). Opt-in telemetri: alan listesi (08 §9), saklama süresi (90 gün), amaç.
3. Yerel olarak saklanan veriler (08 §2 tablosu), cihazda kalır, kaldırınca silinir.
4. İzinler ve neden (§2).
5. Üçüncü taraf hizmetler: kullanıcı bağlarsa (Jira/Slack/…) veriler **doğrudan** o servise gider; bu servislerin kendi politikaları; TSA'ya yalnızca hash.
6. Çocuklar, satış yok, reklam yok, profil oluşturma yok.
7. Güvenlik (CSP, remote-code yok, token saklama).
8. Haklar: "Clear all data", dışa aktarım, iletişim.
9. Değişiklikler ve tarih.
`REQ-REL-021`: Politika değişikliği → sürüm notu + `Settings.privacy.policyVersionSeen` ile tek seferlik bilgilendirme.

---

## 4. Veri Kullanımı Beyanı (Dashboard "Privacy practices") (`REQ-REL-030`)
- "Does your extension collect or use user data?" → **Yes, only if user opts in** — işaretlenen kategoriler: *none* (varsayılan build, telemetri opt-in olsa da "Website content"/"Personally identifiable info" toplanmaz). Eğer telemetri sürümde aktifse: **"Usage data / analytics"** kutusu (`User activity` → *no*; `Website content` → *no*).
- Sertifikasyonlar: ✔ Not selling to third parties; ✔ Not using for purposes unrelated to core functionality; ✔ Not used for creditworthiness/lending.
- "Remote code" → **No**.
- Host permission gerekçesi (optional) → §2 metni.

---

## 5. Tek Amaç Uyumu (`REQ-REL-040`)
Tüm özellikler "web sayfası ekran görüntüsü almak ve bu görüntüleri dışa aktarmak/düzenlemek/yönetmek" amacına bağlıdır. Kapsam dışı kalacak (eklenmeyecek) şeyler: genel dosya yöneticisi, video kayıt (ayrı uzantı), web scraping/metin dışa aktarma (OCR yalnızca ekran görüntüsü içinde arama/searchable PDF için), not alma aracı, sekme yöneticisi. Store "Single purpose" alanı §1 beyanı.

---

## 6. İnceleme Riskleri ve Azaltımlar (`REQ-REL-050`…`055`)
| Risk | Azaltım |
|---|---|
| `debugger` izni | Store build'inde yok (`BUILD_VARIANT=store`). `cdp` varyantı Web Store'a **gönderilmez**; self-hosted (§13) (`REQ-REL-050`) |
| `unlimitedStorage` | Gerekçe §2; history özelliği listing'de açıkça anlatılır |
| `optional_host_permissions <all_urls>` | Sadece opsiyonel; gerekçe; ekran görüntüsü #5'te batch gösterilir; dar origin seçeneği |
| Büyük paket (OCR dil verileri ~20 MB) | Yalnızca `eng`+`tur` varsayılan; diğer diller ayrı "language pack" sürümü/self-hosted; paket ≤ 60 MB (`REQ-REL-052`) |
| `wasm-unsafe-eval` CSP | Gerekçe: OCR/encoder WASM; remote değil |
| `identity` ve dış API origin'leri | Gizlilik politikasında listelenir; `connect-src` allowlist |
| Kullanıcı verisi beyanı tutarsızlığı | `store/` içerikleri koddan üretilen izin listesiyle CI'da karşılaştırılır (`REQ-REL-011`) |
| Reddedilme durumunda | Appeal şablonu `store/appeal-template.md`; değişiklik notlarıyla yeniden gönderim; her sürüm için "reviewer notes" alanı doldurulur (test hesabı gerekmez, fixture site URL'si verilir) (`REQ-REL-055`) |

---

## 7. Sürümleme (`REQ-REL-060`…`064`)
- SemVer `MAJOR.MINOR.PATCH` (`package.json`); manifest `version` 4 parçalı `MAJOR.MINOR.PATCH.BUILD` (BUILD = CI run numarası; yerel build `0`); `version_name` = `1.4.2 (store)` / `1.4.2-cdp`. Dashboard her yüklemede daha büyük manifest `version` ister → BUILD monoton artar.
- `CHANGELOG.md` Keep-a-Changelog; `conventional commits` → `changesets`/`release-please` ile otomatik taslak; "What's new" store metni changelog'dan özetlenir.
- Şema versiyonları ayrı: `Settings.schemaVersion`, Dexie DB version; her artış changelog'da "Migration" başlığı.
- Dal stratejisi: `main` (her zaman yayınlanabilir), `release/x.y` hotfix dalları, tag `v1.4.2`.
- Önizleme kanalı: Web Store "unlisted" ikinci listing (`FullPageLab Beta`, ayrı ID) haftalık build; beta kullanıcıları Options'ta "beta" rozeti görür (`REQ-REL-064`).

---

## 8. Build Varyantları ve CI/CD (`REQ-REL-070`…`078`)
- `BUILD_VARIANT=store|cdp` (Vite `define`, `manifest.config.ts` dallanır); `BUILD_CHANNEL=stable|beta`; çıktı `dist/<variant>-<channel>/` ve `artifacts/ssx-<version>-<variant>-<channel>.zip`.
- Pipeline (GitHub Actions, `.github/workflows/release.yml`, tetik: tag `v*`):
  1. `pnpm install --frozen-lockfile` (ignore-scripts)
  2. `lint-typecheck`, `unit-integration`, `e2e-linux` (11) — başarısızsa durur
  3. `build` (store+cdp, stable) — reproducible (08 §14), iki kez build + SHA karşılaştırma
  4. `zip` (`scripts/build-zip.ts`: sıralı girdiler, sabit mtime, `manifest.json` kökte)
  5. Artefakt + `SHA256SUMS` + `licenses.txt` + `traceability.md` yükle; GitHub Release taslağı
  6. **Store upload** (manuel onay gate'i `environment: production`): `chrome-webstore-upload-cli upload --source artifacts/…store-stable.zip --extension-id $CWS_EXTENSION_ID --client-id $CWS_CLIENT_ID --client-secret $CWS_CLIENT_SECRET --refresh-token $CWS_REFRESH_TOKEN` ardından `publish --trusted-testers` (beta) ya da `publish` (stable); secrets GitHub Environments'ta, OIDC yok (CWS API gerektirmez)
  7. Staged rollout: Dashboard'da **%10 → %50 → %100** (CWS "percentage rollout" sadece büyük kullanıcı tabanlı listing'lerde görünür; yoksa beta kanalı → stable sıralaması ile taklit); her adım 24–48 s bekleme, S0/S1 yoksa ilerle (`REQ-REL-074`)
  8. (Opsiyonel) Edge Add-ons: `@plasmohq/edge-addons-api` / Partner Center API ile aynı zip (`REQ-REL-075`)
  9. `cdp` varyantı: self-hosted `update.xml` ve CRX imzalama (`crx3` ile `ssx-cdp.pem`, CI secret) → `https://<domain>/cdp/ssx-cdp.crx` (`REQ-REL-076`)
- PR pipeline (`ci.yml`): lint, unit/integration, e2e-linux, bundle-size; `build` artefaktı 7 gün saklanır (manuel test için).
- `REQ-REL-078`: CI'da store'a yükleme yalnızca tag + manuel onay ile; `main` push asla yayınlamaz.

---

## 9. Release Checklist (`REQ-REL-080`)
Her stable sürüm için `docs/release-checklist.md` kopyalanır ve işaretlenir:
- [ ] Açık S0/S1 yok; flaky karantina ≤ 5
- [ ] 11 §22 manuel QA tamamlandı (tarih, kişi)
- [ ] Migration testi: önceki 2 stable sürümden yükseltme (history/settings korunuyor)
- [ ] i18n eşitlik testi geçti; yeni metinler `tr`'de
- [ ] CHANGELOG ve "What's new" güncel; sürüm numaraları (`package.json`, manifest) tutarlı
- [ ] Store assets güncel (UI değiştiyse yeni ekran görüntüleri)
- [ ] İzin değişikliği varsa: §2 metinleri, gizlilik politikası, dashboard güncellendi; **izin artışı** kullanıcıya yeniden onay diyaloğu gösterir → sürüm notunda uyarı
- [ ] Gizlilik politikası tarihi/versiyonu
- [ ] Reproducible build SHA eşleşmesi; `SHA256SUMS` yayınlandı
- [ ] Beta kanalında ≥ 3 gün, kritik geri bildirim yok
- [ ] Rollback planı hazır: önceki sürüm zip'i artefaktlarda; gerekirse **aynı içerik daha yüksek `version`** ile yeniden yüklenir (CWS düşük versiyona dönüşe izin vermez) (`REQ-REL-081`)
- [ ] Destek makaleleri / SSS güncellendi
- [ ] Release sonrası 48 s izleme: store yorumları, destek gelen kutusu, `Copy diagnostics` raporları

---

## 10. Güncelleme Stratejisi (`REQ-REL-090`…`094`)
- `chrome.runtime.onInstalled` → `reason:'install'`: onboarding sekmesi, varsayılan preset'ler, `canvasLimits` probe; `reason:'update'`: `SettingsStore.migrate()` + Dexie upgrade; başarısız migration → yedekten geri al (`storage.local.settings_backup_<prevVersion>`), hata bildirimi, "Copy diagnostics".
- Güncelleme sırasında aktif job varsa: SW yeniden başlar → 02 §3.3 recovery (fail + restore). `chrome.runtime.onUpdateAvailable` dinlenir; job sürüyorsa `reload()` ertelenir, bitince uygulanır (`REQ-REL-091`).
- "What's new" yerel sayfa (`onboarding.html#whats-new`) yalnızca MINOR/MAJOR'da ve ayar açıksa bir kez açılır; ağ yok (`REQ-REL-092`).
- Geriye dönük uyumluluk: history kayıtları ileri sürümlerde okunabilir; alan ekleme geriye uyumlu, alan kaldırma 2 sürüm sonra (`REQ-REL-093`).
- Kullanım dışı bırakma: kaldırılan özellik ayarları migration'da temizlenir ve notlanır (`REQ-REL-094`).

---

## 11. Destek Kanalları ve Issue Şablonları (`REQ-REL-100`…`102`)
- Kanallar: Web Store "Support" sekmesi (yönlendirme), GitHub Issues (public repo veya ayrı `ssx-feedback` deposu), e-posta `support@<domain>`; Options → Help: "Report a problem" → şablon doldurulmuş GitHub issue URL'si (tarayıcıda açılır; veri göndermez) + "Copy diagnostics".
- Issue şablonları (`.github/ISSUE_TEMPLATE/`): `bug_report.yml` (URL — kullanıcı isterse, mod, beklenen/gerçek, diagnostics yapıştırma alanı, ekran görüntüsü), `capture_problem.yml` (site türü: sticky/lazy/infinite/iframe/chat; fixture benzeri minimal örnek isteği), `feature_request.yml`, `site_compat.yml` (site uyumluluk listesine ekleme).
- SLA: S0 48 s içinde ilk yanıt; diğerleri 5 iş günü. Sık sorunlar `docs/known-issues.md` (GIF donmaz, shadow DOM sticky, chrome:// sınırı, headless/minimize pencere).

---

## 12. Telemetri-siz Tanılama (`REQ-REL-110`…`113`)
- "Copy diagnostics" butonu (result hata kartı, Options → Help, batch log): panoya JSON + okunabilir blok kopyalar:
```ts
interface Diagnostics {
  appVersion: string; variant: 'store'|'cdp'; channel: 'stable'|'beta';
  browser: { name: string; version: string; os: string; lang: string };
  permissions: { granted: string[]; origins: string[] };
  settingsDigest: Record<string, unknown>;      // token/URL içermez; sayısal/enum ayarlar
  canvasLimits: CanvasLimits;
  storage: StorageStats;
  lastJobs: Array<Pick<JobState,'jobId'|'phase'|'backend'|'progress'|'error'|'startedAt'|'finishedAt'> & { metricsDigest?: { viewport: Size; document: Size; dpr: number; zoom: number; scrollRoot: string; fixedCount: number; iframeCount: number; lazyImages: number }; urlOrigin?: string }>;
  log: string[];                                 // redaction'dan geçmiş son 200 satır
}
```
- URL yalnızca origin düzeyinde; kullanıcı yapıştırmadan önce görebilir/düzenleyebilir (önizleme diyaloğu). (`REQ-REL-111`)
- Triage rehberi `docs/triage.md`: hata kodu → olası neden → istenecek ek bilgi (ör. `E_WINDOW_NOT_VISIBLE` → pencere minimize/ikinci ekran kapalı; `E_CANVAS_LIMIT` → canvasLimits + DPR; dikiş hatası → fixture isteği + `metricsDigest`). (`REQ-REL-112`)
- Sentry/crash SDK yok (08 §9). (`REQ-REL-113`)

---

## 13. Kurumsal Dağıtım (`REQ-REL-120`…`124`)
- Chrome Enterprise politikası: `ExtensionInstallForcelist` ile store ID (`"<id>;https://clients2.google.com/service/update2/crx"`) veya self-hosted `cdp` varyantı (`"<cdp-id>;https://<domain>/cdp/update.xml"`); `ExtensionSettings` ile `runtime_allowed_hosts`/`toolbar_pin:"force_pinned"`.
- Self-hosted CRX: `manifest.json` `update_url:"https://<domain>/cdp/update.xml"` (sadece cdp build), CRX3 imzası sabit anahtar (ID sabit kalır), `update.xml` `<gupdate>` formatı; HTTPS zorunlu; SHA256 yayınlanır.
- Yönetilen ayarlar (`storage.managed`, `managed_schema.json`): `privacy.telemetry` (zorla kapalı), `integrations.allowedProviders`, `export.download.subfolder`, `history.maxBytes`, `features.disabled[]` (ör. cloud/integrations kapalı), `presets` (zorunlu preset seti). Options'ta yönetilen alanlar kilitli gösterilir. (`REQ-REL-122`)
- Kurumsal dokümantasyon `docs/enterprise.md`: kurulum, politika örnekleri (Windows GPO/ADMX JSON, macOS plist), ağ gereksinimleri (**yok** — yalnızca seçilen entegrasyon origin'leri).
- cdp varyantı kurulum notu: "debugger" uyarısı ve infobar davranışı; isteğe bağlı `--silent-debugger-extension-api` yalnızca test ortamı.

---

## 14. Monetizasyon Önerisi (öneri; ürün kararı ayrıdır) (`REQ-REL-130`…`135`)
- **Karar (öneri):** Çekirdek **ücretsiz**: full-page/visible/selection/element/scroll-container capture, PNG/JPG/WebP/PDF (temel), clipboard, history (yerel), kısayollar, context menu, temel editör (ok, şekil, metin, blur/redact, crop). **Pro:** batch URL/all-tabs, entegrasyonlar, OCR arama & searchable PDF, version compare/pixel diff/monitoring, evidence bundle (TSA), gelişmiş PDF (header/footer/watermark/smart break/outline), presets paylaşımı, API/CLI.
- Ücretsiz katmanda sınırlama **kaliteyi** düşürmez (boyut/çözünürlük kısıtı, watermark, reklam yok — rakip şikayetlerinden ders).
- Lisanslama: **çevrimdışı imzalı anahtar** — `licenseKey = base64(payload).base64(sig)`, payload `{ sub: email-hash, plan:'pro', exp: ISO|null, seats, iat }`, Ed25519 imzası; public key bundle'da (`src/shared/license.pub`), doğrulama `crypto.subtle.verify('Ed25519')` (Chrome 113+ WebCrypto Ed25519; yoksa `@noble/ed25519` fallback). Sunucu çağrısı yok; satın alma web sitesinde (Paddle/LemonSqueezy/Stripe) yapılır, anahtar e-posta ile gelir, Options → License'a yapıştırılır. İptal/iade: `exp` kısa (yıllık) ve yenileme anahtarı; kara liste güncellemesi uzantı sürümüyle gelir (uzaktan değil). (`REQ-REL-132`)
- `Settings.license: { key?: string; plan: 'free'|'pro'|'team'; validUntil?: IsoDate; seats?: number }`; `features.isPro()` tek kapı; Pro olmayanlarda özellik UI'da görünür fakat "Pro" rozeti + açıklama (gizlenmez; keşfedilebilirlik). (`REQ-REL-133`)
- Deneme: 14 gün Pro, yerel `trialStartedAt` (kötüye kullanım kabul edilir; sunucu yok). (`REQ-REL-134`)
- Takım/kurumsal: seat sayılı anahtar + `storage.managed` ile dağıtım. (`REQ-REL-135`)
- Store listing'de "in-app purchases" işaretlenir (dış satın alma bağlantısı CWS politikasına uygun biçimde: fiyat şeffaf, uygulama içi ödeme formu yok).

---

## 15. Kabul Kriterleri
| ID | Kriter |
|---|---|
| AC-REL-01 | `store` build manifest'inde `debugger` ve `host_permissions` yok; `check-manifest` geçer; izin listesi `store/permissions.en.json` ile birebir |
| AC-REL-02 | Release workflow tag'de çalışır, testler geçmeden zip üretmez; store upload adımı manuel onay gerektirir |
| AC-REL-03 | İki bağımsız CI build'inin zip SHA-256'sı eşit (reproducible) |
| AC-REL-04 | `cdp` varyantı CRX3 imzalı, `update.xml` ile test Chrome'da policy kurulumu ve otomatik güncelleme çalışır |
| AC-REL-05 | Önceki 2 stable sürümden yükseltmede settings/history korunur (E2E: eski `dist` ile profil oluştur → yeni `dist` yükle) |
| AC-REL-06 | "Copy diagnostics" çıktısı URL path/query, token, dosya adı içermez (regex test) |
| AC-REL-07 | Listing varlıkları (5×1280×800, 440×280, 1400×560, 128 ikon) `store/assets/` altında ve boyutları script ile doğrulanır |
| AC-REL-08 | Geçersiz/expired lisans anahtarı reddedilir; geçerli Ed25519 imzalı anahtar `plan:'pro'` açar; doğrulama ağ isteği yapmaz |
| AC-REL-09 | `storage.managed` ile `privacy.telemetry=false` zorlandığında Options'ta toggle kilitli ve kapalı |
| AC-REL-10 | CHANGELOG, manifest `version`, `package.json` ve "What's new" metni aynı sürüm numarasını taşır (script kontrolü) |
