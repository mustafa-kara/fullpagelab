# 01 — Ürün Özeti ve Konumlandırma

> Vizyon, hedef kullanıcılar, rakip analizi, konumlandırma, kapsam/non-goal ve öncelik matrisi. Kaynak: `_source-features.md` §8–§11 + rakip araştırması (Ağustos 2026).

---

## 1. Vizyon

**"Capture, document and track the web."**

Tek bir Chrome uzantısında:
1. **GoFullPage kalitesinde capture engine** — tek tık, hızlı, güvenilir; sticky/lazy/nested-scroll/iframe/infinite-scroll gibi gerçek dünyayı bozan tüm durumları doğru yöneten.
2. **FireShot seviyesinde batch/PDF** — URL listesi, tüm sekmeler, akıllı sayfalı PDF, aranabilir/linkli PDF, header/footer, ZIP.
3. **Güçlü, erişilebilir editör** — annotation, gerçek redaction, hızlı paylaşım.
4. **History + Recapture + Diff + Evidence/QA** — rakiplerin hiç girmediği alan: ekran görüntüsünü *zaman içinde takip edilen, doğrulanabilir bir belge* yapmak.

Temel ilke: **Local-first, gizlilik varsayılan.** "Screenshots never leave your browser unless you choose to upload them."

---

## 2. Pazar Bağlamı (Ağustos 2026)

