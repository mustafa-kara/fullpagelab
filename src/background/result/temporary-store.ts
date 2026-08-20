import type { CaptureFile, CaptureRecord, TemporaryResultPayload } from '../../shared/types/history';
import type { BlobRef, Id } from '../../shared/types/primitives';
import { blobToDataUrl } from '../capture/image';

interface TemporaryEntry {
  record: CaptureRecord;
  blobs: Map<string, Blob>;
  expiresAt: number;
}

export interface TemporaryResultStore {
  put(record: CaptureRecord, blobs: Map<string, Blob>): Promise<void>;
  get(id: Id): Promise<CaptureRecord | undefined>;
  resolve(ref: BlobRef): Promise<Blob>;
  addFile(recordId: Id, file: CaptureFile, blob: Blob): Promise<CaptureRecord>;
  payload(id: Id): Promise<TemporaryResultPayload | null>;
  delete(id: Id): void;
  clearExpired(now?: number): void;
}

const MAX_AGE_MS = 30 * 60 * 1000;

export function createTemporaryResultStore(now: () => number = () => Date.now()): TemporaryResultStore {
  const entries = new Map<Id, TemporaryEntry>();

  function entry(id: Id): TemporaryEntry {
    const value = entries.get(id);
    if (!value || value.expiresAt <= now()) {
      entries.delete(id);
      throw new Error(`Temporary capture not found: ${id}`);
    }
    return value;
  }

  return {
    async put(record, blobs) {
      entries.set(record.id, { record, blobs, expiresAt: now() + MAX_AGE_MS });
    },
    async get(id) {
      try {
        return entry(id).record;
      } catch {
        return undefined;
      }
    },
    async resolve(ref) {
      const captureId = ref.key.split(':')[0];
      if (!captureId) throw new Error(`Temporary blob not found: ${ref.key}`);
      const blob = entry(captureId).blobs.get(ref.key);
      if (!blob) throw new Error(`Temporary blob not found: ${ref.key}`);
      return blob;
    },
    async addFile(recordId, file, blob) {
      const current = entry(recordId);
      current.blobs.set(file.ref.key, blob);
      current.record = { ...current.record, files: [...current.record.files, file], updatedAt: new Date(now()).toISOString() };
      return current.record;
    },
    async payload(id) {
      try {
        const current = entry(id);
        const files = await Promise.all(current.record.files.map(async (file) => ({ fileId: file.id, dataUrl: await blobToDataUrl(current.blobs.get(file.ref.key) ?? new Blob()) })));
        return { record: current.record, files };
      } catch {
        return null;
      }
    },
    delete(id) {
      entries.delete(id);
    },
    clearExpired(at = now()) {
      for (const [id, current] of entries) if (current.expiresAt <= at) entries.delete(id);
    },
  };
}
