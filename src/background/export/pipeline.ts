import { PDFDocument } from '@cantoo/pdf-lib';
import { putBlob, resolveBlob } from '../../shared/db/blob-ref';
import type { ExportFormat, ExportRequest, ExportResult, ImageEncodeOptions, DownloadOptions, PdfOptions } from '../../shared/types/export';
import type { CaptureFile, CaptureRecord } from '../../shared/types/history';
import type { BlobRef } from '../../shared/types/primitives';
import { blobToDataUrl } from '../capture/image';
import type { TemporaryResultStore } from '../result/temporary-store';
import { extensionForFormat, resolveFilename, type FilenameContext } from './filename-template';

interface HistoryExportStore {
  get(id: string): Promise<CaptureRecord | undefined>;
  addFile(recordId: string, file: CaptureFile): Promise<CaptureRecord>;
}

export interface ExportPipelineDependencies {
  history: HistoryExportStore;
  temporary?: TemporaryResultStore;
  resolve?: (ref: BlobRef) => Promise<Blob>;
  encodeImage?: (source: Blob, format: Extract<ExportFormat, 'png' | 'jpeg' | 'webp'>, options: ImageEncodeOptions) => Promise<Blob>;
  buildPdf?: (source: Blob, record: CaptureRecord, options: PdfOptions) => Promise<Blob>;
  download?: (blob: Blob, filename: string, options: DownloadOptions) => Promise<number>;
  copyClipboard?: (blob: Blob) => Promise<void>;
  now?: () => Date;
  counter?: () => number;
}

export interface ExportPipeline {
  run(request: ExportRequest): Promise<ExportResult>;
}

const defaultPdfOptions: PdfOptions = {
  mode: 'singleLongPage', pageSize: 'auto', orientation: 'auto', fit: 'width',
  marginPt: { top: 0, right: 0, bottom: 0, left: 0 }, scale: 1, smartPageBreaks: true,
  breakSearchWindowPct: 20, imageFormat: 'jpeg', imageQuality: 0.85, clickableLinks: true,
  searchableText: 'none', headerFooter: { enabled: false, header: {}, footer: {}, fontSizePt: 9, color: '#475569', heightPt: 18 },
  maxSinglePageHeightPt: 14_400,
};

function sourceFile(record: CaptureRecord, stripIndex?: number): CaptureFile {
  const edited = record.files.find((file) => file.role === 'edited');
  if (edited) return edited;
  if (stripIndex !== undefined) {
    const strip = record.files.find((file) => file.role === 'strip' && file.index === stripIndex);
    if (strip) return strip;
  }
  const full = record.files.find((file) => file.role === 'full');
  if (full) return full;
  const strip = record.files.find((file) => file.role === 'strip');
  if (strip) return strip;
  throw new Error('Capture has no exportable image file.');
}

function outputFilename(record: CaptureRecord, plan: ExportRequest['plan'], format: ExportFormat, counter: () => number, now: Date): string {
  let hostname = record.domain;
  try {
    hostname = new URL(record.url).hostname;
  } catch {
    // The stored URL can be a restricted page placeholder.
  }
  const context: FilenameContext = {
    domain: record.domain,
    hostname,
    title: record.title,
    url: record.url,
    capturedAt: now,
    width: record.size.width,
    height: record.size.height,
    viewportWidth: record.viewport.width,
    viewportHeight: record.viewport.height,
    mode: record.mode,
    format,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    counter,
  };
  const base = resolveFilename(plan.filename, context);
  return /\.[a-z0-9]{2,5}$/i.test(base) ? base : `${base}.${extensionForFormat(format)}`;
}

function downloadPath(filename: string, options: DownloadOptions): string {
  const subfolder = options.subfolder.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-').replace(/^[-. ]+|[-. ]+$/g, '');
  return subfolder ? `${subfolder}/${filename}` : filename;
}

function temporaryRef(recordId: string, format: ExportFormat, blob: Blob, counter: () => number): BlobRef {
  return { store: 'session', key: `${recordId}:export-${format}-${counter()}`, mime: blob.type || 'application/octet-stream', bytes: blob.size };
}

async function defaultDownload(blob: Blob, filename: string, options: DownloadOptions): Promise<number> {
  return chrome.downloads.download({
    url: await blobToDataUrl(blob),
    filename: downloadPath(filename, options),
    saveAs: options.saveAs,
    conflictAction: options.conflictAction,
  });
}

async function defaultEncodeImage(source: Blob, format: Extract<ExportFormat, 'png' | 'jpeg' | 'webp'>, options: ImageEncodeOptions): Promise<Blob> {
  if (format === 'png' && source.type === 'image/png' && !options.scale && !options.maxWidthPx && !options.maxHeightPx && !options.stripAlpha) return source;
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') throw new Error('Image encoding is unavailable in this context.');
  const bitmap = await createImageBitmap(source);
  try {
    const requestedScale = options.scale ?? 1;
    const maxWidthScale = options.maxWidthPx ? options.maxWidthPx / bitmap.width : 1;
    const maxHeightScale = options.maxHeightPx ? options.maxHeightPx / bitmap.height : 1;
    const scale = Math.min(requestedScale, maxWidthScale, maxHeightScale);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image encoding context is unavailable.');
    if (format !== 'png' || options.stripAlpha) {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
    }
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, width, height);
    const quality = format === 'jpeg' ? options.jpegQuality : options.webpQuality;
    return canvas.convertToBlob({ type: `image/${format}`, quality });
  } finally {
    bitmap.close();
  }
}

