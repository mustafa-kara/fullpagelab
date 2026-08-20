# Result, Önizleme ve Dışa Aktarma Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture tamamlandığında otomatik indirme yerine yerel kaydı oluşturup A düzenindeki result sayfasını açmak; kullanıcıya gerçek önizleme, PNG/JPEG/WebP/PDF seçimi, clipboard ve açık indirme aksiyonları sunmak.

**Architecture:** Capture coordinator görüntüyü doğrudan Downloads'a göndermeyecek; `CaptureResultService` üzerinden `BlobRef` ve `CaptureRecord` oluşturacak. Service worker result sekmesini açacak. Result sayfası metadata'yı tipli mesajla alacak, blob'ları extension IndexedDB/OPFS'den okuyacak ve export/clipboard aksiyonlarını yine tipli service-worker mesajlarıyla tetikleyecek. History kapalıyken geçici sonuç registry'si kullanılacak.

**Tech Stack:** TypeScript strict, Preact, vanilla CSS token'ları, Dexie/IndexedDB, OPFS, `@cantoo/pdf-lib`, Chrome MV3 messaging, Vitest, happy-dom.

---

## Task 1: Result ve export sözleşmelerini tamamla

**Files:**
- Modify: `src/shared/types/messages.ts`
- Modify: `src/shared/types/history.ts`
- Modify: `src/shared/types/export.ts`
- Modify: `src/shared/types/capture.ts`
- Test: `test/unit/result-contracts.test.ts`

- [x] **Step 1: Başarısız tip/messaging testini yaz**

`test/unit/result-contracts.test.ts` içinde `MsgMap`'in result ve export aksiyonlarını taşıdığını doğrula:

```ts
import { describe, expect, it } from 'vitest';
import type { MsgMap } from '../../src/shared/types/messages';

describe('result contracts', () => {
  it('defines typed result and export operations', () => {
    const get: MsgMap['history.get']['req'] = { id: 'capture-1' };
    const exportRequest: MsgMap['export.request']['req'] = {
      captureId: 'capture-1',
      plan: {} as MsgMap['export.request']['req']['plan'],
    };
    const copy: MsgMap['export.copy']['req'] = { captureId: 'capture-1' };
    expect(get.id).toBe('capture-1');
    expect(exportRequest.captureId).toBe(copy.captureId);
  });
});
```

- [x] **Step 2: Testi çalıştır ve eksik sözleşmeyi doğrula**

Run: `pnpm exec vitest run test/unit/result-contracts.test.ts`

Expected: FAIL because `history.get`, `export.request` or `export.copy` is not present in `MsgMap`.

- [x] **Step 3: Mesajları ve result özetini ekle**

`src/shared/types/messages.ts` içine aşağıdaki mesajları ekle:

```ts
'history.get': { req: { id: Id }; res: CaptureRecord | null };
'export.request': { req: ExportRequest; res: ExportResult };
'export.copy': { req: { captureId: Id; stripIndex?: number }; res: { copiedAs: 'png' } };
```

`history.ts` içinde result için gereken `CaptureFile.role` birleşimini koru. `export.ts` içindeki `ExportRequest` ve `ExportResult` alanlarını planla uyumlu bırak; `CaptureResultSummary` içine `captureId`, `size`, `cssSize`, `strips`, `durationMs`, `backend` ve `warnings` alanlarının tümünü taşı.

- [x] **Step 4: Testi çalıştır ve sözleşmeleri doğrula**

Run: `pnpm exec vitest run test/unit/result-contracts.test.ts`

Expected: PASS.

## Task 2: Capture sonucu için yerel kayıt servisinin oluşturulması

**Files:**
- Create: `src/background/result/service.ts`
- Create: `src/background/result/types.ts`
- Modify: `src/background/history/service.ts`
- Modify: `src/shared/db/blob-ref.ts`
- Modify: `src/shared/types/history.ts`
- Test: `test/unit/result-service.test.ts`

- [x] **Step 1: Blob/ref yaşam döngüsü testlerini yaz**

