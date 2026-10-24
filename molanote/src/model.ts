import { diagramText } from './diagram';
import type { CommentAuthor, Content, El, ElMap, ElementType, LabelDef, Loc } from './types';
import { LABELS_ID, PROFILE_ID, ROOT_ID } from './types';
import { tr } from './i18n';

export const uid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);

export const DEFAULT_WIDTH: Record<ElementType, number> = {
  BOARD: 120,
  CARD: 240,
  TASK_LIST: 240,
  IMAGE: 280,
  LINK: 240,
  FILE: 240,
  COLUMN: 264,
  COLOR_SWATCH: 120,
  TABLE: 380,
  SKETCH: 200,
  DIAGRAM: 360,
  LINE: 0,
  PROFILE: 0,
  LABELS: 0,
};

export const RESIZABLE = new Set<ElementType>(['CARD', 'TASK_LIST', 'IMAGE', 'LINK', 'FILE', 'COLUMN', 'COLOR_SWATCH', 'TABLE', 'SKETCH', 'DIAGRAM']);
/** Types whose height can also be fixed with the resize handle; the rest follow their content. */
export const HEIGHT_RESIZABLE = new Set<ElementType>(['CARD', 'TASK_LIST', 'COLOR_SWATCH', 'SKETCH', 'COLUMN']);
export const MIN_WIDTH: Partial<Record<ElementType, number>> = { COLOR_SWATCH: 80, COLUMN: 180 };

/** Height can be fixed for notes, to-dos, swatches, and link cards that show a paper. */
export const canResizeHeight = (el: El) => HEIGHT_RESIZABLE.has(el.type) || (el.type === 'LINK' && !!el.content.paper);

export function makeEl(type: ElementType, loc: Partial<Loc> & { parentId: string }, content: Content = {}): El {
  const now = Date.now();
  return {
    id: uid(),
    type,
    loc: { section: 'CANVAS', x: 0, y: 0, score: 0, ...loc },
    width: DEFAULT_WIDTH[type],
    content,
    createdAt: now,
    updatedAt: now,
  };
}

export function defaultContent(type: ElementType): Content {
  switch (type) {
    case 'CARD':
      return { html: '' };
    case 'TASK_LIST':
      return { title: '', tasks: [{ id: uid(), text: '', done: false }] };
    case 'LINK':
      return { url: '', title: '' };
    case 'COLUMN':
      return { title: '' };
    case 'BOARD':
      return { title: tr('새 보드', 'New board'), icon: '📋' };
    case 'COLOR_SWATCH':
      return { hex: '#4c8df2', name: '' };
    case 'TABLE':
      return { cells: [['', '', ''], ['', '', ''], ['', '', '']] };
    default:
      return {};
  }
}

export const AVATAR_COLORS = ['#e8590c', '#d6336c', '#ae3ec9', '#7048e8', '#4263eb', '#1c7ed6', '#0c8599', '#2b8a3e', '#5c940d', '#495057'];

/** Stable colour for an account that has not picked one. */
export function avatarColor(seed: string): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

/** Profile shown on comments: the saved one, or a default from the account e-mail. */
export function profileOf(m: ElMap | null, userId: string, email?: string): CommentAuthor {
  const p = m?.[PROFILE_ID]?.content;
  const fallbackName = email ? email.split('@')[0] : tr('나', 'Me');
  return {
    id: userId,
    name: p?.name?.trim() || fallbackName,
    color: p?.hex || avatarColor(userId),
    photoKey: p?.blobKey,
  };
}

const WELCOME_W = 320;
/** Rough height of the welcome note, for placing it. */
const WELCOME_H = 150;

/** Where the welcome note goes: the middle of the board as it first shows (left bar and top bar left out). */
function welcomeSpot(): { parentId: string; x: number; y: number } {
  const w = typeof innerWidth === 'number' ? innerWidth - 72 : 1200;
  const h = typeof innerHeight === 'number' ? innerHeight - 48 : 800;
  return { parentId: ROOT_ID, x: Math.max(40, Math.round((w - WELCOME_W) / 2)), y: Math.max(40, Math.round((h - WELCOME_H) / 2)) };
}

