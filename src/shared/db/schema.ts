import Dexie, { type Table } from 'dexie';
import type { BatchItem, BatchJob } from '../types/batch';
import type { TileRecord } from '../types/capture';
import type { DiffResult, MonitorRule } from '../types/diff';
import type { EditorDocument } from '../types/editor';
import type { CaptureRecord, BlobRow, Folder, LogRow, OcrDocRow, Tag } from '../types/history';
import type { Preset } from '../types/presets';

export class SsxDb extends Dexie {
  captures!: Table<CaptureRecord, string>;
  blobs!: Table<BlobRow, string>;
  tiles!: Table<TileRecord, string>;
  batches!: Table<BatchJob, string>;
  batchItems!: Table<BatchItem & { batchId: string }, string>;
  diffs!: Table<DiffResult & { id: string }, string>;
  ocrDocs!: Table<OcrDocRow, string>;
  editorDocs!: Table<EditorDocument, string>;
  tags!: Table<Tag, string>;
  folders!: Table<Folder, string>;
  presets!: Table<Preset, string>;
  monitors!: Table<MonitorRule, string>;
  logs!: Table<LogRow, number>;

  constructor() {
    super('ssx');
    this.version(1).stores({
      captures: 'id, createdAt, domain, *tags, folderId, mode, starred, url, [domain+createdAt], [folderId+createdAt], [starred+createdAt]',
      blobs: 'id, createdAt, refCount, bytes',
      tiles: 'id, jobId, [jobId+index]',
      batches: 'id, status, createdAt',
      batchItems: 'id, batchId, [batchId+index], status',
      diffs: 'id, baseId, headId, createdAt, [baseId+headId]',
      ocrDocs: 'captureId, *tokens, indexedAt',
      editorDocs: 'captureId, updatedAt',
      tags: 'name, count',
      folders: 'id, parentId, name',
      presets: 'id, name, builtin',
      monitors: 'id, url, enabled, nextRunAt',
      logs: '++id, at, level, jobId',
    });
  }
}

export const db = new SsxDb();