Test; PNG blob'unun `putBlob` ile yazıldığını, `CaptureRecord` oluşturulduğunu, `history.get` ile okunabildiğini ve kayıt silinince full/thumbnail referanslarının release edildiğini doğrulasın. Aynı blob iki dosyada kullanılıyorsa refCount'un iki referansla korunduğunu test et.

- [x] **Step 2: Testi çalıştır ve servis eksikliğini doğrula**

Run: `pnpm exec vitest run test/unit/result-service.test.ts`

Expected: FAIL because `createCaptureResultService` is not defined.

- [x] **Step 3: `CaptureResultService` arayüzünü ve kayıt oluşturmayı ekle**

`src/background/result/types.ts`:

```ts
export interface CaptureResultInput {
  job: JobState;
  original: Blob;
  strips?: Blob[];
  metrics?: PageMetrics;
  durationMs: number;
}

export interface CaptureResultService {
  save(input: CaptureResultInput): Promise<CaptureRecord>;
  get(id: Id): Promise<CaptureRecord | null>;
}
```

`src/background/result/service.ts` içinde:

- full blob'u `putBlob` ile yaz;
- strip varsa her birini `role:'strip'` ve sıralı `index` ile yaz;
- thumbnail için görüntünün WebP küçültülmüş hâlini üret; `OffscreenCanvas` mevcut değilse küçük PNG'yi güvenli fallback olarak kullan ve warning ekle;
- URL/domain/title/mode/backend/viewport/DPR/zoom/size/cssSize/request/source/duration alanlarını job ve metrics'ten doldur;
- `history.enabled` false olduğunda `TemporaryResultStore` ile metadata/ref kaydını tut, kalıcı `db.captures.put` çağırma;
- history açıkken `HistoryService.put` kullan;
- aynı full ref'i thumbnail olarak paylaşma; release/refCount kurallarını ihlal etmeyecek ayrı ref oluştur.

- [x] **Step 4: Result service testlerini çalıştır**

Run: `pnpm exec vitest run test/unit/result-service.test.ts`

Expected: PASS; `db.captures` ve `db.blobs` sayıları ile refCount beklentileri doğru olur.

## Task 3: Coordinator'ın direct download davranışını kaldır

**Files:**
- Modify: `src/background/capture/coordinator.ts`
- Modify: `src/background/index.ts`
- Modify: `src/background/result/service.ts`
- Modify: `test/unit/capture-coordinator.test.ts`
- Modify: `test/integration/coordinator.int.test.ts`

- [x] **Step 1: Download çağrısının yapılmadığını kanıtlayan testleri ekle**

Visible ve full-page senaryolarında `platform.download` spy'ının çağrılmadığını; sonuç servisinin `save` metodunun tam olarak bir kez çağrıldığını; terminal job'ın `captureId` taşıdığını doğrula.

- [x] **Step 2: Testleri çalıştır ve mevcut davranışın kırmızı olduğunu doğrula**

Run: `pnpm exec vitest run test/unit/capture-coordinator.test.ts test/integration/coordinator.int.test.ts`

Expected: FAIL because coordinator currently downloads the PNG directly and `JobState` result id taşımıyor.

- [x] **Step 3: Coordinator'a result service bağımlılığı ekle**

`CaptureCoordinatorOptions` içine `resultService` ekle. Visible capture'ta data URL blob'a çevrildikten sonra `resultService.save` çağır. Full-page capture'ta stitched blob veya strip çıktısını aynı service'e geçir. Job state'e `captureId` yaz ve `done` log mesajını `Capture ready.` olarak güncelle. `platform.download` yalnızca export pipeline tarafından kullanıcı aksiyonu sırasında kullanılacak.

- [x] **Step 4: Background'da result service'i bağla**

`src/background/index.ts` içinde `createCaptureResultService({ history: historyService, settings: () => settings })` oluşturup coordinator'a enjekte et. Capture tamamlandığında `chrome.tabs.create` veya `chrome.tabs.update` ile `chrome.runtime.getURL('src/pages/result/index.html?id=' + captureId)` adresini `Settings.general.resultTabBehavior` kararına göre aç.

