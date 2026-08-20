# FullPageLab İlerleme Raporu

> Son güncelleme: 2026-08-20

Bu dosya, repodaki gerçekleşen uygulama durumunun kanonik ilerleme raporudur. Planlanan işler için `C:\Users\musta\.commandcode\plans\chrome-screenshot-extension.md`, kısa canlı durum için Orca worktree comment'i kullanılır.

## Raporlama düzeni

- Her kapsamlı değişiklik grubundan sonra bu dosya; durum, commit, doğrulama ve kalan işler ile güncellenir.
- Orca worktree comment'i kısa ve anlık bir ayna olarak tutulur; ayrıntılı kayıt bu dosyadadır.
- `.commandcode` plan dosyası yapılacak işleri ve kapı kriterlerini tanımlar; bu dosya gerçekleşen uygulamayı kaydeder.
- Commitlerde `Co-authored-by` trailer'ı kullanılmaz.

## Güncel özet

| Alan | Durum |
|---|---|
| M0 altyapı | Uygulandı ve doğrulandı |
| M1 MVP capture | Kısmi: Visible area ve Full page akışları; deterministik geometri, yatay taşma, rate-limit, job deadline ve restore koruması çalışıyor |
| M1 result/export dilimi | Uygulandı: otomatik indirme kaldırıldı; önizleme, history/geçici sonuç, PNG/JPEG/WebP/PDF ve açık indirme/kopyalama aksiyonları çalışıyor |
| Onboarding | Uygulandı: responsive 3 adımlı tanıtım, kısayol/sabitleme ipucu, yerel gizlilik açıklaması, kalıcı depolama isteği, opt-in tanılama ve ilk full-page capture akışı çalışıyor |
| Aktif dal | `master` |
| Remote durumu | `origin/master` ile hizalı |
| Aktif dal commitleri | `Co-authored-by` trailer'ı yok |

## Şu an çalışan akışlar

- Popup, `capture.start` mesajını service worker'a gönderir ve çalışma durumunu gösterir.
- `capture.start` job ID'sini hemen döndürür; popup başarılı başlangıçtan sonra kapanır, capture service worker'da sürer ve yeniden açılan popup aktif job'ı `capture.listActive` ile görebilir.
- **Visible area:** `chrome.tabs.captureVisibleTab` ile PNG alınır, yerel result kaydı oluşturulur ve result sekmesi açılır; indirme yalnızca kullanıcı result panelindeki **İndir** aksiyonunu seçerse başlar.
- **Full page:** temel belge ölçümleriyle dikey plan oluşturulur; sayfa kaydırılır, görünür kareler alınır, `OffscreenCanvas` ile birleştirilir ve result kaydı oluşturulur. İşlem sonunda sayfa konumu geri yüklenir; otomatik Downloads çağrısı yapılmaz.
- Full-page planlayıcı; DPR/zoom, RTL, yatay taşma, sticky inset, seçim, element, scroll-container ve nested plan geometrilerini saf fonksiyonlarla üretir; son tile kırpması gerçek scroll onayına göre yeniden hesaplanır.
- Aynı pencere için capture çağrıları ortak rate limiter üzerinden en az 500 ms aralıkla yürütülür. Chrome quota hatalarında 750/1500/3000 ms geri çekilme uygulanır.
- Full-page coordinator; aktif sekme/pencere doğrulaması, restricted görünür alan fallback'i, faz deadline'ları, bounded job log'u, viewport değişimi kontrolü ve idempotent restore içerir.
- Content agent; belge/scroll-container taraması, hazırlama CSS'i, medya/görsel/font beklemeleri, fixed/sticky anchor stratejisi ve kapalı Shadow DOM progress overlay'i sağlar.
- Content agent build'i ayrı standalone IIFE olarak üretilir; `chrome.scripting.executeScript({ files: ['content/page-agent.js'] })` ile modül sözdizimi çakışmaz.
- Tile'lar arasındaki viewport doğrulaması hafif tarama seçenekleriyle yapılır; büyük DOM'larda her adımda tam stil/element taraması tekrarlanmaz.
- `html`/`body`, tarayıcının belge scroll kökü olarak özel scroll-container listesinden dışlanır; sayfa scroll'u gerçek `document.scrollingElement` üzerinden yürür.
- Progress overlay'i ilk tile ve sonraki tile capture'ları sırasında gizlenir; çıktı görüntüsüne sağ üst durum kartı sızmaz.
- Progress overlay gizleme yanıtı, görünürlük değişikliğinden sonra iki temiz compositor frame bekler; lazy içerik için hazırlıkta kontrollü pre-scroll yapılır ve capture sırasında büyüyen belge kuyruğa yeni tail tile'ları ekler.
- Cookie/consent modalı ve sabit karartma katmanı preparation aşamasında selector/heuristic kurallarıyla gizlenir; `smartHide` etkin olduğunda kategori kuralları, `hideFixedElements:auto/always` durumunda da cookie metni taşıyan sabit katman savunması devrededir. Normal site navigasyonu korunur ve fixed-tile geçişleri gizlemeyi geri açamaz.
- `fullpagelabicon.png`, hem manifest üst seviye `icons` alanına hem action toolbar ikonlarına bağlanır; Chrome uzantı yönetim kartı da aynı markalı ikonu kullanır.
- **Onboarding:** kurulum sekmesi artık yer tutucu değildir; 3 adımlı tanıtım akışı, `settings.set` ile tamamlanma durumu, `navigator.storage.persist()` isteği, varsayılan kapalı anonim tanılama seçeneği ve onboarding sayfasından `capture.start(fullPage)` denemesi vardır.
- Result sayfası A düzeninde gerçek görüntü önizlemesi, zoom/fit ve strip gezintisi, metadata/uyarı alanı, PNG/JPEG/WebP/PDF format seçimi, kalite/PDF seçenekleri, filename önizlemesi, **İndir**, **Kopyala** ve **Yazdır** aksiyonlarını sunar.
- History açıkken original ve ayrı thumbnail IndexedDB/OPFS `BlobRef`'leriyle saklanır; history kapalıyken kayıt 30 dakika süreli geçici oturum deposunda tutulur ve result sayfası `result.get` ile okuyabilir.
- Result tab davranışı `newTab` ve `reuseTab` ayarlarını uygular; aynı capture için ikinci kez result sekmesi açılmaz.
- Temel job durumu `storage.session` içinde tutulur; unsupported capture modları kullanıcıya hata olarak döner.

