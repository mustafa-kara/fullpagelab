# PageShot İlerleme Raporu

> Son güncelleme: 2026-08-19

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
| M1 MVP capture | Kısmi: temel Visible area ve Full page akışları çalışıyor |
| Aktif dal | `master` |
| Remote durumu | `origin/master` ile hizalı |
| Aktif dal commitleri | `Co-authored-by` trailer'ı yok |

## Şu an çalışan akışlar

- Popup, `capture.start` mesajını service worker'a gönderir ve çalışma durumunu gösterir.
- **Visible area:** `chrome.tabs.captureVisibleTab` ile PNG alınır ve indirme başlatılır.
- **Full page:** temel belge ölçümleriyle dikey plan oluşturulur; sayfa kaydırılır, görünür kareler alınır, `OffscreenCanvas` ile birleştirilir ve PNG indirilir. İşlem sonunda sayfa konumu geri yüklenir.
- Aynı pencere için capture çağrıları ortak rate limiter üzerinden en az 500 ms aralıkla yürütülür. Chrome quota hatalarında 750/1500/3000 ms geri çekilme uygulanır.
- Temel job durumu `storage.session` içinde tutulur; unsupported capture modları kullanıcıya hata olarak döner.

Bu akış, şu an normal HTTP(S) belge sayfalarındaki temel kullanım içindir. Chrome kısıtlı sayfaları ve ileri capture senaryoları henüz M1 kabul kapsamını tamamlamaz.

## M0 durumu

M0 iskeleti ve altyapı temelleri tamamlandı: mesaj protokolü, storage katmanları, job yaşam döngüsü, service worker/offscreen/content başlangıçları, popup iskeleti, build varyantları ve temel test altyapısı repoda mevcut.

## M1 durumu

M1 henüz tamamlanmadı. Mevcut uygulama, M1'in temel görünür alan ve basit full-page dikey capture dilimini sağlar. Aşağıdaki parçalar tamamlanmayı bekler veya yalnızca iskelet düzeyindedir:

- Selection, Element, Scrolling area ve All tabs capture modları.
- Sayfa tarayıcısı, özel scroll root, nested scroll, sticky/fixed element yönetimi, lazy-load bekleme ve iframe/infinite-scroll davranışları.
- `PagePreparer`/`Restorer` kapsamının genişletilmesi, progress/cancel overlay'i ve job event Port'u.
- Offscreen stitch worker, tile store/IDB tabanlı büyük veri akışı ve bellek bütçesi yönetimi.
- Tam export pipeline'ı: JPEG/WebP, PDF, clipboard, filename şablonları, result sayfası ve history kaydı.
- Options, onboarding, commands/context menu, DPR/zoom/RTL doğrulaması ve E2E fixture/smoke akışı.

## Son ilgili commitler

- `cdadc2e` — `fix: throttle screenshot capture calls`
- `870ba1e` — `fix: connect popup capture actions`
- `ca65306` — `feat: add visible and full-page capture flow`
- `7d31528` — `test: cover M0 storage and runtime helpers`
- `c4e5780` — `feat: wire M0 runtime contracts`
- `24521ab` — `feat: add storage and lifecycle foundations`

Bu commitler `origin/master`'a gönderildi ve aktif dalda co-author trailer'ı içermez.

## Doğrulama durumu

2026-08-19 tarihinde aşağıdaki kontroller geçti:

- `pnpm test` — 20 test, 7 dosya
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
4. PNG dosyasının Downloads klasörüne indiğini ve full-page işleminde quota hatası oluşmadığını kontrol et.

Bu çalışma oturumunda Orca'nın bağlı Chrome profilinde PageShot yüklü olmadığı için rate-limit düzeltmesi Chrome arayüzünde yeniden doğrulanamadı; otomatik test, typecheck, lint ve build kontrolleri geçti.