- [x] **Step 5: Coordinator testlerini çalıştır**

Run: `pnpm exec vitest run test/unit/capture-coordinator.test.ts test/integration/coordinator.int.test.ts`

Expected: PASS; direct download spy'ı çağrılmaz, result kaydı ve `captureId` oluşur.

## Task 4: Export pipeline ve kullanıcı aksiyonları

**Files:**
- Create: `src/background/export/pipeline.ts`
- Create: `src/background/export/filename-template.ts`
- Create: `src/background/export/clipboard.ts`
- Modify: `src/background/index.ts`
- Modify: `src/background/capture/image.ts`
- Modify: `src/shared/types/export.ts`
- Test: `test/unit/export-pipeline.test.ts`
- Test: `test/unit/filename-template.test.ts`

- [x] **Step 1: Format ve filename testlerini yaz**

Testler şu davranışları kapsasın:

```ts
expect(resolveFilename('{domain}_{yyyy-mm-dd}_{counter}', context)).toBe('example.com_2026-08-20_001');
expect(resolveOutputMime('png')).toBe('image/png');
expect(resolveOutputMime('jpeg')).toBe('image/jpeg');
expect(resolveOutputMime('webp')).toBe('image/webp');
expect(resolveOutputMime('pdf')).toBe('application/pdf');
```

Path separator, control character, boş domain/title ve 255 karakter üstü filename senaryolarını da test et.

- [x] **Step 2: Testleri çalıştır ve eksik export modüllerini doğrula**

Run: `pnpm exec vitest run test/unit/export-pipeline.test.ts test/unit/filename-template.test.ts`

Expected: FAIL because pipeline and template resolver do not exist.

- [x] **Step 3: Image encoder ve filename resolver'ı ekle**

PNG/JPEG/WebP için `OffscreenCanvas.convertToBlob` kullan; alpha olmayan formatlarda `stripAlpha` ve background davranışını uygula. `ExportPlan.image` kalite/scale/max size alanlarını uygula. `filename-template.ts` domain, title, date, time, width, height, mode ve counter token'larını sanitize ederek çözümler.

- [x] **Step 4: PDF pipeline'ını ekle**

`@cantoo/pdf-lib` ile `PdfOptions` alanlarını uygula: singleLongPage/page size/orientation/fit/margin, smart breaks, image format/quality, clickable link ve header/footer. `maxSinglePageHeightPt` aşılırsa `split-long-page` warning üret. Strip'leri tek uzun sayfaya veya çok sayfalı PDF'e sırayla yerleştir.

- [x] **Step 5: Download ve clipboard hedeflerini ekle**

Download hedefi blob'u data URL veya güvenli object URL ile `chrome.downloads.download`'a gönderir; `saveAs`, `subfolder` ve `conflictAction` uygulanır. Clipboard hedefi yalnızca PNG yazar; 100 MB üstünde `E_CLIPBOARD` döndürür. Her hedef hatası diğer hedefleri engellemeden `ExportResult.warnings` içine eklenir.

- [x] **Step 6: Background export mesajlarını bağla**

`src/background/index.ts` içinde `history.get`, `export.request`, `export.copy` case'lerini ekle. Her payload zod ile doğrulansın; service worker dışındaki UI'lara `ErrorInfo` dönsün.

- [x] **Step 7: Export testlerini çalıştır**

Run: `pnpm exec vitest run test/unit/export-pipeline.test.ts test/unit/filename-template.test.ts`

Expected: PASS.

## Task 5: A düzenindeki result sayfasını uygulama

**Files:**
- Modify: `src/pages/result/main.tsx`
- Create: `src/pages/result/result.css`
- Modify: `src/pages/result/index.html`
- Modify: `src/ui/tokens.css`
- Modify: `public/_locales/en/messages.json`
- Modify: `public/_locales/tr/messages.json`
- Test: `test/unit/result-page.test.tsx`

