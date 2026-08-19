import type { CaptureRequest } from './capture';
import type { BlobRef, Rect, Size } from './primitives';

export interface DiffOptions { threshold: number; includeAA: boolean; alignment: 'top' | 'none'; ignoreRegions: Rect[]; highlightColor: string; addedColor: string; removedColor: string; clusterGapPx: number; minClusterAreaPx: number; }
export interface DiffRequest { baseRef: BlobRef; headRef: BlobRef; options: DiffOptions; }
export interface DiffResult { id?: string; baseId?: string; headId?: string; changedPixels: number; totalPixels: number; changedPct: number; regions: Array<Rect & { kind: 'changed' | 'added' | 'removed' }>; maskRef?: BlobRef; sideBySideRef?: BlobRef; sizeBase: Size; sizeHead: Size; durationMs: number; createdAt: string; warnings?: string[]; }
export interface MonitorRule { id: string; name: string; url: string; request: CaptureRequest; schedule: { everyMinutes: number; activeHours?: { from: string; to: string }; days?: number[] }; diff: DiffOptions & { notifyThresholdPct: number }; enabled: boolean; lastRunAt?: string; lastCaptureId?: string; nextRunAt?: string; keepLast: number; requiresHostPermission: true; }
