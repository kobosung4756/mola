import { del as idbDel, get as idbGet, keys as idbKeys, set as idbSet } from 'idb-keyval';
import type { El, ElMap } from './types';
import { blobKeysIn, labelDefsOf, makeEl, uid } from './model';
import { LABELS_ID, PROFILE_ID, ROOT_ID } from './types';
import { tr } from './i18n';

/** Boards saved before cloud sign-in existed (local-only mode). */
export const LEGACY_STATE_KEY = 'board-studio:state:v1';
/** Boards kept for a cloud account, from when the app had sign-in (now only read once, see importAccountBoards). */
export const userStateKey = (userId: string) => `${LEGACY_STATE_KEY}:u:${userId}`;

/* ---------- Where things are kept: the data folder on this PC, or the browser ---------- */

type Store = {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  /** `unused`: a clean-up of a file no board uses (the data folder keeps it while it is new). */
  del(key: string, unused?: boolean): Promise<void>;
  keys(): Promise<string[]>;
};

/** The browser's own storage (IndexedDB): used when the app runs without the launcher. */
const browserStore: Store = {
  get: (key) => idbGet(key),
  set: (key, value) => idbSet(key, value),
  del: (key) => idbDel(key),
  keys: async () => (await idbKeys()).filter((k): k is string => typeof k === 'string'),
};

const MOLANOTE = { 'x-molanote': '1' };
const kvUrl = (key: string) => '/__data/kv?key=' + encodeURIComponent(key);

/** The data folder (C:\Users\<name>\molanote-data by default), through the local server started by molanote.cmd. */
const folderStore: Store = {
  async get(key) {
    const r = await fetch(kvUrl(key), { headers: MOLANOTE, cache: 'no-store' });
    if (r.status === 404) return undefined;
    if (!r.ok) throw new Error(tr(`데이터 폴더를 읽지 못했습니다 (${r.status})`, `Couldn't read the data folder (${r.status})`));
    return (r.headers.get('x-kind') === 'blob' ? await r.blob() : await r.json()) as never;
  },
  async set(key, value) {
    const blob = value instanceof Blob;
    const r = await fetch(kvUrl(key), {
      method: 'PUT',
      headers: blob
        ? { ...MOLANOTE, 'x-kind': 'blob', 'content-type': (value as Blob).type || 'application/octet-stream' }
        : { ...MOLANOTE, 'x-kind': 'json', 'content-type': 'application/json' },
      body: blob ? (value as Blob) : JSON.stringify(value),
    });
    if (!r.ok) throw new Error(tr(`데이터 폴더에 저장하지 못했습니다 (${r.status})`, `Couldn't save to the data folder (${r.status})`));
  },
  async del(key, unused) {
    await fetch(kvUrl(key) + (unused ? '&unused' : ''), { method: 'DELETE', headers: MOLANOTE });
  },
  async keys() {
    const r = await fetch('/__data/keys', { headers: MOLANOTE, cache: 'no-store' });
    return r.ok ? ((await r.json()) as string[]) : [];
  },
};

let store: Store = browserStore;
/** The data folder in use, or null when the browser's storage is used. */
export let dataFolder: string | null = null;
/** The data folder could not be reached at the start (Google Drive not running…): where it is and why. */
export let folderMissing: { dir: string; error: string } | null = null;
/** Showing this browser's last copy of the folder's boards, read-only, because the folder is missing. */
export let viewingLastCopy = false;
/** No data folder has been chosen on this PC yet: the app asks where to keep the data. */
export let folderFirstRun = false;

/**
 * Picks the data folder when the local server offers one. The first time a folder is used, what
 * this browser had saved so far is copied into it (the browser's copy is left as it was).
 */
