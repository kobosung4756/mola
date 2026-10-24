import type { Commit, El, ElementType } from './types';
import { defaultContent, makeEl, scoresAt, toInbox } from './model';
import { putBlob } from './db';

export interface Point {
  x: number;
  y: number;
}
export interface ColumnSlot {
  id: string;
  index: number;
}

/** Creates an element centred on `at`, or inside a column slot. Returns the new id. */
export function addElement(
  commit: Commit,
  type: ElementType,
  boardId: string,
  at: Point,
  column?: ColumnSlot | null,
  opts: { inbox?: boolean; content?: El['content']; width?: number } = {},
): string {
  const el = makeEl(type, { parentId: boardId }, { ...defaultContent(type), ...opts.content });
  if (opts.width) el.width = opts.width;
  el.loc.x = Math.round(at.x - el.width / 2);
  el.loc.y = Math.round(at.y - 40);
  commit((m) => {
    if (column && type !== 'COLUMN') {
      const [score] = scoresAt(m, column.id, column.index, [], 1);
      el.loc = { parentId: column.id, section: 'ATTACHED', x: 0, y: 0, score };
    }
    m[el.id] = el;
    if (opts.inbox) toInbox(m, [el.id], boardId);
  });
  return el.id;
}

/** Stores dropped or picked files locally and adds image or file cards for them. */
export async function addFiles(
  commit: Commit,
  files: File[],
  boardId: string,
  at: Point,
  column?: ColumnSlot | null,
  opts: { inbox?: boolean } = {},
): Promise<string[]> {
  const made: El[] = [];
  for (const [i, file] of files.entries()) {
    const blobKey = await putBlob(file);
    const isImage = file.type.startsWith('image/');
    const el = makeEl(
      isImage ? 'IMAGE' : 'FILE',
      { parentId: boardId },
      isImage
        ? { blobKey, caption: '' }
        : { blobKey, fileName: file.name, fileSize: file.size, mime: file.type },
    );
    el.loc.x = Math.round(at.x - el.width / 2 + i * 24);
    el.loc.y = Math.round(at.y - 60 + i * 24);
    made.push(el);
  }
  commit((m) => {
    const scores = column ? scoresAt(m, column.id, column.index, [], made.length) : [];
    made.forEach((el, i) => {
      if (column) el.loc = { parentId: column.id, section: 'ATTACHED', x: 0, y: 0, score: scores[i] };
      m[el.id] = el;
    });
    if (opts.inbox) toInbox(m, made.map((e) => e.id), boardId);
  });
  return made.map((e) => e.id);
}

export function normalizeUrl(raw: string): string {
  const s = raw.trim();
  if (!s) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return s;
  return 'https://' + s;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function formatBytes(n = 0): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
