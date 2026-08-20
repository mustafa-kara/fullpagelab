# Result, Önizleme ve Dışa Aktarma Tasarım Kararı

> Durum: Kullanıcı tarafından onaylandı.
> Tarih: 2026-08-20
> Görsel yön: A — Odaklı çalışma alanı

## Amaç

Capture tamamlandıktan sonra FullPageLab'ın dosyayı sessizce indirmesi yerine kullanıcıya sonucu inceleyebileceği, görüntüyü kopyalayabileceği ve hangi formatta kaydedeceğini seçebileceği bir sonuç akışı sunmak.

Bu tasarım; `docs/chrome-screenshot-extension-features.md` içindeki export, clipboard, history ve local-first gereksinimlerini; `docs/specs/02-architecture.md`, `04-export-and-files.md`, `07-history-and-storage.md`, `10-ui-ux.md` ve `13-data-contracts.md` içindeki kararlarla birlikte uygular.

## Kullanıcı akışı

```text
Popup / shortcut
    → capture.start
    → popup kapanır, capture service worker'da sürer
    → tile'lar birleştirilir ve orijinal PNG yerel olarak yazılır
    → result.html?id=<captureId> yeni veya yeniden kullanılan sekmede açılır
    → kullanıcı önizler
    → PNG / JPEG / WebP / PDF seçer
    → İndir, Kopyala, Yazdır veya Düzenle aksiyonlarından birini seçer
```

Capture tamamlandığında `chrome.downloads.download` çağrısı yapılmaz. Varsayılan hedefler `history` ve `openResult` olur; `download` yalnızca kullanıcı sonuç ekranındaki bir aksiyona bastığında çalışır. `Settings.general.afterCapture` eski uyumluluk için korunur, ancak varsayılan değer `openResultTab` olarak kalır ve kullanıcı onayı olmadan indirme başlatmaz.

History kapalıysa sonuç sekmesi için geçici sonuç kaydı ve blob referansı kullanılır; sekme veya service worker yaşam döngüsü sona erdiğinde geçici veri temizlenir. History açık olduğunda `CaptureRecord`, thumbnail ve orijinal capture dosyaları `HistoryService` üzerinden yazılır.

## Görsel düzen — A: Odaklı çalışma alanı

### Üst çubuk

- Sol: History'e dönüş ve FullPageLab markası.
- Orta: sayfa başlığı, alan adı ve güvenli biçimde `textContent` ile render edilen kaynak URL özeti.
- Sağ: `Düzenle`, `Yeniden yakala` ve taşma menüsü.
- Alt meta şeridi: görüntü boyutu, CSS boyutu, capture modu, tarih/saat, dosya boyutu, mevcut format ve uyarı rozeti.

### Sol önizleme alanı

- Varsayılan görünüm `fit-to-width` olur.
- `100%`, yakınlaştır, uzaklaştır ve ekrana sığdır kontrolleri bulunur.
- Ctrl + tekerlek yakınlaştırır; normal tekerlek görüntüyü kaydırır.
- Uzun görseller tek blob ise dikey kaydırılır.
- Canvas sınırı nedeniyle strip üretildiyse strip sayfalama, önceki/sonraki kontrolleri ve `Tek görüntü olarak göster` seçeneği sunulur.
- Görüntü alanı sabit bir yükseklik kullanmaz; ana sayfa kaydırması ve iç görüntü kaydırması birbirini kilitlemez.
- Anlamlı görüntüler için kaynak başlığı ve modunu içeren alt metin kullanılır.
- Blob URL'leri bileşen kaldırılırken `URL.revokeObjectURL` ile temizlenir.

### Sağ dışa aktarma paneli

Panel her zaman görünür olan tek bir ana dışa aktarma alanıdır. Ekrandaki birincil CTA yalnızca bir tanedir ve seçili formata göre etiketlenir:

- Format segmented control: `PNG`, `JPEG`, `WebP`, `PDF`.
- Görüntü formatlarında kalite, ölçek, alpha arka planı ve dosya adı alanları.
- PDF seçildiğinde progressive disclosure ile açılan accordion:
  - tek uzun sayfa / çok sayfalı görünüm,
  - A4, A3, A5, Letter, Legal, Tabloid veya otomatik boyut,
  - dikey / yatay / otomatik yön,
  - genişliğe sığdır / içeride tut,
  - kenar boşlukları,
  - akıllı sayfa kesimleri,
  - tıklanabilir linkler,
  - aranabilir metin seçeneği,
  - header/footer ve watermark.
