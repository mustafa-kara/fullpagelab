# 06 — Batch Capture ve Automation

> URL listesinden ve açık sekmelerden toplu capture, bekleme koşulları, çıktı birleştirme (PDF/ZIP), hata yönetimi ve otomasyon altyapısı. Tipler `13-data-contracts.md §8` (`BatchJobInput`, `BatchControl`, `BatchJob`, `BatchItem`, `BatchEvent`), capture algoritmaları `03-capture-engine.md`, export `04-export-and-files.md`. Gereksinim ID önek: `REQ-BAT-*`. Öncelik: URL batch / all-tabs P1, combined PDF / ZIP / retry-timeout / custom wait P1.5, sitemap import / scheduling P2.

İçindekiler: 1 Kapsam ve ilkeler · 2 Kaynaklar (URL listesi, sekmeler, sitemap) · 3 Capture modları · 4 Bekleme koşulları · 5 Çıktılar · 6 Filename template · 7 Batch kontrolleri · 8 Pencere havuzu ve concurrency · 9 İzinler · 10 BatchRunner mimarisi ve state machine · 11 SW yaşam döngüsü ve resume · 12 Olay akışı ve UI (`batch.html`) · 13 Rapor ve loglar · 14 Presetler · 15 Scheduling kancası · 16 Limitler ve performans · 17 Kabul kriterleri

---

## 1. Kapsam ve İlkeler

- `REQ-BAT-001` Batch, tekil capture motorunun (03) **üstünde** çalışan bir orkestrasyon katmanıdır; her batch öğesi normal bir `CaptureRequest` üretir (`trigger:'batch'`, `meta.batchId/batchItemId`) ve `CaptureCoordinator.start()` yolundan geçer. Batch'e özel capture kodu **yazılmaz**.
- `REQ-BAT-002` Batch, SW yeniden başlatmalarına dayanıklıdır (11): durum IndexedDB `batches` + `storage.session`'dadır; UI kapatılsa da devam eder.
- `REQ-BAT-003` Kullanıcı batch sırasında tarayıcıyı kullanmaya devam edebilmelidir → batch kendi **ayrı penceresinde** çalışır (8). İstisna: `source.kind:'tabs'` (all-tabs) kullanıcının kendi penceresinde sekmeleri sırayla aktif eder; bu sırada UI "lütfen bekleyin" uyarısı gösterir.
- `REQ-BAT-004` Her öğe bağımsızdır: birinin hatası diğerlerini etkilemez (`stopOnError:false` varsayılan).
- `REQ-BAT-005` Hiçbir URL, ekran görüntüsü veya log cihazdan çıkmaz (08). Batch rapor/logları yalnızca yerel dosya olarak indirilir.

---

## 2. Kaynaklar

