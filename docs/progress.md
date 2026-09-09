# FullPageLab İlerleme Raporu

> Son güncelleme: 2026-09-09

Bu dosya, repodaki gerçek uygulama durumunun kanonik ilerleme raporudur. Hedef kapsam `docs/specs/` altında, özet özellik listesi ise `docs/chrome-screenshot-extension-features.md` dosyasındadır. Hedef spec içinde bulunması bir özelliğin tamamlandığı anlamına gelmez.

## Güncel özet

| Alan | Durum |
|---|---|
| M0 altyapı | Uygulandı ve doğrulandı |
| M1 yakalama | Kısmi: Full page ve Visible area aktiftir |
| Result/export | Uygulandı: önizleme, format/dosya adı seçimi, kullanıcı onaylı indirme, kopyalama ve yazdırma |
| Onboarding | Uygulandı: üç adımlı tanıtım, gizlilik, sabitleme ipucu ve yakalanabilir örnek sayfa |
| Editör (annotation) | Kısmi: 11 araçlık çubuk, stil/zoom kontrolleri ve tahribatsız kayıt çalışır; katman paneli, kırpma/döndürme, autosave ve klavye kısayolları yoktur |
| Otomatik doğrulama | 35 Vitest dosyasında 211 test (33 unit / 200, 2 integration / 11) ve 3 Playwright dosyasında 42 Chromium E2E senaryosu |
| Aktif dal | `master` |
| Remote | Bu raporun commit'iyle birlikte `origin/master` ile hizalanır |

## Şu anda çalışan kullanıcı akışları

- Popup yalnız çalışan **Full page** ve **Visible area** düğmelerini gösterir. Selection, Element, Scrolling area ve All tabs kullanıcıya sunulmaz.
- `capture.start`, hedef sekme/pencere bilgisi dâhil eksiksiz bir `CaptureRequest` alır ve job ID'sini hemen döndürür.
- Popup başarılı başlangıçtan sonra kapanır. Yakalama service worker'da sürer; popup yeniden açıldığında aktif iş `capture.listActive` ile izlenebilir.
- **Full page:** sayfa hazırlanır, gerçek scroll onaylarına göre tile kırpma/yerleştirme yeniden hesaplanır, görünür kareler birleştirilir ve result sekmesi açılır.
- **Visible area:** erişilebilen sayfalarda scrollbar/animasyon/fixed katman hazırlığı best-effort uygulanır; hazırlık yapılamazsa görünür alan yakalama yine denenir.
- Capture tamamlandığında dosya otomatik indirilmez. Result sayfası gerçek görüntü önizlemesi, zoom/fit, PNG/JPEG/WebP/PDF seçimi, dosya adı önizlemesi, kalite/PDF seçenekleri ve açık **İndir**, **Kopyala**, **Yazdır** eylemlerini sunar.
- Görünen alan komutu `Alt+Shift+V` ile çalışır. Tam sayfa için varsayılan `Alt+Shift+P` komutu yoktur.
- Sağ tık menüsünde yalnız sayfa bağlamındaki **Tam sayfayı yakala** eylemi bulunur.
- Onboarding, Chrome tarafından korunan uzantı sayfasını yakalamaya çalışmaz; `onboarding.openDemo` ile normal HTTP(S) örnek sayfasını açar.
- Result sayfasındaki **Düzenle** eylemi annotation editörünü açar. Kayıt tahribatsızdır: **Kaydet** yeni bir capture kaydı üretir ve `source.editedFrom` alanına kaynağın kimliğini yazar; özgün dosya olduğu gibi kalır.
- Editör araç çubuğu tek satırdır ve şu araçları sunar: select, arrow (çizgi + üçgen uç), rect, ellipse, line, freehand (Fabric PencilBrush), text (yerinde düzenleme), highlight (multiply karışım), blur, pixelate, redact.
- Araç çubuğunda renk paleti ve çizgi kalınlığı kontrolleri bulunur; redact ve pikselleştirme etkileri sabittir çünkü görünüşleri verilen garantinin kendisidir.
- Zoom kontrolleri (büyüt/küçült/sığdır/%100) çalışır. Capture, genişliği sığacak biçimde açılır ve yükseklik kaydırılır; %25 alt sınırı korunur, böylece tam sayfa yakalama üzerine çizilebilecek boyutta gelir.
- Seçili bir annotation `Delete`/`Backspace` ile silinir. Undo/redo, taşıma ve yeniden boyutlandırma dâhil tüm işlemleri kapsar.
- Sürükleme sırasında şekil canlı önizlenir. Blur ve pixelate önizlemede yarı saydam bir dolgu gösterir; bölgeyi her pointer hareketinde yeniden kesmek pahalı olduğu için nihai etki bırakışta uygulanır.
- Etkileşim sözleşmesi: bir çizim aracı seçiliyken mevcut annotation'lar etkileşimsiz olur, böylece üzerlerine çizilebilir. Taşımak için select aracına geçilir. Text bunun tek istisnasıdır; düzenleme süresince kendi nesnesini yeniden etkinleştirir.
- Manifest ve action toolbar ikonları `fullpagelabicon.png` kullanır; ürün adı FullPageLab'dir.

