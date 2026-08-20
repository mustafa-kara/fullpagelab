# M1/P0 Yakalama Çekirdeği ve Tetikleyiciler Tasarımı

**Tarih:** 20 Ağustos 2026
**Durum:** Kullanıcı tarafından onaylandı
**Kapsam:** Yakalama kararlılığı, ortak istek sözleşmesi, çalışan modların görünürlüğü, sağ tık tetikleyicisi, kaydırma çubuğu gizleme ve tarayıcı doğrulama temeli

## 1. Amaç

FullPageLab'ın M1/P0 yakalama çekirdeğini kanonik spec belgeleriyle uyumlu ve gerçek Chrome davranışlarına dayanıklı hâle getirmek. Tam sayfa ve görünür alan akışları önce kararlı bir ortak temel üzerinde tamamlanacak; seçim, kaydırılabilir alan ve element yakalama modları aynı koordinatöre bağımlı çalışma paketleri olarak eklenecektir.

Önceki ürün kararları kanonik spec ile çeliştiğinde kullanıcı kararı geçerlidir:

- `Alt+Shift+P` tam sayfa kısayolu kaldırılacaktır.
- Sağ tık menüsü yalnızca gerçekten çalışan modları gösterecektir.
- Başlangıçta yalnızca `Tam sayfa ekran görüntüsünü al` eylemi bulunacaktır.
- Yeni yakalama modu tamamlanmadan popup, sağ tık menüsü veya komut yüzeyinde aktif gösterilmeyecektir.

## 2. Mimari Sınırlar

Bütün yakalama girişleri tek `CaptureCoordinator` kullanır. Popup, sağ tık menüsü ve desteklenen komutlar farklı yakalama motorları oluşturmaz; yalnızca aynı istek sözleşmesine farklı `trigger` değeriyle bağlanır.

`capture.start`, yalnızca `mode` taşıyan geçici payload yerine doğrulanmış bir `CaptureRequest` kabul eder. İstek en az şu bilgileri kaybetmeden koordinatöre ulaşır:

- yakalama modu,
- tetikleyici,
- hedef sekme ve gerekiyorsa hedef öğe/alan,
- yakalama seçenekleri,
- dışa aktarma planı,
- preset ve üst iş metadata'sı.

İlk çalışma paketi tam sayfa ve görünür alan kararlılığını tamamlar. Selection, scrolling area ve element akışları aynı koordinatörün sonraki bağımlı paketleridir. Büyük görüntülerin IDB/offscreen akışı, gelişmiş History ve ileri dışa aktarma ayrı M1 paketlerinde ele alınır.

## 3. Yakalama Veri Akışı

1. Etkin sekme, pencere görünürlüğü ve URL yakalanabilirliği doğrulanır.
2. Sayfa ajanı enjekte edilir; belge, viewport, kaydırma kökü, DPR, zoom ve başlangıç kaydırma konumu ölçülür.
3. Kaydırma çubukları gizlenir; seçili ayarlara göre animasyonlar, medya, sabit öğeler, akıllı gizleme ve lazy-load hazırlığı uygulanır.
4. Hazırlık değişikliklerinden sonra iki temiz compositor karesi beklenir.
5. Sayfa yeniden ölçülür ve yakalama planı hazırlık sonrası geometriyle oluşturulur.
6. İlk karede kaydırma kökünün başlangıcına gerçekten ulaşıldığı doğrulanır.
7. Sonraki karelerde planlanan konumla kesin eşitlik aranmaz; tarayıcının bildirdiği gerçek konumun yeni kapsama alanı üretmesi beklenir.
8. Son sınıra bağlı doğal kaydırma kısıtlaması geçerli kabul edilir. İçerik devam ettiği hâlde ilerleme tamamen durmuşsa yinelenen kare üretmeden işlem sonlandırılır.
9. Her karenin kırpma ve yerleştirme geometrisi gerçek kaydırma onayıyla yeniden hesaplanır.
10. Yakalama göstergesi ekran görüntüsünden önce gizlenir ve iki temiz compositor karesi beklenir.
11. Kareler birleştirilir, sonuç yerel olarak kaydedilir ve result sekmesi açılır.
12. Başarı, hata ve iptal yollarının tamamında özgün stiller ile kaydırma konumu idempotent `finally` akışıyla geri yüklenir.

