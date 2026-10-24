import { textHas } from './hangul';
import type { El, ElMap, ElementType } from './types';
import { ROOT_ID } from './types';
import { elText, elTitle, isHidden, labelDefsOf } from './model';
import { tr } from './i18n';

/* ---------- What can be searched for, and how (the search panel and the [[ ]] link picker) ---------- */

/** Search categories: the type they cover, the name shown, and the \commands that pick them. */
export const SEARCH_KINDS: { type: ElementType; name: string; words: string[] }[] = [
  { type: 'CARD', name: tr('노트', 'Notes'), words: ['note', '노트'] },
  { type: 'TASK_LIST', name: tr('할 일', 'To-dos'), words: ['todo', '할일'] },
  { type: 'BOARD', name: tr('보드', 'Boards'), words: ['board', '보드'] },
  { type: 'IMAGE', name: tr('이미지', 'Images'), words: ['image', '이미지'] },
  { type: 'TABLE', name: tr('표', 'Tables'), words: ['table', '표'] },
  { type: 'COLUMN', name: tr('컬럼', 'Columns'), words: ['column', '컬럼'] },
  { type: 'LINK', name: tr('링크', 'Links'), words: ['link', '링크'] },
  { type: 'FILE', name: tr('파일', 'Files'), words: ['file', '파일'] },
  { type: 'COLOR_SWATCH', name: tr('색상', 'Colors'), words: ['color', '색상'] },
  { type: 'SKETCH', name: tr('그리기', 'Drawings'), words: ['drawing', '그리기'] },
  { type: 'DIAGRAM', name: tr('블록선도', 'Diagrams'), words: ['diagram', '도형', '블록선도'] },
];
/** \tag (or \태그): everything that has a tag. */
const TAG_WORDS = ['tag', '태그'];

export type SearchScope = ElementType | 'tag' | null;

/** The category a typed \command names, if any ('tag' for \tag). */
export function searchScope(word: string): SearchScope {
  const w = word.toLowerCase();
  if (TAG_WORDS.includes(w)) return 'tag';
  return SEARCH_KINDS.find((k) => k.words.includes(w))?.type ?? null;
}

export const scopeName = (scope: SearchScope) => (scope === 'tag' ? tr('태그', 'Tagged') : SEARCH_KINDS.find((k) => k.type === scope)?.name ?? '');

/** The \commands that start with what was typed after the \. */
export const scopeCommands = (typed: string) =>
  [{ word: 'tag', name: tr('태그가 붙은 모든 것', 'Everything tagged') }, ...SEARCH_KINDS.map((k) => ({ word: k.words[0], name: k.name }))].filter((c) =>
    c.word.startsWith(typed.toLowerCase()),
  );

/** Blocks (not lines, not the home board) whose text or tags have `q`, within `scope`. */
export function findBlocks(els: ElMap, q: string, scope: SearchScope): El[] {
  const needle = q.trim().toLowerCase();
  const defs = new Map(labelDefsOf(els).map((d) => [d.id, d] as const));
  const tagNames = (e: El) => [...(e.content.labels ?? []).map((id) => defs.get(id)?.name ?? ''), e.content.tag?.text ?? ''].filter(Boolean);
  return Object.values(els)
    .filter((e) => e.id !== ROOT_ID && e.type !== 'LINE' && e.type !== 'LABELS' && e.type !== 'PROFILE' && !isHidden(els, e.id))
    .filter((e) => (scope === 'tag' ? tagNames(e).length > 0 : scope ? e.type === scope : true))
    // (Korean also by its first consonants: ㅎㅇ finds 회의.)
    .filter((e) => !needle || textHas(elText(e).toLowerCase(), needle) || tagNames(e).some((t) => textHas(t.toLowerCase(), needle)));
}

/* ---------- Links to blocks: [[ ]] in notes and to-dos ---------- */

