import { release } from '../../shared/db/blob-ref';
import { getOpfsBytes } from '../../shared/db/opfs';
import { db } from '../../shared/db/schema';
import type { CaptureRecord, CaptureRecordPatch, HistoryPage, HistoryQuery, StorageStats } from '../../shared/types/history';
import type { BlobRef } from '../../shared/types/primitives';

function refs(record: CaptureRecord): BlobRef[] {
  return [record.thumbnail, ...record.files.map((file) => file.ref), ...(record.favicon ? [record.favicon] : [])];
}

function cursorFor(record: CaptureRecord): string {
  return btoa(JSON.stringify([record.createdAt, record.id]));
}

function parseCursor(cursor?: string): [string, string] | undefined {
  if (!cursor) return undefined;
  const value = JSON.parse(atob(cursor)) as unknown;
  if (!Array.isArray(value) || typeof value[0] !== 'string' || typeof value[1] !== 'string') throw new Error('Invalid history cursor');
  return [value[0], value[1]];
}

function matches(record: CaptureRecord, query: HistoryQuery): boolean {
  if (query.domains?.length && !query.domains.includes(record.domain)) return false;
  if (query.tags?.length && !query.tags.every((tag) => record.tags.includes(tag))) return false;
  if (query.modes?.length && !query.modes.includes(record.mode)) return false;
  if (query.formats?.length && !record.files.some((file) => query.formats?.some((format) => file.format === format))) return false;
  if (query.starred !== undefined && record.starred !== query.starred) return false;
  if (query.folderId !== undefined && record.folderId !== query.folderId) return false;
  if (!query.q) return true;
  const haystack = `${record.title} ${record.url} ${record.notes ?? ''} ${record.tags.join(' ')}`.toLocaleLowerCase();
  return query.q.toLocaleLowerCase().split(/\s+/).filter(Boolean).every((term) => haystack.includes(term));
}

export function createHistoryService() {
  const put = async (record: CaptureRecord): Promise<CaptureRecord> => {
    await db.captures.put(record);
    return record;
  };
  const get = async (id: string): Promise<CaptureRecord | undefined> => db.captures.get(id);
  const update = async (id: string, patch: CaptureRecordPatch): Promise<CaptureRecord> => {
    const record = await db.captures.get(id);
    if (!record) throw new Error(`Capture not found: ${id}`);
    const next = { ...record, ...patch, updatedAt: new Date().toISOString() };
    await db.captures.put(next);
    return next;
  };
  const list = async (query: HistoryQuery): Promise<HistoryPage> => {
    const cursor = parseCursor(query.cursor);
    let collection = db.captures.orderBy('createdAt');
    if (query.dir === 'desc') collection = collection.reverse();
    const items = await collection.filter((record) => {
      if (cursor) {
        const [createdAt, id] = cursor;
        const after = query.dir === 'desc' ? record.createdAt < createdAt || (record.createdAt === createdAt && record.id < id) : record.createdAt > createdAt || (record.createdAt === createdAt && record.id > id);
        if (!after) return false;
      }
      return matches(record, query);
    }).limit(query.limit + 1).toArray();
    const pageItems = items.slice(0, query.limit);
    return { items: pageItems, nextCursor: items.length > query.limit ? cursorFor(pageItems.at(-1) as CaptureRecord) : undefined, total: await db.captures.count() };
  };
  const deleteRecords = async (ids: string[]): Promise<number> => {
    let deleted = 0;
    for (let offset = 0; offset < ids.length; offset += 100) {
      const chunk = ids.slice(offset, offset + 100);
      const records = await db.captures.bulkGet(chunk);
      await db.transaction('rw', [db.captures, db.ocrDocs, db.editorDocs, db.blobs], async () => {
        await db.captures.bulkDelete(chunk);
        await db.ocrDocs.bulkDelete(chunk);
        await db.editorDocs.bulkDelete(chunk);
      });
      for (const record of records) for (const ref of record ? refs(record) : []) await release(ref);
      deleted += records.filter(Boolean).length;
    }
    return deleted;
  };
  const gc = async (activeJobIds: string[] = []): Promise<number> => {
    const referenced = new Set<string>();
    for (const record of await db.captures.toArray()) for (const ref of refs(record)) if (ref.store === 'idb') referenced.add(ref.key);
    for (const row of await db.blobs.toArray()) if (!referenced.has(row.id) || row.refCount <= 0) await db.blobs.delete(row.id);
    await db.tiles.filter((tile) => !activeJobIds.includes(tile.jobId)).delete();
    return (await db.blobs.count());
  };
  const stats = async (): Promise<StorageStats> => {
    const estimate = await navigator.storage.estimate();
    return { usageBytes: estimate.usage ?? 0, quotaBytes: estimate.quota ?? 0, captures: await db.captures.count(), blobs: await db.blobs.count(), opfsBytes: await getOpfsBytes(), persisted: await navigator.storage.persisted() };
  };
  return { put, get, update, list, delete: deleteRecords, gc, stats };
}