- [x] **Step 1: UI durum testi yaz**

happy-dom testinde `history.get` mock'u ile result kaydı yüklenirken skeleton, başarıyla yüklendiğinde başlık/meta/önizleme, format değiştiğinde panel alanları ve export başarılı olduğunda toast gösterildiğini doğrula. `window.URL.createObjectURL` ve `sendMessage` mock'ları temizlenebilir olsun.

- [x] **Step 2: Testi çalıştır ve scaffold'un yetersiz olduğunu doğrula**

Run: `pnpm exec vitest run test/unit/result-page.test.tsx`

Expected: FAIL because result page currently calls generic `renderPage` and has no viewer/export controls.

- [x] **Step 3: Result page state modelini ekle**

URL'den `id` oku. `history.get` ile record yükle; `resolveBlob` ile full/strip blob'larını çöz; object URL'leri effect cleanup'ında revoke et. State'ler `loading`, `ready`, `exporting`, `success`, `warning`, `error` olarak ayrışsın. Export plan'ı `Settings.export` varsayılanından klonla ve kullanıcı format/quality/filename değişikliklerini local state'te tut.

- [x] **Step 4: Üst bar, viewer ve export panelini oluştur**

Sol tarafta zoom/fit kontrolleri ve uzun görüntü viewer'ı; sağ tarafta format segmented control, filename, quality, PDF accordion, `İndir`, `Kopyala`, `Yazdır`, `Düzenle` aksiyonları olsun. Strip navigation'da `1 / N`, önceki/sonraki ve tek görüntü warning'i göster.

- [x] **Step 5: CSS token ve responsive kurallarını ekle**

`result.css` A mockup'ındaki iki kolon düzenini uygulasın. 900 px altında panel alt satıra geçsin, 640 px altında meta alanı sarılsın. Focus ring, disabled/loading, hover/pressed, reduced-motion, contrast ve 44 px minimum hedef kuralları token'larla tanımlansın.

- [x] **Step 6: İngilizce/Türkçe i18n anahtarlarını ekle**

`ui.result.*`, `ui.result.export.*`, `ui.result.viewer.*`, `common.copy`, `common.download`, `common.retry` anahtarlarını iki locale dosyasına ekle. UI'da hard-coded kullanıcı metni bırakma; teknik format ve mode identifier'ları yalnızca çeviri anahtarından göster.

- [x] **Step 7: Result UI testini çalıştır**

Run: `pnpm exec vitest run test/unit/result-page.test.tsx`

Expected: PASS.

## Task 6: Result sekmesi, history ve geçici sonuç yaşam döngüsü

**Files:**
- Modify: `src/background/index.ts`
- Modify: `src/background/history/service.ts`
- Modify: `src/background/job-state.ts`
- Create: `src/background/result/temporary-store.ts`
- Modify: `src/shared/types/messages.ts`
- Test: `test/unit/result-lifecycle.test.ts`

- [x] **Step 1: Sekme açma ve history kapalı fallback testini yaz**

Test; `openResultTab` ayarında `chrome.tabs.create` URL'sinin doğru `captureId` taşıdığını, `reuseTab` için mevcut result sekmesinin güncellendiğini, history kapalıyken `db.captures` sayısının değişmediğini ve result sayfasının geçici kaydı okuyabildiğini doğrulasın.

- [x] **Step 2: Testi çalıştır ve lifecycle eksikliğini doğrula**

Run: `pnpm exec vitest run test/unit/result-lifecycle.test.ts`

Expected: FAIL because result tab opening and temporary result store are not implemented.

- [x] **Step 3: TemporaryResultStore ve result tab opener'ı ekle**

Geçici store job/capture id ile metadata ve blob ref'lerini tutmalı; `get`, `put`, `delete` ve `clearExpired` operasyonları olmalı. Result opener `resultTabBehavior` kararını uygulamalı, `chrome.tabs.query` ile daha önce açılmış result sekmesini yalnızca `reuseTab` seçiliyken bulmalı.

