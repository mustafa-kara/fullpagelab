# 07 — Screenshot History ve Depolama

> Tüm capture'ların yerel (local-first) kaydı, arama/filtreleme, bulk işlemler, recapture, editörde yeniden açma, kota yönetimi, yedekleme ve şema migration'ları. Tipler `13-data-contracts.md §5` (`CaptureRecord`, `CaptureFile`, `HistoryQuery`, `HistoryPage`, `StorageStats`, `Folder`, `Tag`, `BlobRow`, `BlobRef`), mimari `02-architecture.md §6`. Gereksinim ID önek: `REQ-HIS-*`.

İçindekiler: 1 İlkeler · 2 Dexie şeması · 3 OPFS · 4 BlobRef çözümleme & GC · 5 Yazma yolu (write-through-SW) · 6 Kayıt oluşturma & thumbnail · 7 Metadata alanları · 8 Listeleme/sayfalama · 9 Arama & OCR indeksi · 10 Filtreler · 11 Kayıt işlemleri (bulk, re-download, open URL, recapture, editörde aç) · 12 Kota yönetimi · 13 Yedekleme (export/import) · 14 Veri silme · 15 Migration · 16 Gizlilik · 17 Performans · 18 Kabul kriterleri

---

## 1. İlkeler — `REQ-HIS-001`…`004`
1. **Varsayılan açık, local-only.** Her başarılı capture `CaptureRecord` olarak IndexedDB'ye yazılır; hiçbir veri cihazdan çıkmaz (08).
2. **Tek yazar.** Tüm yazmalar SW `HistoryService` üzerinden; UI sayfaları **yalnızca okur** (aynı DB'yi Dexie ile açar) ve değişiklikleri `history.*` mesajlarıyla ister. Gerekçe: tek transaction sırası, refCount/GC tutarlılığı, kota kontrolü tek noktada.
3. **Kapatılabilir.** `Settings.history.enabled=false` → capture sonucu yalnızca `storage.session` + result sekmesinde geçici tutulur (sekme kapanınca gider); history UI "kapalı" durumunu açıklar.
4. **Kapsayıcı metadata.** Kaynak dokümandaki her alan (thumbnail, title, URL, domain, tarih, saat, boyutlar, format, dosya boyutu, capture modu, tags, folder, preset, capture settings) `CaptureRecord`'da tutulur (§7).

---

## 2. Dexie Şeması (`src/shared/db/schema.ts`) — `REQ-HIS-010`…`014`
DB adı `ssx`. Sürüm 1:

```ts
export class SsxDb extends Dexie {
  captures!: Table<CaptureRecord, Id>;
  blobs!:    Table<BlobRow, string>;
  tiles!:    Table<TileRecord, string>;
  batches!:  Table<BatchJob, Id>;
  batchItems!: Table<BatchItem & { batchId: Id }, Id>;
  diffs!:    Table<DiffResult & { id: Id }, Id>;
  ocrDocs!:  Table<OcrDocRow, Id>;          // capture başına OCR belgesi (tokens multiEntry)
  editorDocs!: Table<EditorDocument, Id>;    // key: captureId (05 §13)
  tags!:     Table<Tag, string>;
  folders!:  Table<Folder, Id>;
  presets!:  Table<Preset, Id>;
  monitors!: Table<MonitorRule, Id>;
  logs!:     Table<LogRow, number>;
  constructor() {
    super('ssx');
    this.version(1).stores({
      captures:   'id, createdAt, domain, *tags, folderId, mode, starred, url, [domain+createdAt], [folderId+createdAt], [starred+createdAt]',
      blobs:      'id, createdAt, refCount, bytes',
      tiles:      'id, jobId, [jobId+index]',
      batches:    'id, status, createdAt',
      batchItems: 'id, batchId, [batchId+index], status',
      diffs:      'id, baseId, headId, createdAt, [baseId+headId]',
      ocrDocs:    'captureId, *tokens, indexedAt',
      editorDocs: 'captureId, updatedAt',
      tags:       'name, count',
      folders:    'id, parentId, name',
      presets:    'id, name, builtin',
      monitors:   'id, url, enabled, nextRunAt',
      logs:       '++id, at, level, jobId',
    });
  }
}
```
- `captures` içindeki blob içerikleri **tutulmaz**; yalnızca `BlobRef` (`files[].ref`, `thumbnail`, `favicon`).
- `blobs.id` = `nanoid(16)`; `BlobRow.refCount` kaç `CaptureRecord`/`DiffResult`/`BatchJob` tarafından referanslandığını tutar.
- Dexie `Table<…, key>` tipleri `13`'teki tiplerle aynıdır; ek satır tipleri (**13'e eklenecek**):
```ts
export interface OcrDocRow { captureId: Id; text: string; tokens: string[]; /* benzersiz, normalize */ words: OcrResult['words']; lang: string[]; indexedAt: IsoDate; }
export interface LogRow { id?: number; at: IsoDate; level: 'debug'|'info'|'warn'|'error'; ns: string; jobId?: Id; msg: string; }
```
- `storage.local` ile DB arasında bağ: `Settings.history.*` politikaları ve `filenameCounter` DB dışında kalır.

