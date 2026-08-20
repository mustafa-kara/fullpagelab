import { createId, nowIso } from '../ids';
import type { BlobRef } from '../types/primitives';
import { deleteOpfsPath, getOpfsBlob, putOpfsBlob } from './opfs';
import { db } from './schema';

const OPFS_THRESHOLD = 50 * 1024 * 1024;

export async function putBlob(blob: Blob, options: { preferOpfs?: boolean; path?: string } = {}): Promise<BlobRef> {
  const useOpfs = Boolean(options.preferOpfs || blob.size > OPFS_THRESHOLD);
  if (useOpfs) {
    const key = options.path ?? `blobs/${createId()}`;
    await putOpfsBlob(key, blob);
    return { store: 'opfs', key, mime: blob.type || 'application/octet-stream', bytes: blob.size };
  }
  const id = createId();
  await db.blobs.put({ id, blob, mime: blob.type || 'application/octet-stream', bytes: blob.size, createdAt: nowIso(), refCount: 1 });
  return { store: 'idb', key: id, mime: blob.type || 'application/octet-stream', bytes: blob.size };
}

export async function resolveBlob(ref: BlobRef): Promise<Blob> {
  if (ref.store === 'opfs') return getOpfsBlob(ref.key);
  if (ref.store === 'session') throw new Error('Session blob must be resolved by the temporary result store.');
  const row = await db.blobs.get(ref.key);
  if (!row) throw new Error(`Blob not found: ${ref.key}`);
  return row.blob;
}

export async function retain(ref: BlobRef): Promise<void> {
  if (ref.store === 'idb') await db.blobs.where('id').equals(ref.key).modify((row) => { row.refCount += 1; });
}

export async function release(ref: BlobRef): Promise<void> {
  if (ref.store === 'session') return;
  if (ref.store === 'opfs') {
    await deleteOpfsPath(ref.key);
    return;
  }
  await db.transaction('rw', db.blobs, async () => {
    const row = await db.blobs.get(ref.key);
    if (!row) return;
    if (row.refCount <= 1) await db.blobs.delete(ref.key);
    else await db.blobs.update(ref.key, { refCount: row.refCount - 1 });
  });
}
