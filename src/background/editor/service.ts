import { putBlob as defaultPutBlob } from '../../shared/db/blob-ref';
import { db } from '../../shared/db/schema';
import { createId as defaultCreateId, nowIso } from '../../shared/ids';
import type { EditorDocument } from '../../shared/types/editor';
import type { CaptureFile, CaptureRecord, CaptureRecordPatch } from '../../shared/types/history';
import type { BlobRef } from '../../shared/types/primitives';
import { dataUrlToBlob } from '../capture/image';

export interface EditorSaveInput {
  captureId: string;
  doc: EditorDocument;
  flattened: { dataUrl: string; mime: string };
  saveAsNew: boolean;
}

export interface EditorServiceDependencies {
  history: {
    get(id: string): Promise<CaptureRecord | undefined>;
    put(record: CaptureRecord): Promise<CaptureRecord>;
    replaceFile(id: string, file: CaptureFile): Promise<CaptureRecord>;
    update(id: string, patch: CaptureRecordPatch): Promise<CaptureRecord>;
  };
  putBlob?: (blob: Blob) => Promise<BlobRef>;
  saveDoc?: (doc: EditorDocument) => Promise<void>;
  loadDoc?: (captureId: string) => Promise<EditorDocument | null>;
  makeThumbnail?: (blob: Blob) => Promise<BlobRef | undefined>;
  createId?: () => string;
  now?: () => string;
}

export function createEditorService({
  history,
  putBlob = defaultPutBlob,
  saveDoc = async (doc) => { await db.editorDocs.put(doc); },
  loadDoc = async (captureId) => (await db.editorDocs.get(captureId)) ?? null,
  makeThumbnail = async () => undefined,
  createId = defaultCreateId,
  now = nowIso,
}: EditorServiceDependencies) {
  return {
    async save({ captureId, doc, flattened, saveAsNew }: EditorSaveInput): Promise<{ captureId: string; createdNewRecord: boolean }> {
      const record = await history.get(captureId);
      if (!record) throw new Error(`Capture not found: ${captureId}`);

      const blob = dataUrlToBlob(flattened.dataUrl);
      const ref = await putBlob(blob);
      const timestamp = now();
      const editedFile: CaptureFile = { id: `edited-${createId()}`, role: 'edited', ref, format: 'png', createdAt: timestamp };
      const thumbnail = await makeThumbnail(blob);

      if (saveAsNew) {
        const cloneId = createId();
        const clone: CaptureRecord = {
          ...structuredClone(record),
          id: cloneId,
          createdAt: timestamp,
          updatedAt: timestamp,
          files: [...record.files.filter((file) => file.role !== 'edited'), editedFile],
          thumbnail: thumbnail ?? record.thumbnail,
          source: { ...record.source, editedFrom: record.id },
        };
        await history.put(clone);
        await saveDoc({ ...doc, captureId: cloneId, updatedAt: timestamp });
        return { captureId: cloneId, createdNewRecord: true };
      }

      await history.replaceFile(captureId, editedFile);
      if (thumbnail) await history.update(captureId, { thumbnail });
      await saveDoc({ ...doc, captureId, updatedAt: timestamp });
      return { captureId, createdNewRecord: false };
    },

    async load(captureId: string): Promise<EditorDocument | null> {
      return loadDoc(captureId);
    },
  };
}
