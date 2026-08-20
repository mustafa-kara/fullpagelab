# Sağ Tık Menüsü ve Yakalama Kararlılığı Tasarımı

**Tarih:** 20 Ağustos 2026  
**Durum:** Onaylandı  
**Kapsam:** Tam sayfa yakalama regresyonu, sağ tık tetikleyicisi, Alt+Shift+P kaldırılması ve kaydırma çubuğu gizleme

## 1. Amaç

FullPageLab tam sayfa yakalama akışını gerçek tarayıcı kaydırma davranışlarına dayanıklı hâle getirmek, Alt+Shift+P tam sayfa kısayolunu kaldırmak ve aynı işlemi Chrome'un yerel sağ tık menüsünden erişilebilir kılmak. Tam sayfa ve görünür alan çıktılarında erişilebilen kaydırma çubukları görünmemeli; yakalama sonrasında sayfanın özgün durumu eksiksiz geri yüklenmelidir.

## 2. Mevcut Sorunların Kök Nedeni

### 2.1 Tam sayfa regresyonu

`4d64fff` değişikliği, her kaydırma adımında tarayıcının bildirdiği konumu planlanan konumla yaklaşık eşit olmaya zorlayan bir doğrulama ekledi. Gerçek sayfalarda kaydırma konumu; belgenin son sınırı, alt piksel yuvarlaması, özel kaydırma kökü veya dinamik yerleşim nedeniyle planlanan değerden farklı olabilir. Bu durum geçerli bir tarayıcı yanıtını yakalama hatasına dönüştürür.

Mevcut `recomputeStepFromAck` akışı zaten kırpma geometrisini tarayıcının bildirdiği gerçek konuma göre yeniden hesaplamak için vardır. Katı eşitlik doğrulaması bu uyarlamalı davranışla çelişmektedir.

### 2.2 Görünür alan çıktısındaki kaydırma çubuğu

Tam sayfa akışı `preparePage` üzerinden kaydırma çubuğu gizleme stilini uygular. Görünür alan akışı ise doğrudan `captureVisibleTab` çağırdığı için hazırlama ve geri yükleme aşamalarından geçmez. Bu nedenle `hideScrollbars: true` ayarı görünür alan yakalamalarında etkisizdir.

Ana belgeye eklenen stil aynı kaynaklı iframe belgelerine kendiliğinden geçmez. Erişilebilen iframe belgeleri ayrıca hazırlanmalıdır. Farklı kaynaklı iframe içeriği tarayıcı güvenlik sınırları nedeniyle ek izin olmadan değiştirilemez.

## 3. Seçilen Yaklaşım

Mevcut `CaptureCoordinator` ve görünür sekme arka ucu korunacaktır. Tam sayfa motoru yeniden yazılmayacak ve mağaza sürümüne `debugger` izni eklenmeyecektir.

- Katı hedef-konum eşitliği, ilerleme ve kapsama doğrulamasıyla değiştirilecek.
- Kare kırpma geometrisi tarayıcının gerçek kaydırma yanıtına göre hesaplanacak.
- Görünür alan yakalama, yalnızca görsel hazırlık ve geri yükleme amacıyla hafif bir hazırlama işleminden geçecek.
- Sağ tık menüsü ayrı ve test edilebilir bir arka plan modülünde yönetilecek.
- Onboarding'deki klavye kısayolu kartı kaldırılacak; yerine yeni bir yapay kart eklenmeyecek.

## 4. Sağ Tık Menüsü ve Kısayol

### 4.1 Menü davranışı

Chrome yerel sağ tık menüsünde yalnızca normal sayfa bağlamında şu öğe gösterilecek:

- Türkçe: `Tam sayfa ekran görüntüsünü al`
- İngilizce: `Capture full-page screenshot`

Menü `contexts: ['page']` ile oluşturulacak. Seçim, bağlantı, resim ve çerçeve bağlamlarında gösterilmeyecek. Menü tıklaması mevcut koordinatörü şu bilgilerle başlatacak:

- `mode: 'fullPage'`
- `trigger: 'contextMenu'`
- etkin sekme ve geçerli kullanıcı ayarları

