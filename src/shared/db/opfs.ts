const rootName = 'ssx';

async function root(): Promise<FileSystemDirectoryHandle> {
  const directory = await navigator.storage.getDirectory();
  return directory.getDirectoryHandle(rootName, { create: true });
}

export async function putOpfsBlob(path: string, blob: Blob): Promise<void> {
  const parts = path.split('/').filter(Boolean);
  const fileName = parts.pop();
  if (!fileName) throw new Error('OPFS path must include a filename');
  let directory = await root();
  for (const part of parts) directory = await directory.getDirectoryHandle(part, { create: true });
  const file = await directory.getFileHandle(fileName, { create: true });
  const writable = await file.createWritable();
  await writable.write(blob);
  await writable.close();
}

export async function getOpfsBlob(path: string): Promise<Blob> {
  const parts = path.split('/').filter(Boolean);
  const fileName = parts.pop();
  if (!fileName) throw new Error('OPFS path must include a filename');
  let directory = await root();
  for (const part of parts) directory = await directory.getDirectoryHandle(part);
  const file = await directory.getFileHandle(fileName);
  return file.getFile();
}

export async function deleteOpfsPath(path: string): Promise<void> {
  const parts = path.split('/').filter(Boolean);
  const fileName = parts.pop();
  if (!fileName) return;
  let directory = await root();
  for (const part of parts) directory = await directory.getDirectoryHandle(part);
  await directory.removeEntry(fileName, { recursive: true });
}

type DirectoryHandleWithEntries = FileSystemDirectoryHandle & {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
};

async function directoryBytes(directory: FileSystemDirectoryHandle): Promise<number> {
  let bytes = 0;
  for await (const [, handle] of (directory as DirectoryHandleWithEntries).entries()) {
    if (handle.kind === 'file') bytes += (await (handle as FileSystemFileHandle).getFile()).size;
    else bytes += await directoryBytes(handle as FileSystemDirectoryHandle);
  }
  return bytes;
}

export async function getOpfsBytes(): Promise<number> {
  try {
    return await directoryBytes(await root());
  } catch {
    return 0;
  }
}

export async function removeOpfsChildren(path = ''): Promise<void> {
  let directory = await root();
  for (const part of path.split('/').filter(Boolean)) directory = await directory.getDirectoryHandle(part);
  for await (const [name] of (directory as DirectoryHandleWithEntries).entries()) await directory.removeEntry(name, { recursive: true });
}