export async function initStorage() {
  let info: { dir: string | null; empty: boolean; unavailable?: boolean; error?: string; firstRun?: boolean } | null = null;
  try {
    const r = await fetch('/__data/info', { headers: MOLANOTE, cache: 'no-store' });
    if (r.ok) info = await r.json();
  } catch {
    // No local server (opened some other way): the browser's storage it is.
  }
  if (!info?.dir) return;
  if (info.unavailable) {
    // Not the browser's own storage instead: that would split the boards in two without saying so.
    folderMissing = { dir: info.dir, error: info.error ?? '' };
    return;
  }
  store = folderStore;
  dataFolder = info.dir;
  folderFirstRun = !!info.firstRun;
  try {
    if (info.empty) await copyBrowserIntoFolder();
    else await keepOtherBrowserBoards();
  } catch (err) {
    console.warn('Copying the boards of this browser into the data folder stopped:', err);
  }
}

/**
 * A browser that had its own boards before the data folder (and is not the one they were copied
 * from) keeps them: they are saved once into the folder as "browser-backup:…" before this browser
 * starts showing the folder's boards, so nothing it held is lost.
 */
async function keepOtherBrowserBoards() {
  if (await browserStore.get('molanote:browser-kept')) return;
  const keys = await ownBrowserKeys();
  const boards = keys.filter((k) => k.startsWith(LEGACY_STATE_KEY));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  for (const k of boards) {
    const m = await browserStore.get<ElMap>(k);
    if (!m) continue;
    const saved = await folderStore.get<ElMap>(k);
    if (saved && JSON.stringify(saved) === JSON.stringify(m)) continue;
    for (const b of blobKeysIn(m)) {
      const blob = await browserStore.get<Blob>(b);
      if (blob && !(await folderStore.get(b))) await folderStore.set(b, blob);
    }
    await folderStore.set(`browser-backup:${stamp}:${k}`, m);
  }
  await browserStore.set('molanote:browser-kept', true);
}

/** Keys of what the app itself saved in the browser (not its copies of a data folder). */
const ownBrowserKeys = async () => (await browserStore.keys()).filter((k) => !k.startsWith('mirror:') && !k.startsWith('molanote:'));

async function copyBrowserIntoFolder() {
  const keys = await ownBrowserKeys();
  if (!keys.length) return browserStore.set('molanote:browser-kept', true);
  // Files first, then the boards that point at them.
  const ordered = [...keys.filter((k) => k.startsWith('blob:')), ...keys.filter((k) => !k.startsWith('blob:'))];
  for (const k of ordered) {
    const v = await browserStore.get(k);
    if (v !== undefined) await folderStore.set(k, v);
  }
  await folderStore.set('molanote:copied-from-browser', { at: new Date().toISOString(), browser: navigator.userAgent, keys: keys.length });
  await browserStore.set('molanote:browser-kept', true);
}

/** Tries the data folder again (the server opens it if it can, and writes what waits on this PC). */
export async function retryFolder(): Promise<{ folderOk: boolean; written: number; pending: number } | null> {
  const r = await fetch('/__data/retry', { method: 'POST', headers: MOLANOTE }).catch(() => null);
  return r?.ok ? r.json() : null;
}

/**
 * The data folder is missing: shows this browser's last copy of its boards, read-only (files and
 * images that were only in the folder do not show).
 */
export function viewLastCopy(dir: string) {
  dataFolder = dir;
  viewingLastCopy = true;
  store = {
    get: async (key) => (key.startsWith(LEGACY_STATE_KEY) ? browserStore.get(mirrorKey(key)) : undefined),
    set: async () => {},
    del: async () => {},
    keys: async () => [],
  };
}

/* ---------- Boards ---------- */

const stampKey = (key: string) => `${key}:saved-at`;
/** This browser's copy of a data folder's board (one per folder, apart from the browser's own boards). */
const mirrorKey = (key: string) => `mirror:${dataFolder}:${key}`;

/** Changes sent to the local server but not yet confirmed, kept in this browser until they are. */
const unsentKey = (key: string) => `unsent:${dataFolder}:${key}`;
type Unsent = { at: number; changes: Record<string, El | null> };

/**
 * With a data folder, the board is also kept in this browser (for the read-only last copy), and
 * every save is kept here until the local server has it. Saves that never got there (the app was
 * closed while it could not be reached) are put back on the next start, block by block on top of
 * what the folder holds by then: another PC's edits to other blocks stay, and of a block changed
 * in both places the later edit wins.
 */