- Dosya adı alanı `Settings.export.filename` şablonunu gösterir ve örnek çözümlemeyi canlı günceller.
- Primary: `PNG olarak indir`, `JPEG olarak indir`, `WebP olarak indir` veya `PDF olarak indir`.
- Secondary: `Panoya kopyala`.
- Tertiary: `Yazdır` ve `Düzenle`.
- Clipboard aksiyonu format seçiminden bağımsız olarak PNG yazar; arayüzde açıkça `Panoya PNG olarak kopyalanacak` bilgisi gösterilir.

### Responsive davranış

- 900 px ve üzeri: iki kolon, önizleme esnek genişlikte; dışa aktarma paneli 360–420 px aralığında.
- 900 px altı: panel önizlemenin altına iner ve accordion olarak açılıp kapanır.
- 640 px altı: meta şeridi satırlara bölünür; butonlar en az 44 px dokunma alanını korur.
- Yatay taşma oluşturulmaz; panel içindeki seçenekler sarılır.

## Durumlar ve geri bildirim

- `loading`: metadata ve blob çözülürken skeleton önizleme; düğmeler devre dışı.
- `ready`: görüntü ve export seçenekleri aktif.
- `exporting`: ilgili düğmede spinner, tekrar tıklama engeli ve `aria-live="polite"` mesajı.
- `success`: `Kopyalandı`, `İndirildi: <dosya adı>` veya `PDF hazır` toast'ı.
- `warning`: strip fallback, PDF sayfa bölme, clipboard PNG dönüşümü veya eksik link/metin verisi sarı uyarı olarak görünür.
- `error`: hatanın nedeni ve toparlanma aksiyonu aynı panelde gösterilir; `Tekrar dene`, `Detayları kopyala` ve gerekiyorsa `Yer aç` seçenekleri bulunur.
- `history.enabled=false`: result sayfasında `Bu sonuç yalnızca geçici olarak tutuluyor` açıklaması gösterilir.

## Teknik sınırlar ve veri akışı

1. Capture coordinator, stitched PNG veya strip referanslarını `CaptureResultStore`/`HistoryService` üzerinden kaydeder.
2. `CaptureRecord.files` içinde `role:'full'` veya `role:'strip'` dosyaları tutulur; thumbnail ayrı bir WebP blob'dur.
3. `result.html` `history.get` ile metadata alır ve görüntü referanslarını blob çözümleme mesajı ile ister.
4. Export işlemleri `ExportRequest { captureId, plan, stripIndex?, editedRef? }` üzerinden service worker'a gider.
5. Export pipeline hedef sırasını `history → clipboard → download → print → integration → openResult` kararına göre yürütür; sonuç ekranından gelen tekil aksiyonlar yalnızca ilgili hedefi çalıştırır.
6. Büyük blob'lar OPFS'e, küçük blob'lar IndexedDB `blobs` tablosuna yazılır. `BlobRef` yaşam döngüsü refCount/release kurallarıyla korunur.
7. PDF oluşturma `@cantoo/pdf-lib` ve gerektiğinde offscreen worker üzerinden yapılır. Store varyantında aranabilir metin OCR katmanı ile sağlanır; CDP varyantında native PDF yolu ayrıca kullanılabilir.
8. Clipboard yazımı result sayfası → aktif sayfa content script'i → odaksız mini clipboard penceresi zincirini kullanır.
9. Kullanıcı verileri uzantı dışına gönderilmez; entegrasyonlar bu ekranın temel akışından ayrıdır ve açık kullanıcı aksiyonu ister.

## Mesaj ve sözleşme yüzeyi

Result akışı için tipli mesajlar aşağıdaki sorumlulukları taşır:

- `history.get`: metadata, dosyalar ve uyarıları döndürür.
- `result.resolveBlob`: `BlobRef` için geçici object URL veya blob metadata döndürür.
- `export.request`: seçilen `ExportPlan` ile dosya oluşturur ve `ExportResult` döndürür.
- `export.copy`: seçilen capture/strip'i clipboard'a PNG olarak yazar.
- `history.update`: başlık, etiket, klasör, not ve yıldız değişikliklerini kaydeder.
- `history.delete`: result menüsünden silme aksiyonunu gerçekleştirir.

Mesaj payload'ları zod doğrulamasından geçer; UI ham sayfa verisini HTML olarak birleştirmez.

## Erişilebilirlik ve tasarım sistemi

- Tasarım dili mevcut `src/ui/tokens.css` token'larına genişletilir; bileşenlerde rastgele hex değerleri kullanılmaz.
- Normal metin kontrastı en az WCAG AA 4.5:1 olur.
- Tüm ikon-only kontroller `aria-label` ve görünür focus ring taşır.
- Klavye sırası üst çubuk → önizleme kontrolleri → export paneli şeklinde ilerler.
- Format seçimi radio/segmented-control semantiğine sahip olur; durum yalnızca renkle anlatılmaz.
- Animasyonlar 150–300 ms aralığında, yalnızca durum değişimini anlatacak şekilde kullanılır; `prefers-reduced-motion` dikkate alınır.
- Primary CTA tekil ve format adını içeren açıklayıcı bir etiket taşır.

## Kabul kriterleri

- Capture tamamlandığında hiçbir varsayılan akış `chrome.downloads.download` çağırmaz.
- Visible ve full-page capture sonucu yeni result sekmesinde açılır; popup kapanmış olsa bile job service worker'da tamamlanır.
- Result ekranı gerçek capture görüntüsünü gösterir; önizleme fit-to-width, 100%, zoom ve dikey kaydırma ile kullanılabilir.
- PNG, JPEG, WebP ve PDF formatları panelden seçilebilir; indirme yalnızca kullanıcı CTA'ya bastığında başlar.
- Clipboard aksiyonu PNG yazar ve format dönüşümünü kullanıcıya bildirir.
- Filename template ve conflict/save seçenekleri `ExportPlan` ile eşleşir.
- Strip'li sonuçlarda strip navigasyonu ve uyarı görünür; tek dev canvas varsayılmaz.
- History açıkken capture kaydı, thumbnail, metadata ve dosya referansları result açılmadan önce kullanılabilir olur.
- History kapalıyken sonuç geçici olarak görüntülenir ve kalıcı history kaydı oluşturulmaz.
- Export, clipboard, storage quota ve blob çözümleme hataları kullanıcıya toparlanma aksiyonu ile gösterilir.
- Result sayfası 900 px altında yatay taşma üretmez ve klavye/ekran okuyucu ile çalışır.
- `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build:all`, `pnpm check:manifest`, `pnpm check:content-assets`, `pnpm traceability` ve UTF-8 denetimi geçer.

## Kaynak gereksinim eşlemesi

| Gereksinim | Kaynak | Tasarım karşılığı |
|---|---|---|
| PNG/JPEG/PDF, clipboard, history | `docs/chrome-screenshot-extension-features.md` §2 P0 | Result export paneli ve yerel kayıt |
| WebP, filename, print, auto-download ayarları | kaynak §2 P1 | Format paneli, şablon alanı ve açık kullanıcı aksiyonu |
| Multi-image fallback | kaynak §2 P0 | Strip navigasyonu ve tek görüntü tercihi |
| Capture sonucu result sekmesi | `docs/specs/10-ui-ux.md` §4 | A düzeni, meta şeridi ve viewer |
| ExportPlan ve ExportRequest | `docs/specs/04-export-and-files.md` §1, `13-data-contracts.md` §4 | Tipli export mesajları |
| Local-first history ve thumbnail | `docs/specs/07-history-and-storage.md` §5–§7 | CaptureRecord, BlobRef ve geçici sonuç fallback'i |
| Job yaşam döngüsü ve openResult | `docs/specs/02-architecture.md` §3–§4 | Coordinator done → result tab geçişi |
| Erişilebilirlik, responsive, toast | `docs/specs/10-ui-ux.md` §13–§18 | Token, focus, responsive ve geri bildirim kuralları |