## Yakalama motorunda doğrulanan davranışlar

- Hedef sekme ve pencere, istekteki `CaptureTarget.tabId/windowId` üzerinden sabitlenir; o anda aktif görünen farklı bir sekme yanlışlıkla yakalanmaz.
- `captureVisibleTab` çağrıları aynı pencere için en az 500 ms aralıkla çalışır; quota hatalarında geri çekilme uygulanır.
- Son tile ve sayfa sonundaki crop, istenen konum yerine `ScrollAck.actualX/actualY` değerlerine göre hesaplanır.
- Kesirli DPR'da stitch çıktı boyutları en yakın piksele yuvarlanır; fazladan bir piksel satırı/sütunu oluşmaz.
- Progress overlay her ekran görüntüsü öncesinde gizlenir ve iki temiz compositor frame beklenir; overlay çıktı görseline sızmaz.
- Cookie/consent katmanları gizlendikten sonra compositor ve içerik yerleşiminin temizlenmesi beklenir.
- Scrollbar gizleme stili ana belgeye ve erişilebilen same-origin iframe belgelerine uygulanır; restore sırasında eklenen tüm style düğümleri kaldırılır.
- Sticky/fixed katman hazırlığı ve kontrollü lazy-load pre-scroll uygulanır; işlem sonunda özgün scroll ve geçici stiller idempotent biçimde geri yüklenir.
- Service worker başlatma kurtarması yalnız ilk initialization sırasında çalışır; her mesajda aktif job'ı hatalı biçimde `E_SW_RESTART` durumuna düşürmez.
- Standalone content agent IIFE olarak bundle edilir; content script içinde `import statement outside a module` hatası oluşmaz.

## Editörde bulunup düzeltilen hatalar

Bu bölüm, editör çalışması sırasında bulunup giderilen ve her biri için önce başarısız olan bir test yazılan hataları kaydeder. Testler, düzeltme geri alınarak doğrulanmıştır.