export async function loadState(key: string = LEGACY_STATE_KEY): Promise<ElMap | undefined> {
  if (store !== folderStore) return store.get<ElMap>(key);
  const [fileState, unsent] = await Promise.all([folderStore.get<ElMap>(key), browserStore.get<Unsent>(unsentKey(key)).catch(() => undefined)]);
  if (fileState) folderCopy.set(key, fileState);
  if (!unsent || !Object.keys(unsent.changes).length) return fileState;
  const merged: ElMap = { ...(fileState ?? {}) };
  for (const [id, el] of Object.entries(unsent.changes)) {
    const theirs = merged[id];
    if (theirs && (theirs.updatedAt ?? 0) > unsent.at) continue;
    if (el === null) delete merged[id];
    else merged[id] = el;
  }
  await saveToFolder(merged, key, Date.now()).catch(() => {});
  return merged;
}

/** Whether the local server is keeping saves on this PC because the data folder cannot be reached. */
export let savesWaiting = false;

/** What the data folder holds for each board, so a save sends only the blocks that changed. */
const folderCopy = new Map<string, ElMap>();
/** Saves go out one after another, so an older one can never land after a newer one. */
let saving: Promise<unknown> = Promise.resolve();

/**
 * Saves a board to the data folder. Blocks are replaced, never edited in place, so a block that is
 * not the same object as last time has changed; only those (and the removed ones) are sent. The
 * whole board goes when the folder has no copy yet or when most of it changed.
 */
function saveToFolder(m: ElMap, key: string, at: number): Promise<void> {
  const run = saving.then(async () => {
    const base = folderCopy.get(key);
    if (base) {
      const changes: Record<string, El | null> = {};
      let n = 0;
      for (const id in m) if (m[id] !== base[id]) (changes[id] = m[id]), n++;
      for (const id in base) if (!(id in m)) (changes[id] = null), n++;
      if (n === 0) return; // nothing changed since the last save
      // Everything since the last confirmed save, kept here until the local server has it.
      await browserStore.set(unsentKey(key), { at, changes } satisfies Unsent).catch(() => {});
      // While saves wait on this PC, always as changes (a whole board could not be laid over another PC's edits).
      if (savesWaiting || n <= Math.max(50, Object.keys(m).length / 2)) {
        const r = await fetch('/__data/patch?key=' + encodeURIComponent(key), {
          method: 'POST',
          headers: { ...MOLANOTE, 'content-type': 'application/json' },
          body: JSON.stringify({ at, changes }),
        });
        if (r.ok) {
          savesWaiting = !!(await r.json().catch(() => ({}))).pending;
          folderCopy.set(key, m);
          await browserStore.del(unsentKey(key)).catch(() => {});
          return;
        }
        if (r.status !== 409) throw new Error(tr(`데이터 폴더에 저장하지 못했습니다 (${r.status})`, `Couldn't save to the data folder (${r.status})`));
      }
    }
    await folderStore.set(key, m);
    await folderStore.set(stampKey(key), at);
    folderCopy.set(key, m);
    await browserStore.del(unsentKey(key)).catch(() => {});
  });
  saving = run.catch(() => {});
  return run;
}

/* ---------- Boards from the time the app had cloud sign-in ---------- */

const IMPORTED_KEY = 'molanote:accounts-imported';

/**
 * Sign-in has been removed. Boards that were only kept for a cloud account (on this PC) come into
 * the local boards once: whatever the local boards do not already have goes into a new board
 * "계정에서 가져온 보드" on the home board. Its tags come along; the account copies stay where they are.
 */
// Asked twice at once (the page starting up), the boards still come in once: the second asking
// waits for the first and finds them already in.
let importing: Promise<unknown> = Promise.resolve();
export function importAccountBoards(m: ElMap, key: string): Promise<ElMap> {
  const run = importing.then(() => importAccountBoardsOnce(m, key));
  importing = run.catch(() => undefined);
  return run;
}