---

## 3. OPFS (`src/shared/db/opfs.ts`) — `REQ-HIS-020`…`023`
- Kullanım eşiği: **tek blob > 50 MB** (Karar) → IndexedDB yerine OPFS (`navigator.storage.getDirectory()`); `BlobRef.store:'opfs'`. Küçük blob'lar IDB'de kalır (sorgu/transaction kolaylığı).
- Düzen: `/captures/<captureId>/<fileId>.<ext>`, `/batches/<batchId>/<name>.zip`, `/evidence/<captureId>/bundle.zip`, `/tmp/<jobId>/…` (geçici; job sonunda silinir).
- Yazma: worker içinde `createSyncAccessHandle` (offscreen worker'ları); SW'de `createWritable` (async). Okuma: `getFile()` → `File`.
- Offscreen ve SW aynı origin → aynı OPFS; eşzamanlı yazma çakışması `tmp` + `move` (rename yoksa copy+delete) ile önlenir.
- Silme: `removeEntry(name, {recursive:true})`; capture silinince dizin tamamen kaldırılır.
- `StorageStats.opfsBytes`: dizin gezilerek hesaplanır (cache'lenir, 5 dk).

---

## 4. BlobRef Çözümleme ve GC — `REQ-HIS-030`…`035`
```ts
export async function resolveBlob(ref: BlobRef): Promise<Blob>           // idb → blobs.get ; opfs → file handle
export async function putBlob(blob: Blob, opts: { preferOpfs?: boolean; path?: string }): Promise<BlobRef>
export async function retain(ref: BlobRef): Promise<void>                // refCount++ (idb) | opfs: refs.json
export async function release(ref: BlobRef): Promise<void>               // refCount-- ; 0 → sil
```
- `putBlob`: `bytes > 50 MB || preferOpfs` → OPFS; aksi IDB. `refCount` başlangıç 1.
- `release` ile `refCount` 0'a düşen blob anında silinir (aynı transaction'da). OPFS için `/<dir>/refs.json` yerine basitlik: OPFS blob'ları yalnızca tek bir kayda ait kabul edilir (Karar) → kayıt silinince dizin silinir.
- **GC taraması** (`HistoryService.gc()`): `chrome.alarms` günde 1 + SW başlangıcında (throttle 6 saat): (a) `blobs.where('refCount').equals(0)` sil; (b) hiçbir `captures`/`diffs`/`batches` tarafından referans edilmeyen `blobs` (orphan; crash sonrası) — tüm kayıtların ref'leri `Set` yapılır, fark silinir; (c) `tiles` tablosunda aktif olmayan `jobId`'ler silinir; (d) OPFS `/tmp` ve `/captures/<id>` dizini olup `captures` kaydı olmayanlar silinir. GC < 2 s hedef (10k blob).
- Editör `keepOriginalsAfterEdit=false` ise `edited` yazılırken `full` release edilir (§11.6).

---

## 5. Yazma Yolu (write-through-SW) — `REQ-HIS-040`…`043`
- UI → `history.update|delete|export|recapture|clear` → SW `HistoryService` → Dexie transaction (`'rw', [captures, blobs, tags, ocrDocs, editorDocs]`).
- SW, değişiklik sonrası `history-events` (**13'e eklenecek** `PortName` `'history-events'`, mesaj `history.changed { kind:'put'|'delete'|'clear'; ids: Id[] }`) ile açık UI'lara push eder; UI liste/önbelleği günceller (kendi sorgusunu yeniler).
- Büyük toplu işlemler (bulk delete 1.000 kayıt) 100'lük parçalar halinde ayrı transaction'larda (UI progress alır).

---

## 6. Kayıt Oluşturma ve Thumbnail — `REQ-HIS-050`…`055`
Capture job `stitching` bittikten sonra (02 §3.3):
1. `offscreen.thumbnail {src: full|strips[0], maxSize: Settings.history.thumbnailWidth (320)}` → WebP (`quality 0.8`), genişlik 320 px, en-boy korunur, **yükseklik en fazla 640 px** (uzun sayfalarda üst kısım; Karar) → `putBlob` → `thumbnail`.
2. `favicon`: `tab.favIconUrl` varsa `fetch` (SW, `activeTab` kapsamı; hata → yok say) → ≤ 32 KB ise `putBlob`.
3. `sha256`: `offscreen.hash` (full görüntü) — `includeMetadata`/evidence isteniyorsa; aksi halde lazy (evidence/OCR talebinde hesaplanır). Karar: her capture'da hesaplanır (maliyet düşük, < 200 ms / 20 MB).
4. `CaptureRecord` alanları doldurulur (§7); `request` kopyasından geçici alanlar temizlenir: `target.tabId/windowId/tabIds` silinir, `target.url` = capture edilen URL; `id/trigger` korunur.
5. `tags` güncelleme: preset `autoTags` (**13'e eklenecek** `Preset.extras.autoTags?: string[]`) → `tags` tablosunda `count++`.
6. Kota ön-kontrol (§12): yazmadan önce `needBytes` tahmini (full+strips+thumb) ile `ensureSpace(needBytes)`.
7. `captures.put` → `history.changed`.

---

## 7. Metadata Alanları — `REQ-HIS-060`
| Kaynak dokümandaki alan | `CaptureRecord` |
|---|---|
| Thumbnail | `thumbnail` (BlobRef, WebP 320) |
| Title | `title` |
| Original URL | `url` |
| Domain | `domain` (hostname `www.` kırpılmış; `hostname` ayrıca `request.target.url`'den türetilir) |
| Capture tarihi / saati | `createdAt` (UTC ISO; UI yerel saatte gösterir) |
| Dimensions | `size` (DevicePx), `cssSize`, `viewport`, `dpr`, `zoom` |
| Format | `files[].format` (full PNG her zaman; ek export'lar eklenir) |
| File size | `files[].ref.bytes` (UI toplamı ve full'ü gösterir) |
| Capture mode | `mode` |
| Tags | `tags[]` |
| Folder | `folderId` |
| Preset | `presetId`, `presetName` (preset silinse bile ad kalır) |
| Capture settings | `request.options` (+ `request.export`) |
| Ek | `backend`, `warnings`, `durationMs`, `appVersion`, `sha256`, `starred`, `notes`, `source`, `ocr`, `evidence`, `bugReport`, `aux.links/textRects` (04 §1.3) |

---

## 8. Listeleme ve Sayfalama — `REQ-HIS-070`…`074`
- `history.list {HistoryQuery}` → `HistoryPage`. Varsayılan sıralama `createdAt desc`.
- **Keyset pagination**: cursor = `base64url(JSON [sortValue, id])`. Sorgu: `captures.where('createdAt').below(cursorCreatedAt)` (+ eşitlikte `id` karşılaştırması) `.reverse().limit(limit+1)`; son eleman fazlaysa `nextCursor`. Filtreli sorgularda en seçici indeks seçilir (§10) ve diğer filtreler `.filter()` ile bellek içinde.
- `total`: filtresizde `captures.count()`; filtreli sorgularda yaklaşık (ilk 5.000 taranır; UI "5.000+" gösterir) — Karar.
- UI: sanal ızgara (`@tanstack/virtual` benzeri basit kendi implementasyonu; sayfa başına 60 kayıt, scroll sonunda `nextCursor`). Thumbnail'ler `URL.createObjectURL` ile gösterilir, görünümden çıkınca `revokeObjectURL` (IntersectionObserver).
- Detay paneli (`history.get`) tek kayıt için tüm metadata + dosya listesi + aksiyonlar.

---

## 9. Arama ve OCR İndeksi — `REQ-HIS-080`…`088`
### 9.1 Metin arama (`HistoryQuery.q`)
1. Sorgu tokenize edilir (§9.3); her token için:
   - `title`, `url`, `notes`, `tags`: kayıt alanları üzerinde **prefix/substring** eşleşme — indeks yok; filtre bellek içinde yapılır ama önce `ocrDocs` + `url`/`domain` indeksleriyle aday küme daraltılır (Karar: 10k kayıt için tam tarama ~100 ms kabul edilebilir; 50k+ için `searchIndex` tablosu P2).
   - OCR: `ocrDocs.where('tokens').startsWith(tok).primaryKeys()` → `captureId` kümesi; çoklu token'da kesişim.
2. Çoklu token → kesişim (AND); sonuç `createdAt desc`; OCR eşleşmesi olan kayıtlarda `snippet` (eşleşen kelime ± 5 kelime) döner (**13'e eklenecek** `HistoryPage.items[i].matches?: { field: 'title'|'url'|'notes'|'tags'|'ocr'; snippet: string }[]`).
3. Boş `q` → filtre yok.

### 9.2 OCR indeksleme (`ocr.index`)
- Tetik: `Settings.history.ocrAutoIndex=true` (opt-in) ise her capture sonrası arka planda (offscreen worker, düşük öncelik, ekran başına tek iş, kullanıcı etkileşimine öncelik: `requestIdleCallback` benzeri kuyruk); ya da kullanıcı detay panelinde "Metni indeksle"; ya da bulk "Seçilenleri indeksle".
- `offscreen.ocr {src: full (ya da strip'ler sırayla), lang}` → `OcrResult.words[]` → tokenize (§9.3) → `ocrDocs.put({captureId, text, tokens, words, lang, indexedAt})` (**Karar:** ters indeks tablosu yerine capture başına tek satır + Dexie **multiEntry** `*tokens` indeksi; `where('tokens').startsWith(t)` prefix aramayı destekler; snippet/bbox için aynı satırdaki `words` kullanılır — 09 §8 ile aynı şema). Büyük `words` dizisi (> 50k kelime) ayrıca `blobs`'a JSON olarak yazılıp satırda `wordsRef` ile referanslanabilir (`CaptureFile role:'ocr'`).
- `CaptureRecord.ocr = { indexedAt, lang, words }`.
- Silme: kayıt silinince `ocrDocs.delete(captureId)` (tek işlem).
- Boyut: 1.000 capture × ~1.500 benzersiz token + words ≈ 30–60 MB (kabul edilebilir; `StorageStats` gösterir). multiEntry indeks boyutu token sayısıyla doğrusal.

### 9.3 Tokenizasyon (`lib/text/tokenize.ts`)
- Unicode NFKC → `toLocaleLowerCase` (**Türkçe:** `İ→i`, `I→ı` hataları için dil `tr` ise `'tr-TR'` locale, değilse `'en'`; Karar: her iki varyant da indekslenir — `"İstanbul"` → `istanbul` ve `i̇stanbul` normalize edilip tek `istanbul`); aksan katlama: `ş→s, ç→c, ğ→g, ı→i, ö→o, ü→u` **ek** token olarak (arama `"sirket"` ile `"şirket"` bulur).
- Ayırıcı: `\p{L}\p{N}` dışı her şey; token uzunluğu 2–40; sayısal token'lar korunur (fatura no); stopword listesi **yok** (Karar; kanıt aramalarında her kelime önemli).
- Prefix eşleşme ≥ 3 karakter; 2 karakterli sorgular tam eşleşme.

---

## 10. Filtreler — `REQ-HIS-090`…`094`
| Filtre | İndeks / yöntem |
|---|---|
| Domain (`domains[]`) | `where('domain').anyOf(domains)`; tek domain + tarih → `[domain+createdAt]` |
| Tarih (`dateFrom/dateTo`) | `where('createdAt').between(from, to, true, true)` |
| Format (`formats[]`) | bellek içi: `files.some(f => formats.includes(f.format))` |
| Tag (`tags[]`) | `where('tags').anyOf(tags)` (multiEntry) → `distinct()`; AND semantiği için bellek içi kesişim (Karar: UI'da "herhangi biri / hepsi" anahtarı) |
| Mode (`modes[]`) | `where('mode').anyOf(modes)` |
| Starred | `[starred+createdAt]` |
| Folder | `[folderId+createdAt]`; "klasörsüz" = `folderId` undefined (bellek içi) |
| Preset | bellek içi `presetId` |
- Seçim stratejisi: en az kayıt döndürmesi beklenen indeks (öncelik: tag → domain → folder → starred → createdAt) birincil; kalanlar `.filter()`. Sayaçlar için sidebar "facet"leri (domain başına sayı, tag sayıları) `tags.count` ve `domain` üzerinde `Dexie` `orderBy('domain').uniqueKeys()` + periyodik sayım (cache 60 s).
- Filtre durumu URL hash'inde (`history.html#q=…&domain=…`) → paylaşılabilir/geri dönülebilir.

---

## 11. Kayıt İşlemleri — `REQ-HIS-100`…`129`
### 11.1 Bulk delete (`history.delete {ids}`)
1. 100'lük parçalar; her parça `rw` transaction: `captures.bulkGet` → tüm `BlobRef`'ler `release` → `captures.bulkDelete` → `tags.count--` → `ocrDocs` temizliği kuyruğa.
2. `diffs` içinde `baseId/headId` eşleşenler silinir (bağlı mask blob'ları release).
3. OPFS dizinleri silinir.
4. UI: önce "Geri al" (5 s) için **soft delete** — Karar: soft delete yok; onay diyaloğu ("12 kayıt, 84 MB silinecek") yeterli.

### 11.2 Bulk export (`history.export {ids, format, asZip}`)
- `asZip:false` ve `ids.length ≤ 10` → her kayıt için `ExportPipeline` download; `> 10` → zorla ZIP (Chrome çoklu indirme uyarısı). `asZip:true` → `zip.worker` (04 §10) + `manifest.json`. `format:'pdf'` + birden fazla kayıt → tek combined PDF seçeneği (04 §5.10) ya da ayrı PDF'ler (UI seçimi).
- Dosya adları kaydın kendi bağlamıyla (`TemplateContext` capture'dan) çözülür.

### 11.3 Screenshot'ı tekrar indir
- Detay/kart aksiyonu: ilgili `CaptureFile` için `DownloadManager.download` (yeni `downloadId`); önce `chrome.downloads.search({id})` ile dosya hâlâ varsa `chrome.downloads.show` seçeneği sunulur ("Klasörde göster").

### 11.4 Original URL'yi aç
- `chrome.tabs.create({url})`; `url` `javascript:`/`data:` ise engellenir. Evidence kayıtlarında `finalUrl` gösterilir.

### 11.5 Recapture (`history.recapture {id, overrides?}`)
1. `record.request` klonlanır; `overrides` merge; `trigger:'recapture'`, `meta.recaptureOf = id`.
2. Hedef sekme: **yeni pencere** `chrome.windows.create({ url: record.url, type:'normal', width: viewport.width + chromeW, height: viewport.height + chromeH, focused:true })` — `chromeW/H` = ilk açılışta ölçülen pencere kromu farkı (`window.outerWidth - innerWidth`; `storage.local.windowChrome`), böylece **aynı viewport** sağlanır (Karar: aynı viewport için yeni pencere; kullanıcı `overrides.target.tabId` verirse mevcut sekme kullanılır ve viewport farkı uyarı olarak eklenir).
3. `webNavigation`/`tabs.onUpdated status:'complete'` beklenir + `request.options.wait` (`pageLoad:'load'`), ardından `CaptureCoordinator.start(request)` — aynı `mode`, `selector`, `delayMs`, `presetId`, `smartHide`, `lazyLoad` vb. Eğer `mode:'selection'` → `target.rect` aynen; `element/selector` → selector bulunamazsa `E_SELECTOR_NOT_FOUND` + UI "Sayfa yapısı değişmiş olabilir; elementi yeniden seç" (picker başlat seçeneği).
4. Zoom: `zoomHandling` aynı; DPR farklıysa (başka ekran) uyarı `warnings:['dpr-differs']`.
5. Sonuç yeni kayıt; `source.recaptureOf` bağı ile detay panelinde "Önceki sürümle karşılaştır" (09 §1) butonu.
6. Pencere capture sonrası kapatılır (ayar `recapture.closeWindowAfter` — **13'e eklenecek** `Settings.history.recaptureCloseWindow: boolean`, varsayılan true).

### 11.6 Editörde yeniden aç
- `result.html?id=<captureId>` → `EditorDocument` varsa (`CaptureFile role:'editorDoc'` — **13'e eklenecek** `CaptureFile.role` birleşimine `'editorDoc'`, JSON) yüklenir; yoksa `full` (ya da `edited`) base alınır.
- Kaydet: `editorDoc` JSON + düzleştirilmiş `edited` PNG yazılır; `keepOriginalsAfterEdit=false` ise `full` release (uyarı: "Orijinal silinecek"); `redact` annotation commit edildiyse `base` yeni blob'dur ve eski base **zorunlu** silinir (05 §4).
- History kartı `edited` varsa onun thumbnail'ini gösterir (thumbnail yeniden üretilir).

### 11.7 Diğer
- Star/unstar, tag ekle/çıkar (autocomplete `tags`), klasöre taşı (ağaç, sürükle-bırak), notlar (≤ 2.000 karakter), yeniden adlandır (`title`).
- Klasör silme: içindekiler "klasörsüz" olur (Karar; kayıt silinmez).
- Detayda "Compare'e gönder", "Diff geçmişi" (09), "Bug report oluştur", "Evidence bundle" aksiyonları.

---

## 12. Kota Yönetimi — `REQ-HIS-130`…`137`
- `StorageStats`: `navigator.storage.estimate()` (`usage`, `quota`) + DB sayımları + OPFS bayt; Options/History üst bilgi çubuğunda gösterilir. `unlimitedStorage` ile Chrome eviction yapmaz; yine de disk dolabilir.
- Onboarding'de `navigator.storage.persist()` çağrılır; `persisted` durumu `StorageStats`'ta.
- Eşikler (`usage/quota` ve kendi limitleri `Settings.history.maxBytes` (2 GB) / `maxItems` (1000)):
  - **%85** (ya da limitlerin %85'i) → uyarı banner'ı (history/popup): "Depolama %85 dolu. Eski kayıtları temizle."
  - **%95** → `autoCleanup` politikası: `'oldest'` → yıldızsız en eski kayıtlar silinir (hedef %80'e inene kadar; evidence kayıtları ve klasörlü kayıtlar **son sırada**); `'ask'` → capture öncesi diyalog (result sayfasında) ve yeni capture yine kaydedilir ama uyarı; `'never'` → `maxBytes` aşılırsa yeni capture `E_STORAGE_QUOTA` ile **history'ye yazılmaz**, geçici sonuç sunulur.
- `ensureSpace(needBytes)` yazma öncesi: `usage + needBytes > limit` ise politika uygulanır.
- `IndexedDB` `QuotaExceededError` yakalanır → `E_STORAGE_QUOTA`; capture sonucu yine result sekmesinde gösterilir (veri kaybı yok) + "Yer aç" butonu.
- Options → Veri: kullanım dağılımı (görüntüler / PDF / OCR indeksi / tiles geçici), "Temizle" kısayolları (30 günden eski, domain bazlı, OCR indeksini sıfırla).

---

## 13. Yedekleme: Export / Import — `REQ-HIS-140`…`144`
- **Export** (Options → "Tüm geçmişi yedekle"): ZIP (streaming, OPFS'e yazılır, sonra download): `manifest.json { version:1, exportedAt, appVersion, captures: CaptureRecord[] (BlobRef.key → zip yolu), tags, folders, presets }`, `captures/<id>/full.png|strip-01.png|edited.png|…`, `thumbs/<id>.webp`. OCR indeksi **dahil edilmez** (import sonrası yeniden üretilir; opsiyon).
- **Import**: ZIP seçilir (`<input type=file>` options sayfasında) → manifest doğrulanır (`zod`) → çakışan `id`'ler atlanır ya da yeni id (seçenek) → blob'lar `putBlob` → kayıtlar; ilerleme gösterilir; `history.changed`.
- Seçili kayıtları yedekleme = bulk export ZIP (+ manifest).
- Karar: şifreli yedek yok (P2; WebCrypto AES-GCM ile parola).

---

## 14. Veri Silme — `REQ-HIS-150`…`153`
- Options → "Tüm verileri sil": onay (yazarak `DELETE`) → `db.delete()` + OPFS kök temizliği + `storage.local` (ayarlar hariç seçenek) + `storage.session`; entegrasyon token'ları da silinir (08).
- `history.clear {olderThan}`: tarih bazlı toplu silme (11.1 ile aynı yol).
- Kaldırma notu: uzantı kaldırılınca Chrome origin verisini (IDB/OPFS/storage) siler — onboarding ve Options'ta açıkça yazılır: "Uzantıyı kaldırırsanız tüm ekran görüntüleri silinir; önce yedek alın." `chrome.runtime.setUninstallURL` **kullanılmaz** (telemetri algısı; Karar).

---

## 15. Migration Stratejisi — `REQ-HIS-160`…`163`
- Dexie `version(n).stores({...}).upgrade(tx => …)`; her sürüm `src/shared/db/migrations/vN.ts`; yıkıcı değişiklik yok (alan ekleme/indeks ekleme); alan silme için 2 sürüm bekle.
- `CaptureRecord` içinde `schemaVersion` yok — DB sürümü yeterli; `request` (CaptureRequest) içindeki yapı değişirse `upgrade` içinde `normalizeRequest(v)`.
- `Settings.schemaVersion` ayrı (`storage.local`), `settings/migrations.ts`.
- Test: her migration için fixture DB (önceki sürüm dump'ı JSON) → upgrade → şema/veri doğrulama (11).
- Açılışta `db.open()` hatası (`VersionError`: daha yeni DB ile eski kod — downgrade) → UI "Uzantı sürümü geri alınmış; geçmiş açılamıyor" + yedek alma linki; veri silinmez.

---

## 16. Gizlilik Notu — `REQ-HIS-170`
- History tamamen cihazda; `08` ile uyumlu. `history.enabled=false` modunda thumbnail dahil hiçbir şey yazılmaz; `tiles` geçici store'u yine kullanılır ve job sonunda silinir.
- OCR indeksi metin içeriği barındırır → "Tüm verileri sil" ve kayıt silme ile birlikte temizlenir; yedek ZIP'inde OCR JSON dosyaları (`role:'ocr'`) dahil edilir (kullanıcı seçimi).
- History UI'da URL/title `textContent` ile render edilir (XSS yok).

---

## 17. Performans Bütçeleri — `REQ-HIS-180`
| İş | Hedef |
|---|---|
| `history.list` 60 kayıt (filtresiz) | < 50 ms |
| Filtreli + `q` (10k kayıt, OCR'lı) | < 300 ms |
| Kayıt yazma (put + thumbnail + hash) | < 400 ms (SW+offscreen) |
| Bulk delete 1.000 kayıt | < 10 s, UI bloklanmaz |
| GC taraması (10k blob) | < 2 s |
| Yedek export 2 GB | streaming, bellek < 150 MB |
| Thumbnail grid 60 kart | ilk boya < 150 ms; scroll 60 fps |

---

## 18. Kabul Kriterleri
| ID | Kriter |
|---|---|
| AC-HIS-01 | Her capture sonrası kayıt listede 1 s içinde görünür; thumbnail, title, domain, tarih/saat, boyut, format, dosya boyutu, mod doğru |
| AC-HIS-02 | Arama `q="fatura"` title/url/notes/tag eşleşmelerini döndürür; OCR indeksli kayıtta görüntü içi metinle de bulur; `"sirket"` → `"şirket"` eşleşir; `İSTANBUL` → `istanbul` |
| AC-HIS-03 | Domain/tarih/format/tag/mod/starred/folder filtreleri tek tek ve birlikte doğru sonuç verir; URL hash ile durum korunur |
| AC-HIS-04 | 1.000 kayıt bulk delete: tüm blob'lar silinir (`blobs` orphan 0), OPFS dizinleri yok, `ocrDocs` temiz; UI progress gösterir |
| AC-HIS-05 | Bulk export 25 kayıt → ZIP + manifest; `format:'pdf'` combined seçeneği tek PDF üretir |
| AC-HIS-06 | "Tekrar indir" yeni download başlatır; "Klasörde göster" mevcut dosya varsa çalışır |
| AC-HIS-07 | "Original URL'yi aç" yeni sekmede açar; `javascript:` URL engellenir |
| AC-HIS-08 | Recapture: aynı URL, aynı viewport (±0 px), aynı mod/selector/delay/preset ile yeni kayıt oluşur, `source.recaptureOf` bağı var; selector kaybolmuşsa anlaşılır hata + picker önerisi |
| AC-HIS-09 | Editörde yeniden aç: annotation'lar `editorDoc`'tan geri yüklenir; `keepOriginalsAfterEdit=false` iken `full` silinir; redaction sonrası eski base hiçbir blob'da kalmaz |
| AC-HIS-10 | Kota %85'te banner, %95'te `oldest` politikası yıldızlı/evidence kayıtlarını en son siler; `never` politikasında capture kaybolmaz (geçici sonuç) |
| AC-HIS-11 | Yedek export → temiz profilde import: kayıt sayısı, thumbnail'ler, tag/folder/preset birebir; OCR yeniden indekslenebilir |
| AC-HIS-12 | "Tüm verileri sil" sonrası IDB/OPFS/storage boş; entegrasyon token'ları silinmiş |
| AC-HIS-13 | Şema v1→v2 migration fixture'ı veri kaybı olmadan geçer; downgrade'de veri korunur ve uyarı gösterilir |
| AC-HIS-14 | `history.enabled=false` iken DB'ye hiçbir kayıt/blob yazılmaz; `tiles` job sonunda boş |
| AC-HIS-15 | 10k kayıtlı DB'de liste ilk boya < 150 ms, filtreli arama < 300 ms |
