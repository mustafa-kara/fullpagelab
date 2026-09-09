import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { EditorHandle, EditorStyle } from '../../editor/editor-core';
import { createEditor } from '../../editor/index';
import { t } from '../../shared/i18n';
import { sendMessage } from '../../shared/messages';
import type { EditorDocument, ToolId } from '../../shared/types/editor';

const tools: ToolId[] = ['select', 'arrow', 'rect', 'ellipse', 'line', 'freehand', 'text', 'highlight', 'blur', 'pixelate', 'redact'];

/**
 * Glyphs for the tool buttons.
 *
 * Names spelled out took three rows of the panel and pushed the capture itself
 * below the fold; a labelled icon fits on one row and stays legible. The
 * accessible name still comes from the translated string.
 */
const toolGlyphs: Record<ToolId, string> = {
  select: '↖',
  arrow: '↗',
  rect: '▭',
  ellipse: '◯',
  line: '╱',
  freehand: '✎',
  text: 'T',
  highlight: '▤',
  blur: '◌',
  pixelate: '▓',
  redact: '■',
  marker: '①',
  emoji: '☺',
  image: '❑',
  crop: '⌗',
  pan: '✚',
};

/**
 * Palette covering the colours that stay legible over typical page content.
 *
 * Kept short on purpose: the whole toolbar has to fit one row, and every extra
 * swatch pushes Save onto a second one.
 */
const colors = ['#FF1493', '#FF3B30', '#FFCC00', '#34C759', '#0A84FF', '#111111'];

const strokeWidths = [2, 4, 8, 14];