async function importAccountBoardsOnce(m: ElMap, key: string): Promise<ElMap> {
  if (await store.get(IMPORTED_KEY)) return m;
  const keys = (await store.keys()).filter((k) => k.startsWith(LEGACY_STATE_KEY + ':u:') && !k.endsWith(':saved-at'));
  const next: ElMap = { ...m };
  const imported: string[] = [];
  for (const k of keys) {
    const acc = await store.get<ElMap>(k).catch(() => undefined);
    if (!acc || typeof acc !== 'object') continue;
    const fresh = Object.values(acc).filter((el) => el && el.id && !(el.id in next) && el.id !== ROOT_ID && el.id !== PROFILE_ID && el.id !== LABELS_ID);
    // Tags the imported blocks use.
    const defs = labelDefsOf(acc).filter((d) => !labelDefsOf(next).some((x) => x.id === d.id));
    if (defs.length) {
      const all = [...labelDefsOf(next), ...defs];
      next[LABELS_ID] = next[LABELS_ID]
        ? { ...next[LABELS_ID], content: { ...next[LABELS_ID].content, labelDefs: all }, updatedAt: Date.now() }
        : { ...makeEl('LABELS', { parentId: '' }, { labelDefs: all }), id: LABELS_ID };
    }
    if (!fresh.some((el) => el.loc?.section !== 'TRASH')) continue;
    const homeItems = Object.values(next).filter((el) => el.loc?.parentId === ROOT_ID && el.loc.section === 'CANVAS');
    const x = homeItems.length ? Math.max(...homeItems.map((el) => el.loc.x + (el.width || 120))) + 60 : 80;
    const board = makeEl('BOARD', { parentId: ROOT_ID, x, y: 80 }, { title: tr('계정에서 가져온 보드', 'Boards from the account'), icon: '☁️' });
    next[board.id] = board;
    for (const el of fresh) next[el.id] = el.loc?.parentId === ROOT_ID ? { ...el, loc: { ...el.loc, parentId: board.id } } : el;
    imported.push(k);
  }
  await store.set(IMPORTED_KEY, { at: new Date().toISOString(), keys: imported });
  if (!imported.length) return m;
  await saveState(next, key);
  return next;
}

/* ---------- The same data folder opened on several PCs (through Google Drive and the like) ---------- */

export type FolderStatus = {
  machine: string;
  /** The data folder can be written now. */
  folderOk: boolean;
  /** Saves kept on this PC until the folder can be written again. */
  pending: number;
  /** Other PCs with the folder open now. */
  others: { machine: string; user: string; beat: number }[];
  /** Per board, when each other PC last saved it; it changes when one of them saves. */
  stamps: Record<string, string>;
  /** Copies a sync app made of a file changed on two PCs at once. */
  conflicts: { name: string; board: boolean }[];
};

export async function folderStatus(): Promise<FolderStatus | null> {
  if (store !== folderStore) return null;
  const r = await fetch('/__data/status', { headers: MOLANOTE, cache: 'no-store' }).catch(() => null);
  return r?.ok ? ((await r.json()) as FolderStatus) : null;
}

/**
 * Tells the local server this page has the folder open (every 30 s), so other PCs can see it.
 * A page that only watches (read-only) does not count. Returns a function that changes that.
 */
export function announcePresence(watching: boolean) {
  if (store !== folderStore) return () => {};
  const id = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : String(Math.random()).slice(2);
  let mode = watching;
  const send = (extra: Record<string, unknown> = {}) =>
    fetch('/__data/presence', {
      method: 'POST',
      keepalive: true,
      headers: { ...MOLANOTE, 'content-type': 'application/json' },
      body: JSON.stringify({ id, watching: mode, ...extra }),
    }).catch(() => {});
  send({ first: true });
  const timer = setInterval(() => send(), 30_000);
  const bye = () => send({ bye: true });
  addEventListener('pagehide', bye);
  return (nextWatching: boolean | 'stop') => {
    if (nextWatching === 'stop') {
      clearInterval(timer);
      removeEventListener('pagehide', bye);
      bye();
      return;
    }
    mode = nextWatching;
    send({ first: true });
  };
}

