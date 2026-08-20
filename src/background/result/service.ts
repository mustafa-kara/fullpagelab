import { putBlob } from '../../shared/db/blob-ref';
import { createId } from '../../shared/ids';
import type { JobState, PageMetrics } from '../../shared/types/capture';
import type { CaptureRecord, CaptureFile } from '../../shared/types/history';
import type { BlobRef, Id, Size } from '../../shared/types/primitives';
import type { Settings } from '../../shared/types/settings';
import { createTemporaryResultStore, type TemporaryResultStore } from './temporary-store';
import type { CaptureResultInput, CaptureResultService } from './types';

interface HistoryReaderWriter {
  put(record: CaptureRecord): Promise<CaptureRecord>;
  get(id: string): Promise<CaptureRecord | undefined>;
}

export interface CaptureResultServiceOptions {
  history: HistoryReaderWriter;
  settings: () => Settings;
  temporary?: TemporaryResultStore;
  now?: () => string;
  appVersion: string;
}

interface ThumbnailResult {
  blob: Blob;
  warnings: string[];
}

function safeDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '') || 'page';
  } catch {
    return 'page';
  }
}

function fallbackSize(): Size {
  return { width: 0, height: 0 };
}

async function pngSize(blob: Blob): Promise<Size | undefined> {
  if (blob.type !== 'image/png' || blob.size < 24) return undefined;
  const bytes = new Uint8Array(await blob.slice(16, 24).arrayBuffer());
  if (bytes.length !== 8) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(0);
  const height = view.getUint32(4);
  if (width === 0 || height === 0) return undefined;
  return { width, height };
}

async function imageSize(blob: Blob, metrics?: PageMetrics): Promise<{ size: Size; cssSize: Size }> {
  if (metrics) {
    return {
      cssSize: metrics.document,
      size: { width: Math.round(metrics.document.width * metrics.dpr), height: Math.round(metrics.document.height * metrics.dpr) },
    };
  }
  const size = (await pngSize(blob)) ?? fallbackSize();
  return { size, cssSize: size };
}

async function makeThumbnail(source: Blob, maxWidth: number): Promise<ThumbnailResult> {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') {
    return { blob: new Blob([await source.arrayBuffer()], { type: source.type || 'image/png' }), warnings: ['thumbnail-fallback'] };
  }

  const bitmap = await createImageBitmap(source);
  try {
    const scale = Math.min(1, maxWidth / Math.max(1, bitmap.width), 640 / Math.max(1, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) return { blob: new Blob([await source.arrayBuffer()], { type: source.type || 'image/png' }), warnings: ['thumbnail-fallback'] };
    context.drawImage(bitmap, 0, 0, width, height);
    return { blob: await canvas.convertToBlob({ type: 'image/webp', quality: 0.8 }), warnings: [] };
  } finally {
    bitmap.close();
  }
}

function recordFiles(job: JobState, fullRef: BlobRef, stripRefs: BlobRef[], now: string): CaptureFile[] {
  const files: CaptureFile[] = [{ id: createId(), role: 'full', ref: fullRef, format: 'png', createdAt: now }];
  stripRefs.forEach((ref, index) => files.push({ id: createId(), role: 'strip', index, ref, format: 'png', createdAt: now }));
  return files;
}

function captureTitle(job: JobState, metrics?: PageMetrics): string {
  return job.request.target.title || metrics?.title || safeDomain(job.request.target.url ?? '');
}

function temporaryRef(captureId: Id, name: string, blob: Blob): BlobRef {
  return { store: 'session', key: `${captureId}:${name}`, mime: blob.type || 'application/octet-stream', bytes: blob.size };
}

export function createCaptureResultService({ history, settings, temporary = createTemporaryResultStore(), now = () => new Date().toISOString(), appVersion }: CaptureResultServiceOptions): CaptureResultService {
  return {
    async save(input: CaptureResultInput): Promise<CaptureRecord> {
      const createdAt = now();
      const captureId = createId();
      const historyEnabled = settings().history.enabled;
      const fullRef = historyEnabled ? await putBlob(input.original, { preferOpfs: input.original.size > 50 * 1024 * 1024 }) : temporaryRef(captureId, 'full', input.original);
      const stripRefs: BlobRef[] = [];
      for (const [index, strip] of (input.strips ?? []).entries()) stripRefs.push(historyEnabled ? await putBlob(strip, { preferOpfs: strip.size > 50 * 1024 * 1024 }) : temporaryRef(captureId, `strip-${index}`, strip));
      const thumbnail = await makeThumbnail(input.original, settings().history.thumbnailWidth);
      const thumbnailRef = historyEnabled ? await putBlob(thumbnail.blob, { preferOpfs: thumbnail.blob.size > 50 * 1024 * 1024 }) : temporaryRef(captureId, 'thumbnail', thumbnail.blob);
      const { size, cssSize } = await imageSize(input.original, input.metrics);
      const url = input.metrics?.url || input.job.request.target.url || 'about:blank';
      const record: CaptureRecord = {
        id: captureId,
        createdAt,
        updatedAt: createdAt,
        url,
        domain: safeDomain(url),
        title: captureTitle(input.job, input.metrics),
        mode: input.job.request.mode,
        backend: input.job.backend,
        request: structuredClone(input.job.request),
        size,
        cssSize,
        dpr: input.metrics?.dpr ?? 1,
        zoom: input.metrics?.zoom ?? 1,
        viewport: input.metrics?.viewport ?? cssSize,
        files: recordFiles(input.job, fullRef, stripRefs, createdAt),
        thumbnail: thumbnailRef,
        tags: [],
        starred: false,
        warnings: thumbnail.warnings,
        durationMs: input.durationMs,
        appVersion,
        source: {
          trigger: input.job.request.trigger,
          batchId: input.job.request.meta?.batchId,
          batchItemId: input.job.request.meta?.batchItemId,
          recaptureOf: input.job.request.meta?.recaptureOf,
          monitorRuleId: input.job.request.meta?.monitorRuleId,
        },
      };
      if (!historyEnabled) {
        const blobs = new Map<string, Blob>([[fullRef.key, input.original], [thumbnailRef.key, thumbnail.blob]]);
        for (const [index, ref] of stripRefs.entries()) {
          const strip = input.strips?.[index];
          if (strip) blobs.set(ref.key, strip);
        }
        await temporary.put(record, blobs);
        return record;
      }
      return history.put(record);
    },
    async get(id: Id): Promise<CaptureRecord | null> {
      return (await history.get(id)) ?? (await temporary.get(id)) ?? null;
    },
  };
}