- [x] **Step 4: Lifecycle testini çalıştır**

Run: `pnpm exec vitest run test/unit/result-lifecycle.test.ts`

Expected: PASS.

## Task 7: Entegrasyon, dokümantasyon ve kalite kapıları

**Files:**
- Modify: `docs/progress.md`
- Modify: `docs/chrome-screenshot-extension-features.md` only if implementation status wording is stale
- Modify: `docs/specs/10-ui-ux.md` only if the approved A decision needs an explicit amendment
- Modify: `scripts/traceability.ts` if new requirement IDs need mapping
- Test: `test/integration/result-flow.int.test.ts`

- [x] **Step 1: Uçtan uca result flow testini yaz**

Mock platform ile visible ve full-page capture başlat; result service kaydı, result tab URL'si, direct download yokluğu, `history.get`, format export ve clipboard aksiyonlarını tek akışta doğrula.

- [x] **Step 2: Entegrasyon testini çalıştır**

Run: `pnpm exec vitest run test/integration/result-flow.int.test.ts`

Expected: FAIL until all previous tasks are connected, then PASS.

- [x] **Step 3: Progress ve traceability dokümantasyonunu güncelle**

`docs/progress.md` içinde otomatik indirme yerine result tab, önizleme, PNG/JPEG/WebP/PDF, clipboard, history ve responsive A düzeninin gerçek durumunu yaz. Test sayısını gerçek çıktıyla eşleştir. Gereksinim ID'leri için traceability kontrolünde result/export/history satırları eksikse ekle.

- [x] **Step 4: Tüm kalite kontrollerini çalıştır**

Run:

```text
pnpm test
pnpm typecheck
pnpm lint
pnpm build:all
pnpm check:manifest
pnpm check:content-assets
pnpm check:bundle
pnpm traceability
git diff --check
```

Expected: tüm testler, typecheck, lint, iki build, manifest/content asset, bundle ve traceability kontrolleri geçer.

- [x] **Step 5: Türkçe karakter ve UTF-8 pre-flight denetimi yap**

Değişen metin dosyalarını UTF-8 BOM'suz oku; `U+FFFD` ve `U+00C3/U+00C2` ile başlayan mojibake dizilerini ve ASCII'leştirilmiş Türkçe kelimeleri ara. Bulunan tüm metinleri doğru Türkçe karakterlerle düzelt ve tekrar `git diff --check` çalıştır.

## Spec kapsamı için sonraki bağımsız planlar

Kaynak dokümanın tamamı result akışından daha geniştir. Bu planın doğruladığı alt sistem, kaynak dokümandaki §2 P0 export/clipboard/history davranışıdır. Eksiksiz ürün kapsamı için aşağıdaki bağımsız planlar aynı sözleşme seti üzerinden yürütülmelidir:

1. Capture modes: selection, element, CSS selector, scroll-container, iframe, infinite-scroll, all-tabs ve picker akışları (`03-capture-engine.md`, `06-batch-and-automation.md`).
2. Büyük veri akışı: tile store, offscreen stitch worker, canvas limitleri, strip/ZIP fallback (`02-architecture.md`, `03-capture-engine.md`, `04-export-and-files.md`).
3. Editor: crop, annotation, blur/pixelate/redaction, undo/redo ve editor document history (`05-editor.md`).
4. Batch/automation: URL listesi, wait conditions, retry/timeout/concurrency ve combined outputs (`06-batch-and-automation.md`).
5. History arama/filtre/OCR/recapture ve quota yönetimi (`07-history-and-storage.md`).
6. Compare/diff/evidence/bug report/monitoring/integrations (`09-differentiators.md`).
7. Options, onboarding, side panel, i18n, privacy permissions ve release/store kapıları (`08-privacy-security.md`, `10-ui-ux.md`, `14-release-and-store.md`).

Bu planın uygulanması sırasında git commit'i oluşturulmayacak; değişiklikler kullanıcı incelemesi için çalışma ağacında bırakılacak.