### 2.1 URL listesi (`source.kind:'urls'`) — `REQ-BAT-010`…`016`
- UI: `batch.html` içinde `<textarea>` — her satır bir URL. Ayrıca **Dosyadan içe aktar** (`.txt` satır başına URL; `.csv` ilk sütun URL, isteğe bağlı ikinci sütun `name` → `{batchName}` yerine öğe adı `{itemName}` (template'e eklenir, bkz. 6); başlık satırı otomatik algılanır: ilk hücre `url` ise atlanır).
- Normalizasyon: trim; boş satır ve `#` ile başlayan satırlar yoksayılır; şema yoksa `https://` eklenir ve uyarı işaretlenir; `URL` constructor ile parse edilemeyenler **geçersiz** (satır numarasıyla listelenir, batch başlatılamaz ya da "geçersizleri atla" seçeneği).
- Sadece `http:` ve `https:` kabul edilir (`REQ-BAT-012`). `file:`, `chrome:`, `chrome-extension:`, `data:`, `javascript:` reddedilir (restricted sayfalar 03 §1.1).
- Dedupe: aynı normalize URL (fragment `#` hariç, trailing slash farkı gözardı) bir kez alınır; UI "N yinelenen kaldırıldı" gösterir. Kullanıcı "Yinelenenleri tut" diyebilir (ör. farklı zamanlarda art arda aynı sayfa).
- Limit: `maxBatchItems = 500` (Karar). Üzeri uyarı ile reddedilir; kullanıcı listeyi böler. 100'ün üzerinde "Bu işlem yaklaşık X dk sürecek" tahmini gösterilir (16).
- Örnek giriş (kaynak doküman):
  ```text
  https://site.com/page-1
  https://site.com/page-2
  https://site.com/page-3
  ```
- Sitemap import (`source.kind:'sitemap'`, **P2**): kullanıcı `sitemap.xml` URL'si verir; SW `fetch` (host izni gerekli) + `DOMParser` (offscreen) ile `<loc>` değerleri çıkarılır (sitemap index → alt sitemap'ler 1 seviye); 500 limiti uygulanır; kullanıcı önizlemede seçim yapar.

### 2.2 Açık sekmeler (`source.kind:'tabs'`) — `REQ-BAT-020`…`024`
- İzin: `tabs` (opsiyonel) — URL/title okumak için. PermissionBroker `feature:'allTabs'`.
- `tabs.listForCapture {scope:'currentWindow'|'allWindows'}` → `TabSummary[]`; UI'da checkbox listesi; `restricted:true` (chrome://, Web Store, PDF viewer) olanlar devre dışı ve işaretli; `discarded:true` olanlar "yeniden yüklenecek" rozetiyle.
- Sıralama sekme sırasıdır; `{tabIndex}` template değişkeni bu sırayı verir.
- Akış: her öğe için `chrome.tabs.update(tabId,{active:true})` + `chrome.windows.update(windowId,{focused:true})` → discarded ise `chrome.tabs.reload` + `pageLoad` bekleme → capture → sonraki. Bitince **orijinal aktif sekme ve pencere odağı geri yüklenir** (`REQ-BAT-023`).
- Kullanıcı bu sırada sekme değiştirirse 03 §14'teki aktif-sekme doğrulaması devreye girer; 2. tekrarında öğe `failed(E_TAB_NOT_ACTIVE)`; batch devam eder.
- All-tabs, popup'tan "Capture all tabs" ile tek tıkla da başlatılır: varsayılan preset + varsayılan çıktı (`separate` veya ayarlardaki `combine`).

---

## 3. Capture Modları (`REQ-BAT-030`)
`BatchJobInput.mode ∈ {'fullPage','visible','selector','element','scrollContainer','infinite','iframe'}` (`selection`, `allTabs`, `browserWindow` hariç). Pratikte UI dört seçenek sunar:

| UI seçeneği | mode | Ek alan |
|---|---|---|
| Full page | `fullPage` | — |
| Visible viewport | `visible` | — |
| CSS selector | `selector` | `selector` (zorunlu), `selectorIndex` (0) — "Test" butonu aktif sekmede dener (03 §7.4) |
| Belirli DOM element | `element` | Aktif sekmede picker ile seçilir → üretilen selector batch'e yazılır (fiilen `selector` modu; `mode:'element'` korunur ki history'de ayrışsın) |

