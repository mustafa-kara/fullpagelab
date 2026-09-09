# FullPageLab onboarding tanıtım akışı

> Durum: Uygulandı
> Tarih: 2026-08-20
> Kapsam: Chrome uzantısının ilk kurulum sekmesi

## Amaç

İlk çalıştırmada kullanıcıya FullPageLab'in ne yaptığını, ekran görüntülerinin
varsayılan olarak tarayıcıda kaldığını ve ilk full-page yakalamanın nasıl
başlatılacağını kısa bir akışta anlatmak. Akış, kullanıcıyı ayarlar arasında
kaybetmeden tek bir birincil eylemle tamamlanır.

## Kullanıcı akışı

1. **Hoş geldin:** FullPageLab markası, tam sayfa/akıllı/yerel işleme özellik
   kartları ve Chrome araç çubuğundan sabitleme ipucu. Tam sayfa için varsayılan
   klavye kısayolu olmadığı için kısayol kartı gösterilmez.
2. **Gizlilik:** Ekran görüntülerinin kullanıcı açıkça yüklemeyi seçmedikçe
   tarayıcıdan çıkmadığını belirten ana mesaj, `activeTab` izninin açıklaması,
   kalıcı depolama isteği ve varsayılan olarak kapalı tanılama seçeneği.
3. **Dene:** Kurulum sekmesinin Chrome uzantı sayfası olduğu açıkça belirtilir.
   Tek CTA, `onboarding.openDemo` ile yakalanabilir bir örnek web sayfasını yeni
   sekmede açar. Kullanıcı bu sekmede FullPageLab simgesindeki **Full page**
   düğmesini veya sayfanın **Tam sayfayı yakala** sağ tık eylemini kullanarak ilk
   gerçek yakalamasını başlatır. Kullanıcı isterse turu atlayıp aynı tamamlanma
   ekranına ulaşır.

## Görsel sistem

- Tam sayfa iki kolonlu tanıtım düzeni: solda marka/ilerleme rayı, sağda adım
  içeriği ve eylem alanı.
- Tarayıcı yardımcısı hissi veren içerik-öncelikli düzen: nötr yüzeyler, tek mavi
  vurgu rengi, belirgin sınırlar ve ölçülü gölge kullanımı.
- Dekoratif gradient, sahte tarayıcı mockup'ı, parlayan tarama animasyonu ve
  tekrarlanan CTA kullanılmaz; her adımda tek bir birincil eylem bulunur.
- Emoji yerine kapalı bir ikon sözlüğüyle çizilmiş inline SVG ikonlar.
- Yakalama akışı satırları ve sabitleme ipucu gerçek kullanım sırasını doğrudan
  anlatır; uygulanmamış bir kısayol önerilmez.

## Etkileşim ve durumlar

- İleri/geri adım kontrolleri ve üstte 3 adımlı ilerleme göstergesi.
- Her adımda tek bir birincil CTA; `Turu atla` ikincil eylem olarak korunur.
- Kalıcı depolama isteği beklerken buton kilitlenir; başarılı/başarısız sonuç
  aynı kartta açıklanır.
- Örnek sayfa açılırken CTA kilitlenir; açıldıktan sonra yeni sekmede uzantı
  simgesinin kullanılacağı canlı durum mesajıyla açıklanır.
- Ayar dili değiştiğinde `document.documentElement.lang` güncellenir; metinler
  `public/_locales/{en,tr}/messages.json` içindeki onboarding anahtarlarından
  gelir.

## Erişilebilirlik ve responsive davranış

- Tüm etkileşimli hedefler en az 44 px, görünür klavye focus halkasına ve
  anlamlı `aria-label`/`aria-live` açıklamalarına sahiptir.
- `prefers-reduced-motion` etkinse ilerleme ve önizleme animasyonları kapanır.
- 920 px altında sol ray yatay adım navigasyonuna, 620 px altında içerik tek
  kolona dönüşür.
- Renk tek başına anlam taşımaz; durumlar metin ve ikonla birlikte gösterilir.

## Uygulama sözleşmesi

| Alan | Uygulama |
|---|---|
| Sayfa | `src/pages/onboarding/main.tsx` |
| Stil | `src/pages/onboarding/onboarding.css` |
| Dil | `public/_locales/en/messages.json`, `public/_locales/tr/messages.json` |
| Tamamlanma | `settings.set({ patch: { general: { onboardingDone: true } } })` |
| Gizlilik | `settings.set({ patch: { privacy: { telemetry } } })` |
| Örnek sayfa | `onboarding.openDemo` ile `https://example.com/` yeni sekmesi |
| Kurulum tetikleyicisi | `runtime.onInstalled` → onboarding sekmesi |

## Kabul ölçütleri

- Yeni kurulumda onboarding sekmesi açılır ve üç adım klavye ile tamamlanır.
- Atla veya tamamla akışı `onboardingDone=true` yazar.
- Tanılama seçeneği kullanıcı opt-in olmadan etkinleşmez.
- Kalıcı depolama isteği ve ilk yakalama aksiyonu başarısızlıkta kullanıcıya
  açıklanabilir bir durum gösterir.
- `pnpm test`, `pnpm typecheck`, `pnpm lint` ve store/CDP build kontrolleri
  başarılıdır.