- **Boş editör (`a8f7257`).** Fabric iki katmanlı canvas kurar: alttaki çizimi, üstteki etkileşimi taşır. `.editor-stage canvas` kuralı ikisini birden biçimlendirdiği için üstteki canvas görüntünün üzerine opak beyaz boyanıyordu. Capture her zaman doğru render ediliyordu ama hiç görünmüyordu. Çerçeve artık Fabric'in ürettiği sarmalayıcıya uygulanır, etkileşim katmanı saydam kalır.
- **Canvas boyutu ve yükleme hatası (`2ace979`).** Canvas capture metadata'sından boyutlanırken arka plan görüntüsü tarayıcının çözdüğü boyutta çiziliyordu; ikisi ayrışınca görünen alan boş kalıyordu. Artık bitmap tek doğru kaynaktır. `fitCanvasToLimits` tarayıcı sınırıyla doğrudan karşılaştırma yapıyordu, oysa Fabric backing store'u device pixel ratio ile çarpar: ratio 1'de sığan bir capture ratio 2'de taşıyor ve tahsis sessizce başarısız oluyordu. Reddedilen bir görüntü yüklemesi yakalanıyor ama araç çubuğu yine hazır işaretleniyordu; artık hata sahnede nedeniyle birlikte görünür.
- **History dışı capture'lar (`4375681`).** Editör kendi taban görüntüsünü `resolveBlob` ile çözüyordu; bu fonksiyon session-store referansları için hata fırlatır. History kapalıyken alınan capture'lar o store'da yaşadığı için editör boş canvas açıyordu. Result sayfası her iki store için de URL çözdüğünden artık o URL aktarılır.
- **Dışa aktarma (`8ab0e7c`).** Dışa aktarma zoom'u bölmek için bir multiplier geçiriyordu, ama zoom aynı zamanda canvas'ı yeniden boyutlandırıyor; iki ölçekleme birbiriyle çakışınca annotation'lar dışa aktarılan karenin dışına düşüyordu. Dışa aktarma artık viewport'u sıfırlar ve capture'ın kendi çözünürlüğünde render eder.
- **Görüntüleyici düzenlenmiş dosyayı yok sayıyordu (`8ab0e7c`).** Result görüntüleyici düzenlenmiş dosya yerine dokunulmamış capture'ı tercih ediyordu; iki rol de strip indeksi taşımadığından sıralama berabere kalıyordu. Bu yüzden çalışmış bir kayıt bile hiçbir şey yapmamış gibi görünüyordu.
- **Blur/pixelate gizlilik hatası (`8ab0e7c`).** Bir blur/pixelate bölgesi taşındığında veya yeniden boyutlandırıldığında üzerinde oluşturulduğu pikselleri de beraberinde taşıyordu. Bu hem gizlemesi gereken içeriği yeniden açığa çıkarıyor hem de o içeriğin hafifçe bulanıklaştırılmış bir kopyasını kullanıcının hiç incelemediği bir yere naklediyordu. Bölge artık yeni konumunda capture'ın gösterdiği şeyden yeniden kesilir.
- **Araçların çoğu düz dikdörtgen çiziyordu (`b60d8fb`).** Doküman modeli doğru annotation tipini kaydettiği için pikseller kontrol edilene kadar hiçbir şey yanlış görünmüyordu: freehand dikdörtgen çiziyordu, ok ucu yoktu, blur/pixelate hiçbir şey gizlemeyen boş bir kontur çiziyordu, text'e yazı girilemiyordu ve highlight opaktı.
- **Çizim jesti mevcut annotation tarafından yutuluyordu (`4dce384`).** Kaçak şekil hatası için eklenen koruma, basış bir nesnenin üzerine geldiğinde tüm çizim jestini bastırıyordu; böylece daha önceki bir annotation kapladığı alanı çizilemez hâle getiriyordu. Çözüm ters yönde: çizim aracı annotation'ları etkileşimsiz kılar.

## Henüz tamamlanmayan kapsam

- Selection, Element/Selector, Scrolling area/scrollContainer, iframe ve All tabs yakalama modları.
- Infinite scroll'un genel amaçlı büyütme/durdurma akışı ve çok seviyeli nested scroll yakalama.
- Büyük sonuçlar için IDB/OPFS tile streaming, strip/multi-image fallback ve partial stitch.
- Gelişmiş History UI: arama, filtre, bulk işlemleri, recapture, compare ve kota yönetimi.
- Editörde `marker`, `emoji`, `image`, `crop` ve `pan` araçları: `ToolId` tip sisteminde ve annotation fabrikasında tanımlıdırlar ama araç çubuğunda yer almazlar, yani kullanıcıya sunulmazlar.
- Editörde katman paneli, autosave (`EditorSettings.autosaveMs` okunmaz), pano yapıştırma ve kırpma/yeniden boyutlandırma/döndürme arayüzü.
- Editör klavye desteği yalnız `Delete`/`Backspace` ile sınırlıdır; spec'teki V/A/R/T/B araç kısayolları, `Ctrl+Z/Y`, `Ctrl+C/V`, `Ctrl+D` yoktur.
- `src/lib/editor/flatten.ts` ölü koddur: `src/` içinden hiçbir yerden import edilmez, yalnız kendi unit testi onu çağırır. Canlı render yolu Fabric canvas'ının `toDataUrl()` çıktısıdır ve bu iki yol birbiriyle uyuşmaz. Bu dosya ya canlı yola bağlanmalı ya da kaldırılmalıdır.
- Gelişmiş PDF: metin/link katmanı, header/footer, watermark ve smart page breaks.
- Batch URL/all-tabs, ZIP/combined PDF, OCR, diff/monitoring, entegrasyonlar ve public API.
- Tam Options ve side panel kullanıcı yüzeyleri.