export function initialState(): ElMap {
  const root: El = { ...makeEl('BOARD', { parentId: '' }, { title: tr('홈', 'Home'), icon: '🏠' }), id: ROOT_ID };
  const welcome = makeEl(
    'CARD',
    welcomeSpot(),
    {
      html:
        `<h2>${tr('환영합니다 👋', 'Welcome 👋')}</h2>` +
        `<div>${tr('빈 곳을 더블클릭하면 노트가 생깁니다.', 'Double-click an empty spot to add a note.')}</div>` +
        `<div>${tr('왼쪽 도구로 할 일, 링크, 이미지, 컬럼, 보드를 추가하세요.', 'Use the tools on the left to add to-dos, links, images, columns and boards.')}</div>` +
        `<div>${tr('데이터는 고른 데이터 폴더에 저장되고, 오른쪽 위 ⋯에서 바꿀 수 있습니다.', 'Your data is kept in the data folder you chose; change it with ⋯ at the top right.')}</div>`,
    },
  );
  welcome.width = WELCOME_W;
  return { [root.id]: root, [welcome.id]: welcome };
}

export type ElPatch = Partial<Omit<El, 'content' | 'id'>> & { content?: Partial<Content> };

/** Replaces the element with an updated copy. Never mutate element objects in place. */
export function update(m: ElMap, id: string, patch: ElPatch) {
  const el = m[id];
  if (!el) return;
  m[id] = {
    ...el,
    ...patch,
    content: patch.content ? { ...el.content, ...patch.content } : el.content,
    updatedAt: Date.now(),
  };
}

export function childrenOf(m: ElMap, parentId: string, section?: Loc['section']): El[] {
  return Object.values(m).filter((e) => e.loc.parentId === parentId && (!section || e.loc.section === section));
}

export const canvasItems = (m: ElMap, boardId: string) =>
  childrenOf(m, boardId, 'CANVAS').filter((e) => e.type !== 'LINE');

export const linesOf = (m: ElMap, boardId: string) =>
  childrenOf(m, boardId, 'CANVAS').filter((e) => e.type === 'LINE');

/** Every label the account has made, in creation order. */
export const labelDefsOf = (m: ElMap | null): LabelDef[] => m?.[LABELS_ID]?.content.labelDefs ?? [];

/** Makes a new label and returns its id; the shared LABELS element is created on first use. */
export function createLabel(m: ElMap, name: string, color: string): string {
  const def: LabelDef = { id: uid(), name: name.trim(), color };
  if (m[LABELS_ID]) update(m, LABELS_ID, { content: { labelDefs: [...labelDefsOf(m), def] } });
  else m[LABELS_ID] = { ...makeEl('LABELS', { parentId: '' }, { labelDefs: [def] }), id: LABELS_ID };
  return def.id;
}

/** Renames a tag and/or changes its colour (on every block that has it). */
export function editLabel(m: ElMap, labelId: string, name: string, color: string) {
  if (!m[LABELS_ID]) return;
  update(m, LABELS_ID, { content: { labelDefs: labelDefsOf(m).map((d) => (d.id === labelId ? { ...d, name: name.trim() || d.name, color } : d)) } });
}

/** Deletes a label everywhere: from the list and from every block that had it. */
export function deleteLabel(m: ElMap, labelId: string) {
  if (m[LABELS_ID]) update(m, LABELS_ID, { content: { labelDefs: labelDefsOf(m).filter((d) => d.id !== labelId) } });
  for (const el of Object.values(m)) {
    if (el.content.labels?.includes(labelId)) {
      const rest = el.content.labels.filter((l) => l !== labelId);
      update(m, el.id, { content: { labels: rest.length ? rest : undefined } });
    }
  }
}

/** Puts a label on a block, or takes it off. */
export function toggleLabel(m: ElMap, elId: string, labelId: string) {
  const el = m[elId];
  if (!el) return;
  const has = el.content.labels?.includes(labelId);
  const next = has ? el.content.labels!.filter((l) => l !== labelId) : [...(el.content.labels ?? []), labelId];
  update(m, elId, { content: { labels: next.length ? next : undefined } });
}

/** Adds or removes this person's emoji reaction on an element. */
export function toggleReaction(m: ElMap, id: string, emoji: string, userId: string) {
  const el = m[id];
  if (!el) return;
  const all = { ...(el.content.reactions ?? {}) };
  const who = all[emoji] ?? [];
  const next = who.includes(userId) ? who.filter((u) => u !== userId) : [...who, userId];
  if (next.length) all[emoji] = next;
  else delete all[emoji];
  update(m, id, { content: { reactions: Object.keys(all).length ? all : undefined } });
}

