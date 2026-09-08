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
  onClose(saved?: { captureId: string }): void;
}

export function EditorPanel({ doc, captureId, onClose }: EditorPanelProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<EditorHandle | null>(null);
  const [tool, setTool] = useState<ToolId>('select');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let disposed = false;
    const element = canvasRef.current;
    if (!element) return;
    void createEditor(element, doc).then((handle) => {
      if (disposed) { handle.dispose(); return; }
      handleRef.current = handle;
      // Tools and Save only work once the canvas exists, so the toolbar advertises readiness for tests and screen readers.
      setReady(true);
    }).catch((error: unknown) => setMessage(error instanceof Error ? error.message : t('error.E_UNKNOWN.body')));
    return () => {
      disposed = true;
      setReady(false);
      handleRef.current?.dispose();
      handleRef.current = null;
    };
  }, [doc]);

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
      <button type="button" class="button button-quiet" onClick={() => handleRef.current?.undo()}>{t('ui.editor.undo')}</button>
      <button type="button" class="button button-quiet" onClick={() => handleRef.current?.redo()}>{t('ui.editor.redo')}</button>
      <button type="button" class="button button-quiet" data-testid="editor-cancel" onClick={() => onClose()}>{t('ui.editor.cancel')}</button>
      <button type="button" class="button button-primary" data-testid="editor-save" disabled={busy || !ready} onClick={() => void save()}>{busy ? t('ui.editor.saving') : t('ui.editor.save')}</button>
    </div>
    <p class="editor-privacy-note" data-testid="editor-privacy-note">{privacyNote}</p>
    <div class="editor-stage"><canvas ref={canvasRef} /></div>
    {message && <div class="toast" role="status" aria-live="polite">{message}</div>}
  </section>;
}