Bu özellikler hedef spec'lerde tanımlıdır ancak mevcut Store build'inin çalışan özelliği olarak ilan edilmez.

## Son ilgili commitler

- `4dce384` — `fix(editor): draw over annotations, preview effects filled, compact toolbar`
- `8ab0e7c` — `fix(editor): correct manipulation, saving, and add style controls`
- `b60d8fb` — `feat(editor): make every annotation tool actually work`
- `a8f7257` — `fix(editor): stop the interaction layer from covering the capture`
- `2ace979` — `fix(editor): size the canvas from the decoded image and report load failures`
- `4375681` — `fix(editor): load captures that are kept out of history`
- `e563cce` — `test(editor): cover annotate-and-save and privacy warnings end to end`
- `b0f1328` — `feat(editor): open the annotation editor from the result page`
- `c8b90c2` — `feat(editor): add Fabric.js editor core behind a lazy entry point`
- `ee4fc91` — `fix: stabilize full-page capture across site layouts`

## Doğrulama durumu

2026-09-09 tarihinde aşağıdaki kontroller yapıldı:

- `pnpm test` — 35 dosya, 211 test geçti (33 unit dosyasında 200 test, 2 integration dosyasında 11 test).
- Playwright Chromium E2E — toplam 42 senaryo, 3 dosyada: `editor.spec.ts` 34, `capture-robustness.spec.ts` 4, `capture-stability.spec.ts` 4.
- `pnpm typecheck`.
- `pnpm lint`.
- Store Vite build'i.
- Standalone content agent build'i.
- Değiştirilen dokümanlarda UTF-8 BOM, mojibake ve Türkçe karakter denetimi.

**Bilinen E2E sorunu.** E2E paketi tam olarak baştan sona koşturulduğunda her seferinde rastgele bir test başarısız olur. Her test kendi Chrome örneğini başlattığı için bu bir kaynak baskısı sorunudur, ürün hatası değildir: başarısız olan testler tek başına ve küçük gruplar hâlinde koşturulduğunda saniyeler içinde geçer. Sorun editör çalışmasından öncesine dayanır ve henüz giderilmemiştir. Doğrulama yaparken spec dosyalarını ya da test gruplarını ayrı ayrı çalıştırın.

## Yerel Chrome kontrolü

1. `pnpm build:store` çalıştır.
2. `chrome://extensions/` üzerinden `dist/store` klasörünü yükle veya uzantıyı yeniden yükle.
3. Normal bir HTTP(S) sayfasında popup'tan **Full page** ya da **Visible area** seç; alternatif olarak sayfada sağ tıklayıp **Tam sayfayı yakala** eylemini kullan.
4. Tam sayfa yakalamada progress overlay'in çıktıya girmediğini, ilk/son karede kayıp olmadığını ve scrollbar'ın görünmediğini kontrol et.
5. Result sekmesinde önizlemeyi ve format/dosya adı seçeneklerini kontrol et.
6. **İndir** seçilmeden Downloads'a dosya yazılmadığını; seçildikten sonra seçilen formatın indirildiğini doğrula.
7. Result sayfasında **Düzenle**'yi aç; capture'ın boş beyaz bir sahne yerine gerçekten göründüğünü doğrula. Bir ok ve bir blur bölgesi çiz, blur bölgesini taşı ve altındaki içeriğin yeni konumda yeniden kesildiğini gözle kontrol et. **Kaydet** sonrasında yeni bir kaydın oluştuğunu, görüntüleyicinin düzenlenmiş sürümü gösterdiğini ve özgün capture'ın korunduğunu doğrula.