## 4. Tam Sayfa Kararlılığı

Mevcut katı hedef-konum doğrulaması kaldırılır. Tarayıcının son sınıra sıkıştırdığı, alt piksel yuvarladığı veya özel kaydırma kökünde uyarladığı geçerli konumlar hata sayılmaz.

Doğrulama iki koşula odaklanır:

- İlk kare yakalama alanının başlangıcını kapsamalıdır.
- Sonraki her kare, yakalanmamış alana doğru ölçülebilir ilerleme sağlamalıdır; doğal son sınır istisnadır.

İlk bölümü eksik veya yinelenen karelerden oluşan bir çıktı kaydedilmez. Hata, teknik istisna yerine yerelleştirilebilir `E_VALIDATION` bilgisiyle job kaydına yazılır.

## 5. Görünür Alan ve Kaydırma Çubukları

Görünür alan yakalaması da hafif hazırlama/geri yükleme döngüsünden geçer:

1. Sayfa ajanını enjekte etmeyi dene.
2. En azından kaydırma çubuklarını gizle.
3. İki temiz compositor karesi bekle.
4. Görünür sekmeyi yakala.
5. Hazırlığı her koşulda geri yükle.

Hazırlama stili ana belgeye, standart ve özel kaydırma alanlarına uygulanır. Erişilebilen aynı kaynaklı iframe belgelerine de ayrı stil eklenir. Farklı kaynaklı iframe içeriği ek izin olmadan değiştirilmez.

Görünür alan hazırlığı kısıtlı sayfa veya enjeksiyon hatası nedeniyle başarısız olursa yakalama devam eder; kaydırma çubuğunun gizlenemediği uyarı seviyesinde kaydedilir. Tam sayfa için zorunlu ölçüm ve hazırlık başarısızlığı ise açık hata üretir.

## 6. Tetikleyiciler ve Kullanıcı Arayüzü

### 6.1 Popup

- Tam sayfa ve görünür alan aktif kalır.
- Desteklenmeyen modlar teknik hata veren aktif düğmeler olarak sunulmaz.
- Selection, scrolling area ve element yalnızca koordinatöre uçtan uca bağlandıkları pakette aktifleşir.
- Capture başladıktan sonra popup kapanır; ilerleme sayfa üstündeki göstergeden izlenir.

### 6.2 Sağ tık menüsü

İlk menü öğesi:

- Türkçe: `Tam sayfa ekran görüntüsünü al`
- İngilizce: `Capture full-page screenshot`
- Bağlam: yalnızca `page`
- İstek: `mode: 'fullPage'`, `trigger: 'contextMenu'`

Menü yaşam döngüsü ayrı ve test edilebilir bir arka plan modülünde tutulur. Kurulum, başlangıç ve service worker yeniden yüklemeleri yinelenen öğe üretmez. Yeni modlar tamamlandıkça menü kontrollü biçimde genişletilir.

### 6.3 Klavye komutları ve onboarding

- `capture-full-page` ve `Alt+Shift+P` manifestten kaldırılır.
- Onboarding'deki kısayol kartı, ilişkili CSS, dil anahtarları ve testler kaldırılır.
- Diğer komutlar yalnızca bağlı oldukları mod gerçekten çalışıyorsa korunur.
- Kaldırılan kartın yerine yapay bir tanıtım kartı eklenmez.

## 7. Hata ve Geri Yükleme Davranışı

- İlk kare başlangıca ulaşamazsa yakalama başlamadan `E_VALIDATION` ile durur.
- Kapsanacak alan varken kaydırma ilerlemiyorsa yeni kare alınmaz.
- Son karedeki doğal tarayıcı kısıtlaması gerçek konuma göre kırpılır ve geçerli kabul edilir.
- Görünür alan hazırlama hatası yakalamayı engellemez.
- Kısıtlı sayfalarda kullanıcıya yerelleştirilmiş ve toparlanma önerisi taşıyan hata gösterilir.
- Hazırlama sırasında eklenen her stil ve değiştirilen her özellik `Restorer` tarafından kaydedilir.
- Başarı, hata, iptal ve timeout yolları aynı idempotent restore işlemini kullanır.

## 8. Test Tasarımı

### 8.1 Birim ve entegrasyon testleri