/** Items waiting in a board's Unsorted panel, top first. */
export const inboxOf = (m: ElMap, boardId: string) =>
  childrenOf(m, boardId, 'INBOX').sort((a, b) => a.loc.score - b.loc.score);

/** Moves elements into the board's Unsorted panel, newest at the top in the given order. */
export function toInbox(m: ElMap, ids: string[], boardId: string) {
  const top = Math.min(0, ...inboxOf(m, boardId).filter((e) => !ids.includes(e.id)).map((e) => e.loc.score));
  ids.forEach((id, k) => {
    if (!m[id]) return;
    update(m, id, { loc: { parentId: boardId, section: 'INBOX', x: 0, y: 0, score: top - (ids.length - k) } });
  });
}

export const attachedOf = (m: ElMap, columnId: string) =>
  childrenOf(m, columnId, 'ATTACHED').sort((a, b) => a.loc.score - b.loc.score);

/** True if the element or any ancestor is in the trash, or the parent chain is broken. */
export function isHidden(m: ElMap, id: string): boolean {
  let cur: El | undefined = m[id];
  let guard = 0;
  while (cur && guard++ < 1000) {
    if (cur.loc.section === 'TRASH') return true;
    if (cur.id === ROOT_ID) return false;
    cur = m[cur.loc.parentId];
  }
  return true;
}

export function descendants(m: ElMap, id: string): Set<string> {
  const byParent = new Map<string, string[]>();
  for (const e of Object.values(m)) {
    const list = byParent.get(e.loc.parentId);
    if (list) list.push(e.id);
    else byParent.set(e.loc.parentId, [e.id]);
  }
  const out = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const c of byParent.get(cur) ?? []) {
      if (!out.has(c)) {
        out.add(c);
        stack.push(c);
      }
    }
  }
  return out;
}

/** The board an element is shown on (walks up through columns). */
export function containingBoard(m: ElMap, id: string): string {
  let cur = m[m[id]?.loc.parentId];
  let guard = 0;
  while (cur && guard++ < 1000) {
    if (cur.type === 'BOARD') return cur.id;
    cur = m[cur.loc.parentId];
  }
  return ROOT_ID;
}

export function boardPath(m: ElMap, boardId: string): El[] {
  const out: El[] = [];
  let cur: El | undefined = m[boardId];
  let guard = 0;
  while (cur && guard++ < 1000) {
    if (cur.type === 'BOARD') out.unshift(cur);
    if (cur.id === ROOT_ID) break;
    cur = m[cur.loc.parentId];
  }
  return out;
}