function pageSize(options: PdfOptions, widthPt: number, heightPt: number): { width: number; height: number } {
  if (options.pageSize === 'auto') return { width: widthPt, height: Math.min(options.maxSinglePageHeightPt, heightPt) };
  if (typeof options.pageSize === 'object') return { width: options.pageSize.widthPt, height: options.pageSize.heightPt };
  const sizes: Record<Exclude<PdfOptions['pageSize'], 'auto' | { widthPt: number; heightPt: number }>, { width: number; height: number }> = {
    A3: { width: 841.89, height: 1190.55 }, A4: { width: 595.28, height: 841.89 }, A5: { width: 419.53, height: 595.28 },
    Letter: { width: 612, height: 792 }, Legal: { width: 612, height: 1008 }, Tabloid: { width: 792, height: 1224 },
  };
  const selected = sizes[options.pageSize];
  if (options.orientation === 'landscape' || (options.orientation === 'auto' && widthPt > heightPt)) return { width: selected.height, height: selected.width };
  return selected;
}

async function defaultBuildPdf(source: Blob, record: CaptureRecord, options: PdfOptions): Promise<Blob> {
  if (source.type !== 'image/jpeg') {
    source = await defaultEncodeImage(source, 'jpeg', { jpegQuality: options.imageQuality, webpQuality: 0.9, pngCompression: 'default', stripAlpha: true });
  }
  const pdf = await PDFDocument.create();
  const image = await pdf.embedJpg(new Uint8Array(await source.arrayBuffer()));
  const widthPt = Math.max(1, record.cssSize.width * 0.75 * options.scale);
  const heightPt = Math.max(1, record.cssSize.height * 0.75 * options.scale);
  const marginWidth = options.marginPt.left + options.marginPt.right;
  const marginHeight = options.marginPt.top + options.marginPt.bottom;
  const pages = options.mode === 'singleLongPage' ? Math.max(1, Math.ceil(heightPt / options.maxSinglePageHeightPt)) : Math.max(1, Math.ceil(heightPt / Math.max(1, pageSize(options, widthPt, heightPt).height - marginHeight)));
  const selectedPage = pageSize(options, widthPt + marginWidth, Math.min(heightPt, options.maxSinglePageHeightPt) + marginHeight);
  const pageWidth = options.mode === 'singleLongPage' ? widthPt + marginWidth : selectedPage.width;
  const pageHeight = options.mode === 'singleLongPage' ? Math.min(options.maxSinglePageHeightPt, heightPt) + marginHeight : selectedPage.height;
  const renderedWidth = options.mode === 'singleLongPage' ? widthPt : Math.min(widthPt, pageWidth - marginWidth);
  const renderedHeight = heightPt * (renderedWidth / widthPt);
  const contentHeight = options.mode === 'singleLongPage' ? pageHeight - marginHeight : pageHeight - marginHeight;
  for (let index = 0; index < pages; index += 1) {
    const page = pdf.addPage([pageWidth, pageHeight]);
    const y = pageHeight - options.marginPt.top - renderedHeight + index * contentHeight;
    page.drawImage(image, { x: options.marginPt.left, y, width: renderedWidth, height: renderedHeight });
  }
  const bytes = await pdf.save();
  return new Blob([bytes], { type: 'application/pdf' });
}

export function createExportPipeline({
  history,
  temporary,
  resolve = resolveBlob,
  encodeImage = defaultEncodeImage,
  buildPdf = defaultBuildPdf,
  download = defaultDownload,
  copyClipboard,
  now = () => new Date(),
  counter = (() => { let value = 0; return () => ++value; })(),
}: ExportPipelineDependencies): ExportPipeline {
  return {
    async run(request: ExportRequest): Promise<ExportResult> {
      const persistedRecord = await history.get(request.captureId);
      const record = persistedRecord ?? (temporary ? await temporary.get(request.captureId) : undefined);
      if (!record) throw new Error(`Capture not found: ${request.captureId}`);
      const file = sourceFile(record, request.stripIndex);
      const sourceRef = request.editedRef ?? file.ref;
      let source: Blob;
      if (sourceRef.store === 'session') {
        if (!temporary) throw new Error('Temporary result storage is unavailable.');
        source = await temporary.resolve(sourceRef);
      } else {
        source = await resolve(sourceRef);
      }
      const format = request.plan.format;
      let output = source;
      if (format === 'png' || format === 'jpeg' || format === 'webp') output = await encodeImage(source, format, request.plan.image);
      else if (format === 'pdf') output = await buildPdf(source, record, { ...defaultPdfOptions, ...request.plan.pdf });
      else throw new Error(`Export format "${format}" is not available yet.`);

      const filename = outputFilename(record, request.plan, format, counter, now());
      const outputRef = output === source
        ? file.ref
        : file.ref.store === 'session' && temporary
          ? temporaryRef(record.id, format, output, counter)
          : await putBlob(output);
      if (outputRef !== file.ref) {
        const generatedFile: CaptureFile = { id: `export-${counter()}`, role: format === 'pdf' ? 'pdf' : 'full', ref: outputRef, format, createdAt: now().toISOString() };
        if (outputRef.store === 'session') {
          if (!temporary) throw new Error('Temporary result storage is unavailable.');
          await temporary.addFile(record.id, generatedFile, output);
        } else {
          await history.addFile(record.id, generatedFile);
        }
      }
      const files: ExportResult['files'] = [{ ref: outputRef, filename }];
      const warnings: string[] = [];
      if (request.plan.targets.includes('clipboard')) {
        if (!copyClipboard) warnings.push('clipboard-unavailable');
        else await copyClipboard(format === 'png' ? output : await encodeImage(source, 'png', request.plan.image));
      }
      if (request.plan.targets.includes('download')) {
        const downloadId = await download(output, filename, request.plan.download);
        const first = files[0];
        if (first) files[0] = { ...first, downloadId };
      }
      return { files, warnings };
    },
  };
}
