import type { CaptureMode } from './capture';
import type { BlobRef, DevicePx, Id, Pt, Rect, Size, Url } from './primitives';

export type ExportFormat = 'png' | 'jpeg' | 'webp' | 'pdf' | 'gif' | 'bmp' | 'avif';
export type ExportTarget = 'download' | 'clipboard' | 'history' | 'openResult' | 'print' | 'integration';
export interface ImageEncodeOptions { jpegQuality: number; webpQuality: number; pngCompression: 'fast' | 'default' | 'max'; maxWidthPx?: DevicePx; maxHeightPx?: DevicePx; scale?: number; stripAlpha: boolean; }
export type PdfPageSize = 'auto' | 'A4' | 'A3' | 'A5' | 'Letter' | 'Legal' | 'Tabloid' | { widthPt: Pt; heightPt: Pt };
export type HfToken = '{title}' | '{url}' | '{domain}' | '{date}' | '{time}' | '{datetime}' | '{page}' | '{pages}' | '{timezone}' | `{text:${string}}`;
export interface PdfHeaderFooter { enabled: boolean; header: { left?: HfToken[]; center?: HfToken[]; right?: HfToken[] }; footer: { left?: HfToken[]; center?: HfToken[]; right?: HfToken[] }; fontSizePt: Pt; color: string; heightPt: Pt; }
export interface PdfOptions { mode: 'singleLongPage' | 'paged'; pageSize: PdfPageSize; orientation: 'portrait' | 'landscape' | 'auto'; fit: 'width' | 'contain'; marginPt: { top: Pt; right: Pt; bottom: Pt; left: Pt }; scale: number; smartPageBreaks: boolean; breakSearchWindowPct: number; imageFormat: 'jpeg' | 'png'; imageQuality: number; clickableLinks: boolean; searchableText: 'none' | 'ocr' | 'native'; ocrLang?: string[]; headerFooter: PdfHeaderFooter; maxSinglePageHeightPt: Pt; }
export interface DownloadOptions { auto: boolean; saveAs: boolean; subfolder: string; conflictAction: 'uniquify' | 'overwrite' | 'prompt'; }
export interface EmbeddedMetadataOptions { enabled: boolean; fields: Array<'url' | 'title' | 'timestamp' | 'timezone' | 'viewport' | 'dpr' | 'userAgent' | 'sha256' | 'captureMode' | 'appVersion'>; }
export interface WatermarkOptions { kind: 'text' | 'image'; text?: string; imageRef?: BlobRef; position: 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight' | 'center' | 'tile'; opacity: number; fontSizePx?: number; color?: string; marginPx: number; rotateDeg?: number; }
export interface IntegrationSendRequest { provider: string; captureId: Id; fileRef?: BlobRef; title: string; description?: string; fields: Record<string, unknown>; includeBugReport?: boolean; includeEvidence?: boolean; }
export interface ExportPlan { targets: ExportTarget[]; format: ExportFormat; image: ImageEncodeOptions; pdf?: PdfOptions; filename: string; download: DownloadOptions; multiImage: 'zip' | 'separate' | 'pdfPages'; metadata: EmbeddedMetadataOptions; watermark?: WatermarkOptions; integration?: IntegrationSendRequest; }
export interface LinkRect { href: Url; rect: Rect; frameId?: number; }
export interface TextRect { rect: Rect; kind: 'textLine' | 'image' | 'block' | 'heading'; text?: string; level?: number; }
export interface ExportRequest { captureId: Id; plan: ExportPlan; stripIndex?: number; editedRef?: BlobRef; }
export interface ExportResult { files: Array<{ ref: BlobRef; filename: string; downloadId?: number }>; warnings: string[]; }
export interface PdfBuildRequest { jobId?: Id; images: Array<{ ref: BlobRef; cssWidth: number; cssHeight: number; dpr: number }>; options: PdfOptions; links?: LinkRect[]; textRects?: TextRect[]; context: { url: Url; title: string; domain: string; capturedAt: string; timezone: string }; }
export interface ZipRequest { entries: Array<{ name: string; ref: BlobRef }>; level: 0 | 1 | 6; comment?: string; }
export interface TemplateContext { url: string; title: string; capturedAt: Date; timezone: string; width: number; height: number; viewport: Size; mode: CaptureMode; preset?: string; format: string; tabIndex?: number; batchIndex?: number; batchName?: string; itemName?: string; attempt?: number; strip?: number; counter: () => number; page?: number; pages?: number; }
