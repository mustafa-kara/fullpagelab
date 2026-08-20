import type { CaptureBackend, CaptureMode, CaptureRequest } from './capture';
import type { ExportFormat, LinkRect, TextRect } from './export';
import type { BlobRef, Id, IsoDate, Size } from './primitives';

export interface CaptureFile { id: Id; role: 'full' | 'strip' | 'pdf' | 'edited' | 'evidenceBundle' | 'bugReport' | 'diff' | 'ocr' | 'editorDoc'; index?: number; ref: BlobRef; format: ExportFormat | 'zip' | 'json'; createdAt: IsoDate; }
export interface CaptureRecordAux { links?: LinkRect[]; textRects?: TextRect[]; }
export interface CaptureRecord { id: Id; createdAt: IsoDate; updatedAt: IsoDate; url: string; domain: string; title: string; favicon?: BlobRef; mode: CaptureMode; backend: CaptureBackend; request: CaptureRequest; presetId?: Id; presetName?: string; size: Size; cssSize: Size; dpr: number; zoom: number; viewport: Size; files: CaptureFile[]; thumbnail: BlobRef; sha256?: string; tags: string[]; folderId?: Id; notes?: string; starred: boolean; ocr?: { indexedAt: IsoDate; lang: string[]; words: number }; evidence?: unknown; bugReport?: unknown; aux?: CaptureRecordAux; source: { trigger: CaptureRequest['trigger']; batchId?: Id; batchItemId?: Id; recaptureOf?: Id; editedFrom?: Id; monitorRuleId?: Id }; warnings: string[]; durationMs: number; appVersion: string; }
export interface TemporaryResultPayload { record: CaptureRecord; files: Array<{ fileId: Id; dataUrl: string }>; }
export interface CaptureRecordPatch { title?: string; tags?: string[]; folderId?: Id; notes?: string; starred?: boolean; }
export interface HistoryQuery { q?: string; domains?: string[]; tags?: string[]; folderId?: Id; modes?: CaptureMode[]; formats?: ExportFormat[]; starred?: boolean; sort: 'createdAt' | 'title' | 'domain' | 'size'; dir: 'asc' | 'desc'; cursor?: string; limit: number; }
export interface HistoryMatch { field: 'title' | 'url' | 'notes' | 'tags' | 'ocr'; snippet: string; }
export interface HistoryPage { items: Array<CaptureRecord & { matches?: HistoryMatch[] }>; nextCursor?: string; total: number; }
export interface Folder { id: Id; name: string; parentId?: Id; createdAt: IsoDate; }
export interface Tag { name: string; color?: string; count: number; }
export interface BlobRow { id: string; blob: Blob; mime: string; bytes: number; createdAt: IsoDate; refCount: number; }
export interface StorageStats { usageBytes: number; quotaBytes: number; captures: number; blobs: number; opfsBytes: number; persisted: boolean; }
export interface OcrDocRow { captureId: Id; text: string; tokens: string[]; words: unknown[]; wordsRef?: BlobRef; lang: string[]; indexedAt: IsoDate; }
export interface LogRow { id?: number; at: IsoDate; level: 'debug' | 'info' | 'warn' | 'error'; ns: string; jobId?: Id; msg: string; }
