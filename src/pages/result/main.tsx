import { render } from 'preact';
import type { JSX } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { createDocument } from '../../lib/editor/document';
import { resolveBlob } from '../../shared/db/blob-ref';
import { t } from '../../shared/i18n';
import { sendMessage } from '../../shared/messages';
import type { ExportFormat, ExportPlan, PdfOptions } from '../../shared/types/export';
import type { CaptureFile, CaptureRecord } from '../../shared/types/history';
import { EditorPanel } from './editor-panel';
import '../../ui/tokens.css';
import './result.css';

type ResultFormat = Extract<ExportFormat, 'png' | 'jpeg' | 'webp' | 'pdf'>;
type BusyAction = 'download' | 'copy' | null;

const formats: Array<{ id: ResultFormat; label: string; extension: string }> = [
  { id: 'png', label: 'PNG', extension: 'png' },
  { id: 'jpeg', label: 'JPEG', extension: 'jpg' },
  { id: 'webp', label: 'WebP', extension: 'webp' },
  { id: 'pdf', label: 'PDF', extension: 'pdf' },
];

const defaultPdf: PdfOptions = {
  mode: 'singleLongPage', pageSize: 'auto', orientation: 'auto', fit: 'width',
  marginPt: { top: 0, right: 0, bottom: 0, left: 0 }, scale: 1, smartPageBreaks: true,
  breakSearchWindowPct: 20, imageFormat: 'jpeg', imageQuality: 0.85, clickableLinks: true,
  searchableText: 'none', headerFooter: { enabled: false, header: {}, footer: {}, fontSizePt: 9, color: '#475569', heightPt: 18 },
  maxSinglePageHeightPt: 14_400,
};

function extensionFor(format: ResultFormat): string {
  return formats.find((item) => item.id === format)?.extension ?? format;
}

function filenameForFormat(value: string, format: ResultFormat): string {
  const withoutExtension = value.replace(/\.(png|jpe?g|webp|pdf)$/i, '');
  return `${withoutExtension}.${extensionFor(format)}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[index]}`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function resultFiles(record: CaptureRecord): CaptureFile[] {
  return record.files
    .filter((file) => file.role === 'full' || file.role === 'strip' || file.role === 'edited')
    .sort((left, right) => (left.index ?? -1) - (right.index ?? -1));
}

async function toPng(source: Blob): Promise<Blob> {
  if (source.type === 'image/png') return source;
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') throw new Error(t('error.E_CLIPBOARD.body'));
  const bitmap = await createImageBitmap(source);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error(t('error.E_CLIPBOARD.body'));
    context.drawImage(bitmap, 0, 0);
    return canvas.convertToBlob({ type: 'image/png' });
  } finally {
    bitmap.close();
  }
}