export function htmlToText(html: string): string {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(
    html.replace(/<\/(div|p|h1|h2|h3|li)>/gi, '</$1>\n').replace(/<br\s*\/?>/gi, '\n'),
    'text/html',
  );
  return (doc.body.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
}

/** A to-do's text without its marks ({#e03131|coloured}, ==highlighted==, **bold** …), for search, titles and embeds. */
export function plainTaskText(text: string): string {
  // Marks may hold others ({#e03131|**bold red**}): taken off until none are left.
  for (let i = 0; i < 5; i++) {
    const next = text
      .replace(/\{=?#[0-9a-fA-F]{6}\|([^{}\n]+)\}/g, '$1')
      .replace(/\*\*(?=\S)([^*\n]+?)\*\*|`([^`\n]+)`|~~([^~\n]+?)~~|==([^=\n]+?)==/g, (_m, a, b, c, d) => a ?? b ?? c ?? d ?? '');
    if (next === text) break;
    text = next;
  }
  return text;
}

export function elText(el: El): string {
  const c = el.content;
  return [
    c.title,
    htmlToText(c.html ?? ''),
    ...(c.tasks ?? []).map((t) => plainTaskText(t.text)),
    diagramText(c.diagram),
    c.url,
    c.caption,
    c.fileName,
    c.name,
    c.hex,
    c.label,
    c.paper?.title,
    c.preview?.title,
    ...(c.paper?.authors ?? []),
    c.paper?.abstract,
    ...(c.comments ?? []).map((cm) => cm.text),
    ...(c.cells ?? []).flat(),
    c.tag?.text,
  ]
    .filter(Boolean)
    .join(' ');
}

export function elTitle(el: El): string {
  const c = el.content;
  switch (el.type) {
    case 'BOARD':
      return `${c.icon ?? ''} ${c.title || tr('제목 없는 보드', 'Untitled board')}`.trim();
    case 'COLUMN':
      return c.title || tr('컬럼', 'Column');
    case 'TASK_LIST':
      return c.title || (c.tasks ?? []).map((t) => plainTaskText(t.text)).filter(Boolean)[0] || 'New To-do List';
    case 'IMAGE':
      return c.caption || tr('이미지', 'Image');
    case 'FILE':
      return c.fileName || tr('파일', 'File');
    case 'LINK':
      return c.paper?.title || c.title || c.preview?.title || c.url || tr('링크', 'Link');
    case 'TABLE':
      return c.title || (c.cells ?? []).flat().find(Boolean) || tr('표', 'Table');
    case 'SKETCH':
      return tr('그림', 'Drawing');
    case 'DIAGRAM':
      return diagramText(c.diagram).split(' ')[0] || tr('블록선도', 'Block diagram');
    case 'COLOR_SWATCH':
      return c.name || c.hex || tr('색상', 'Color');
    default:
      return (c.showTitle && c.title) || htmlToText(c.html ?? '').split('\n')[0] || tr('빈 노트', 'Empty note');
  }
}

/** Fractional scores for inserting `n` items at `index` of a column. */
export function scoresAt(m: ElMap, columnId: string, index: number, exclude: string[], n: number): number[] {
  const kids = attachedOf(m, columnId).filter((k) => !exclude.includes(k.id));
  const prev = kids[index - 1]?.loc.score;
  const next = kids[index]?.loc.score;
  let lo: number;
  let hi: number;
  if (prev === undefined && next === undefined) {
    lo = 0;
    hi = n + 1;
  } else if (prev === undefined) {
    hi = next!;
    lo = hi - (n + 1);
  } else if (next === undefined) {
    lo = prev;
    hi = lo + n + 1;
  } else {
    lo = prev;
    hi = next;
  }
  return Array.from({ length: n }, (_, i) => lo + ((hi - lo) * (i + 1)) / (n + 1));
}

/** Removes lines whose attached endpoints were deleted or no longer sit on the line's board. */
export function pruneLines(m: ElMap) {
  for (const ln of Object.values(m)) {
    if (ln.type !== 'LINE') continue;
    const board = ln.loc.parentId;
    const endOk = (id?: string, point?: { x: number; y: number }) => {
      if (point) return true;
      const el = m[id ?? ''];
      return !!el && containingBoard(m, el.id) === board;
    };
    if (!endOk(ln.content.from, ln.content.fromPoint) || !endOk(ln.content.to, ln.content.toPoint)) delete m[ln.id];
  }
}

export function trashIds(m: ElMap, ids: string[]) {
  for (const id of ids) {
    const el = m[id];
    if (!el || id === ROOT_ID) continue;
    if (el.type === 'LINE') {
      delete m[id];
      continue;
    }
    update(m, id, { prevLoc: el.loc, loc: { ...el.loc, section: 'TRASH' } });
  }
}

export function restore(m: ElMap, id: string) {
  const el = m[id];
  if (!el) return;
  const prev = el.prevLoc;
  const parent = prev ? m[prev.parentId] : undefined;
  const ok =
    prev && parent && !isHidden(m, parent.id) && (prev.section !== 'ATTACHED' || parent.type === 'COLUMN');
  update(m, id, {
    prevLoc: undefined,
    loc: ok ? prev : { parentId: ROOT_ID, section: 'CANVAS', x: 100, y: 100, score: 0 },
  });
}

export function deleteForever(m: ElMap, id: string) {
  if (id === ROOT_ID) return;
  const gone = descendants(m, id);
  gone.add(id);
  for (const g of gone) delete m[g];
  pruneLines(m);
}

export interface Snapshot {
  roots: string[];
  items: El[];
  /** Lines picked on their own (their blocks not picked): pasted again between the same blocks. */
  loose?: El[];
}

/**
 * Captures elements with everything inside them and the lines between them. With `shortcuts`
 * (copying), a board is taken without what is inside it: it is pasted as a shortcut to itself.
 */
export function makeSnapshot(m: ElMap, ids: string[], opts: { shortcuts?: boolean } = {}): Snapshot {
  const all = new Set<string>();
  const roots = ids.filter((id) => m[id] && m[id].type !== 'LINE' && id !== ROOT_ID);
  const kids = new Map<string, string[]>();
  for (const e of Object.values(m)) (kids.get(e.loc.parentId) ?? kids.set(e.loc.parentId, []).get(e.loc.parentId)!).push(e.id);
  const take = (id: string) => {
    all.add(id);
    if (opts.shortcuts && m[id].type === 'BOARD') return;
    for (const c of kids.get(id) ?? []) if (m[c].loc.section !== 'TRASH' && !all.has(c)) take(c);
  };
  for (const id of roots) take(id);
  for (const e of Object.values(m)) {
    if (e.type !== 'LINE') continue;
    const c = e.content;
    const fromOk = c.fromPoint ? true : all.has(c.from ?? '');
    const toOk = c.toPoint ? true : all.has(c.to ?? '');
    const touches = (!c.fromPoint && all.has(c.from ?? '')) || (!c.toPoint && all.has(c.to ?? ''));
    if (fromOk && toOk && touches) all.add(e.id);
  }
  const loose = ids
    .filter((id) => m[id]?.type === 'LINE' && !all.has(id))
    .map((id) => structuredClone(m[id]));
  const items = [...all].map((id) => {
    const copy = structuredClone(m[id]);
    if (opts.shortcuts && copy.type === 'BOARD') copy.boardRef = copy.boardRef ?? copy.id;
    return copy;
  });
  return { roots, items, loose };
}

/** The block a linked copy really comes from (a copy of a copy leads to the first one). */
export const linkSource = (m: ElMap, id: string) => (m[id]?.linkOf && m[m[id].linkOf!] ? m[id].linkOf! : id);

/**
 * What every block has for itself, linked or not: its comments, reactions, title and caption, and
 * tags. These never come from the original, and changing them on a copy keeps the link. (A board's
 * or a column's title is its name, so it is content there.)
 */
const OWN_FIELDS = ['comments', 'reactions', 'title', 'showTitle', 'caption', 'showCaption', 'labels', 'tag'] as const;
const ownFields = (e: El): readonly string[] => (e.type === 'BOARD' || e.type === 'COLUMN' ? OWN_FIELDS.filter((k) => k !== 'title') : OWN_FIELDS);

/** A block's content without its own extras: what a linked copy shares with its original. */
function sharedContent(e: El): Record<string, unknown> {
  const out: Record<string, unknown> = { ...e.content };
  for (const k of ownFields(e)) delete out[k];
  return out;
}

/** The original's content with the copy's own extras kept. */
function withOwnExtras(copy: El, original: El): El['content'] {
  const next: Record<string, unknown> = { ...sharedContent(original) };
  const mine = copy.content as Record<string, unknown>;
  for (const k of ownFields(copy)) if (mine[k] !== undefined) next[k] = mine[k];
  return next as El['content'];
}

/**
 * After a change: what changed in a linked block's content shows up in its copies (content and
 * colour; where each copy sits, how big it is and its own extras stay its own). A copy whose own
 * content was changed no longer follows; comments, reactions, titles and tags keep the link.
 */
export function syncLinks(prev: ElMap, m: ElMap) {
  const copies = new Map<string, string[]>();
  for (const e of Object.values(m)) if (e.linkOf) (copies.get(e.linkOf) ?? copies.set(e.linkOf, []).get(e.linkOf)!).push(e.id);
  if (!copies.size) return;
  const same = (a: El, b: El) => JSON.stringify(sharedContent(a)) === JSON.stringify(sharedContent(b)) && (a.color ?? '') === (b.color ?? '');
  // A copy changed on its own (not by its original): it goes its own way from now on.
  for (const list of copies.values())
    for (const cid of list) {
      const c = m[cid];
      const o = m[c.linkOf!];
      if (!o || c === prev[cid] || !prev[cid]) continue;
      if (o === prev[o.id] && !same(c, o)) {
        const { linkOf: _gone, ...rest } = c;
        void _gone;
        m[cid] = rest;
      }
    }
  // An original changed: its copies take it in.
  for (const [oid, list] of copies) {
    const o = m[oid];
    if (!o || o === prev[oid]) continue;
    for (const cid of list) {
      const c = m[cid];
      if (!c?.linkOf || same(c, o)) continue;
      m[cid] = { ...c, content: withOwnExtras(c, o), color: o.color, updatedAt: o.updatedAt };
    }
  }
}

/** A line's copy beside it: the same blocks, bowed out a little more so both can be seen. */
function looseCopies(m: ElMap, snap: Snapshot, boardId: string, n: number): string[] {
  const out: string[] = [];
  for (const ln of snap.loose ?? []) {
    const c = ln.content;
    const ok = (id?: string, p?: unknown) => !!p || (!!id && !!m[id] && !isHidden(m, id));
    if (!ok(c.from, c.fromPoint) || !ok(c.to, c.toPoint)) continue;
    const copy: El = { ...structuredClone(ln), id: uid(), createdAt: Date.now(), updatedAt: Date.now() };
    copy.loc = { ...ln.loc, parentId: boardId };
    copy.content = { ...c, bend: (c.bend ?? 0) + 40 * n };
    m[copy.id] = copy;
    out.push(copy.id);
  }
  return out;
}

/** Where a paste goes: `offset` moves blocks that were on a board; the others go near `fallback`. */
export type PastePlace = { offset: { dx: number; dy: number }; fallback: { x: number; y: number } };

/**
 * Pastes what was cut: the very blocks come back out of the trash at the new place (keeping their
 * comments, tags and what is inside them), with the lines between them. Returns null when they are
 * no longer all in the trash (then a copy is pasted instead).
 */
export function pasteCut(m: ElMap, snap: Snapshot, boardId: string, place: PastePlace): string[] | null {
  if (!snap.roots.length || !snap.roots.every((id) => m[id]?.loc.section === 'TRASH')) return null;
  const inSnap = new Set(snap.items.map((e) => e.id));
  let k = 0;
  for (const e of snap.items) {
    if (snap.roots.includes(e.id)) {
      const loc: Loc =
        e.loc.section === 'CANVAS'
          ? { ...e.loc, parentId: boardId, x: e.loc.x + place.offset.dx, y: e.loc.y + place.offset.dy }
          : { parentId: boardId, section: 'CANVAS', x: place.fallback.x + k * 24, y: place.fallback.y + k * 24, score: 0 };
      if (e.loc.section !== 'CANVAS') k++;
      update(m, e.id, { loc, prevLoc: undefined });
    } else if (e.type === 'LINE' && !m[e.id]) {
      // Cutting removed the lines between the blocks; they come back with them.
      const shift = (pt?: { x: number; y: number }) => (pt ? { x: pt.x + place.offset.dx, y: pt.y + place.offset.dy } : undefined);
      m[e.id] = {
        ...structuredClone(e),
        loc: { ...e.loc, parentId: inSnap.has(e.loc.parentId) ? e.loc.parentId : boardId },
        content: { ...e.content, fromPoint: shift(e.content.fromPoint), toPoint: shift(e.content.toPoint) },
        updatedAt: Date.now(),
      };
    }
  }
  pruneLines(m);
  return [...snap.roots, ...looseCopies(m, snap, boardId, 1)];
}

/** Pastes a copy (the n-th paste of the same copy shifts loose lines a little further). */
export function pasteCopy(m: ElMap, snap: Snapshot, boardId: string, place: PastePlace, n: number): string[] {
  const roots = snap.roots.length ? insertSnapshot(m, snap, boardId, place.offset, place.fallback, true) : [];
  return [...roots, ...looseCopies(m, snap, boardId, n)];
}

/** Inserts copies of a snapshot. Root items land on `boardId` at their position plus the offset. */
export function insertSnapshot(
  m: ElMap,
  snap: Snapshot,
  boardId: string,
  offset: { dx: number; dy: number },
  fallback: { x: number; y: number },
  link = false,
): string[] {
  const idMap = new Map<string, string>();
  for (const e of snap.items) idMap.set(e.id, uid());
  const now = Date.now();
  let k = 0;
  for (const e of snap.items) {
    const copy: El = structuredClone(e);
    copy.id = idMap.get(e.id)!;
    copy.createdAt = now;
    copy.updatedAt = now;
    delete copy.z;
    // Pasted copies follow their original (as it is now), lines excepted.
    if (link && e.type !== 'LINE') {
      const from = m[e.linkOf ?? ''] ? e.linkOf! : m[e.id] ? e.id : null;
      if (from) {
        copy.linkOf = from;
        copy.content = m[from].content;
        copy.color = m[from].color;
      }
    }
    if (snap.roots.includes(e.id)) {
      copy.loc =
        e.loc.section === 'CANVAS'
          ? { ...e.loc, parentId: boardId, x: e.loc.x + offset.dx, y: e.loc.y + offset.dy }
          : { parentId: boardId, section: 'CANVAS', x: fallback.x + k * 24, y: fallback.y + k * 24, score: 0 };
      k++;
    } else if (e.type === 'LINE') {
      copy.loc = { ...e.loc, parentId: idMap.get(e.loc.parentId) ?? boardId };
      const shift = (p?: { x: number; y: number }) => (p ? { x: p.x + offset.dx, y: p.y + offset.dy } : undefined);
      copy.content = {
        ...e.content,
        from: e.content.fromPoint ? undefined : idMap.get(e.content.from!),
        to: e.content.toPoint ? undefined : idMap.get(e.content.to!),
        fromPoint: shift(e.content.fromPoint),
        toPoint: shift(e.content.toPoint),
      };
    } else {
      copy.loc = { ...e.loc, parentId: idMap.get(e.loc.parentId) ?? e.loc.parentId };
    }
    m[copy.id] = copy;
  }
  pruneLines(m);
  return snap.roots.map((r) => idMap.get(r)!);
}

export function blobKeysIn(m: ElMap): Set<string> {
  const keys = new Set<string>();
  for (const e of Object.values(m)) {
    if (e.content.blobKey) keys.add(e.content.blobKey);
    if (e.content.paper?.blobKey) keys.add(e.content.paper.blobKey);
    if (e.content.preview?.imageKey) keys.add(e.content.preview.imageKey);
    for (const cm of e.content.comments ?? []) if (cm.author.photoKey) keys.add(cm.author.photoKey);
  }
  return keys;
}

export function boardToMarkdown(m: ElMap, boardId: string, depth = 0): string {
  const lines: string[] = [];
  const items = canvasItems(m, boardId).sort((a, b) => a.loc.y - b.loc.y || a.loc.x - b.loc.x);
  const render = (el: El, indent: string) => {
    const c = el.content;
    switch (el.type) {
      case 'CARD':
        lines.push(indent + htmlToText(c.html ?? '').replace(/\n/g, '\n' + indent), '');
        break;
      case 'TASK_LIST':
        if (c.title) lines.push(`${indent}**${c.title}**`);
        for (const t of c.tasks ?? []) lines.push(`${indent}- [${t.done ? 'x' : ' '}] ${t.text}`);
        lines.push('');
        break;
      case 'LINK':
        lines.push(`${indent}[${c.paper?.title || c.title || c.url}](${c.url})`, '');
        if (c.paper?.authors?.length) lines.push(`${indent}${c.paper.authors.join(', ')}`, '');
        break;
      case 'IMAGE':
        lines.push(`${indent}🖼️ ${c.caption || tr('이미지', 'Image')}`, '');
        break;
      case 'FILE':
        lines.push(`${indent}📎 ${c.fileName}`, '');
        break;
      case 'COLOR_SWATCH':
        lines.push(`${indent}🎨 ${c.name ? c.name + ' ' : ''}${c.hex}`, '');
        break;
      case 'DIAGRAM':
        lines.push(`${indent}🔷 ${tr('블록선도', 'Block diagram')}${diagramText(c.diagram) ? ': ' + diagramText(c.diagram) : ''}`, '');
        break;
      case 'BOARD':
        lines.push(`${indent}${'#'.repeat(Math.min(depth + 2, 6))} ${c.icon ?? ''} ${c.title}`, '');
        lines.push(boardToMarkdown(m, el.id, depth + 1));
        break;
      case 'TABLE': {
        if (c.title) lines.push(`${indent}**${c.title}**`, '');
        const rows = c.cells ?? [];
        rows.forEach((row, r) => {
          lines.push(`${indent}| ${row.map((v) => v.replace(/\|/g, '\\|')).join(' | ')} |`);
          if (r === 0) lines.push(`${indent}|${row.map(() => ' --- ').join('|')}|`);
        });
        lines.push('');
        break;
      }
      case 'SKETCH':
        lines.push(`${indent}✏️ ${tr('그림', 'Drawing')}`, '');
        break;
      case 'COLUMN':
        lines.push(`${indent}**▤ ${c.title || tr('컬럼', 'Column')}**`, '');
        for (const k of attachedOf(m, el.id)) render(k, indent + '  ');
        break;
    }
  };
  for (const el of items) render(el, '');
  return lines.join('\n');
}