/** Merges the copies a sync app made back into their boards; returns the boards that changed. */
export async function mergeFolderConflicts(): Promise<string[]> {
  const r = await fetch('/__data/conflicts', { method: 'POST', headers: MOLANOTE });
  if (!r.ok) throw new Error(tr(`충돌 사본을 합치지 못했습니다 (${r.status})`, `Couldn't merge the conflict copies (${r.status})`));
  return ((await r.json()) as { changed: string[] }).changed;
}

/** What changed in the folder copy of a board compared with what this page last knew of it. */
export type FolderPull = { upserts: El[]; deletes: string[] };

/**
 * Reads a board again after another PC changed it. Only the blocks that PC changed are taken
 * (compared with what this page last read or saved), so edits made here meanwhile stay; a block
 * changed in both places takes the other PC's version. Runs in turn with the saves.
 */
export function pullFromFolder(key: string, current: ElMap): Promise<{ next: ElMap; pull: FolderPull } | null> {
  const run = saving.then(async () => {
    const theirs = await folderStore.get<ElMap>(key);
    if (!theirs) return null;
    const base = folderCopy.get(key) ?? current;
    const upserts: El[] = [];
    const deletes: string[] = [];
    const same = (a: El | undefined, b: El | undefined) => a === b || (!!a && !!b && JSON.stringify(a) === JSON.stringify(b));
    for (const id in theirs) if (!same(base[id], theirs[id])) upserts.push(theirs[id]);
    for (const id in base) if (!(id in theirs)) deletes.push(id);
    const nextBase = { ...base };
    const next = { ...current };
    for (const el of upserts) nextBase[el.id] = next[el.id] = el;
    for (const id of deletes) delete nextBase[id], delete next[id];
    folderCopy.set(key, nextBase);
    const at = await folderStore.get<number>(stampKey(key)).catch(() => undefined);
    await Promise.all([browserStore.set(mirrorKey(key), next), browserStore.set(stampKey(mirrorKey(key)), at ?? Date.now())]).catch(() => {});
    return { next, pull: { upserts, deletes } };
  });
  saving = run.catch(() => {});
  return run;
}

export async function saveState(m: ElMap, key: string = LEGACY_STATE_KEY) {
  if (store === browserStore) return browserStore.set(key, m);
  const at = Date.now();
  await Promise.all([browserStore.set(mirrorKey(key), m), browserStore.set(stampKey(mirrorKey(key)), at)]).catch(() => {});
  await saveToFolder(m, key, at);
}

export const loadMeta = <T>(key: string) => store.get<T>(key);
export const saveMeta = <T>(key: string, value: T) => store.set(key, value);

export async function putBlob(blob: Blob, key = 'blob:' + uid()): Promise<string> {
  await store.set(key, blob);
  return key;
}

export const getLocalBlob = (key: string) => store.get<Blob>(key);

export const getBlob = (key: string) => store.get<Blob>(key);

const urlCache = new Map<string, string>();

export const cachedBlobUrl = (key: string) => urlCache.get(key) ?? null;

export async function blobUrl(key: string): Promise<string | null> {
  const hit = urlCache.get(key);
  if (hit) return hit;
  const blob = await getBlob(key);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urlCache.set(key, url);
  return url;
}

/** Deletes stored files that no saved board (local-only or any account's copy) references. */
export async function collectGarbage() {
  const all = await store.keys();
  const referenced = new Set<string>();
  for (const k of all) {
    // Boards, and boards kept from another browser, keep their files.
    if ((k.startsWith(LEGACY_STATE_KEY) || k.startsWith('browser-backup:')) && !k.endsWith(':saved-at')) {
      const m = await store.get<ElMap>(k);
      if (m) for (const b of blobKeysIn(m)) referenced.add(b);
    }
  }
  for (const k of all) {
    if (k.startsWith('blob:') && !referenced.has(k)) await store.del(k, true);
  }
}