Menü yaşam döngüsü ve tıklama yönlendirmesi `src/background/context-menus.ts` gibi tek sorumluluklu bir modülde tutulacak. Dinleyici servis çalışanı yüklenirken eşzamanlı olarak kaydedilecek; menü öğesi kurulum ve başlangıç sırasında kimliği üzerinden güvenli biçimde yenilenecek. Tekrarlanan başlatmalar yinelenen menü öğesi oluşturmamalıdır.

### 4.2 Alt+Shift+P kaldırılması

`capture-full-page` komutu ve `Alt+Shift+P` önerilen tuşu manifestten tamamen kaldırılacak. Onboarding'deki `ShortcutCard`, ilgili CSS ve Türkçe/İngilizce metinler silinecek. Diğer bağımsız komutlar bu kapsamda değiştirilmeyecek.

## 5. Tam Sayfa Yakalama Veri Akışı

1. Etkin sekme doğrulanır ve sayfa metrikleri taranır.
2. Sayfa hazırlanır: kaydırma çubukları gizlenir, mevcut sabit öğe ve akıllı gizleme kuralları uygulanır, görseller ve yazı tipleri beklenir.
3. Hazırlama sonrası metrikler yeniden taranır ve yakalama planı bu geometriyle oluşturulur.
4. Her kare için planlanan konum sayfa ajanına gönderilir.
5. Sayfa ajanı kaydırmayı en fazla üç kez dener ve gerçek konumu bildirir.
6. İlk karenin kaydırma kökünün başlangıcına ulaştığı doğrulanır. Ulaşılamazsa üst kısmı eksik bir çıktı üretmek yerine işlem durdurulur.
7. Sonraki karelerde yeni kapsama alanına doğru ilerleme doğrulanır. Belgenin doğal son sınırında oluşan kaydırma kısıtlaması kabul edilir; kapsanacak alan kaldığı hâlde ilerleme yoksa yinelenen kareyi önlemek için işlem durdurulur.
8. Her karenin kırpma alanı `recomputeStepFromAck` ile gerçek konuma göre hesaplanır.
9. Yakalama arayüzü kare alınmadan önce gizlenir ve temiz birleştirme için bir sonraki boyama karesi beklenir.
10. Kareler birleştirilir, geçici sonuç kaydedilir ve sonuç önizleme sekmesi açılır.
11. Başarı, hata veya iptal durumlarının tamamında sayfa stilleri ve özgün kaydırma konumu `finally` üzerinden geri yüklenir.

## 6. Kaydırma Çubuğu Gizleme

### 6.1 Tam sayfa

Hazırlama stili ana belgeye, tüm standart ve özel kaydırma alanlarına uygulanacak. WebKit ve Firefox uyumlu kurallar hem genişliği hem yüksekliği sıfırlayacak:

- `scrollbar-width: none !important`
- `::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }`

Erişilebilen aynı kaynaklı iframe belgelerine de ayrı hazırlama stili eklenecek. Eklenen tüm stil öğeleri `Restorer` tarafından kaydedilecek ve işlem sonunda kaldırılacak.

### 6.2 Görünür alan

Görünür alan yakalaması şu hafif işlemden geçecek:

1. Sayfa ajanını enjekte etmeyi dene.
2. Yalnızca gerekli görsel hazırlığı uygula; en azından kaydırma çubuklarını gizle.
3. Düzen ve compositor için iki temiz boyama karesi bekle.
4. Görünür sekmeyi yakala.
5. Hazırlama durumunu her koşulda geri yükle.

`chrome://`, Chrome Web Store veya izin verilmeyen farklı kaynaklı belge gibi ajan enjekte edilemeyen sayfalarda görünür alan yakalaması başarısız sayılmayacak. Yakalama doğrudan devam edecek; yalnızca kaydırma çubuğunu gizleme garantisi verilemeyecek.

## 7. Hata Yönetimi