- İlk karenin sayfa başlangıcını eksiksiz kapsaması.
- Tarayıcı tarafından sınırlandırılan son kaydırmanın kabul edilmesi.
- İlerlemeyen kaydırmada yinelenen kare alınmaması.
- Gerçek scroll onayına göre kırpmanın boşluksuz hesaplanması.
- Ana belge, özel scroll alanı ve erişilebilir aynı kaynaklı iframe kaydırma çubuklarının gizlenmesi.
- Görünür alan hazırlığı başarısız olsa bile `captureVisibleTab` çağrısının sürmesi.
- Hazırlık stilleri ve özgün kaydırma konumunun geri yüklenmesi.
- Sağ tık menüsünün tek kez ve yalnızca `page` bağlamında oluşturulması.
- Menü eyleminin koordinatörü `trigger: 'contextMenu'` ile başlatması.
- Manifest, onboarding ve dil yüzeylerinde `Alt+Shift+P` kalmaması.
- Çalışmayan popup modlarının aktif eylem olarak sunulmaması.

### 8.2 Tarayıcı fixture ve E2E temeli

İlk Playwright fixture seti şunları içerir:

- uzun statik sayfa,
- sticky header ve footer,
- özel scroll container,
- aynı kaynaklı iframe,
- yakalama sırasında yüksekliği büyüyen belge,
- DPR ve zoom senaryosu.

E2E denetimi birleştirilmiş çıktıda ilk bölüm kaybı, tekrar, boşluk ve kaydırma çubuğu sızıntısını arar. Otomatik tarayıcı testi mümkün olmayan yerel profil durumlarında aynı senaryolar belgelenmiş Chrome smoke testiyle tamamlanır.

## 9. Dokümantasyon Uyumu

Aynı değişiklik grubunda aşağıdaki belgeler gerçek ürün kararı ve uygulama durumuyla güncellenir:

- `docs/specs/02-architecture.md`
- `docs/specs/03-capture-engine.md`
- `docs/specs/10-ui-ux.md`
- `docs/specs/12-roadmap-and-milestones.md`
- `docs/specs/13-data-contracts.md`
- `docs/specs/14-release-and-store.md`
- `docs/progress.md`
- onboarding tasarım belgesi

Kanonik spec'teki genel keyboard shortcut gereksinimi, tam sayfa için zorunlu varsayılan `Alt+Shift+P` anlamına gelmeyecek biçimde açıklanır. Sağ tık menüsü hedef ağacı, yalnızca tamamlanmış modları gösterme kuralıyla aşamalı hâle getirilir. Store metinleri yayımlanmamış özellikleri mevcutmuş gibi anlatmaz.

## 10. Kapsam Dışı

Bu tasarımın ilk kararlılık paketinde aşağıdakiler uygulanmaz:

- farklı kaynaklı iframe için yeni izin akışı,
- store sürümünde debugger/CDP arka ucuna geçiş,
- büyük tile'ların IDB/offscreen worker akışı,
- ileri PDF, ZIP, History yönetimi ve editör,
- batch, OCR, diff, evidence ve entegrasyonlar.

Bu alanlar M1'in sonraki paketleri veya M2–M5 kilometre taşlarıdır.

## 11. Kabul Kapısı

Faz aşağıdakilerin tamamı sağlanmadan bitmiş sayılmaz:

1. Tam sayfa çıktısında ilk bölüm kaybı ve yinelenen kare bulunmaz.
2. Tam sayfa ve görünür alan çıktılarında erişilebilen kaydırma çubukları görünmez.
3. Yakalama göstergesi hiçbir kareye sızmaz.
4. Sağ tık menüsü çalışan tam sayfa akışını başlatır.
5. Alt+Shift+P ve onboarding kısayol kartı kaldırılmıştır.
6. Çalışmayan popup eylemleri kullanıcıya teknik hata üretmez.
7. Sayfanın özgün stilleri ve kaydırma konumu her terminal durumda geri yüklenir.
8. Birim, entegrasyon ve E2E/Chrome smoke senaryoları geçer.
9. `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build:store`, `pnpm check:manifest`, `pnpm check:content-assets` ve `git diff --check` başarılıdır.
10. Değiştirilen dosyalar UTF-8 BOM'suzdur; Türkçe metinler karakter ve mojibake denetiminden geçmiştir.
