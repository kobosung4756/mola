import type { El, ElMap } from './types';
import { ROOT_ID } from './types';
import { containingBoard, elText, elTitle, isHidden } from './model';
import { BLOCK_LINK_TEXT } from './blockLinks';
import { tr } from './i18n';

/*
 * The relation map (bottom-right switch): every block and how blocks are tied together, scored and
 * levelled the way ideaverse-maps (github.com/nickmilo/ideaverse-maps, MIT, Nick Milo) does it
 * for an Obsidian vault. Blocks take the place of notes, boards and columns the place of folders and maps.
 */

/** How two blocks are tied. */
export type RelKind =
  /** A connector line drawn between them on a board. */
  | 'line'
  /** A [[ ]] link in a note or a to-do. */
  | 'link'
  /** An ![[ ]] embed in a note. */
  | 'embed'
  /** A board inside a board. */
  | 'board'
  /** A block put in a column. */
  | 'column'
  /** A block on a board. */
  | 'on'
  /** A linked copy (pasted elsewhere with Ctrl+V) and its original. */
  | 'copy'
  /** A board pasted as a shortcut, and that board. */
  | 'shortcut';

export const REL_KINDS: RelKind[] = ['line', 'link', 'embed', 'copy', 'shortcut', 'board', 'column', 'on'];

/** Kinds that are a block being somewhere, not two blocks referring to each other. */
export const PLACE_KINDS: RelKind[] = ['board', 'column', 'on'];

export interface RelEdge {
  /** From (the one linking, the container, the copy) to (the one linked, held, the original). */
  a: string;
  b: string;
  kind: RelKind;
  /** The connector line's own id, for a 'line'. */
  via?: string;
}

export interface RelNode {
  id: string;
  el: El;
  title: string;
  /** Searchable text. */
  text: string;
  /** The board the block is shown on (itself for a board). */
  board: string;
  /** The top-level board it is under (the home board's own blocks: the home board): a column of the map. */
  area: string;
  /** Hops from the home board through boards. */
  depth: number;
  /** References in and out (not counting where it is). */
  inn: number;
  out: number;
  /** Blocks it holds (boards and columns). */
  kids: number;
  score: number;
  /** When it was made (ms). */
  created: number;
  /** Words in it, and its size in KB (its content, and its file if it has one). */
  words: number;
  kb: number;
  level: 1 | 2 | 3 | 4 | 5;
  /** Why it has its level. */
  why: string;
}

export interface RelGraph {
  nodes: RelNode[];
  byId: Map<string, RelNode>;
  edges: RelEdge[];
  /** Neighbours over every kind of edge. */
  adj: Map<string, { id: string; kind: RelKind; out: boolean }[]>;
  /** The top-level boards, in board order: the columns of Emergence, the sectors of Gravity. */
  areas: string[];
}

const SKIP = new Set(['LINE', 'LABELS', 'PROFILE']);

/** Ids of blocks a note's html links ([[ ]]) and embeds (![[ ]]). */
function htmlRefs(html: string): { link: string[]; embed: string[] } {
  const link: string[] = [];
  const embed: string[] = [];
  for (const m of html.matchAll(/<(a|div)\b([^>]*)>/g)) {
    const attrs = m[2];
    const ref = /\bdata-ref="([\w-]{1,64})"/.exec(attrs)?.[1];
    if (!ref) continue;
    if (m[1] === 'a' && /\bclass="[^"]*\bblock-link\b/.test(attrs)) link.push(ref);
    else if (m[1] === 'div' && /\bclass="[^"]*\bembed\b/.test(attrs)) embed.push(ref);
  }
  return { link, embed };
}

/** Weights and cut-offs, as in ideaverse-maps' scanner, scaled down for a board (fewer links than a vault). */
const W = { in: 1, out: 0.6, both: 0.8, kids: 0.45 };
const L3 = 2;
const L4 = 3;