function ResultPage({ captureId }: { captureId: string }): JSX.Element {
  const [record, setRecord] = useState<CaptureRecord | null>(null);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [selectedStrip, setSelectedStrip] = useState(0);
  const [format, setFormat] = useState<ResultFormat>('png');
  const [plan, setPlan] = useState<ExportPlan | null>(null);
  const [zoom, setZoom] = useState(100);
  const [showPdfOptions, setShowPdfOptions] = useState(false);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let urls: string[] = [];
    setLoading(true);
    setError('');
    void Promise.all([sendMessage('history.get', { id: captureId }), sendMessage('settings.get', undefined)])
      .then(async ([nextRecord, nextSettings]) => {
        if (!nextRecord) throw new Error(t('error.E_UNKNOWN.body'));
        const files = resultFiles(nextRecord);
        const temporaryPayload = nextRecord.files.some((file) => file.ref.store === 'session') ? await sendMessage('result.get', { id: captureId }) : null;
        const temporaryUrls = new Map(temporaryPayload?.files.map((file) => [file.fileId, file.dataUrl]) ?? []);
        urls = await Promise.all(files.map(async (file) => {
          if (file.ref.store === 'session') {
            const dataUrl = temporaryUrls.get(file.id);
            if (!dataUrl) throw new Error(t('error.E_STORAGE_QUOTA.body'));
            return dataUrl;
          }
          return URL.createObjectURL(await resolveBlob(file.ref));
        }));
        if (cancelled) {
          urls.forEach((url) => URL.revokeObjectURL(url));
          return;
        }
        const nextFormat: ResultFormat = nextSettings.export.format === 'jpeg' || nextSettings.export.format === 'webp' || nextSettings.export.format === 'pdf' ? nextSettings.export.format : 'png';
        setRecord(nextRecord);
        setFormat(nextFormat);
        setPlan({ ...structuredClone(nextSettings.export), format: nextFormat, filename: filenameForFormat(nextSettings.export.filename, nextFormat), pdf: { ...defaultPdf, ...nextSettings.export.pdf } });
        setImageUrls(urls);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : t('error.E_UNKNOWN.body'));
        setLoading(false);
      });
    return () => {
      cancelled = true;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [captureId]);

  const files = useMemo(() => record ? resultFiles(record) : [], [record]);
  const currentFile = files[selectedStrip] ?? files[0];
  // Keep one document identity per image: the editor rebuilds itself whenever
  // this value changes, so a fresh object on every render would loop forever.
  const editorDoc = useMemo(
    () => currentFile && record ? createDocument({ captureId, base: { ref: currentFile.ref, size: record.size } }) : null,
    [captureId, currentFile, record],
  );

  const chooseFormat = (nextFormat: ResultFormat): void => {
    setFormat(nextFormat);
    setPlan((current) => current ? { ...current, format: nextFormat, filename: filenameForFormat(current.filename, nextFormat), pdf: { ...defaultPdf, ...current.pdf } } : current);
  };

  const updatePlan = (patch: Partial<ExportPlan>): void => setPlan((current) => current ? { ...current, ...patch } : current);
  const updatePdf = (patch: Partial<PdfOptions>): void => setPlan((current) => current ? { ...current, pdf: { ...defaultPdf, ...current.pdf, ...patch } } : current);

  const download = async (): Promise<void> => {
    if (!plan) return;
    setBusy('download');
    setToast('');
    try {
      await sendMessage('export.request', { captureId, plan: { ...plan, targets: ['download'], format } });
      setToast(t('ui.result.export.downloaded'));
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : t('error.E_EXPORT.body'));
    } finally {
      setBusy(null);
    }
  };

  const copy = async (): Promise<void> => {
    if (!currentFile) return;
    setBusy('copy');
    setToast('');
    try {
      if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error(t('error.E_CLIPBOARD.body'));
      const imageUrl = imageUrls[selectedStrip] ?? imageUrls[0];
      if (!imageUrl) throw new Error(t('error.E_CLIPBOARD.body'));
      const response = await fetch(imageUrl);
      const blob = await toPng(await response.blob());
      if (blob.size > 100 * 1024 * 1024) throw new Error(t('error.E_CLIPBOARD.body'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setToast(t('ui.result.export.copiedPng'));
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : t('error.E_CLIPBOARD.body'));
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <main class="result-page result-loading" aria-busy="true"><div class="result-skeleton" /><div class="result-skeleton result-skeleton-short" /></main>;
  if (error || !record || !plan || imageUrls.length === 0) return <main class="result-page"><section class="result-error" role="alert"><h1>{t('ui.result.errorTitle')}</h1><p>{error || t('error.E_EXPORT.body')}</p><button type="button" onClick={() => window.location.reload()}>{t('common.retry')}</button></section></main>;

  const currentUrl = imageUrls[selectedStrip] ?? imageUrls[0];
  const meta = `${record.size.width.toLocaleString()} × ${record.size.height.toLocaleString()} · ${t(`ui.capture.mode.${record.mode}`)} · ${formatDate(record.createdAt)} · ${formatBytes(record.files.reduce((sum, file) => sum + file.ref.bytes, 0))}`;

  return <main class="result-page">
    <header class="result-header">
      <div class="result-brand"><button class="icon-button" type="button" aria-label={t('ui.result.back')} onClick={() => window.history.back()}>←</button><span class="brand-mark">F</span><strong>FullPageLab</strong></div>
      <div class="result-heading"><h1 data-testid="result-title">{record.title}</h1><a href={record.url} target="_blank" rel="noreferrer">{record.domain}</a></div>
      <div class="result-header-actions"><button class="button button-quiet" type="button" data-testid="result-edit" onClick={() => setEditing(true)}>{t('ui.result.edit')}</button><button class="button button-quiet" type="button" onClick={() => setToast(t('ui.result.recaptureUnavailable'))}>{t('ui.result.recapture')}</button></div>
    </header>
    <div class="result-meta" aria-label={t('ui.result.metadata')}><span>{meta}</span>{record.warnings.length > 0 && <span class="warning-badge">{t('ui.result.warning')}</span>}</div>
    {record.warnings.length > 0 && <div class="result-warning" role="status">{record.warnings.map((warning) => <span key={warning}>{warning}</span>)}</div>}

    <div class="result-layout">
      {editing && editorDoc
        ? <EditorPanel
            captureId={captureId}
            doc={editorDoc}
            imageUrl={currentUrl}
            onClose={(saved) => { setEditing(false); if (saved) window.location.search = `?id=${saved.captureId}`; }}
          />
        : <section class="viewer-column" aria-label={t('ui.result.preview')}>
        <div class="viewer-toolbar">
          <div class="viewer-toolbar-group"><button type="button" class="button button-quiet" onClick={() => setZoom(100)}>{t('ui.result.viewer.fit')}</button><button type="button" class="icon-button" aria-label={t('ui.result.viewer.zoomOut')} onClick={() => setZoom((value) => Math.max(25, value - 25))}>−</button><span class="zoom-value">{zoom}%</span><button type="button" class="icon-button" aria-label={t('ui.result.viewer.zoomIn')} onClick={() => setZoom((value) => Math.min(300, value + 25))}>+</button></div>
          {files.length > 1 && <div class="strip-nav"><button type="button" class="icon-button" aria-label={t('ui.result.viewer.previous')} disabled={selectedStrip === 0} onClick={() => setSelectedStrip((value) => Math.max(0, value - 1))}>←</button><span>{selectedStrip + 1} / {files.length}</span><button type="button" class="icon-button" aria-label={t('ui.result.viewer.next')} disabled={selectedStrip === files.length - 1} onClick={() => setSelectedStrip((value) => Math.min(files.length - 1, value + 1))}>→</button></div>}
        </div>
        <div class="viewer-stage" data-testid="result-viewer"><img src={currentUrl} alt={`${record.title} ${t(`ui.capture.mode.${record.mode}`)} screenshot`} style={{ width: `${zoom}%` }} /></div>
          </section>}

      <aside class="export-panel" aria-label={t('ui.result.export.title')}>
        <div class="panel-heading"><span class="eyebrow">{t('ui.result.export.eyebrow')}</span><h2>{t('ui.result.export.title')}</h2></div>
        <div class="format-control" role="radiogroup" aria-label={t('ui.result.export.format')}>
          {formats.map((item) => <button key={item.id} type="button" data-format={item.id} class={format === item.id ? 'format-option active' : 'format-option'} role="radio" aria-checked={format === item.id} onClick={() => chooseFormat(item.id)}>{item.label}</button>)}
        </div>
        {format !== 'pdf' && <label class="field"><span>{t('ui.result.export.filename')}</span><input data-testid="filename-input" type="text" value={plan.filename} onInput={(event) => updatePlan({ filename: (event.currentTarget as HTMLInputElement).value })} /></label>}
        {format !== 'pdf' && <label class="field"><span>{t('ui.result.export.quality')} <strong>{Math.round((format === 'jpeg' ? plan.image.jpegQuality : plan.image.webpQuality) * 100)}%</strong></span><input type="range" min="50" max="100" value={Math.round((format === 'jpeg' ? plan.image.jpegQuality : plan.image.webpQuality) * 100)} disabled={format === 'png'} onInput={(event) => { const quality = Number((event.currentTarget as HTMLInputElement).value) / 100; updatePlan({ image: { ...plan.image, jpegQuality: format === 'jpeg' ? quality : plan.image.jpegQuality, webpQuality: format === 'webp' ? quality : plan.image.webpQuality } }); }} /></label>}
        {format === 'pdf' && <button type="button" class="accordion-trigger" aria-expanded={showPdfOptions} onClick={() => setShowPdfOptions((value) => !value)}>{t('ui.result.export.pdfOptions')}<span>{showPdfOptions ? '−' : '+'}</span></button>}
        {format === 'pdf' && showPdfOptions && <div class="pdf-options"><label class="field"><span>{t('ui.result.export.pdfMode')}</span><select value={plan.pdf?.mode ?? defaultPdf.mode} onChange={(event) => updatePdf({ mode: (event.currentTarget as HTMLSelectElement).value as PdfOptions['mode'] })}><option value="singleLongPage">{t('ui.result.export.singleLongPage')}</option><option value="paged">{t('ui.result.export.paged')}</option></select></label><label class="field"><span>{t('ui.result.export.pageSize')}</span><select value={typeof plan.pdf?.pageSize === 'string' ? plan.pdf.pageSize : 'auto'} onChange={(event) => updatePdf({ pageSize: (event.currentTarget as HTMLSelectElement).value as PdfOptions['pageSize'] })}><option value="auto">{t('ui.result.export.auto')}</option><option value="A4">A4</option><option value="Letter">Letter</option><option value="Legal">Legal</option></select></label><label class="check-field"><input type="checkbox" checked={plan.pdf?.smartPageBreaks ?? true} onChange={(event) => updatePdf({ smartPageBreaks: (event.currentTarget as HTMLInputElement).checked })} /><span>{t('ui.result.export.smartBreaks')}</span></label></div>}
        <div class="filename-preview"><span>{t('ui.result.export.preview')}</span><strong>{filenameForFormat(plan.filename, format)}</strong></div>
        <div class="export-actions"><button data-testid="download-button" class="button button-primary" type="button" disabled={busy !== null} onClick={() => void download()}>{busy === 'download' ? t('common.working') : `${formats.find((item) => item.id === format)?.label} ${t('ui.result.export.download')}`}</button><button class="button button-secondary" type="button" disabled={busy !== null} onClick={() => void copy()}>{busy === 'copy' ? t('common.working') : t('ui.result.export.copy')}</button></div>
        <div class="panel-links"><button type="button" onClick={() => window.print()}>{t('ui.result.print')}</button><button type="button" onClick={() => setEditing(true)}>{t('ui.result.edit')}</button></div>
        <p class="privacy-note">{t('privacy_tagline')}</p>
      </aside>
    </div>
    {toast && <div class="toast" role="status" aria-live="polite">{toast}</div>}
  </main>;
}

const resultId = new URLSearchParams(window.location.search).get('id');
if (resultId) render(<ResultPage captureId={resultId} />, document.getElementById('app')!);

export { ResultPage };
