import type { El, ElMap } from './types';
import { ROOT_ID } from './types';
import { isHidden } from './model';

/*
 * What this person goes to often, for the board finder (Ctrl+O) and the search (Ctrl+Space) to
 * offer before anything is typed. Kept in this browser only (a convenience, not part of the data).
 */

type Seen = Record<string, { n: number; t: number }>;
type Recent = { boards: Seen; picks: Seen; queries: { q: string; t: number }[] };

const KEY = 'molanote.recent.v1';
const empty = (): Recent => ({ boards: {}, picks: {}, queries: [] });

function load(): Recent {
  try {
    const r = JSON.parse(localStorage.getItem(KEY) ?? '') as Partial<Recent>;
    return { boards: r.boards ?? {}, picks: r.picks ?? {}, queries: Array.isArray(r.queries) ? r.queries : [] };
  } catch {
    return empty();
  }
}

function save(r: Recent) {
  try {
    localStorage.setItem(KEY, JSON.stringify(r));
  } catch {
    // Storage may be blocked (a private window): nothing is offered then.
  }
}

const bump = (seen: Seen, id: string) => {
  seen[id] = { n: (seen[id]?.n ?? 0) + 1, t: Date.now() };
  // Only the most used ones are kept.
  const ids = Object.keys(seen);
  if (ids.length > 200) for (const old of ids.sort((a, b) => seen[a].t - seen[b].t).slice(0, ids.length - 200)) delete seen[old];
};

/** A board was opened. */
export function noteBoardVisit(id: string) {
  if (id === ROOT_ID) return;
  const r = load();
  bump(r.boards, id);
  save(r);
}

/** A search result was picked (and what had been typed for it). */
export function noteSearchPick(id: string, q: string) {
  const r = load();
  bump(r.picks, id);
  const typed = q.trim();
  if (typed) r.queries = [{ q: typed, t: Date.now() }, ...r.queries.filter((x) => x.q !== typed)].slice(0, 8);
  save(r);
}

/** Often and lately used first: each use counts, a recent one a little more. */
const rank = (seen: Seen) => {
  const now = Date.now();
  const score = (id: string) => seen[id].n + 3 / (1 + (now - seen[id].t) / 86_400_000);
  return Object.keys(seen).sort((a, b) => score(b) - score(a));
};

const alive = (els: ElMap, id: string) => !!els[id] && !isHidden(els, id);

/** Boards gone to most. */
export const topBoards = (els: ElMap, k = 6): El[] =>
  rank(load().boards)
    .filter((id) => alive(els, id) && els[id].type === 'BOARD')
    .slice(0, k)
    .map((id) => els[id]);

/** Things picked most from the search. */
export const topPicks = (els: ElMap, k = 6): El[] =>
  rank(load().picks)
    .filter((id) => alive(els, id))
    .slice(0, k)
    .map((id) => els[id]);

/** Blocks changed most lately (not the ones in `skip`), newest first. */
export const recentEdits = (els: ElMap, skip: Set<string>, k = 6): El[] =>
  Object.values(els)
    .filter((e) => !skip.has(e.id) && !['PROFILE', 'LABELS', 'LINE'].includes(e.type) && e.loc.parentId && alive(els, e.id))
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .slice(0, k);

/** What was searched for lately. */
export const recentQueries = (k = 5) => load().queries.slice(0, k).map((x) => x.q);