| Rakip | Durum / Güçlü yanlar | Zayıf yanlar (kullanıcı şikâyetleri) |
|---|---|---|
| **GoFullPage** (~11M kullanıcı, 4.9★) | Basit, hızlı, güvenilir full-page; Premium $12/yıl: editör, crop, blur, URL/timestamp, smart PDF split, filename pattern. **Ağustos 2026'da Chrome Web Store'dan telif gerekçesiyle kaldırıldı**; "BETA" listesi ve Edge sürümüyle devam ediyor, kullanıcı tabanı arayışta. | Visible/area modu yok (çekirdek); editör ücretli; PDF image-only (metin seçilemez); çok uzun sayfalar parçalara bölünür (≥10 parça başarısız olabilir); indirme klasörü Downloads alt klasörüyle sınırlı; sticky header'lar "çoğunlukla" düzgün; lazy içerik için "önce scroll edin" önerisi. |
| **FireShot** (5M+ kullanıcı, 4.8★; $39.95/yıl, $99.95 lifetime) | Capture modları (entire/visible/selection/element/all tabs/URL list), PDF (searchable, multipage, header/footer/watermark), editör (Windows'ta native), batch, print/email/upload. | Ücretsizde reklam ve kısıtlar; PDF'ler çok büyük (205 sayfa = 219 MB) ve bulanık; "Captured by FireShot" footer'ı; native uygulama karmaşası (Mac beta); `<all_urls>` izni şüphesi; uzun sayfada çökme/donma ve progress yokluğu; sticky header tekrarları; filename `%t` boş kalabiliyor. |
| Awesome Screenshot | Video + cloud + takım paylaşımı; Jira/Slack/Trello. | Cloud-first (gizlilik); tam sayfa kalitesi orta. |
| Nimbus (FuseBase) | Video/GIF, cloud. | Platform içine gömüldü. |
| Capture Full Page (yeni) | Ücretsiz, local, editör, çok uzun sayfada çok sayfalı PDF. | Batch/PDF/history yok. |

**Fırsat:** GoFullPage'in kaldırılmasıyla oluşan boşluk + FireShot'un PDF/boyut/reklam şikâyetleri + hiçbir rakibin sunmadığı **history-recapture-diff-evidence** katmanı.

---

## 3. Hedef Kullanıcılar (Persona)

| Persona | İhtiyaç | Kritik özellikler |
|---|---|---|
| **Günlük kullanıcı / içerik üreticisi** | Tek tık tam sayfa, hızlı paylaşım | Full page, clipboard, PNG/JPG, basit annotation, kısayol |
| **QA / yazılım geliştirici** | Bug raporu, regresyon karşılaştırma, element capture | Element/selector capture, bug report mode, pixel diff, batch, Jira/Linear/GitHub |
| **Tasarımcı / ürün yöneticisi** | Design review, rakip takibi | Full page @DPR2, compare/slider, presets, Slack/Notion |
| **Hukuk / uyum / araştırmacı** | Kanıt niteliğinde, doğrulanabilir yakalama | Evidence mode (hash, timestamp, TSA), PDF metadata, history arşivi, OCR arama |
| **Pazarlama / SEO / ajans** | Çok sayıda landing page, periyodik izleme | URL batch, ZIP, combined PDF, change monitoring, filename template |
| **Dokümantasyon / teknik yazar** | Uzun uygulama ekranları, scroll'lu paneller | Scroll container capture, numbered markers, editör, çok sayfalı PDF |

---

## 4. Değer Önerisi ve Ayrıştırıcılar

1. **Doğru capture, her sayfada:** sticky/fixed tekrarı yok, iç scroll alanları, iframe, lazy-load, infinite scroll, 100k+ px sayfalar (strip/ZIP/PDF), DPR/zoom doğru.
2. **Gerçek PDF:** akıllı sayfa kesimi, tıklanabilir link, aranabilir metin (OCR / CDP), header/footer/watermark, makul dosya boyutu (JPEG gömme, ayarlanabilir kalite).
3. **Gizlilik:** activeTab, local-first, opsiyonel izinler bağlamsal; cloud yalnızca opt-in.
4. **History → Recapture → Compare → Diff → Monitor:** bir URL'nin zaman çizgisi.
5. **Evidence & Bug Report modları:** SHA-256, zaman damgası, ortam bilgisi, console hataları tek pakette.
6. **Automation:** URL batch, presetler, wait conditions, ZIP/combined PDF, (P2) API/CLI.
7. **Editör:** gerçek redaction (piksel yok etme), blur/pixelate, numaralı işaretçiler, katmanlar, kısayollar.

---

## 5. Kapsam ve Non-Goal'lar

**Kapsam (bu spec seti):** Chrome MV3 uzantısı; tüm `_source-features.md` maddeleri; Chromium tabanlı tarayıcılar best-effort.

**Non-goal (V1–V2 için):**
- Video/GIF ekran kaydı (tabCapture) — GIF yalnızca statik görüntü export'u.
- Masaüstü (tarayıcı dışı) ekran görüntüsü.
- Bulut depolama/hesap sistemi zorunluluğu; takım çalışma alanı (P3+).
- Firefox/Safari portu (V2+ değerlendirme).
- Sunucu tarafı render (headless) — her şey kullanıcı tarayıcısında.
- Otomatik cookie banner **tıklama** (consent'i kullanıcı adına kabul etme) — sadece gizleme.
- DRM/korunan içerik.

---

## 6. Öncelik Matrisi (kaynak §11 + genişletilmiş)

| Özellik | Öncelik | Spec |
|---|---|---|
| Full-page capture | P0 | 03 §4 |
| Visible capture | P0 | 03 §3 |
| Selection capture | P0 | 03 §5 |
| Scrollable container capture | P0 | 03 §7 |
| Sticky/fixed handling | P0 | 03 §6 |
| Çok uzun sayfada güvenli parça/parça capture | P0 | 03 §10 |
| Progress / cancel / overlay | P0 | 03 §13 |
| Keyboard shortcut | P0 | 03 §2 |
| PNG/JPG export | P0 | 04 |
| PDF export (temel) | P0 | 04 §5 |
| Clipboard | P0 | 04 §3 |
| History (local) | P0 | 07 |
| Local-only storage / minimum izin | P0 | 08 |
| Multi-image fallback | P0 | 04 §6 |
| DOM element / CSS selector capture | P1 | 03 §7 |
| iframe / frameset | P1 | 03 §9 |
| Infinite scroll (+ manuel durdurma) | P1 | 03 §11 |
| Gecikmeli capture / timer, sağ tık menüsü | P0/P1 | 03 §2 |
| Lazy-load otomatik yükleme | P1 | 03 §8 |
| Editor (temel + gizlilik araçları) | P1 | 05 |
| Smart PDF (A4/Letter/Legal, portrait/landscape, smart breaks) | P1 | 04 §5 |
| Searchable PDF / clickable links | P1 | 04 §5.5–5.6 |
| Header/footer, page number, URL, timestamp, domain, title, watermark | P1 | 04 §5.7–5.8 |
| Print, auto-download, özel klasör, filename template | P1 | 04 |
| All-tabs capture, URL batch, combined PDF, ZIP, retry/timeout, wait conditions | P1 / P1.5 | 06 |
| Screenshot diff / version compare | P1/P2 (DIFF) | 09 §1–2 |
| Evidence mode, bug report mode | P1/P2 (DIFF) | 09 §4–5 |
| Smart element hide | P1 (DIFF) | 09 §3 |
| Recapture, diff timeline | DIFF | 07 §11.5, 09 §7 |
| OCR search | P2 | 09 §8 |
| Presets | P2 (yerleşikler P1) | 09 §9 |
| Jira/Linear/Slack/Notion/Trello/GitHub/Webhook | P2 | 09 §10 |
| Public API / native messaging | P2 | 09 §11 |
| Change monitoring | P2 (DIFF) | 09 §12 |
| GIF/BMP export | P2 | 04 |

Roadmap ve milestone kırılımı: `12-roadmap-and-milestones.md`.

---

## 7. Başarı Ölçütleri (ürün)
- Capture doğruluğu: test matrisindeki (11) 30+ fixture sitede dikiş/tekrar hatası 0.
- Medyan full-page süresi (10k px, DPR2): < 15 s; kullanıcı iptal oranı < %3.
- Web Store: ≥ 4.7★; izin uyarısı kurulumda yalnızca "Downloads" benzeri düşük riskli uyarılar.
- History'den recapture/compare kullanan kullanıcı oranı (opt-in telemetry varsa) ≥ %15.
- Destek taleplerinin < %10'u "eksik/çift header, boş görsel" kategorisinde.

---

## 8. Ürün Mesajları (kopya)
- Slogan: *Capture, document and track the web.*
- Gizlilik cümlesi: *Screenshots never leave your browser unless you choose to upload them.*
- Mod adları (en/tr): Full page / Tam sayfa · Visible area / Görünen alan · Select area / Alan seç · Select element / Öğe seç · Scrollable area / Kaydırılabilir alan · All tabs / Tüm sekmeler · Delayed / Gecikmeli · Batch URLs / URL listesi.