- İlk kare kökün başlangıcına ulaşamazsa `E_VALIDATION` ile işlem durur; hiçbir eksik sonuç kaydedilmez.
- Kapsanacak alan kaldığı hâlde kaydırma ilerlemiyorsa `E_VALIDATION` ile işlem durur; yinelenen kare birleştirilmez.
- Son karedeki doğal tarayıcı kısıtlaması hata değildir ve gerçek konuma göre kırpılır.
- Görünür alan hazırlama hatası yakalamayı engellemez; hata uyarı seviyesinde loglanır.
- Sağ tık işlemi kısıtlı bir sekmede başlatılamazsa iş kaydı hata kodu ve açıklamasıyla sonlandırılır.
- Tüm hata yolları idempotent geri yükleme çalıştırır.

## 8. Test Tasarımı

### 8.1 Birim testleri

- Manifestte `capture-full-page` ve `Alt+Shift+P` bulunmamalı.
- Onboarding çıktısında `ShortcutCard`, kısayol tuşları ve ilişkili metinler bulunmamalı.
- Sağ tık menüsü yalnızca `page` bağlamında ve tek kez oluşturulmalı.
- Yerelleştirilmiş menü başlığı Türkçe ve İngilizce için doğrulanmalı.
- Menü tıklaması koordinatörü `mode: 'fullPage'` ve `trigger: 'contextMenu'` ile başlatmalı.
- Son karede sınırlandırılmış gerçek kaydırma konumu kabul edilmeli.
- İlk kare başlangıca ulaşmadığında görüntü alınmadan işlem durmalı.
- Sonraki karede ilerleme olmadığında yeni kare alınmamalı.
- Gerçek kaydırma yanıtına göre yeniden hesaplanan kırpma alanları çıktıyı boşluksuz kaplamalı.
- Görünür alan hazırlaması başarısız olduğunda `captureVisibleTab` yine çağrılmalı.

### 8.2 Entegrasyon testleri

- Ana belge ve özel kaydırma alanlarının scrollbar stilleri yakalama sırasında gizlenmeli.
- Erişilebilen aynı kaynaklı iframe scrollbar stili gizlenmeli.
- Hazırlama tamamlandıktan sonra eklenen stiller ve özgün kaydırma konumu eksiksiz geri yüklenmeli.
- İlerleyen gerçek kaydırma yanıtlarıyla çok kareli bir yakalama tamamlanmalı ve yinelenen kare oluşmamalı.

### 8.3 Son doğrulama

- `pnpm test`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm build:store`
- `pnpm check:manifest`
- `pnpm check:content-assets`
- Uzun belge üzerinde tam sayfa Chrome smoke testi
- Görünür alan scrollbar gizleme Chrome smoke testi
- Sağ tık menüsü Chrome smoke testi

## 9. Dokümantasyon ve Kodlama Kuralları

İlgili ürün/spec belgeleri gerçek uygulama durumuna göre güncellenecek. Değiştirilen bütün metinler UTF-8 BOM'suz tutulacak. Türkçe metinlerde ç, ğ, ı, İ, ö, ş ve ü karakterleri doğru kullanılacak; son kontrolde değiştirilen satırlar mojibake ve İngilizceleştirilmiş Türkçe ifadeler açısından taranacaktır.

## 10. Kapsam Dışı

- Tam sağ tık menüsü ağacı ve diğer yakalama modları
- Seçim, bağlantı, resim veya iframe bağlamlarına özel menü eylemleri
- Farklı kaynaklı iframe içeriğine ek izin isteme
- Store sürümünde CDP/debugger arka ucuna geçiş
- Diğer klavye komutlarını kaldırma veya yeniden atama

## 11. Kabul Kriterleri

1. Alt+Shift+P tam sayfa komutu artık manifestte ve onboarding'de bulunmaz.
2. Sağ tık menüsünde yalnızca sayfa bağlamında yerelleştirilmiş tam sayfa eylemi görünür.
3. Menü eylemi mevcut tam sayfa koordinatörünü başlatır.
4. Gerçek tarayıcı kaydırma sınırları geçerli kareleri hataya dönüştürmez.
5. İlk bölüm kaybı ve yinelenen kareler doğrulama ile önlenir.
6. Erişilebilen kaydırma çubukları tam sayfa ve görünür alan çıktılarında görünmez.
7. Yakalama sonrasında sayfanın özgün stilleri ve kaydırma konumu geri yüklenir.
8. Tüm otomatik kontroller ve belirtilen Chrome smoke testleri geçer.
