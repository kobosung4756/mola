import { useCallback, useEffect, useRef, useState } from 'react';
import type { Commit, ElMap } from './types';
import { ROOT_ID } from './types';
import { initialState, syncLinks } from './model';
import { collectGarbage, importAccountBoards, LEGACY_STATE_KEY, loadState, pullFromFolder, saveState, viewingLastCopy } from './db';
import type { FolderPull } from './db';

export type SaveStatus = 'saved' | 'saving' | 'error';

const HISTORY_LIMIT = 200;
/** Autosave: this long after the last change, and never later than SAVE_MAX_WAIT_MS after the first unsaved one. */
const SAVE_PAUSE_MS = 250;
const SAVE_MAX_WAIT_MS = 5000;
/** A save that failed (the local server could not be reached) is tried again this often. */
const SAVE_RETRY_MS = 5000;

function applyPatch(m: ElMap, patch: FolderPull): ElMap {
  const next = { ...m };
  for (const el of patch.upserts) next[el.id] = el;
  for (const id of patch.deletes) delete next[id];
  return next;
}

/**
 * The board as loaded, shared by everything that asks for it at the same moment (the page asks
 * twice while it starts up): one load, one welcome note, the account's boards brought in once —
 * and not a second, older copy that would then be saved over them.
 */
const loading = new Map<string, Promise<ElMap>>();
function loadOnce(stateKey: string): Promise<ElMap> {
  const had = loading.get(stateKey);
  if (had) return had;
  // Boards once kept under a cloud account (sign-in has been removed) come in once, as a board of their own.
  const run = loadState(stateKey)
    .then((s) => (s && s[ROOT_ID] ? s : initialState()))
    .then((s) => importAccountBoards(s, stateKey).catch(() => s));
  loading.set(stateKey, run);
  // A later start (another folder, a reload of the store) loads afresh.
  const forget = () => setTimeout(() => loading.get(stateKey) === run && loading.delete(stateKey), 1500);
  run.then(forget, forget);
  return run;
}

export function useStore(stateKey: string = LEGACY_STATE_KEY) {
  const [els, setEls] = useState<ElMap | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const ref = useRef<ElMap | null>(null);
  const past = useRef<ElMap[]>([]);
  const future = useRef<ElMap[]>([]);
  const lastKey = useRef<string | null>(null);
  /** When the oldest change not yet saved was made. */
  const pendingSince = useRef<number | null>(null);
  /** Read-only (the data folder is in use on another PC): changes are refused and nothing is saved. */
  const readOnlyRef = useRef(viewingLastCopy);
  const [readOnly, setReadOnlyState] = useState(viewingLastCopy);
  const retryTimer = useRef<number | undefined>(undefined);
  /** Saves; when that fails, tries again every few seconds until it works (or the next save replaces it). */
  const persist = useCallback(
    (m: ElMap) => {
      clearTimeout(retryTimer.current);
      return saveState(m, stateKey).then(
        () => setSaveStatus('saved'),
        () => {
          setSaveStatus('error');
          retryTimer.current = window.setTimeout(() => ref.current && !readOnlyRef.current && persist(ref.current), SAVE_RETRY_MS);
        },
      );
    },
    [stateKey],
  );
  /** "다시 시도": saves what is on screen now. */
  const retrySave = useCallback(() => (ref.current && !readOnlyRef.current ? persist(ref.current) : Promise.resolve()), [persist]);
  const setReadOnly = useCallback((on: boolean) => {
    readOnlyRef.current = on;
    setReadOnlyState(on);
  }, []);
  /** Tells the page a change was refused because it is read-only. */
  const refused = () => {
    dispatchEvent(new Event('molanote:read-only'));
    return true;
  };

  useEffect(() => {
    let alive = true;
    const start = (m: ElMap) => {
      if (!alive) return;
      ref.current = m;
      setEls(m);
      collectGarbage().catch(() => {});
    };
    loadOnce(stateKey)
      .then(start)
      .catch(() => alive && start(initialState()));
    navigator.storage?.persist?.().catch(() => {});
    return () => {
      alive = false;
    };
  }, [stateKey]);

  useEffect(() => {
    if (!els || readOnlyRef.current) return;
    setSaveStatus('saving');
    // Saved once edits pause for a moment, and at least every few seconds while they go on.
    if (pendingSince.current === null) pendingSince.current = Date.now();
    const wait = Math.max(0, Math.min(SAVE_PAUSE_MS, pendingSince.current + SAVE_MAX_WAIT_MS - Date.now()));
    const t = setTimeout(() => {
      pendingSince.current = null;
      persist(els);
    }, wait);
    const flush = () => {
      if (document.visibilityState !== 'hidden') return;
      pendingSince.current = null;
      saveState(els, stateKey).catch(() => {});
    };
    document.addEventListener('visibilitychange', flush);
    return () => {
      clearTimeout(t);
      document.removeEventListener('visibilitychange', flush);
    };
  }, [els, stateKey, persist]);

  const commit: Commit = useCallback((fn, key) => {
    const prev = ref.current;
    if (!prev || (readOnlyRef.current && refused())) return;
    const next = { ...prev };
    fn(next);
    // Linked copies follow their originals.
    syncLinks(prev, next);
    if (!key || key !== lastKey.current) {
      past.current.push(prev);
      if (past.current.length > HISTORY_LIMIT) past.current.shift();
    }
    lastKey.current = key ?? null;
    future.current = [];
    ref.current = next;
    setEls(next);
  }, []);

  /** Undo and redo hand back what they changed (before, after, the blocks that differ). */
  type Step = { before: ElMap; after: ElMap; ids: string[] } | null;
  const changedIds = (a: ElMap, b: ElMap) => {
    const ids: string[] = [];
    for (const id in b) if (a[id] !== b[id]) ids.push(id);
    for (const id in a) if (!(id in b)) ids.push(id);
    return ids;
  };

  const undo = useCallback((): Step => {
    if (readOnlyRef.current && refused()) return null;
    const p = past.current.pop();
    if (!p || !ref.current) return null;
    const before = ref.current;
    future.current.push(before);
    lastKey.current = null;
    ref.current = p;
    setEls(p);
    return { before, after: p, ids: changedIds(before, p) };
  }, []);

  const redo = useCallback((): Step => {
    if (readOnlyRef.current && refused()) return null;
    const f = future.current.pop();
    if (!f || !ref.current) return null;
    const before = ref.current;
    past.current.push(before);
    lastKey.current = null;
    ref.current = f;
    setEls(f);
    return { before, after: f, ids: changedIds(before, f) };
  }, []);

  /**
   * Takes in what another PC saved to the data folder: only the blocks it changed, also in the undo
   * history, so undo keeps reverting this PC's own edits. Returns how many blocks changed.
   */
  const pullFolder = useCallback(async () => {
    if (!ref.current) return 0;
    const r = await pullFromFolder(stateKey, ref.current);
    if (!r || !ref.current) return 0;
    const patch = r.pull;
    const n = patch.upserts.length + patch.deletes.length;
    if (!n) return 0;
    past.current = past.current.map((m) => applyPatch(m, patch));
    future.current = future.current.map((m) => applyPatch(m, patch));
    const next = applyPatch(ref.current, patch);
    ref.current = next;
    setEls(next);
    return n;
  }, [stateKey]);

  /** Ends the current merged edit so the next change becomes its own undo step. */
  const breakMerge = useCallback(() => {
    lastKey.current = null;
  }, []);

  return {
    els,
    commit,
    undo,
    redo,
    breakMerge,
    pullFolder,
    retrySave,
    readOnly,
    setReadOnly,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    saveStatus,
  };
}