- Selector bulunamayan sayfalarda öğe `failed(E_SELECTOR_NOT_FOUND)`; `control.fallbackToFullPage:boolean` (Karar: varsayılan `false`; UI'da "Selector yoksa tüm sayfayı al" kutusu) açıksa `fullPage` ile tekrar denenir ve `warnings` eklenir.
- `infinite` batch'te izinlidir ancak limitler (`InfiniteScrollOptions`) zorunlu; UI uyarır.

---

## 4. Bekleme Koşulları (`REQ-BAT-040`…`047`)
Batch'te her öğe için iki bekleme noktası vardır: **(a) navigasyon sonrası sayfa hazır** ve **(b) capture içi tile bazlı** (03 §8). Tür: `WaitConditions` (13 §3.1). Kullanıcı UI'da şunları seçer; tümü AND ile birleşir, her biri kendi `timeoutMs`'ine sahiptir; zaman aşımı **hata değildir**, `WaitResult.timedOut` listesine yazılır ve `warnings`'e geçer (Karar). Playwright `waitUntil` semantiğine eşleme:

| UI | `WaitConditions` alanı | Uygulama | Playwright karşılığı |
|---|---|---|---|
| Sayfa yüklenmesi | `pageLoad:'domcontentloaded'\|'load'` | `chrome.tabs.onUpdated` `status:'complete'` (+ `webNavigation.onCompleted` varsa) ve CS enjeksiyonu sonrası `document.readyState` doğrulaması | `waitUntil: 'domcontentloaded' \| 'load'` |
| Sabit süre | `fixedDelayMs` | `setTimeout` (CS'de, overlay geri sayım isteğe bağlı) | `page.waitForTimeout` |
| Network idle | `networkIdle:{idleMs:500,maxWaitMs:10000,maxInflight:0}` | CS `PerformanceObserver({type:'resource', buffered:true})`; son `idleMs` içinde yeni `resource` girişi yoksa ve `performance.getEntriesByType('resource').length` artmıyorsa idle. In-flight istekleri doğrudan göremeyiz → `maxInflight` yalnızca `webRequest` izni varsa (SW `onBeforeRequest/onCompleted` sayacı, tab bazlı) kullanılır; yoksa yoksayılır | `networkidle` (500 ms sessizlik) |
| Selector görünene kadar | `selectorVisible:{selector,timeoutMs}` | CS `MutationObserver` + 100 ms polling: `el && getBoundingClientRect().width>0 && visibility!=='hidden'` | `page.waitForSelector(sel,{state:'visible'})` |
| Selector kaybolana kadar | `selectorHidden` | aynı, tersine (loading spinner'lar) | `state:'hidden'` |
| DOM sakinleşsin | `domQuiet:{quietMs:300,maxWaitMs:5000}` | `MutationObserver(subtree,childList,attributes)`; son `quietMs` mutasyon yok | — |
| Fontlar | `fontsReady:{timeoutMs:1500}` | `document.fonts.ready` | — |
| Görseller | `imagesLoaded:{timeoutMs,inViewportOnly:false}` | `Promise.allSettled(imgs.map(i=>i.decode()))` | — |

- Varsayılan batch `wait`: `{pageLoad:'load', networkIdle:{idleMs:500,maxWaitMs:8000}, fontsReady:{timeoutMs:1500}, fixedDelayMs:0}` (Karar).
- `customJs` **yoktur** (remote code yasağı; 08).
- Toplam bekleme `control.perItemTimeoutMs` bütçesi içindedir; aşılırsa öğe `failed(E_TIMEOUT)` (retry'a tabi).

---

## 5. Çıktılar (`REQ-BAT-050`…`058`)
`BatchJobInput.export: ExportPlan & { combine: 'none'|'singlePdf'|'zip'|'zipAndPdf' }`

| combine | Davranış |
|---|---|
| `none` | Her öğe için ayrı dosya(lar) indirilir: `format ∈ {png,jpeg,webp,pdf}`; strip'ler `ExportPlan.multiImage` kuralına göre. Her öğe ayrıca history'ye yazılır (`source.batchId`). |
| `singlePdf` | Tüm öğeler tek PDF: öğe başına bir ya da daha fazla sayfa (`PdfOptions.mode` 'singleLongPage' ise öğe = 1 uzun sayfa; 'paged' ise öğe sayfalara bölünür). Her öğe için **bookmark/outline** girişi (`title` veya URL); PDF `/Outlines` pdf-lib low-level ile yazılır (04 §5.7). Header/footer token'ları öğe bazlı çözülür (`{url}`, `{title}`). |
| `zip` | Tüm öğe dosyaları tek ZIP (fflate streaming, level 0 — görüntüler zaten sıkıştırılmış); ZIP adı `{batchName}_{yyyy-mm-dd}_{time}.zip`; içine `manifest.json` (13) ve `log.csv` eklenir. |
| `zipAndPdf` | Hem ZIP (ayrı görüntüler) hem combined PDF. |

- Dosya boyutu: `singlePdf` tüm öğelerin JPEG'lerini bellekte toplar (pdf-lib streaming yok) → `REQ-BAT-055`: tahmini boyut > 500 MB ise UI uyarır ve "PDF'leri N öğede bir böl" (`pdfChunkSize`, varsayılan 100) uygular; parçalar `_part01.pdf` ekiyle.
- `singlePdf` üretimi **batch bittikten sonra** değil, **akış halinde** yapılamaz (pdf-lib); bu yüzden ara görüntüler `blobs`'ta tutulur, son adımda `offscreen.pdf` tek seferde çağrılır; bellek bütçesi aşılırsa otomatik chunk.
- Combined çıktılar `BatchJob.outputs[]`'a yazılır ve `chrome.downloads` ile indirilir (auto-download ayarı); history'de ayrıca "batch kaydı" görünür (07: `CaptureRecord` değil, `batches` tablosu; history UI'da "Batches" sekmesi).
- ZIP içi dosya adları filename template ile (6); çakışmalarda `_2`, `_3` eki (uniquify).

---

## 6. Filename Template (`REQ-BAT-060`…`062`)
- Grammar 13 §12. Batch varsayılanı: `{batchIndex:3}_{domain}_{title:40}`; ZIP/PDF adı: `{batchName}_{yyyy-mm-dd}_{time}`.
- Batch'e özel değişkenler: `{batchIndex}` (1'den başlar, `:N` zero-pad), `{batchName}`, `{itemName}` (CSV ikinci sütun; yoksa boş → fallback `{itemName|{domain}}`), `{tabIndex}` (tabs kaynağında), `{attempt}` (retry sayısı; debug için).
- Kaynak dokümandaki örnek desteklenir: `{domain}_{title}_{yyyy-mm-dd}_{counter}` — `{counter}` profil geneli sayaçtır (batch içinde ardışık artar).
- Önizleme: UI'da ilk 3 öğe için çözülmüş dosya adları canlı gösterilir.

---

## 7. Batch Kontrolleri (`REQ-BAT-070`…`080`)
`BatchControl` alanları ve davranışları:

| Alan | Varsayılan | Davranış |
|---|---|---|
| `concurrency` | 1 | Paralel pencere sayısı (8). UI: 1 / 2 / 3; 2+ için "Her paralel iş ayrı pencere açar; ekranınızda görünür olmalı" uyarısı. |
| `perItemTimeoutMs` | 60 000 | Navigasyon başlangıcından capture sonuna kadar. Aşılırsa `E_TIMEOUT`, sekme kapatılır/yeniden kullanılır, retry. Full page + infinite için UI 180 000 önerir. |
| `retry.max` / `retry.backoffMs` | 2 / 2000 | Başarısız öğe `attempts ≤ 1+max` olana kadar yeniden kuyruğa; bekleme `backoffMs * 2^(attempt-1)` (2 s, 4 s). `E_RESTRICTED_PAGE`, `E_VALIDATION`, `E_SELECTOR_NOT_FOUND` (fallback kapalıysa) **retry edilmez** (kalıcı hata). `E_TIMEOUT`, `E_NETWORK`, `E_RATE_LIMIT`, `E_WINDOW_NOT_VISIBLE`, `E_AGENT_*`, `E_TAB_*` retry edilir. |
| `delayBetweenMs` | 500 | Öğeler arası bekleme (site nezaketi + rate limit payı). UI 0–10 000. |
| `closeTabsAfter` | true | URL modunda öğe sekmesi kapatılır (pencere havuzu sekmeyi yeniden kullanır: `chrome.tabs.update(tabId,{url:next})`). Tabs modunda daima false. |
| `useIncognito` | false | Pencere havuzu incognito açar (`chrome.windows.create({incognito:true})`); uzantının incognito erişimi yoksa `E_PERMISSION_DENIED` ve UI yönlendirmesi (`chrome://extensions` → Allow in Incognito). `feature:'incognitoBatch'`. |
| `windowSize` | `{1440, 900}` | Pencere dış boyutu; viewport farkı (8.3) ölçülür ve gerekirse düzeltilir. |
| `stopOnError` | false | true ise ilk kalıcı hatada batch `paused` olur ve UI "Devam et / İptal" sorar. |
| `fallbackToFullPage` | false | 3. bölüm. |
| `pdfChunkSize` | 100 | 5. bölüm. |

Kullanıcı aksiyonları (`batch.*` mesajları): **Start**, **Pause** (çalışan öğeler biter, yenisi başlamaz), **Resume**, **Cancel** (çalışan capture job'ları `capture.cancel`, pencereler kapatılır, durum `cancelled`; tamamlanan öğelerin çıktıları korunur ve "kısmi ZIP/PDF oluştur" teklif edilir), **Retry failed** (`status:'failed'` öğeler `queued`'a; `attempts` sıfırlanır; batch `running`), **Duplicate batch** (aynı girdiyle yeni batch), **Export log**.

Progress: `BatchJob.summary {total,done,failed,skipped}` + aktif öğelerin `JobProgress`'i (alt çubuk) + ETA (`ortalama öğe süresi × kalan / concurrency`).

---

## 8. Pencere Havuzu ve Concurrency (`REQ-BAT-090`…`097`)

### 8.1 Neden ayrı pencere?
`chrome.tabs.captureVisibleTab` yalnızca **bir pencerenin aktif sekmesini** ve yalnızca pencere **ekranda görünürken** (minimize/occluded değil) çekebilir. Kullanıcının kendi penceresinde batch koşturmak hem kullanıcıyı kilitler hem de sekme değişimiyle bozulur. Bu nedenle `WindowPool` her paralel iş için `chrome.windows.create({ url:'about:blank', type:'normal', state:'normal', width, height, left, top, focused:false })` ile ayrı pencere açar.

Dürüst kısıtlar (UI'da gösterilir):
- Pencere **minimize edilemez** ve tamamen başka pencerenin arkasında kalmamalıdır; Chrome occluded pencerelerde "image readback failed" verebilir. Pool, `left/top` değerlerini ekranın görünür alanında (`chrome.system.display` izni istenmez; `screen.availWidth/Height` offscreen document'tan okunur) kademeli (cascade: +40 px) yerleştirir. Ekran dışı konum (negatif/taşan) **kullanılmaz** (Chrome clamp eder, capture bozulur).
- `focused:false` ile açılan pencere odak çalmaz; ancak bazı OS'lerde ilk açılış odak alır → açılıştan sonra orijinal pencereye `chrome.windows.update(origWin,{focused:true})` çağrılır (Karar).
- Öneri: **concurrency 1** (varsayılan). 2–3, aynı anda 2–3 görünür pencere ister; rate limit (2 capture/sn) **profil geneli** olduğundan paralellik full-page'de hız kazandırmaz (tile capture serileşir); kazanç yalnızca navigasyon/bekleme aşamalarındadır. UI metni: "2+ paralel iş yalnızca yükleme süreleri uzun sitelerde hız kazandırır."

### 8.2 Pool davranışı
- Pool boyutu = `concurrency`; her slot: `{windowId, tabId, busy, currentItemId}`.
- Öğe atama: slot boşalınca kuyruktan sıradaki `queued` öğe alınır; `chrome.tabs.update(tabId,{url})` (yeni sekme açmak yerine aynı sekme yeniden kullanılır → bellek sabit); `closeTabsAfter:false` ise her öğe için `chrome.tabs.create` ve pencere açık kalır (kullanıcı sonuçları görmek isteyebilir).
- Pencere kullanıcı tarafından kapatılırsa (`chrome.windows.onRemoved`): slot yeniden oluşturulur (1 kez), sonrasında batch `paused` + uyarı.
- Batch bitince/iptalinde tüm pool pencereleri kapatılır (`closeTabsAfter` ne olursa olsun pencere kapanır; `false` ise kapanmadan önce UI "Pencereler açık bırakılsın mı?" — Karar: açık bırakılır).
- Tabs kaynağında pool kullanılmaz (kullanıcı penceresi).

### 8.3 Viewport zorlama
- Dış pencere boyutu ≠ viewport (`innerWidth/innerHeight`) (tab strip, adres çubuğu, scrollbar). Pool ilk öğede `agent.scan` → `PageMetrics.viewport` ölçer; hedef viewport `windowSize` olarak yorumlanır (Karar: kullanıcı **viewport** girer, UI "viewport" der) → fark kadar `chrome.windows.update({width: w + (outerW-innerW), height: h + (outerH-innerH)})` düzeltmesi, tek sefer. Sonraki öğelerde ±4 px toleransla doğrulanır; sapma varsa `warnings`.
- Zoom: pool sekmelerinde `chrome.tabs.setZoom(tabId,1)`; `zoomSettings.scope` per-tab.
- DPR kullanıcı ekranından gelir; `dprMode:'css'` ile 1× çıktı istenebilir (tutarlı regresyon görselleri için QA preset'i bunu kullanır).

---

## 9. İzinler (`REQ-BAT-100`…`103`)
- `activeTab` yalnızca **kullanıcı jestiyle aktif olan sekme** için geçerlidir ve programatik açılan/navigasyon yapılan sekmelere **uzanmaz**. Batch, `chrome.scripting.executeScript` + `captureVisibleTab` için hedef URL'lerde host izni ister → `optional_host_permissions: ["<all_urls>"]`. Batch başlatılmadan önce `PermissionBroker.request('batch')`:
  - Varsayılan istek: `<all_urls>` (tek tık, kalıcı). Alternatif (Karar: UI'da ikinci seçenek): yalnızca listedeki origin'ler için `origins: ['https://site.com/*', ...]` (≤ 50 origin; fazlası `<all_urls>` önerir).
  - Reddedilirse batch başlamaz; açıklama: "Toplu çekim, listedeki sitelerde çalışabilmek için site erişim izni ister. Ekran görüntüleri cihazınızda kalır."
- `tabs` izni: all-tabs ve batch sekme başlıklarını okumak için (URL modunda `title` için de gerekli; yoksa `{title}` CS'den `document.title` ile alınır → `tabs` zorunlu değil; Karar: URL modunda istenmez).
- `webRequest` (opsiyonel, P2): network idle `maxInflight` ve bug-report network hataları için.
- Incognito: `useIncognito` için kullanıcı `chrome://extensions`'ta izin vermeli; `chrome.extension.isAllowedIncognitoAccess()` ile kontrol.

---

## 10. BatchRunner Mimarisi ve State Machine (`REQ-BAT-110`…`116`)

### 10.1 Durumlar
```
queued ──start──▶ running ──(all items terminal)──▶ completed | completedWithErrors
   │                │  ▲
   │              pause │ resume
   │                ▼  │
   │              paused
   └──cancel──▶ cancelled ◀── cancel (running/paused)
running ──(fatal: pool cannot be created, quota)──▶ failed
```
Öğe durumları: `queued → running → done | failed | skipped | cancelled`; `failed` + retry hakkı → tekrar `queued` (attempts++).

### 10.2 Pseudocode
```ts
class BatchRunner {
  async start(batchId) {
    const job = await db.batches.get(batchId); assertPermissions(job);
    job.status = 'running'; job.startedAt = now(); await persist(job);
    this.pool = await WindowPool.create(job.input.control);          // tabs kaynağında no-op
    this.loop(job);
  }
  private async loop(job) {
    while (job.status === 'running') {
      const slot = await this.pool.acquire();                        // boş slot bekler (Promise)
      const item = nextQueued(job);                                  // attempts/backoff uygun olan ilk queued
      if (!item) { if (noRunning(job)) break; await this.pool.release(slot); await waitAny(); continue; }
      item.status = 'running'; item.attempts++; item.startedAt = now(); item.windowId = slot.windowId; item.tabId = slot.tabId;
      await persist(job); emit({kind:'item', item});
      this.runItem(job, item, slot).finally(() => this.pool.release(slot));
      await sleep(job.input.control.delayBetweenMs);
    }
    await this.finish(job);
  }
  private async runItem(job, item, slot) {
    const deadline = now() + control.perItemTimeoutMs;
    try {
      await navigate(slot.tabId, item.url, job.input.wait.pageLoad, deadline);   // tabs.update + onUpdated complete
      const req = buildCaptureRequest(job, item, slot);                           // mode/selector/capture/wait/export(targets:['history'])
      const { jobId } = await coordinator.start(req);
      const result = await coordinator.waitFor(jobId, deadline);                   // job.done|failed|cancelled
      item.captureId = result.captureId; item.status = 'done';
      await stageOutputs(job, item, result);                                       // combine:none → download; else blobs'ta tut
    } catch (e) {
      const err = toErrorInfo(e);
      item.error = err; item.status = isRetryable(err) && item.attempts <= 1 + control.retry.max ? 'queued' : 'failed';
      if (item.status === 'queued') item.notBefore = now() + control.retry.backoffMs * 2 ** (item.attempts - 1);
      log(job, 'error', item.id, `${err.code}: ${err.message}`);
      if (control.stopOnError && item.status === 'failed') { job.status = 'paused'; emit({kind:'status', job}); }
    } finally {
      item.finishedAt = now(); item.durationMs = item.finishedAt - item.startedAt; await persist(job); emit({kind:'item', item});
    }
  }
  private async finish(job) {
    await this.pool.dispose();
    await buildCombinedOutputs(job);                                  // singlePdf / zip / zipAndPdf (+chunking)
    job.status = job.summary.failed ? 'completedWithErrors' : 'completed'; job.finishedAt = now();
    await persist(job); emit({kind:'status', job}); notify(job);
  }
}
```
- `navigate`: `chrome.tabs.update(tabId,{url})` → `chrome.tabs.onUpdated` (`changeInfo.status==='complete'` ve `tab.url` hedef origin'de) → `pageLoad:'domcontentloaded'` için `webNavigation.onDOMContentLoaded` varsa; yoksa `complete` beklenir (Karar). Yönlendirmeler (`3xx`) doğal takip edilir; final URL `CaptureRecord.url`'e yazılır, istenen URL `BatchItem.url`'de kalır. `chrome://`'ya düşen (hata sayfası `chrome-error://chromewebdata/`) navigasyonlar `E_NETWORK` (retry).
- `buildCaptureRequest`: `export.targets` batch'te **daima** `['history']` (+ `combine:'none'` ise `'download'`); `openResult` asla.
- `stageOutputs`: combine ≠ none ise öğe görüntüsü zaten `blobs`'ta (history kaydı) — ek kopya yok; `finish()` referanslarla çalışır.

### 10.3 Tabs kaynağı farkı
Pool yerine kullanıcı penceresi: `slot = {windowId: tab.windowId, tabId}`; `navigate` yerine `activate(tabId)` (+ discarded → reload); `closeTabsAfter` yok; bitişte orijinal aktif sekme geri. `concurrency` zorla 1.

---

## 11. SW Yaşam Döngüsü ve Resume (`REQ-BAT-120`…`124`)
- Batch durumu her değişimde IDB `batches` (+ `batchItems`) tablosuna yazılır; `storage.session.activeBatches: Id[]` hızlı erişim içindir.
- SW canlılığı: çalışan capture job'ları Port/`chrome.*` çağrılarıyla SW'yi canlı tutar; öğeler arası `delayBetweenMs` ve retry backoff bekleme için `setTimeout` **yerine** `chrome.alarms.create('batch:'+id,{when})` kullanılır (süre ≥ 30 s ise; altı `setTimeout`, SW ölürse alarm yedeği olarak 1 dk'lık `batch-watchdog` alarmı).
- `batch-watchdog` (periyodik 1 dk, yalnız aktif batch varken): `activeBatches` için `running` öğelerin `startedAt + perItemTimeoutMs` geçmişse → öğe `failed(E_SW_RESTART)`/retry; pool pencereleri `chrome.windows.get` ile doğrulanır (kapanmışsa yeniden oluştur); `loop()` çalışmıyorsa yeniden başlatılır.
- SW restart (`onStartup`/ilk mesaj): `activeBatches` taranır; `running` öğeler → `queued` (attempts sayılmaz, `notBefore:now`), `loop()` yeniden başlatılır; UI'ya `status` olayı. Tamamlanmış capture'lar (history'de `captureId` var) kaybolmaz.
- Tarayıcı kapanıp açılırsa: `storage.session` temizlenir; `onStartup`'ta IDB'den `running|paused` batch'ler bulunur ve **`paused`** yapılır (Karar: otomatik devam etmez; kullanıcı `batch.html`'de "Devam et" der — pencere açılması sürpriz olmasın).

---

## 12. Olay Akışı ve UI (`batch.html`) (`REQ-BAT-130`…`136`)
- Port `batch-events`; SW `BatchEvent {batchId, kind:'status'|'item'|'log'|'output'}` push eder; UI bağlandığında `batch.get` ile tam durumu alır (snapshot + delta).
- Ekranlar: **Yeni batch** (kaynak seçimi, URL textarea/import, mod, selector test, bekleme, çıktı, kontrol — gelişmiş alanlar katlanabilir; preset seçici), **Çalışan batch** (özet sayaçlar, ETA, öğe tablosu: #, URL, durum, süre, deneme, hata kodu, thumbnail; satır aksiyonları: aç, history'de göster, yeniden dene, atla), **Geçmiş batch'ler** (liste, tekrar çalıştır, çıktıları indir, sil).
- Bildirim: batch tamamlandığında `chrome.notifications` (ayar); badge `"B"` aktif batch göstergesi.
- Popup'tan hızlı giriş: "Batch capture…" → `batch.html` açar.

---

## 13. Rapor ve Loglar (`REQ-BAT-140`…`143`)
- `BatchLogLine` ring buffer (max 2 000 satır/batch; eskiler düşer, `log.dump` ile tam log IDB'den).
- **Export log**: `log.csv` (`at,level,itemIndex,url,code,message`) ve `report.json` (`{batch: BatchJob (item detaylarıyla), app: {version, variant}, generatedAt}`); ZIP çıktılarının içine otomatik eklenir.
- Hata özetleri gruplanır ("12 öğe E_TIMEOUT, 3 öğe E_SELECTOR_NOT_FOUND") → "Başarısızları yeniden çalıştır" butonu.

---

## 14. Presetler (`REQ-BAT-150`)
- `BatchJobInput.presetId`: preset'in `capture`/`export`/`extras` alanları batch girdisine merge edilir (batch'teki açık değerler preset'i ezer). Yerleşik presetler 09 §8 (ör. *QA Test*: `dprMode:'css'`, `hideFixedElements:'always'`, `smartHide` açık, PNG; *Archive*: PDF single long page + metadata + evidence hash).
- "Bu batch'i preset olarak kaydet" → `Preset` (mode dahil) oluşturur.

---

## 15. Scheduling Kancası (`REQ-BAT-160`)
- Batch'in kendisi zamanlanmaz (Karar, P2 değerlendirme); zamanlı çalışma `MonitorRule` (09 §11) ile tekil URL bazlıdır. Ancak `BatchRunner` API'si `monitor` tarafından yeniden kullanılır: `MonitorRule` tetiklendiğinde `BatchJobInput {source:{kind:'urls',urls:[rule.url]}, ...}` ile tek öğelik batch koşar ve `meta.monitorRuleId` taşır. Böylece pencere havuzu, bekleme ve retry mantığı paylaşılır.

---

## 16. Limitler ve Performans (`REQ-BAT-170`…`173`)
| Parametre | Değer |
|---|---|
| Maks öğe | 500 |
| Maks concurrency | 3 |
| Öğe başına varsayılan timeout | 60 s (UI full-page+infinite için 180 s önerir) |
| Tahmini süre (UI ETA) | `navigasyon (~2–4 s) + bekleme + tile sayısı × 0.55 s + stitch (~1–3 s) + delayBetween` → 100 URL × ~8 000 px sayfa (1440×900, ~9 tile) ≈ 100 × ~12 s ≈ **20 dk** (concurrency 1); visible modunda ≈ 100 × 4 s ≈ 7 dk |
| Bellek | Öğe görüntüleri IDB'de; SW heap < 100 MB; combined PDF chunk 100 öğe |
| Depolama | Batch başına `maxBytes` kontrolü (07 kota); %85 doluluk → batch `paused` + uyarı |
| Log | 2 000 satır/batch bellek; tam log IDB |

---

## 17. Kabul Kriterleri
| ID | Kriter |
|---|---|
| AC-BAT-01 | 20 URL'lik liste (3'ü geçersiz, 2'si yinelenen) girilince UI 15 geçerli öğe, 3 geçersiz satır numarası ve 2 yinelenen bildirir; başlat sonrası 15 öğe `done`. |
| AC-BAT-02 | Batch, kullanıcının penceresi yerine ayrı pencerede çalışır; kullanıcı kendi sekmesinde gezinirken çıktılar bozulmaz. |
| AC-BAT-03 | `perItemTimeoutMs=10000` ile yavaş test sayfası (20 s yükleme) 3 denemeden sonra `failed(E_TIMEOUT)` olur; diğer öğeler tamamlanır; summary doğru. |
| AC-BAT-04 | `retryFailed` yalnız `failed` öğeleri yeniden çalıştırır; `done` öğelere dokunmaz. |
| AC-BAT-05 | `combine:'singlePdf'` ile 10 URL → tek PDF, 10 outline girişi, her sayfa başlığında doğru `{url}`. |
| AC-BAT-06 | `combine:'zip'` → ZIP içinde 10 görüntü + `manifest.json` + `log.csv`; dosya adları template'e uygun ve benzersiz. |
| AC-BAT-07 | Pause → çalışan öğe biter, yeni öğe başlamaz; Resume → kaldığı yerden devam; Cancel → pencereler kapanır, tamamlananlar korunur. |
| AC-BAT-08 | SW zorla sonlandırıldığında (chrome://serviceworker-internals stop) batch ≤ 60 s içinde watchdog ile devam eder; öğe kaybı yok, çift capture yok. |
| AC-BAT-09 | Host izni reddedilince batch başlamaz ve açıklayıcı mesaj gösterir; izin verilince aynı form ile başlar. |
| AC-BAT-10 | All-tabs: 8 sekme (1 chrome://, 1 discarded) → 7 capture, restricted atlanır ve loglanır, discarded reload edilir, bitişte orijinal sekme aktif. |
| AC-BAT-11 | `windowSize` viewport 1280×720 istenince `agent.scan` viewport'u ±4 px içinde; tüm öğelerde aynı. |
| AC-BAT-12 | Selector modu: eşleşmeyen sayfada `fallbackToFullPage:false` → `E_SELECTOR_NOT_FOUND` (retry yok); `true` → full page + warning. |
| AC-BAT-13 | `networkIdle` bekleme: XHR ile 3 s sonra içerik ekleyen test sayfasında içerik görüntüde var; `maxWaitMs` aşımı hata değil uyarı. |
| AC-BAT-14 | 100 URL visible-mode batch ≤ 10 dk (ortalama <6 s/öğe) ve SW heap < 100 MB. |
