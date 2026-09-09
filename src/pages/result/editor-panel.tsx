import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { EditorHandle } from '../../editor/editor-core';
import { createEditor } from '../../editor/index';
import { t } from '../../shared/i18n';
import { sendMessage } from '../../shared/messages';
import type { EditorDocument, ToolId } from '../../shared/types/editor';

const tools: ToolId[] = ['select', 'arrow', 'rect', 'ellipse', 'line', 'freehand', 'text', 'highlight', 'blur', 'pixelate', 'redact'];

export interface EditorPanelProps {
  doc: EditorDocument;
  captureId: string;
  /** The URL the result page already resolved, so session-stored captures load too. */
  imageUrl?: string;
  onClose(saved?: { captureId: string }): void;
}

export function EditorPanel({ doc, captureId, imageUrl, onClose }: EditorPanelProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<EditorHandle | null>(null);
  const [tool, setTool] = useState<ToolId>('select');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoomValue] = useState(1);

  useEffect(() => {
    let disposed = false;
    const element = canvasRef.current;
    if (!element) return;
    setFailed(false);
    // The stage is what the capture has to fit inside when the editor opens.
    const stage = stageRef.current?.getBoundingClientRect();
    const viewport = stage ? { width: Math.max(1, stage.width - 40), height: Math.max(1, stage.height - 40) } : undefined;
    void createEditor(element, doc, { imageUrl, viewport }).then((handle) => {
      if (disposed) { handle.dispose(); return; }
      handleRef.current = handle;
      setZoomValue(handle.getZoom());
      // Tools and Save only work once the canvas exists, so the toolbar advertises readiness for tests and screen readers.
      setReady(true);
    }).catch((error: unknown) => {
      if (disposed) return;
      // A failure here used to leave an empty stage that still looked usable.
      // Surface it so the editor never silently shows a blank canvas.
      setFailed(true);
      setMessage(error instanceof Error ? error.message : t('error.E_UNKNOWN.body'));
    });
    return () => {
      disposed = true;
      setReady(false);
      handleRef.current?.dispose();
      handleRef.current = null;
    };
  }, [doc, imageUrl]);

  const changeZoom = (next: number): void => {
    const handle = handleRef.current;
    if (!handle) return;
    handle.setZoom(next);
    setZoomValue(handle.getZoom());
  };

  const chooseTool = (next: ToolId): void => {
    setTool(next);
    handleRef.current?.setTool(next);
  };

  const save = async (): Promise<void> => {
    const handle = handleRef.current;
    if (!handle) return;
    setBusy(true);
    setMessage('');
    try {
      // toDataUrl() flattens at image resolution; the raw canvas method would bake in the on-screen zoom.
      const result = await sendMessage('editor.save', {
        captureId,
        doc: handle.getDocument(),
        flattened: { dataUrl: handle.toDataUrl(), mime: 'image/png' },
        saveAsNew: true,
      });
      setMessage(t('ui.editor.saved'));
      onClose(result);
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : t('error.E_UNKNOWN.body'));
    } finally {
      setBusy(false);
    }
  };

  const privacyNote = tool === 'blur' || tool === 'pixelate' ? t('ui.editor.blurWarning') : tool === 'redact' ? t('ui.editor.redactWarning') : t('ui.editor.keepOriginal');

  return <section class="editor-panel" aria-label={t('ui.editor.title')}>
    <div class="editor-toolbar" data-testid="editor-toolbar" data-ready={ready ? 'true' : 'false'} role="toolbar" aria-label={t('ui.editor.title')} aria-busy={!ready}>
      {tools.map((item) => <button key={item} type="button" data-tool={item} class={tool === item ? 'editor-tool active' : 'editor-tool'} aria-pressed={tool === item} onClick={() => chooseTool(item)}>{t(`ui.editor.tool.${item}`)}</button>)}
      <span class="editor-toolbar-spacer" />
      <div class="editor-zoom" role="group" aria-label={t('ui.editor.zoom')}>
        <button type="button" class="icon-button" data-testid="editor-zoom-out" aria-label={t('ui.editor.zoomOut')} disabled={!ready} onClick={() => changeZoom(zoom / 1.25)}>−</button>
        <span class="editor-zoom-value" data-testid="editor-zoom-value">{Math.round(zoom * 100)}%</span>
        <button type="button" class="icon-button" data-testid="editor-zoom-in" aria-label={t('ui.editor.zoomIn')} disabled={!ready} onClick={() => changeZoom(zoom * 1.25)}>+</button>
        <button type="button" class="button button-quiet" data-testid="editor-zoom-fit" disabled={!ready} onClick={() => changeZoom(handleRef.current?.fitZoom() ?? 1)}>{t('ui.editor.zoomFit')}</button>
        <button type="button" class="button button-quiet" data-testid="editor-zoom-actual" disabled={!ready} onClick={() => changeZoom(1)}>{t('ui.editor.zoomActual')}</button>
      </div>
      <button type="button" class="button button-quiet" onClick={() => handleRef.current?.undo()}>{t('ui.editor.undo')}</button>
      <button type="button" class="button button-quiet" onClick={() => handleRef.current?.redo()}>{t('ui.editor.redo')}</button>
      <button type="button" class="button button-quiet" data-testid="editor-cancel" onClick={() => onClose()}>{t('ui.editor.cancel')}</button>
      <button type="button" class="button button-primary" data-testid="editor-save" disabled={busy || !ready} onClick={() => void save()}>{busy ? t('ui.editor.saving') : t('ui.editor.save')}</button>
    </div>
    <p class="editor-privacy-note" data-testid="editor-privacy-note">{privacyNote}</p>
    <div class="editor-stage" ref={stageRef}><canvas ref={canvasRef} hidden={failed} />{failed && <p class="editor-stage-error" role="alert" data-testid="editor-load-error">{message || t('error.E_UNKNOWN.body')}</p>}</div>
    {message && <div class="toast" role="status" aria-live="polite">{message}</div>}
  </section>;
}
