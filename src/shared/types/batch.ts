import type { CaptureMode, CaptureOptions, WaitConditions } from './capture';
import type { ExportPlan } from './export';
import type { BlobRef, ErrorInfo, Id, IsoDate, Millis, Size, Url } from './primitives';

export interface BatchJobInput { name?: string; source: { kind: 'urls'; urls: Url[] } | { kind: 'tabs'; tabIds: number[] } | { kind: 'sitemap'; url: Url }; mode: Exclude<CaptureMode, 'selection' | 'allTabs' | 'browserWindow'>; selector?: string; capture: Partial<CaptureOptions>; wait: WaitConditions & { pageLoad: 'domcontentloaded' | 'load' }; export: ExportPlan & { combine: 'none' | 'singlePdf' | 'zip' | 'zipAndPdf' }; control: BatchControl; presetId?: Id; qa?: { enabled: boolean; thresholdPct: number; baselineTag: string }; }
export interface BatchControl { concurrency: 1 | 2 | 3; perItemTimeoutMs: Millis; retry: { max: number; backoffMs: Millis }; delayBetweenMs: Millis; closeTabsAfter: boolean; useIncognito: boolean; windowSize?: Size; stopOnError: boolean; fallbackToFullPage: boolean; pdfChunkSize: number; }
export type BatchStatus = 'queued' | 'running' | 'paused' | 'completed' | 'completedWithErrors' | 'cancelled' | 'failed';
export interface BatchItem { id: Id; index: number; url: Url; itemName?: string; status: 'queued' | 'running' | 'done' | 'failed' | 'skipped' | 'cancelled'; attempts: number; notBefore?: IsoDate; tabId?: number; windowId?: number; captureId?: Id; error?: ErrorInfo; startedAt?: IsoDate; finishedAt?: IsoDate; durationMs?: Millis; }
export interface BatchLogLine { at: IsoDate; level: 'info' | 'warn' | 'error'; itemId?: Id; msg: string; }
export interface BatchJob { id: Id; name: string; input: BatchJobInput; status: BatchStatus; createdAt: IsoDate; startedAt?: IsoDate; finishedAt?: IsoDate; items: BatchItem[]; summary: { total: number; done: number; failed: number; skipped: number }; outputs: Array<{ kind: 'zip' | 'pdf' | 'file'; ref: BlobRef; filename: string; downloadId?: number }>; log: BatchLogLine[]; }
export type BatchEvent = { batchId: Id; kind: 'status' | 'item' | 'log' | 'output'; job?: BatchJob; item?: BatchItem; line?: BatchLogLine };