Bu akış, şu an normal HTTP(S) belge sayfalarındaki temel kullanım içindir. Chrome kısıtlı sayfaları ve ileri capture senaryoları henüz M1 kabul kapsamını tamamlamaz.

## M0 durumu

M0 iskeleti ve altyapı temelleri tamamlandı: mesaj protokolü, storage katmanları, job yaşam döngüsü, service worker/offscreen/content başlangıçları, popup iskeleti, build varyantları ve temel test altyapısı repoda mevcut.

## M1 durumu

M1 henüz tamamlanmadı. Mevcut uygulama, M1'in temel görünür alan ve basit full-page dikey capture dilimini sağlar. Aşağıdaki parçalar tamamlanmayı bekler veya yalnızca iskelet düzeyindedir:

- Selection, Element, Scrolling area ve All tabs capture modları.
- Nested scroll, iframe/infinite-scroll davranışları, completion/error notification fallback'i ve job event Port'u.
- Büyük capture'lar için tile store/IDB tabanlı akış, strip/multi-image fallback ve timeout/disconnect durumlarında partial stitch.
- Offscreen stitch worker, tile store/IDB tabanlı büyük veri akışı ve bellek bütçesi yönetimi.
- Export pipeline'ının ileri alanları: PDF link/text/header-footer/watermark, ZIP/GIF/BMP, print sayfa akışı, download event takibi ve hedef hata izolasyonu.
- Result/history'nin ileri yönetimi: tam history UI arama/filtre/bulk işlemleri, quota politikası, recapture ve editor bağlantısı.
- Options, commands/context menu, DPR/zoom/RTL doğrulaması ve E2E fixture/smoke akışı.

## Son ilgili commitler

- `cdadc2e` — `fix: throttle screenshot capture calls`
- `870ba1e` — `fix: connect popup capture actions`
- `ca65306` — `feat: add visible and full-page capture flow`
- `7d31528` — `test: cover M0 storage and runtime helpers`
- `c4e5780` — `feat: wire M0 runtime contracts`
- `24521ab` — `feat: add storage and lifecycle foundations`

Bu commitler `origin/master`'a gönderildi ve aktif dalda co-author trailer'ı içermez.

## Doğrulama durumu

2026-08-20 tarihinde aşağıdaki kontroller geçti:

- `pnpm test` — 69 test, 19 dosya
- `pnpm exec vitest run test/unit/plan.test.ts` — geometri planları, limitler ve kapsama testleri
- `pnpm exec vitest run test/integration/coordinator.int.test.ts` — agent scanner/preparer/overlay restore akışı
- `pnpm check:content-assets` — store/CDP content agent bundle'larında unresolved import yok
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test:coverage` — statements/lines/functions %100, branches %93,67
- `pnpm build:all` — store ve cdp
- `pnpm check:manifest`
- `pnpm check:content-assets`
- `pnpm traceability`
- `git diff --check`
- Değiştirilen dosyalarda UTF-8 BOM ve mojibake denetimi

## Chrome smoke test notu

Yerel deneme akışı:

1. `pnpm build:store` çalıştır.
2. `chrome://extensions/` üzerinden `dist/store` klasörünü yükle veya uzantıyı yeniden yükle.
3. Normal bir HTTP(S) sayfasında popup'ı açıp **Visible area** veya **Full page** seç.
4. Capture tamamlandığında result sekmesinin açıldığını, görüntü önizlemesini ve format/filename seçeneklerini kontrol et.
5. **İndir** seçilmeden Downloads'a dosya yazılmadığını; seçildikten sonra PNG/JPEG/WebP/PDF çıktısının indiğini kontrol et.

Bu çalışma oturumunda Orca'nın bağlı Chrome profilinde FullPageLab yüklü olmadığı için rate-limit düzeltmesi Chrome arayüzünde yeniden doğrulanamadı; otomatik test, typecheck, lint ve build kontrolleri geçti.