export function relationGraph(els: ElMap): RelGraph {
  // (Not the home board itself: it holds everything, so it would only tie to all of it.)
  const shown = Object.values(els).filter((e) => e.id !== ROOT_ID && !SKIP.has(e.type) && !isHidden(els, e.id));
  const ok = new Set(shown.map((e) => e.id));
  const edges: RelEdge[] = [];
  const seen = new Set<string>();
  const add = (a: string, b: string, kind: RelKind, via?: string) => {
    if (a === b || !ok.has(a) || !ok.has(b)) return;
    const key = `${a}>${b}>${kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ a, b, kind, via });
  };

  for (const e of shown) {
    const c = e.content;
    if (e.id !== ROOT_ID) {
      const p = els[e.loc.parentId];
      if (p && e.loc.section === 'ATTACHED' && p.type === 'COLUMN') add(p.id, e.id, 'column');
      else if (p) add(p.id, e.id, e.type === 'BOARD' ? 'board' : 'on');
    }
    if (e.linkOf) add(e.id, e.linkOf, 'copy');
    if (e.boardRef) add(e.id, e.boardRef, 'shortcut');
    // (A linked copy's text is its original's: its links are the original's, counted once.)
    if (!e.linkOf) {
      if (c.html) {
        const r = htmlRefs(c.html);
        r.link.forEach((id) => add(e.id, id, 'link'));
        r.embed.forEach((id) => add(e.id, id, 'embed'));
      }
      for (const t of c.tasks ?? []) for (const m of t.text.matchAll(BLOCK_LINK_TEXT)) if (m[2]) add(e.id, m[2], 'link');
    }
  }
  for (const ln of Object.values(els)) {
    if (ln.type !== 'LINE' || isHidden(els, ln.id)) continue;
    const { from, to, fromPoint, toPoint } = ln.content;
    if (from && to && !fromPoint && !toPoint) add(from, to, 'line', ln.id);
  }

  const adj: RelGraph['adj'] = new Map(shown.map((e) => [e.id, []]));
  for (const ed of edges) {
    adj.get(ed.a)!.push({ id: ed.b, kind: ed.kind, out: true });
    adj.get(ed.b)!.push({ id: ed.a, kind: ed.kind, out: false });
  }

  // Where each block is: its board, its top-level board, how deep.
  const areaOf = (id: string): { area: string; depth: number } => {
    let cur: El | undefined = els[id];
    const chain: string[] = [];
    let guard = 0;
    while (cur && cur.id !== ROOT_ID && guard++ < 1000) {
      if (cur.type === 'BOARD') chain.unshift(cur.id);
      cur = els[cur.loc.parentId];
    }
    return { area: chain[0] ?? ROOT_ID, depth: chain.length };
  };

  const nodes: RelNode[] = shown.map((e) => {
    const refs = adj.get(e.id)!.filter((x) => !PLACE_KINDS.includes(x.kind));
    const inn = refs.filter((x) => !x.out).length;
    const out = refs.filter((x) => x.out).length;
    const kids = adj.get(e.id)!.filter((x) => x.out && PLACE_KINDS.includes(x.kind)).length;
    const both = refs.filter((x) => x.out && refs.some((y) => !y.out && y.id === x.id)).length;
    const bi = Math.log1p(inn);
    const bo = Math.log1p(out);
    // (Two-way ties count extra, as ideaverse's "both"; a container's blocks count a little.)
    const score = Math.round((W.in * bi + W.out * bo + W.both * Math.sqrt(bi * bo) * (both ? 1 : 0.5) + W.kids * Math.log1p(kids)) * 1000) / 1000;
    const { area, depth } = areaOf(e.id);
    const plain = elText(e);
    return {
      id: e.id,
      el: e,
      title: e.id === ROOT_ID ? 'Home' : elTitle(e),
      text: `${elTitle(e)} ${plain}`.toLowerCase(),
      created: e.createdAt || 0,
      words: plain.split(/\s+/).filter(Boolean).length,
      kb: (JSON.stringify(e.content).length + (e.content.fileSize ?? 0)) / 1024,
      board: e.type === 'BOARD' ? e.id : containingBoard(els, e.id),
      area: e.type === 'BOARD' && depth === 1 ? e.id : area,
      depth,
      inn,
      out,
      kids,
      score,
      level: 1,
      why: '',
    };
  });

  // Levels, as ideaverse's: 5 home and the top few, 4 maps of maps and the most tied, 3 maps (boards,
  // columns) and the well tied, 2 tied to something, 1 tied to nothing.
  const top = new Set(
    nodes
      .filter((d) => d.id !== ROOT_ID && d.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, Math.min(25, Math.round(nodes.length * 0.03))))
      .map((d) => d.id),
  );
  for (const d of nodes) {
    const isMap = d.el.type === 'BOARD' || d.el.type === 'COLUMN';
    const subBoards = adj.get(d.id)!.filter((x) => x.out && x.kind === 'board').length;
    const tied = d.inn + d.out > 0;
    if (d.id === ROOT_ID) [d.level, d.why] = [5, 'home'];
    else if (top.has(d.id) && (tied || isMap)) [d.level, d.why] = [5, 'top'];
    else if ((d.el.type === 'BOARD' && subBoards >= 3) || d.score >= L4) [d.level, d.why] = [4, subBoards >= 3 ? 'mapOfMaps' : 'highlyTied'];
    else if (isMap || d.score >= L3) [d.level, d.why] = [3, isMap ? 'map' : 'wellTied'];
    else if (tied) [d.level, d.why] = [2, 'tied'];
    else [d.level, d.why] = [1, 'alone'];
  }

  const byId = new Map(nodes.map((d) => [d.id, d]));
  const areas = [ROOT_ID, ...nodes.filter((d) => d.el.type === 'BOARD' && d.depth === 1).sort((a, b) => a.el.createdAt - b.el.createdAt).map((d) => d.id)];
  return { nodes, byId, edges, adj, areas };
}

/** A steady number in [0, 1) for a string (where a block sits inside its band, the same every time). */
export function hash(s: string, seed = 0): number {
  let h = 2166136261 ^ seed;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

export type MapView = 'emergence' | 'gravity' | 'stars';

export interface Placed {
  x: number;
  y: number;
  r: number;
}

/** World size of the Emergence picture. */
export const WW = 1600;
export const WH = 1000;
/** Level bands of Emergence, top (5) to bottom (1): y0, y1. */
export const BANDS: Record<number, [number, number]> = { 5: [0, 140], 4: [150, 300], 3: [310, 500], 2: [510, 760], 1: [770, 1000] };
/** Gravity rings: inner and outer radius (as a share of the whole) for each level. */
const RINGS: Record<number, [number, number]> = { 5: [0, 0.12], 4: [0.16, 0.3], 3: [0.34, 0.52], 2: [0.56, 0.78], 1: [0.82, 1] };
export const GR = 520;

/** Column spans of the areas in Emergence (x0, x1), each as wide as the square root of its blocks. */
export function areaSpans(g: RelGraph): Map<string, [number, number]> {
  const count = new Map<string, number>(g.areas.map((a) => [a, 0]));
  for (const d of g.nodes) count.set(d.area, (count.get(d.area) ?? 0) + 1);
  const used = g.areas.filter((a) => (count.get(a) ?? 0) > 0);
  const gap = 30;
  const weights = used.map((a) => Math.max(1.5, Math.sqrt(count.get(a)!)));
  const total = weights.reduce((s, w) => s + w, 0) || 1;
  const scale = (WW - gap * Math.max(0, used.length - 1)) / total;
  const out = new Map<string, [number, number]>();
  let x = 0;
  used.forEach((a, i) => {
    out.set(a, [x, x + weights[i] * scale]);
    x += weights[i] * scale + gap;
  });
  return out;
}

/*
 * What the map is laid out by (ideaverse's "By" switch): the boards (its folders), the time a block
 * was made, its size, its words, or its links in + out. It sets the across of Emergence, the clock
 * of Gravity and the star colours of Starfield.
 */
export type MapAxis = 'folder' | 'time' | 'size' | 'words' | 'links';
export const MAP_AXES: MapAxis[] = ['folder', 'time', 'size', 'words', 'links'];

export interface AxisInfo {
  axis: MapAxis;
  /** Across, 0…WW. */
  x: Map<string, number>;
  /** 0…1 along the axis (star colours). */
  t: Map<string, number>;
  /** Marks along the axis (for the boards, each board's id too). */
  ticks: { x: number; label: string; id?: string }[];
  /** The ends' names (the colour key). */
  ends: [string, string];
}

const AXIS_PAD = 30;
const fmtNum = (v: number) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : `${Math.round(v * 10) / 10}`);

export function axisOf(g: RelGraph, axis: MapAxis): AxisInfo {
  const x = new Map<string, number>();
  const t = new Map<string, number>();
  if (axis === 'folder') {
    const spans = areaSpans(g);
    const order = [...spans.keys()];
    for (const d of g.nodes) {
      const [x0, x1] = spans.get(d.area) ?? [0, WW];
      const pad = Math.min(10, (x1 - x0) * 0.1);
      x.set(d.id, d.id === d.area ? (x0 + x1) / 2 : x0 + pad + hash(d.id, 13) * (x1 - x0 - 2 * pad));
      t.set(d.id, Math.max(0, order.indexOf(d.area)) / Math.max(1, order.length - 1));
    }
    const ticks = [...spans].map(([a, [x0, x1]]) => ({ x: (x0 + x1) / 2, id: a, label: a === ROOT_ID ? tr('홈 보드', 'Home board') : (g.byId.get(a)?.title ?? '') }));
    return { axis, x, t, ticks, ends: ['', ''] };
  }
  // The other axes are numbers; sizes, words and links on a log scale (a few big ones don't squeeze the rest).
  const raw = (d: RelNode) => (axis === 'time' ? d.created : axis === 'size' ? d.kb : axis === 'words' ? d.words : d.inn + d.out);
  const u = (v: number) => (axis === 'time' ? v : Math.log10(v + 1));
  let lo = Infinity;
  let hi = -Infinity;
  for (const d of g.nodes) {
    const v = u(raw(d));
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  if (!isFinite(lo)) [lo, hi] = [0, 1];
  if (hi - lo < 1e-9) [lo, hi] = axis === 'time' ? [lo - 864e5, hi + 864e5] : [lo - 0.5, hi + 0.5];
  const xOfU = (v: number) => AXIS_PAD + ((v - lo) / (hi - lo)) * (WW - 2 * AXIS_PAD);
  for (const d of g.nodes) {
    const v = u(raw(d));
    // (A little to the side, so blocks with the same value don't sit on one another.)
    x.set(d.id, xOfU(v) + (hash(d.id, 13) - 0.5) * 14);
    t.set(d.id, (v - lo) / (hi - lo));
  }
  const ticks: AxisInfo['ticks'] = [];
  if (axis === 'time') {
    const day = 864e5;
    const span = (hi - lo) / day;
    const step = span > 900 ? 'year' : span > 75 ? 'month' : 'day';
    const d0 = new Date(lo);
    let at = step === 'year' ? new Date(d0.getFullYear() + 1, 0, 1) : step === 'month' ? new Date(d0.getFullYear(), d0.getMonth() + 1, 1) : new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + 1);
    const every = step === 'day' ? Math.max(1, Math.ceil(span / 10)) : step === 'month' ? Math.max(1, Math.ceil(span / 30 / 10)) : Math.max(1, Math.ceil(span / 365 / 10));
    for (let guard = 0; at.getTime() <= hi && guard < 400; guard++) {
      const label = step === 'year' ? `${at.getFullYear()}` : step === 'month' ? `${at.getFullYear() % 100}.${at.getMonth() + 1}` : `${at.getMonth() + 1}.${at.getDate()}`;
      ticks.push({ x: xOfU(at.getTime()), label });
      at = step === 'year' ? new Date(at.getFullYear() + every, 0, 1) : step === 'month' ? new Date(at.getFullYear(), at.getMonth() + every, 1) : new Date(at.getFullYear(), at.getMonth(), at.getDate() + every);
    }
    const day0 = (ms: number) => new Date(ms).toLocaleDateString();
    // (Too short a time for a mark: its two ends are marked.)
    if (ticks.length < 2) ticks.splice(0, ticks.length, { x: AXIS_PAD, label: day0(lo) }, { x: WW - AXIS_PAD, label: day0(hi) });
    return { axis, x, t, ticks, ends: [day0(lo), day0(hi)] };
  }
  const unit = axis === 'size' ? ' KB' : '';
  for (let p = 0; p <= 7; p++)
    for (const m of [1, 2, 5]) {
      const v = m * 10 ** p;
      const uv = Math.log10(v + 1);
      if (uv >= lo && uv <= hi) ticks.push({ x: xOfU(uv), label: fmtNum(v) + unit });
    }
  if (axis !== 'size' && 0 >= lo) ticks.unshift({ x: xOfU(0), label: '0' });
  const back = (v: number) => fmtNum(Math.max(0, 10 ** v - 1)) + unit;
  if (ticks.length < 2) ticks.splice(0, ticks.length, { x: AXIS_PAD, label: back(lo) }, { x: WW - AXIS_PAD, label: back(hi) });
  return { axis, x, t, ticks, ends: [back(lo), back(hi)] };
}

/** A galaxy of Starfield: where it is and how big (its glow). */
export interface Galaxy {
  id: string;
  x: number;
  y: number;
  r: number;
}

/** A Starfield: its galaxies, and the galaxy each block is in (none: the loose belt). */
export interface Laid {
  pos: Map<string, Placed>;
  galaxies: Galaxy[];
  owner: Map<string, string>;
}

/** Where every block goes in a view, across by the axis. */
export function layout(g: RelGraph, view: MapView, ax: AxisInfo): Laid {
  const out = new Map<string, Placed>();
  const radius = (d: RelNode) => (d.level >= 3 ? 6.5 + d.score * 2.6 : d.level === 2 ? 5 + d.score * 1.4 : 4);
  // Rank inside each level: the higher the score, the nearer the band's top (Emergence) or the ring's inside (Gravity).
  const pct = new Map<string, number>();
  for (let lv = 1; lv <= 5; lv++) {
    const ids = g.nodes.filter((d) => d.level === lv).sort((a, b) => a.score - b.score);
    ids.forEach((d, i) => pct.set(d.id, ids.length > 1 ? i / (ids.length - 1) : 0.5));
  }
  const xOf = (d: RelNode) => ax.x.get(d.id) ?? WW / 2;

  if (view === 'emergence') {
    for (const d of g.nodes) {
      const [y0, y1] = BANDS[d.level];
      const h = y1 - y0;
      const j = hash(d.id, 7);
      const y = d.level === 1 ? y0 + 10 + j * (h - 20) : y0 + 10 + (1 - pct.get(d.id)!) * (h - 20) * 0.8 + j * (h - 20) * 0.2;
      out.set(d.id, { x: xOf(d), y, r: radius(d) });
    }
    return { pos: out, galaxies: [], owner: new Map() };
  }

  if (view === 'gravity') {
    // Rings by level (hubs in the middle), the areas round the clock as in Emergence's columns.
    for (const d of g.nodes) {
      const [a, b] = RINGS[d.level];
      const j = hash(d.id, 7);
      const rr = GR * (d.level === 1 ? a + j * (b - a) : a + (1 - pct.get(d.id)!) * (b - a) * 0.8 + j * (b - a) * 0.2);
      const ang = -Math.PI / 2 + (xOf(d) / WW) * Math.PI * 2;
      out.set(d.id, { x: WW / 2 + rr * Math.cos(ang), y: WH / 2 + rr * Math.sin(ang), r: radius(d) });
    }
    return { pos: out, galaxies: [], owner: new Map() };
  }

  // Starfield: each hub (level 5, and 4: a board has fewer blocks than a vault has notes) a galaxy
  // core; every block joins the hub it reaches in the fewest ties (breadth-first from all cores at
  // once, the stronger core first), the nearer, the closer in.
  const cores = g.nodes.filter((d) => d.level >= 4 && d.id !== ROOT_ID).sort((a, b) => b.level - a.level || b.score - a.score);
  const own = new Map<string, string>();
  const hop = new Map<string, number>();
  const queue: string[] = [];
  for (const c of cores) {
    own.set(c.id, c.id);
    hop.set(c.id, 0);
    queue.push(c.id);
  }
  for (let h = 0; h < queue.length; h++) {
    const u = queue[h];
    for (const v of g.adj.get(u) ?? []) {
      if (v.id === ROOT_ID || own.has(v.id)) continue;
      own.set(v.id, own.get(u)!);
      hop.set(v.id, hop.get(u)! + 1);
      queue.push(v.id);
    }
  }
  type Body = { id: string; core?: string; members: RelNode[]; x: number; y: number; r: number; fixed?: boolean };
  // (The middle of the universe, where the home board would be: kept clear.)
  const home: Body = { id: ROOT_ID, members: [], x: 0, y: 0, r: 40, fixed: true };
  const gal = new Map<string, Body>(cores.map((c) => [c.id, { id: c.id, core: c.id, members: [], x: 0, y: 0, r: 0 }]));
  const loose: RelNode[] = [];
  for (const d of g.nodes) {
    if (d.id === ROOT_ID) continue;
    const o = own.get(d.id);
    if (o) gal.get(o)!.members.push(d);
    else loose.push(d);
  }
  const bodies = [...gal.values()];
  for (const b of bodies) b.r = 60 + 22 * Math.sqrt(b.members.length);
  bodies.sort((p, q) => q.r - p.r);
  bodies.forEach((b, j) => {
    const ang = j * 2.39996 + 0.6;
    const d = home.r + 140 + 200 * Math.sqrt(j + 0.5);
    b.x = Math.cos(ang) * d;
    b.y = Math.sin(ang) * d;
  });
  // Bodies tied to each other pull together, all push apart so none overlap.
  const web = new Map<string, number>();
  for (const e of g.edges) {
    const p = own.get(e.a);
    const q = own.get(e.b);
    if (!p || !q || p === q) continue;
    const k = p < q ? `${p}|${q}` : `${q}|${p}`;
    web.set(k, (web.get(k) ?? 0) + 1);
  }
  const live = [home, ...bodies];
  for (let it = 0; it < 300; it++) {
    for (const [k, n] of web) {
      const [p, q] = k.split('|').map((id) => gal.get(id)!);
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      const d0 = p.r + q.r + 60;
      if (d <= d0) continue;
      const f = (0.012 * Math.min(1, Math.log1p(n) / 3) * (d - d0)) / d;
      p.x += dx * f;
      p.y += dy * f;
      q.x -= dx * f;
      q.y -= dy * f;
    }
    for (const b of bodies) {
      b.x *= 0.995;
      b.y *= 0.995;
    }
    for (let a = 0; a < live.length; a++)
      for (let c = a + 1; c < live.length; c++) {
        const p = live[a];
        const q = live[c];
        const dx = q.x - p.x;
        const dy = q.y - p.y;
        const d = Math.hypot(dx, dy) || 0.01;
        const m = p.r + q.r + 60;
        if (d >= m) continue;
        const push = ((m - d) / d) * 0.5;
        if (p.fixed) {
          q.x += dx * push * 2;
          q.y += dy * push * 2;
        } else {
          p.x -= dx * push;
          p.y -= dy * push;
          q.x += dx * push;
          q.y += dy * push;
        }
      }
  }
  const cx = WW / 2;
  const cy = WH / 2;
  for (const b of bodies) {
    // Members spiral out from the core: nearer in hops and higher in level, closer to it.
    const ms = b.members.filter((d) => d.id !== b.core).sort((p, q) => hop.get(p.id)! - hop.get(q.id)! || q.score - p.score);
    const spin = (hash(b.id, 3) < 0.5 ? -1 : 1) * (2.4 + 1.4 * hash(b.id, 5));
    out.set(b.id, { x: cx + b.x, y: cy + b.y, r: radius(g.byId.get(b.id)!) });
    ms.forEach((d, i) => {
      const t = Math.sqrt((i + 1) / (ms.length + 1));
      const rr = 22 + t * (b.r - 22);
      const ang = i * 2.39996 + t * spin + hash(d.id, 9) * 0.4;
      out.set(d.id, { x: cx + b.x + rr * Math.cos(ang), y: cy + b.y + rr * Math.sin(ang) * 0.8, r: radius(d) });
    });
  }
  // Blocks no hub reaches: a loose belt round the outside.
  let far = home.r;
  for (const b of live) far = Math.max(far, Math.hypot(b.x, b.y) + b.r);
  loose.forEach((d) => {
    const ang = hash(d.id, 11) * Math.PI * 2;
    const rr = far + 40 + hash(d.id, 17) * 70;
    out.set(d.id, { x: cx + rr * Math.cos(ang) * 1.2, y: cy + rr * Math.sin(ang), r: radius(d) });
  });
  return { pos: out, galaxies: bodies.map((b) => ({ id: b.id, x: cx + b.x, y: cy + b.y, r: b.r })), owner: own };
}