/** What a link to a block is called where it is put: the block's title (or its first words). */
// (No $ in it: in a to-do's text it would be taken for the start of a formula.)
export const linkLabel = (el: El) => (elTitle(el) || tr('블록', 'Block')).replace(/[$[\]|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60) || tr('블록', 'Block');

/** A link to a block as it sits in a note: one piece the caret steps over, the block's id kept in it. */
export const blockLinkHtml = (id: string, label: string, size?: string | number) => {
  const esc = label.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // A size written in it (|80) is kept, for when the link becomes an embed (! in front).
  const sz = size !== undefined && /^\d{1,3}$/.test(String(size)) ? ` data-size="${size}"` : '';
  return `<a class="block-link" data-ref="${id}"${sz} contenteditable="false">${esc}</a>`;
};

/**
 * A link not yet pointing at a block (nothing was picked): it has only its name. Pressing it makes
 * a new note of that name and points the link at it.
 */
export const unresolvedLinkHtml = (label: string) => {
  const esc = label.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return `<a class="block-link unresolved" data-new="${esc}" contenteditable="false">${esc}</a>`;
};
/** The name an unresolved link gets when nothing was typed. */
export const NEW_NOTE_NAME = () => tr('새 노트', 'New note');

/** A link to a block in a to-do's text: [[label|id]]; without |id it is unresolved: [[label]]. */
export const blockLinkText = (id: string, label: string) => `[[${label.replace(/[[\]|$]/g, ' ')}|${id}]]`;
export const unresolvedLinkText = (label: string) => `[[${label.replace(/[[\]|$]/g, ' ')}]]`;
export const BLOCK_LINK_TEXT = /\[\[([^[\]|]*)(?:\|([\w-]{1,64}))?\]\]/g;

/**
 * An embed in a note (![[ ]]): the block's content shown in the note. Kept as its address,
 * ![[name]] or ![[name|70]] (an image at 70% of its size), which can be edited while the note is.
 */
export const embedHtml = (id: string, label: string, scale?: number) => {
  const esc = label.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[[\]|^]/g, ' ');
  return `<div class="embed" data-ref="${id}"><span class="embed-addr">![[${esc}|${blockAddress(id)}${scale ? `|${scale}` : ''}]]</span></div>`;
};

/**
 * A block's own address in a link or an embed written as text: ^ and the start of its id
 * (e.g. ^9fd94037). It stays the same when the block is renamed, and no two blocks share one.
 */
export const blockAddress = (id: string) => '^' + id.slice(0, 8);
/** The parts of [[alias|^address]] / ![[alias|^address|70]]: the address, and the rest. */
export function splitAddress(inside: string): { address?: string; alias: string; size?: string } {
  const parts = inside.split('|').map((x) => x.trim());
  const at = parts.findIndex((x) => x.startsWith('^'));
  const address = at >= 0 ? parts[at].slice(1).replace(/[^\w-]/g, '') : undefined;
  const rest = parts.filter((_, i) => i !== at);
  const size = rest.length > 1 && /^\d{1,3}$/.test(rest[rest.length - 1]) ? rest.pop() : undefined;
  return { address, alias: rest.join(' ').trim(), size };
}
/** The size an embed's address asks for, in percent of the original (100 when none or not a number). */
export const embedScale = (addr: string) => {
  const m = /\|\s*(\d{1,3})\s*\]\]\s*$/.exec(addr);
  const n = m ? Number(m[1]) : 100;
  return Math.max(5, Math.min(400, n || 100));
};

/*
 * Names of blocks for a link opened up as text ([[address|alias]]): the app tells what a block is
 * called, and which block a name is.
 */
let resolver: { title: (id: string) => string | undefined; byTitle: (name: string) => string | undefined; byAddress: (address: string) => string | undefined } | null = null;
export const setLinkResolver = (r: typeof resolver) => {
  resolver = r;
};
/** The name a block goes by in links (its "address"). */
export const blockNameOf = (id: string) => resolver?.title(id);
/** The block a name stands for, if there is one. */
export const blockByName = (name: string) => resolver?.byTitle(name);
/** The block an address (the part after ^) points at, if there is one. */
export const blockByAddress = (address: string) => resolver?.byAddress(address);

/** The block link copied with Ctrl+L (Ctrl+K puts it where the caret is). */
let copied: { id: string; label: string } | null = null;
export const copiedBlockLink = () => copied;
export const copyBlockLink = (id: string, label: string) => {
  copied = { id, label };
};

/* ---------- The link picker: a search box at the top middle of the screen ---------- */

/** What the picker gives back: the block picked, or (nothing picked) the name typed, for an unresolved link. */
export type Picked = El | { name: string };
type Ask = (pick: (p: Picked) => void) => void;
let ask: Ask | null = null;

/** The app shows the picker (it registers itself here). */
export const setLinkPickerHost = (host: Ask | null) => {
  ask = host;
};

/** Opens the picker; resolves with the block picked, or with the name typed when it was closed without one. */
export const pickBlock = (): Promise<Picked> => new Promise((done) => (ask ? ask(done) : done({ name: '' })));
export const isPickedBlock = (p: Picked): p is El => 'id' in p;

/*
 * An alias: what a link shows instead of the block's name, typed after a | in the finder
 * ([[name|what it says]], as in Obsidian). For an embed a number there is its size (![[name|70]]).
 */
let alias = '';
export const setPickedAlias = (a: string) => {
  alias = a;
};
/** The alias typed with the last pick (taken once). */
export const takePickedAlias = () => {
  const a = alias;
  alias = '';
  return a;
};
/** What a link to the picked block says: the alias typed, or the block's name. */
export const pickedLabel = (el: El) => {
  const a = takePickedAlias().replace(/[$[\]|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
  return a || linkLabel(el);
};
