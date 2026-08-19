# Chrome Screenshot Extension – Özellik Gereksinimleri

Bu doküman, FireShot ve GoFullPage benzeri bir Chrome extension geliştirmek için önerilen özellik setini içerir.

## 1. Temel Capture Özellikleri

### P0 – Olmazsa Olmaz
- Tek tıkla full-page screenshot alma
- Görünen alanı (visible viewport) yakalama
- Dikdörtgen alan seçerek screenshot alma
- Scrollable `div`, chat paneli ve iç scroll alanlarını yakalama
- Fixed/sticky header ve footer elementlerini doğru yönetme
- Çok uzun sayfalarda güvenli parça/parça capture
- Capture ilerleme göstergesi
- Capture işlemini iptal etme
- Keyboard shortcut desteği

### P1 – Gelişmiş Capture
- DOM element seçerek capture
- CSS selector ile capture (`#main`, `.content` vb.)
- iframe / frameset capture
- Infinite-scroll sayfaları yakalama
- Infinite-scroll sırasında manuel durdurma
- Gecikmeli screenshot / timer
- Sağ tık menüsünden capture
- Tüm açık tabları capture
- URL listesinden batch capture
- Lazy-loaded içerikleri otomatik yükleme

---

## 2. Export ve Dosya Özellikleri

### P0
- PNG export
- JPEG/JPG export
- PDF export
- Clipboard'a kopyalama
- Screenshot history
- Yerel kayıt / browser storage
- Çok büyük screenshot'larda multi-image fallback

### P1
- Tek uzun PDF sayfası
- Multi-page PDF
- A4 PDF
- Letter / Legal PDF
- Portrait / Landscape
- Smart page breaks
- Metin satırlarının PDF sayfaları arasında bölünmesini azaltma
- Clickable link içeren PDF
- Searchable/selectable text içeren PDF
- Header / footer
- Page number
- URL
- Timestamp
- Domain
- Sayfa title bilgisi
- Watermark
- Print
- Auto-download
- Özel download klasörü
- Filename template
- Batch ZIP export
- Tüm tabları tek PDF'e birleştirme

### P2
- GIF export
- BMP export

---

## 3. Screenshot Editor

### Temel Araçlar
- Crop
- Resize
- Rotate
- Arrow
- Rectangle
- Ellipse
- Line
- Freehand pen
- Text
- Highlight
- Numbered marker
- Emoji / sticker

### Gizlilik Araçları
- Blur
- Pixelate
- Kalıcı redaction / blackout

> Hassas bilgiler için blur yerine gerçek redaction seçeneği bulunmalıdır.

### Editör UX
- Undo / redo
- Zoom / pan
- Annotation taşıma
- Annotation yeniden boyutlandırma
- Annotation silme
- Annotation çoğaltma
- Copy / paste
- Keyboard shortcuts
- Layer benzeri annotation yönetimi
- Renk seçimi
- Border kalınlığı
- Fill ayarı
- Font size ve font özellikleri

---

## 4. Capture Engine – Teknik Gereksinimler

### Fixed / Sticky Element Yönetimi
- Sticky navbar'ın her scroll adımında tekrar görüntülenmesini engelle
- Sticky footer tekrarlarını engelle
- Gerekirse elementleri capture sırasında geçici olarak reposition/hide et

### Nested Scrolling
Aşağıdaki uygulama tiplerini destekle:
- Chat uygulamaları
- Admin panelleri
- Dashboard'lar
- Gmail benzeri uygulamalar
- Scroll edilen modal/panel yapıları
- İç içe scroll container'lar

### iframe
- iframe algılama
- Aynı origin iframe capture
- İzin verilirse cross-origin iframe desteği
- Gerektiğinde optional/contextual permissions isteme

### Lazy Loading
- Otomatik pre-scroll
- Görsellerin yüklenmesini bekleme
- Network idle kontrolü
- DOM değişikliklerinin durulmasını bekleme
- Kullanıcı tarafından ayarlanabilir capture delay

### Çok Uzun Sayfalar
- Tek dev canvas yerine tile-based stitching
- Browser canvas/image limitlerini algılama
- Multi-image fallback
- Streaming PDF yaklaşımı
- Bellek kullanımını sınırlandırma

### Infinite Scroll
- Auto-scroll
- `Stop Capture`
- Maksimum scroll sayısı
- Maksimum capture yüksekliği
- Maksimum capture süresi
- Duplicate content detection

---

## 5. Batch Capture ve Automation

### URL Batch Capture
Kullanıcı URL listesi verebilmeli:

```text
https://site.com/page-1
https://site.com/page-2
https://site.com/page-3
```

### Capture Modları
- Full page
- Visible viewport
- CSS selector
- Belirli DOM element

### Bekleme Koşulları
- Sabit süre bekleme
- Network idle
- Selector görünene kadar bekleme
- Sayfa yüklenmesi tamamlanana kadar bekleme

### Output
- Ayrı PNG
- Ayrı JPEG
- Ayrı PDF
- Tek combined PDF
- ZIP

### Filename Template

Örnek:

```text
{domain}_{title}_{yyyy-mm-dd}_{counter}
```

Desteklenebilecek değişkenler:
- `{domain}`
- `{hostname}`
- `{title}`
- `{url}`
- `{date}`
- `{time}`
- `{yyyy-mm-dd}`
- `{counter}`
- `{viewport}`
- `{width}`
- `{height}`

### Batch Kontrolleri
- Progress
- Retry
- Timeout
- Concurrency
- Delay
- Hata logları
- Başarısız URL'leri yeniden çalıştırma

---

## 6. Screenshot History

Her screenshot için aşağıdaki metadata tutulabilir:

- Thumbnail
- Title
- Original URL
- Domain
- Capture tarihi
- Capture saati
- Dimensions
- Format
- File size
- Capture mode
- Tags
- Folder
- Preset
- Capture settings

### History Özellikleri
- Search
- Domain filter
- Date filter
- Format filter
- Tag filter
- Bulk delete
- Bulk export
- Screenshot'u tekrar indir
- Original URL'yi aç
- Aynı URL'yi yeniden capture et
- Screenshot'u editörde yeniden aç

---

## 7. Privacy ve Güvenlik

### Temel Prensip
Varsayılan olarak screenshot'lar cihazdan ayrılmamalıdır.

Önerilen mesaj:

> Screenshots never leave your browser unless you choose to upload them.

### Teknik Yaklaşım
- Local-first storage
- Minimum Chrome permissions
- `activeTab` tercih et
- Gerektiğinde optional permissions
- iframe için contextual permission
- Cloud upload opt-in
- Analytics için açık disclosure
- Hassas metadata'yı varsayılan olarak sunucuya gönderme

---

## 8. Rakiplerden Ayrıştırabilecek Özellikler

### Version Compare
Aynı URL'nin eski ve yeni screenshot'larını yan yana karşılaştır.

### Pixel Diff
İki screenshot arasındaki değişen alanları otomatik işaretle.

Kullanım alanları:
- QA
- Regression testing
- Design review
- Landing page monitoring
- Rakip website tracking

### Smart Element Hide
Capture öncesinde otomatik olarak:
- Cookie banner
- Modal
- Sticky chat
- Reklam
- Floating widget
- Newsletter popup

gibi elementleri kaldırabilme.

### Evidence Mode
Capture ile birlikte:
- URL
- Timestamp
- Timezone
- Browser version
- Viewport
- Page title
- SHA-256 hash

tut.

### Bug Report Mode
Tek pakette:
- Screenshot
- URL
- Viewport
- Browser bilgisi
- Console errors
- Sayfa title
- Timestamp

oluştur.

### Selector Capture
CSS selector ile screenshot:

```text
#invoice
.main-content
[data-testid="report"]
```

### Wait Conditions
- Selector görünene kadar bekle
- Selector kaybolana kadar bekle
- Network idle
- X ms bekle
- Fontların yüklenmesini bekle
- Görsellerin yüklenmesini bekle

### Multi-URL ZIP
Birden fazla URL'nin screenshot/PDF çıktısını tek ZIP halinde indir.

### Recapture
History'deki bir screenshot'ı aynı:
- URL
- viewport
- capture modu
- selector
- delay
- preset

ile yeniden capture et.

### Screenshot Diff History
Bir URL'nin zaman içindeki değişikliklerini timeline olarak göster.

### OCR / History Search
Screenshot içindeki metni OCR ile indexleyip arama yapılmasını sağla.

### Presets
Örnek presetler:
- Bug Report
- Legal Evidence
- Design Review
- Archive
- QA Test
- Documentation
- Full-page PDF

### Entegrasyonlar
- Jira
- Linear
- Slack
- Notion
- Trello
- GitHub Issues
- Webhook

### API
- Capture başlat
- Capture sonucunu al
- Batch oluştur
- History sorgula
- Diff çalıştır

---

## 9. Önerilen Roadmap

### MVP / P0
- Full-page capture
- Visible area
- Selection capture
- Scrollable DIV capture
- Sticky/fixed element handling
- Progress
- Cancel
- PNG
- JPG
- PDF
- Clipboard
- History
- Local-only storage
- Keyboard shortcuts

### V1 / P1
- iframe
- Infinite scroll
- Screenshot editor
- Smart PDF pagination
- URL/timestamp metadata
- Auto-download
- Filename templates
- CSS selector capture
- Lazy-load handling

### V1.5
- All-tabs capture
- URL batch capture
- Combined PDF
- Searchable PDF
- ZIP export
- Batch retry / timeout
- Custom wait conditions

### V2
- Advanced annotations
- Real redaction
- Searchable history
- Presets
- API
- External integrations

### Differentiator
- URL recapture
- Screenshot comparison
- Pixel diff
- Evidence mode
- Bug report mode
- Automated QA workflows
- Change monitoring

---

## 10. Önerilen Ürün Konumlandırması

GoFullPage:
- Basit
- Hızlı
- Güvenilir full-page capture

FireShot:
- Capture
- Batch
- PDF
- Editor
- Power-user workflow

Önerilen ürün:

> **Capture, document and track the web.**

Hedef kombinasyon:

- GoFullPage kalitesinde capture engine
- FireShot seviyesinde batch/PDF
- Güçlü ve erişilebilir screenshot editor
- Screenshot history
- Recapture
- Screenshot diff
- Evidence / QA özellikleri

---

## 11. Öncelik Matrisi

| Özellik | Öncelik |
|---|---|
| Full-page capture | P0 |
| Visible capture | P0 |
| Selection capture | P0 |
| Scrollable container | P0 |
| Sticky/fixed handling | P0 |
| PNG/JPG export | P0 |
| PDF export | P0 |
| Clipboard | P0 |
| History | P0 |
| Capture cancel/progress | P0 |
| Keyboard shortcut | P0 |
| iframe | P1 |
| Infinite scroll | P1 |
| Editor | P1 |
| Smart PDF | P1 |
| Searchable PDF | P1 |
| Filename templates | P1 |
| Auto-download | P1 |
| Batch capture | P1 |
| Combined PDF | P1 |
| ZIP export | P1 |
| CSS selector capture | P1 |
| Screenshot diff | P1/P2 |
| Evidence mode | P1/P2 |
| OCR search | P2 |
| Jira/Linear/Slack integrations | P2 |
| Public API | P2 |
