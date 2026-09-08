/** Iterative browser file-drop traversal for legacy entries and modern handles. */

export const DEFAULT_FILE_DROP_MAX_FILES = 10_000;
export const DEFAULT_FILE_DROP_MAX_ENTRIES = 100_000;

export type FileDropDiagnostic = {
  kind: 'empty-directory' | 'unreadable' | 'truncated' | 'aborted';
  path: string;
  source?: unknown;
  error?: unknown;
};

export type FileDropResult = { files: File[]; diagnostics: FileDropDiagnostic[] };

export type FileDropOptions = {
  signal?: AbortSignal;
  concurrency?: number;
  maxFiles?: number;
  maxEntries?: number;
  pathPrefix?: string;
};

type Task = { value: any; path: string };

const isAborted = (signal?: AbortSignal) => !!signal?.aborted;
const normalizePath = (path: string) => path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
const childPath = (parent: string, name: string) => normalizePath(parent ? `${parent}/${name}` : name);

function stamp(file: File, path: string): File {
  if (!path) return file;
  try { Object.defineProperty(file, 'webkitRelativePath', { value: path, configurable: true }); } catch { /* browser-owned File property */ }
  return file;
}

function readLegacyFile(entry: any): Promise<File> {
  return new Promise((resolve, reject) => { try { entry.file(resolve, reject); } catch (error) { reject(error); } });
}

function readLegacyBatch(reader: any): Promise<any[]> {
  return new Promise((resolve, reject) => { try { reader.readEntries(resolve, reject); } catch (error) { reject(error); } });
}

function isLooseFile(value: any): value is File {
  return !!value && typeof value === 'object' && !value.isFile && !value.isDirectory &&
    typeof value.name === 'string' && (typeof value.size === 'number' || typeof value.slice === 'function');
}

/** Collect mixed drop sources using breadth/batch processing (never recursive). */
export async function collectDroppedFiles(
  sources: Iterable<any> | ArrayLike<any>,
  options: FileDropOptions = {},
): Promise<FileDropResult> {
  const files: File[] = [];
  const diagnostics: FileDropDiagnostic[] = [];
  const roots = Array.from(sources as any);
  const queue: Task[] = [];
  const concurrency = Math.max(1, Math.min(32, Math.floor(options.concurrency ?? 4) || 4));
  const maxFiles = Math.max(0, options.maxFiles ?? DEFAULT_FILE_DROP_MAX_FILES);
  const maxEntries = Math.max(0, options.maxEntries ?? DEFAULT_FILE_DROP_MAX_ENTRIES);
  let seenEntries = 0;
  let reservedFiles = 0;
  let entryLimitReported = false;
  let fileLimitReported = false;

  const enqueue = (next: Task) => {
    if (seenEntries >= maxEntries) {
      if (!entryLimitReported) diagnostics.push({ kind: 'truncated', path: next.path, source: next.value });
      entryLimitReported = true;
      return;
    }
    seenEntries++;
    queue.push(next);
  };
  const process = async (task: Task): Promise<void> => {
    const value = task.value;
    if (isAborted(options.signal)) return;

    if (value?.isFile) {
      const path = task.path ? childPath(task.path, value.name || '') : '';
      try {
        if (reservedFiles >= maxFiles) {
          if (!fileLimitReported) diagnostics.push({ kind: 'truncated', path: value.name || '', source: value });
          fileLimitReported = true;
        }
        else { reservedFiles++; files.push(stamp(await readLegacyFile(value), path)); }
      } catch (error) { diagnostics.push({ kind: 'unreadable', path: path || value.name || '', source: value, error }); }
      return;
    }

    if (value?.isDirectory) {
      const path = childPath(task.path, value.name || '');
      let count = 0;
      try {
        const reader = value.createReader();
        for (;;) {
          if (isAborted(options.signal)) return;
          const batch = await readLegacyBatch(reader);
          if (!batch.length) break;
          count += batch.length;
          for (const child of batch) enqueue({ value: child, path });
        }
        if (!count) diagnostics.push({ kind: 'empty-directory', path, source: value });
      } catch (error) { diagnostics.push({ kind: 'unreadable', path, source: value, error }); }
      return;
    }

    if (value?.kind === 'file' && typeof value.getFile === 'function') {
      const path = task.path ? childPath(task.path, value.name || '') : '';
      try {
        if (reservedFiles >= maxFiles) {
          if (!fileLimitReported) diagnostics.push({ kind: 'truncated', path: value.name || '', source: value });
          fileLimitReported = true;
        }
        else { reservedFiles++; files.push(stamp(await value.getFile(), path)); }
      } catch (error) { diagnostics.push({ kind: 'unreadable', path: path || value.name || '', source: value, error }); }
      return;
    }

    if (value?.kind === 'directory') {
      const path = childPath(task.path, value.name || '');
      let count = 0;
      try {
        const iterator = value.entries ? value.entries() : value.values?.();
        if (iterator) {
          for await (const item of iterator) {
            if (isAborted(options.signal)) return;
            count++;
            enqueue({ value: item?.[1] ?? item, path });
          }
        }
        if (!count) diagnostics.push({ kind: 'empty-directory', path, source: value });
      } catch (error) { diagnostics.push({ kind: 'unreadable', path, source: value, error }); }
      return;
    }

    if (isLooseFile(value)) {
      if (reservedFiles >= maxFiles) {
        if (!fileLimitReported) diagnostics.push({ kind: 'truncated', path: value.name, source: value });
        fileLimitReported = true;
      }
      else { reservedFiles++; files.push(value); }
    }
  };

  // Count roots and process one breadth batch at a time. Promise.all gives
  // genuinely parallel work while the batch size caps observed concurrency.
  for (const value of roots) enqueue({ value, path: normalizePath(options.pathPrefix || '') });
  while (queue.length && !isAborted(options.signal)) {
    const batch = queue.splice(0, concurrency);
    await Promise.all(batch.map(process));
  }
  if (isAborted(options.signal)) diagnostics.push({ kind: 'aborted', path: '', error: new Error('File drop collection aborted') });
  return { files, diagnostics };
}

export const collectFileDropFiles = collectDroppedFiles;

/** Backward-compatible legacy entry walker. */
export async function walkEntry(entry: any, prefix = ''): Promise<File[]> {
  return (await collectDroppedFiles([entry], { pathPrefix: prefix })).files;
}
