# Popup Job Detach Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** FullPageLab popup'ının yakalama başlar başlamaz kapanmasını ve yakalama işinin service worker içinde bağımsız olarak sürmesini sağlamak.

**Architecture:** Coordinator, job oluşturma/doğrulama adımını uzun süren capture işleminden ayıracak. Background mesaj yöneticisi detached başlangıç metodundan hemen `{ jobId }` dönecek; mevcut `run(job)` akışı storage.session güncellemelerini sürdürerek capture, stitch, export ve restore adımlarını tamamlayacak. Popup başarılı başlangıç cevabından sonra `window.close()` çağıracak; başlangıç hatasında açık kalıp hatayı gösterecek.

**Tech Stack:** TypeScript, Chrome MV3 service worker, Preact popup, Vitest, mevcut `JobStateStore` ve mesaj zarfı.

---

### Task 1: Coordinator için detached job başlangıcı

**Files:**
- Modify: `src/background/capture/coordinator.ts`
- Test: `test/unit/task6.test.ts`

- [x] **Step 1: Detached başlangıcın önce başarısız testini yaz**

`test/unit/task6.test.ts` içine, ertelenmiş `captureVisibleTab` kullanan bir test ekle. Test `startDetached()` çağrısının capture promise'i çözülmeden `{ jobId }` döndürdüğünü ve job'ın tamamlanmasından sonra `done` olduğunu doğrulasın:

```ts
it('returns a job id before a detached capture completes', async () => {
  const states: JobState[] = [];
  const jobs = createJobs(states);
  let releaseCapture: ((value: string) => void) | undefined;
  const capture = new Promise<string>((resolve) => { releaseCapture = resolve; });
  const tab = { id: 7, windowId: 3, url: 'https://example.com/docs' };
  const platform: CapturePlatform = {
    queryActiveTab: vi.fn(async () => tab),
    captureVisibleTab: vi.fn(() => capture),
    download: vi.fn(async () => 1),
  };
  const coordinator = createCaptureCoordinator({ platform, jobs, now: () => '2026-08-20T00:00:00.000Z' });

  const start = coordinator.startDetached({ mode: 'visible', settings: structuredClone(defaultSettings) });
  await vi.waitFor(() => expect(platform.captureVisibleTab).toHaveBeenCalled());
  const result = await start;

  expect(result.jobId).toBeTruthy();
  expect(states.at(-1)?.phase).toBe('capturing');
  releaseCapture?.('data:image/png;base64,AAAA');
  await vi.waitFor(() => expect(states.at(-1)?.phase).toBe('done'));
});
```

- [x] **Step 2: Testi çalıştır ve mevcut API eksikliğini doğrula**

Run: `pnpm exec vitest run test/unit/task6.test.ts -t "detached capture"`

Expected: FAIL because `startDetached` is not defined.

- [x] **Step 3: Job oluşturmayı ortaklaştır ve detached metodu ekle**

`src/background/capture/coordinator.ts` içinde tab doğrulama, `initialJob` oluşturma ve `jobs.put` adımlarını ortak bir `createJob(input)` fonksiyonuna taşı. Mevcut `start` metodu bu fonksiyondan aldığı job için `await run(job)` davranışını korusun. Aynı closure içinde şu detached metodu ekle:

```ts
async function startDetached(input: CaptureStartInput): Promise<CaptureStartResult> {
  const job = await createJob(input);
  void run(job);
  return { jobId: job.jobId };
}
```

Döndürülen coordinator nesnesinde `startDetached` metodunu `start` ve `cancel` ile birlikte dışa aç. `run(job)` zaten hata durumunu job state'e yazdığı için detached promise'in unhandled rejection üretmemesini koru.

- [x] **Step 4: Detached testi çalıştır**

Run: `pnpm exec vitest run test/unit/task6.test.ts -t "detached capture"`

Expected: PASS.

### Task 2: Background mesajı ve popup kapanışı

**Files:**
- Modify: `src/background/index.ts`
- Modify: `src/pages/popup/main.tsx`
- Test: `test/unit/task6.test.ts`

- [x] **Step 1: Background mesajını detached başlangıca bağla**

`src/background/index.ts` içindeki `capture.start` case'inde uzun süren `captureCoordinator.start(...)` çağrısını `captureCoordinator.startDetached(...)` ile değiştir. `sendResponse(reply(message, result))` yalnızca job oluşturma/doğrulama tamamlandıktan hemen sonra çalışsın; capture akışını beklemesin.

- [x] **Step 2: Popup davranışını başarılı başlangıçtan sonra kapat**

`src/pages/popup/main.tsx` içindeki `startCapture` fonksiyonunda `capture.start` cevabı alındıktan sonra durum metni veya indirme tamamlandı mesajı göstermeden `window.close()` çağır:

```ts
const result = await sendMessage('capture.start', { mode });
setJobs((current) => current.filter((job) => job.jobId !== result.jobId));
window.close();
```

`catch` bloğu değişmeden kalmalı; başlangıç reddedilirse popup açık kalıp hatayı göstermeli. `finally` yalnızca popup kapanamayan test/normal sayfa bağlamlarında state'i temizlemeye devam etmeli.

- [x] **Step 3: Mesaj akışı için mevcut testleri çalıştır**

Run: `pnpm test`

Expected: Tüm testler PASS; detached job testi dahil test sayısı 45 olmalı.

### Task 3: Doğrulama ve dokümantasyon

**Files:**
- Modify: `docs/progress.md`

- [x] **Step 1: Çalışan akış dokümantasyonunu güncelle**

`docs/progress.md` içinde popup'ın `{ jobId }` cevabından sonra kapandığını ve job'ın `storage.session`/service worker akışında sürdüğünü belirten bir madde ekle. İlerleme durumu satırındaki test sayısını gerçek sonuçla eşleştir.

- [x] **Step 2: Kalite kontrollerini çalıştır**

Run:

```text
pnpm test
pnpm typecheck
pnpm lint
pnpm build:all
pnpm check:manifest
pnpm check:content-assets
git diff --check
```

Expected: 45 test PASS, typecheck/lint/build/manifest/content-agent kontrolleri PASS; `git diff --check` yalnızca mevcut satır sonu uyarılarını üretir.

- [x] **Step 3: UTF-8 denetimini tamamla**

Değişen metin dosyalarında BOM, replacement karakteri, mojibake ve ASCII'leştirilmiş Türkçe karakter kalmadığını kontrol et; tüm metinleri UTF-8 BOM'suz bırak.
