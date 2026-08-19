import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { putBlob, release, resolveBlob, retain } from '../../src/shared/db/blob-ref';
import { getOpfsBlob, getOpfsBytes, putOpfsBlob, removeOpfsChildren } from '../../src/shared/db/opfs';
import { db } from '../../src/shared/db/schema';
import { t } from '../../src/shared/i18n';
import { log, redact } from '../../src/shared/log';
import { sendMessage } from '../../src/shared/messages';
import type { Reply } from '../../src/shared/types/messages';
import { integrationProviders } from '../../src/shared/types/settings';

class FakeFileHandle {
  readonly kind = 'file';
  private blob = new Blob();

  async createWritable() {
    return {
      write: async (value: Blob) => {
        this.blob = value;
      },
      close: async () => undefined,
    };
  }

  async getFile(): Promise<Blob> {
    return this.blob;
  }
}

type FakeEntry = FakeDirectory | FakeFileHandle;

class FakeDirectory {
  readonly kind = 'directory';
  readonly children = new Map<string, FakeEntry>();

  async getDirectoryHandle(name: string, options: { create?: boolean } = {}): Promise<FakeDirectory> {
    const existing = this.children.get(name);
    if (existing?.kind === 'directory') return existing;
    if (!options.create) throw new Error('Directory not found: ' + name);
    const directory = new FakeDirectory();
    this.children.set(name, directory);
    return directory;
  }

  async getFileHandle(name: string, options: { create?: boolean } = {}): Promise<FakeFileHandle> {
    const existing = this.children.get(name);
    if (existing?.kind === 'file') return existing;
    if (!options.create) throw new Error('File not found: ' + name);
    const file = new FakeFileHandle();
    this.children.set(name, file);
    return file;
  }

  async removeEntry(name: string): Promise<void> {
    this.children.delete(name);
  }

  async *entries(): AsyncIterableIterator<[string, FakeEntry]> {
    for (const entry of this.children.entries()) yield entry;
  }
}

function installNavigator(root: FakeDirectory): void {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { storage: { getDirectory: async () => root } },
  });
}

describe('shared runtime helpers', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    installNavigator(new FakeDirectory());
  });

  it('uses the localized message and falls back to the key', () => {
    const getMessage = vi.fn().mockReturnValueOnce('Türkçe metin').mockReturnValueOnce('');
    Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { i18n: { getMessage } } });
    expect(t('capture.visible')).toBe('Türkçe metin');
    expect(t('missing.key')).toBe('missing.key');
  });

  it('sends typed replies and surfaces runtime errors', async () => {
    const success: Reply<'capture.ping'> = { v: 1, type: 'capture.ping', id: 'reply', ok: true, payload: { ready: true, version: 'test' } };
    const sendMessageMock = vi.fn((_message: unknown, callback: (response: Reply<'capture.ping'>) => void) => callback(success));
    Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { runtime: { sendMessage: sendMessageMock, lastError: undefined } } });
    await expect(sendMessage('capture.ping', undefined)).resolves.toEqual(success.payload);
    expect(sendMessageMock).toHaveBeenCalledOnce();

    const failure: Reply<'capture.ping'> = { v: 1, type: 'capture.ping', id: 'reply', ok: false, error: { code: 'E_PROTOCOL', message: 'bad', userMessageKey: 'error.E_PROTOCOL.body', recoverable: false, at: new Date().toISOString() } };
    Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { runtime: { sendMessage: vi.fn((_message: unknown, callback: (response: Reply<'capture.ping'>) => void) => callback(failure)), lastError: undefined } } });
    await expect(sendMessage('capture.ping', undefined)).rejects.toThrow('bad');

    Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { runtime: { sendMessage: vi.fn((_message: unknown, callback: (response: Reply<'capture.ping'>) => void) => callback(undefined as unknown as Reply<'capture.ping'>)), lastError: { message: 'transport failed' } } } });
    await expect(sendMessage('capture.ping', undefined)).rejects.toThrow('transport failed');

    Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { runtime: { sendMessage: vi.fn((_message: unknown, callback: (response: Reply<'capture.ping'>) => void) => callback(undefined as unknown as Reply<'capture.ping'>)), lastError: undefined } } });
    await expect(sendMessage('capture.ping', undefined)).rejects.toThrow('Invalid extension response');
  });

  it('redacts sensitive log fields and keeps ordinary logging safe', () => {
    expect(redact({ token: 'secret', nested: { password: 'hidden' }, visible: 'ok' })).toEqual({ token: '***', nested: { password: '***' }, visible: 'ok' });
    expect(redact(['plain', { authorization: 'hidden' }])).toEqual(['plain', { authorization: '***' }]);
    expect(redact('plain')).toBe('plain');
    expect(() => log('info', 'test', 'message', 'job-1')).not.toThrow();
  });

  it('round-trips IDB and OPFS blob references', async () => {
    const idbRef = await putBlob(new Blob(['idb'], { type: 'text/plain' }));
    expect(await (await resolveBlob(idbRef)).text()).toBe('idb');
    await retain(idbRef);
    await release(idbRef);
    expect(await db.blobs.count()).toBe(1);
    await release(idbRef);
    expect(await db.blobs.count()).toBe(0);

    const opfsRef = await putBlob(new Blob(['opfs'], { type: 'text/plain' }), { preferOpfs: true, path: 'blobs/test.txt' });
    expect(await (await resolveBlob(opfsRef)).text()).toBe('opfs');
    const generatedOpfsRef = await putBlob(new Blob(['generated']), { preferOpfs: true });
    await retain(generatedOpfsRef);
    await release(generatedOpfsRef);
    await release(opfsRef);
    await expect(resolveBlob({ store: 'idb', key: 'missing', mime: 'text/plain', bytes: 0 })).rejects.toThrow('Blob not found');
    await release({ store: 'idb', key: 'missing', mime: 'text/plain', bytes: 0 });

    await putOpfsBlob('nested/one.bin', new Blob(['1']));
    await putOpfsBlob('nested/two.bin', new Blob(['22']));
    expect(await (await getOpfsBlob('nested/two.bin')).text()).toBe('22');
    expect(await getOpfsBytes()).toBe(3);
    await removeOpfsChildren('nested');
    expect(await getOpfsBytes()).toBe(0);

    await expect(putOpfsBlob('/', new Blob())).rejects.toThrow('filename');
    await expect(getOpfsBlob('/')).rejects.toThrow('filename');
    await expect(removeOpfsChildren('missing')).rejects.toThrow('Directory not found');
    installNavigator(new FakeDirectory());
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { storage: { getDirectory: async () => { throw new Error('unavailable'); } } } });
    expect(await getOpfsBytes()).toBe(0);
  });

  it('exposes the supported integration providers', () => {
    expect(integrationProviders).toContain('webhook');
  });
});
