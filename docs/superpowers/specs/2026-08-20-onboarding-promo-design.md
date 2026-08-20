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
   kartları, `Alt+Shift+P` kısayolu ve Chrome araç çubuğundan sabitleme ipucu.
2. **Gizlilik:** Ekran görüntülerinin kullanıcı açıkça yüklemeyi seçmedikçe
   tarayıcıdan çıkmadığını belirten ana mesaj, `activeTab` izninin açıklaması,
   kalıcı depolama isteği ve varsayılan olarak kapalı tanılama seçeneği.
3. **Dene:** `capture.start({ mode: 'fullPage' })` çağrısını başlatan tek CTA.
   Başlangıçtan önce `general.onboardingDone=true` yazılır; kullanıcı isterse
   turu atlayıp aynı tamamlanma ekranına ulaşır.

## Görsel sistem

- Tam sayfa iki kolonlu tanıtım düzeni: solda marka/ilerleme rayı, sağda adım
  içeriği ve eylem alanı.
- FullPageLab mavi-viyole vurgu sistemi, açık yüzeyler, yumuşak sınırlar ve
  sınırlı gölge kullanımı.
- Emoji yerine kapalı bir ikon sözlüğüyle çizilmiş inline SVG ikonlar.
- Yakalama önizlemesi, kısayol kartı ve sabitleme ipucu gerçek kullanım
  sırasını görsel olarak anlatır.

## Etkileşim ve durumlar

- İleri/geri adım kontrolleri ve üstte 3 adımlı ilerleme göstergesi.
- Her adımda tek bir birincil CTA; `Turu atla` ikincil eylem olarak korunur.
- Kalıcı depolama isteği beklerken buton kilitlenir; başarılı/başarısız sonuç
  aynı kartta açıklanır.
- İlk yakalama başlatılınca CTA kilitlenir, canlı durum mesajı gösterilir ve
  result sekmesinin açılacağı bildirilir.
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
| İlk yakalama | `capture.start` ile `mode: 'fullPage'` |
| Kurulum tetikleyicisi | `runtime.onInstalled` → onboarding sekmesi |

## Kabul ölçütleri

- Yeni kurulumda onboarding sekmesi açılır ve üç adım klavye ile tamamlanır.
- Atla veya tamamla akışı `onboardingDone=true` yazar.
- Tanılama seçeneği kullanıcı opt-in olmadan etkinleşmez.
- Kalıcı depolama isteği ve ilk yakalama aksiyonu başarısızlıkta kullanıcıya
  açıklanabilir bir durum gösterir.
- `pnpm test`, `pnpm typecheck`, `pnpm lint` ve store/CDP build kontrolleri
  başarılıdır.