/** Tools whose appearance the style controls cannot change. */
const unstyledTools = new Set<ToolId>(['select', 'blur', 'pixelate', 'redact']);

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
  const [style, setStyle] = useState<EditorStyle>({ color: colors[0]!, strokeWidth: 4 });
  const [docState, setDocState] = useState<EditorDocument>(doc);

  useEffect(() => {
    let disposed = false;
    const element = canvasRef.current;
    if (!element) return;
    setFailed(false);
    // The stage is what the capture has to fit inside when the editor opens.
    const stage = stageRef.current?.getBoundingClientRect();
    const viewport = stage ? { width: Math.max(1, stage.width - 40), height: Math.max(1, stage.height - 40) } : undefined;
    void createEditor(element, doc, { imageUrl, viewport, onChange: setDocState }).then((handle) => {
      if (disposed) { handle.dispose(); return; }
      handleRef.current = handle;
      setZoomValue(handle.getZoom());
      setStyle(handle.getStyle());
      setDocState(handle.getDocument());
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

  const changeStyle = (next: Partial<EditorStyle>): void => {
    const handle = handleRef.current;
    if (!handle) return;
    handle.setStyle(next);
    setStyle(handle.getStyle());
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

  // Redaction must stay opaque black, and the pixel effects show the capture's
  // own pixels, so a colour or width would have nothing to act on.
  const styleDisabled = unstyledTools.has(tool);

  const warns = tool === 'blur' || tool === 'pixelate' || tool === 'redact';

  const privacyNote = tool === 'blur' || tool === 'pixelate' ? t('ui.editor.blurWarning') : tool === 'redact' ? t('ui.editor.redactWarning') : t('ui.editor.keepOriginal');

  return <section class="editor-panel" aria-label={t('ui.editor.title')}>
    <div class="editor-toolbar" data-testid="editor-toolbar" data-ready={ready ? 'true' : 'false'} role="toolbar" aria-label={t('ui.editor.title')} aria-busy={!ready}>
      <div class="editor-group" role="radiogroup" aria-label={t('ui.editor.title')}>
        {tools.map((item) => <button
          key={item}
          type="button"
          data-tool={item}
          class={tool === item ? 'editor-tool active' : 'editor-tool'}
          role="radio"
          aria-checked={tool === item}
          aria-label={t(`ui.editor.tool.${item}`)}
          title={t(`ui.editor.tool.${item}`)}
          onClick={() => chooseTool(item)}
        ><span aria-hidden="true">{toolGlyphs[item]}</span></button>)}
      </div>

      <div class="editor-divider" />

      <div class="editor-group" data-testid="editor-style">
        <div class="editor-swatches" role="radiogroup" aria-label={t('ui.editor.color')}>
          {colors.map((item) => <button
            key={item}
            type="button"
            class={style.color === item ? 'editor-swatch active' : 'editor-swatch'}
            data-color={item}
            role="radio"
            aria-checked={style.color === item}
            aria-label={item}
            title={item}
            style={{ background: item }}
            disabled={!ready || styleDisabled}
            onClick={() => changeStyle({ color: item })}
          />)}
        </div>
        <div class="editor-widths" role="radiogroup" aria-label={t('ui.editor.strokeWidth')}>
          {strokeWidths.map((item) => <button
            key={item}
            type="button"
            class={style.strokeWidth === item ? 'editor-width active' : 'editor-width'}
            data-width={item}
            role="radio"
            aria-checked={style.strokeWidth === item}
            aria-label={`${item}`}
            title={`${item}`}
            disabled={!ready || styleDisabled}
            onClick={() => changeStyle({ strokeWidth: item })}
          ><span style={{ height: `${Math.min(item, 10)}px`, background: styleDisabled ? 'var(--result-muted)' : style.color }} /></button>)}
        </div>
      </div>

      <div class="editor-divider" />

      <div class="editor-group">
        <button type="button" class="editor-action" aria-label={t('ui.editor.undo')} title={t('ui.editor.undo')} onClick={() => handleRef.current?.undo()}><span aria-hidden="true">{'↶'}</span></button>
        <button type="button" class="editor-action" aria-label={t('ui.editor.redo')} title={t('ui.editor.redo')} onClick={() => handleRef.current?.redo()}><span aria-hidden="true">{'↷'}</span></button>
      </div>

      <div class="editor-divider" />

      <div class="editor-group editor-zoom" role="group" aria-label={t('ui.editor.zoom')}>
        <button type="button" class="editor-action" data-testid="editor-zoom-out" aria-label={t('ui.editor.zoomOut')} title={t('ui.editor.zoomOut')} disabled={!ready} onClick={() => changeZoom(zoom / 1.25)}><span aria-hidden="true">{'−'}</span></button>
        <span class="editor-zoom-value" data-testid="editor-zoom-value">{Math.round(zoom * 100)}%</span>
        <button type="button" class="editor-action" data-testid="editor-zoom-in" aria-label={t('ui.editor.zoomIn')} title={t('ui.editor.zoomIn')} disabled={!ready} onClick={() => changeZoom(zoom * 1.25)}><span aria-hidden="true">+</span></button>
        <button type="button" class="editor-action" data-testid="editor-zoom-fit" aria-label={t('ui.editor.zoomFit')} title={t('ui.editor.zoomFit')} disabled={!ready} onClick={() => changeZoom(handleRef.current?.fitZoom() ?? 1)}><span aria-hidden="true">{'⛶'}</span></button>
        <button type="button" class="editor-action editor-action-text" data-testid="editor-zoom-actual" aria-label={t('ui.editor.zoomActual')} title={t('ui.editor.zoomActual')} disabled={!ready} onClick={() => changeZoom(1)}>1:1</button>
      </div>

      <span class="editor-toolbar-spacer" />

      {/* Grouped so a narrow window wraps them together rather than stranding
          Save on a line of its own. */}
      <div class="editor-commits">
        <button type="button" class="button button-quiet editor-commit" data-testid="editor-cancel" onClick={() => onClose()}>{t('ui.editor.cancel')}</button>
        <button type="button" class="button button-primary editor-commit" data-testid="editor-save" disabled={busy || !ready} onClick={() => void save()}>{busy ? t('ui.editor.saving') : t('ui.editor.save')}</button>
      </div>
    </div>
    {/* The reassurance that originals are kept does not need a permanent row;
        the blur and redaction warnings do. */}
    <p class={warns ? 'editor-privacy-note warn' : 'editor-privacy-note'} data-testid="editor-privacy-note">{privacyNote}</p>
    {/* The document state the editor is about to save, so tests can assert on
        what will be persisted rather than only on what is painted. */}
    <span hidden data-testid="editor-object-count">{docState.layers.length}</span>
    <span hidden data-testid="editor-doc-text">{docState.layers.filter((layer) => layer.type === 'text').map((layer) => layer.text).join('|')}</span>
    <span hidden data-testid="editor-doc-rect">{docState.layers.map((layer) => `${Math.round(layer.rect.x)},${Math.round(layer.rect.y)}`).join('|')}</span>
    <div class="editor-stage" ref={stageRef}><canvas ref={canvasRef} hidden={failed} />{failed && <p class="editor-stage-error" role="alert" data-testid="editor-load-error">{message || t('error.E_UNKNOWN.body')}</p>}</div>
    {message && <div class="toast" role="status" aria-live="polite">{message}</div>}
  </section>;
}
