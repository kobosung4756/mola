import type { El, ElMap, Stroke } from './types';
import { makeEl, uid, update } from './model';

export interface DrawSettings {
  /** select: the lasso, to pick strokes (to move, cut, copy or delete them). */
  tool: 'pen' | 'highlighter' | 'eraser' | 'select';
  color: string;
  size: number;
}

export const INK_COLORS = ['#2b2e33', '#e03131', '#1971c2', '#2f9e44', '#f08c00', '#ffe066', '#ae3ec9'];
export const INK_SIZES = [2, 4, 8];
/** Highlighter strokes are wider and see-through. */
export const HIGHLIGHT_FACTOR = 4;
export const HIGHLIGHT_OPACITY = 0.38;

/** Smooth SVG path through a stroke's points (quadratic curves between midpoints). */
export function strokeD(p: number[]): string {
  if (p.length < 2) return '';
  if (p.length < 4) return `M${p[0]} ${p[1]}l0.01 0`;
  let d = `M${p[0]} ${p[1]}`;
  for (let i = 2; i < p.length - 2; i += 2) {
    const mx = (p[i] + p[i + 2]) / 2;
    const my = (p[i + 1] + p[i + 3]) / 2;
    d += `Q${p[i]} ${p[i + 1]} ${mx} ${my}`;
  }
  return d + `L${p[p.length - 2]} ${p[p.length - 1]}`;
}

/** Keeps a point only when it moved far enough from the last kept one. */
export function pushPoint(points: number[], x: number, y: number, minDist = 1.5) {
  const n = points.length;
  if (n >= 2 && Math.hypot(x - points[n - 2], y - points[n - 1]) < minDist) return;
  points.push(Math.round(x * 10) / 10, Math.round(y * 10) / 10);
}

export function boundsOf(points: number[]) {
  let l = Infinity;
  let t = Infinity;
  let r = -Infinity;
  let b = -Infinity;
  for (let i = 0; i < points.length; i += 2) {
    l = Math.min(l, points[i]);
    r = Math.max(r, points[i]);
    t = Math.min(t, points[i + 1]);
    b = Math.max(b, points[i + 1]);
  }
  return { l, t, r, b };
}

/** Shortest distance from a point to a stroke's polyline. */
export function distToStroke(points: number[], x: number, y: number): number {
  let best = Infinity;
  if (points.length === 2) return Math.hypot(points[0] - x, points[1] - y);
  for (let i = 0; i < points.length - 2; i += 2) {
    const ax = points[i];
    const ay = points[i + 1];
    const bx = points[i + 2];
    const by = points[i + 3];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
    best = Math.min(best, Math.hypot(ax + dx * t - x, ay + dy * t - y));
  }
  return best;
}

/** Visible width of a stroke in its own drawing space. */
export const inkWidth = (s: Stroke) => (s.tool === 'highlighter' ? s.size * HIGHLIGHT_FACTOR : s.size);

const box = (el: El) => ({ l: el.loc.x, t: el.loc.y, r: el.loc.x + el.width, b: el.loc.y + (el.height ?? 0) });

/**
 * Adds a stroke drawn on the board (points in board coordinates). It joins `sketchId` when that
 * drawing is close by, growing it to fit; otherwise a new drawing block is made around it.
 * Returns the id of the drawing that holds the stroke.
 */
export function addBoardStroke(
  m: ElMap,
  boardId: string,
  sketchId: string | null,
  stroke: Omit<Stroke, 'id'>,
): string {
  const pad = Math.ceil(inkWidth({ ...stroke, id: '' }) / 2) + 6;
  const sb = boundsOf(stroke.points);
  const want = { l: sb.l - pad, t: sb.t - pad, r: sb.r + pad, b: sb.b + pad };
  const host = sketchId ? m[sketchId] : undefined;
  const near =
    host &&
    host.type === 'SKETCH' &&
    host.loc.section === 'CANVAS' &&
    host.loc.parentId === boardId &&
    (() => {
      const hb = box(host);
      const gap = 240;
      return want.l < hb.r + gap && want.r > hb.l - gap && want.t < hb.b + gap && want.b > hb.t - gap;
    })();

  if (!host || !near) {
    const w = Math.max(1, want.r - want.l);
    const h = Math.max(1, want.b - want.t);
    const el = makeEl('SKETCH', { parentId: boardId, x: Math.round(want.l), y: Math.round(want.t) }, {
      vw: w,
      vh: h,
      strokes: [{ ...stroke, id: uid(), points: stroke.points.map((v, i) => v - (i % 2 ? want.t : want.l)) }],
    });
    el.width = w;
    el.height = h;
    el.loc.x = want.l;
    el.loc.y = want.t;
    m[el.id] = el;
    return el.id;
  }

  // Grow the drawing to fit, keeping its scale (local units per board pixel).
  const hb = box(host);
  const sx = (host.content.vw ?? host.width) / host.width;
  const sy = (host.content.vh ?? host.height ?? 1) / (host.height ?? 1);
  const u = { l: Math.min(hb.l, want.l), t: Math.min(hb.t, want.t), r: Math.max(hb.r, want.r), b: Math.max(hb.b, want.b) };
  const shiftX = (hb.l - u.l) * sx;
  const shiftY = (hb.t - u.t) * sy;
  const old = (host.content.strokes ?? []).map((s) => ({
    ...s,
    points: s.points.map((v, i) => v + (i % 2 ? shiftY : shiftX)),
  }));
  const added: Stroke = {
    ...stroke,
    id: uid(),
    size: stroke.size * sx,
    points: stroke.points.map((v, i) => (i % 2 ? (v - u.t) * sy : (v - u.l) * sx)),
  };
  update(m, host.id, {
    loc: { ...host.loc, x: u.l, y: u.t },
    width: u.r - u.l,
    height: u.b - u.t,
    content: { vw: (u.r - u.l) * sx, vh: (u.b - u.t) * sy, strokes: [...old, added] },
  });
  return host.id;
}

/** Removes board ink under the eraser (board coordinates); deletes drawings left empty. */
export function eraseBoardInk(m: ElMap, boardId: string, x: number, y: number, radius: number): boolean {
  let changed = false;
  for (const el of Object.values(m)) {
    if (el.type !== 'SKETCH' || el.loc.parentId !== boardId || el.loc.section !== 'CANVAS') continue;
    const b = box(el);
    if (x < b.l - radius || x > b.r + radius || y < b.t - radius || y > b.b + radius) continue;
    const sx = (el.content.vw ?? el.width) / el.width;
    const sy = (el.content.vh ?? el.height ?? 1) / (el.height ?? 1);
    const lx = (x - b.l) * sx;
    const ly = (y - b.t) * sy;
    const strokes = el.content.strokes ?? [];
    const left = strokes.filter((s) => distToStroke(s.points, lx, ly) > radius * sx + inkWidth(s) / 2);
    if (left.length === strokes.length) continue;
    changed = true;
    if (left.length) update(m, el.id, { content: { strokes: left } });
    else delete m[el.id];
  }
  return changed;
}

/** A drawing as an SVG picture (for a thumbnail, or a drawing embedded in a note). */
export function sketchDataUrl(el: El, bg?: string): string {
  const w = el.content.vw ?? el.width ?? 200;
  const h = el.content.vh ?? el.height ?? 150;
  const esc = (v: string) => v.replace(/[<>&"]/g, '');
  const paths = (el.content.strokes ?? [])
    .map(
      (s) =>
        `<path d="${strokeD(s.points)}" fill="none" stroke="${esc(s.color)}" stroke-width="${s.tool === 'highlighter' ? s.size * HIGHLIGHT_FACTOR : s.size}"` +
        ` stroke-opacity="${s.tool === 'highlighter' ? HIGHLIGHT_OPACITY : 1}" stroke-linecap="round" stroke-linejoin="round"/>`,
    )
    .join('');
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${Math.round(el.width ?? w)}" height="${Math.round(el.height ?? h)}" preserveAspectRatio="none">` +
    (bg ? `<rect width="100%" height="100%" fill="${esc(bg)}"/>` : '') +
    paths +
    '</svg>';
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

/* ---------- Picking strokes of the drawings on a board (the lasso of the drawing bar) ---------- */

/** Strokes picked in one drawing. */
export type InkPick = { id: string; strokes: string[] };
/** A stroke as drawn on the board (board coordinates, board-sized). */
export type BoardStroke = Omit<Stroke, 'id'>;

const scaleIn = (el: El) => ({
  sx: (el.content.vw ?? el.width) / el.width,
  sy: (el.content.vh ?? el.height ?? 1) / (el.height ?? 1),
});

/** A drawing's stroke in board coordinates. */
export function boardStroke(el: El, s: Stroke): BoardStroke {
  const { sx, sy } = scaleIn(el);
  return { tool: s.tool, color: s.color, size: s.size / sx, points: s.points.map((v, i) => (i % 2 ? el.loc.y + v / sy : el.loc.x + v / sx)) };
}

/** Whether a point is inside a closed shape given as [x, y, x, y, …]. */
function inside(poly: number[], x: number, y: number) {
  let hit = false;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const xi = poly[i];
    const yi = poly[i + 1];
    const xj = poly[j];
    const yj = poly[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-9) + xi) hit = !hit;
  }
  return hit;
}

/** The strokes of the board's drawings that the lasso (board coordinates) goes around (most of each). */
export function strokesInLasso(m: ElMap, boardId: string, lasso: number[]): InkPick[] {
  if (lasso.length < 6) return [];
  const picks: InkPick[] = [];
  for (const el of Object.values(m)) {
    if (el.type !== 'SKETCH' || el.loc.parentId !== boardId || el.loc.section !== 'CANVAS') continue;
    const ids: string[] = [];
    for (const s of el.content.strokes ?? []) {
      const p = boardStroke(el, s).points;
      let n = 0;
      for (let i = 0; i < p.length; i += 2) if (inside(lasso, p[i], p[i + 1])) n++;
      if (n / (p.length / 2) >= 0.6) ids.push(s.id);
    }
    if (ids.length) picks.push({ id: el.id, strokes: ids });
  }
  return picks;
}

/** The picked strokes, as drawn on the board, with the drawing each was in. */
export function pickedStrokes(m: ElMap, picks: InkPick[]): { sketchId: string; stroke: BoardStroke }[] {
  const out: { sketchId: string; stroke: BoardStroke }[] = [];
  for (const p of picks) {
    const el = m[p.id];
    if (!el) continue;
    for (const s of el.content.strokes ?? []) if (p.strokes.includes(s.id)) out.push({ sketchId: el.id, stroke: boardStroke(el, s) });
  }
  return out;
}

/** The box (board coordinates) around the picked strokes. */
export function pickedBounds(m: ElMap, picks: InkPick[]) {
  const all = pickedStrokes(m, picks).flatMap((x) => x.stroke.points);
  return all.length ? boundsOf(all) : null;
}

/** A drawing made just big enough for its strokes again (after some were taken out). */
export function fitSketch(m: ElMap, id: string) {
  const el = m[id];
  const strokes = el?.content.strokes ?? [];
  if (!el || !strokes.length) return;
  const { sx, sy } = scaleIn(el);
  let l = Infinity;
  let t = Infinity;
  let r = -Infinity;
  let b = -Infinity;
  for (const s of strokes) {
    const pad = inkWidth(s) / 2 + 6 * sx;
    const bb = boundsOf(s.points);
    l = Math.min(l, bb.l - pad);
    t = Math.min(t, bb.t - pad);
    r = Math.max(r, bb.r + pad);
    b = Math.max(b, bb.b + pad);
  }
  update(m, id, {
    loc: { ...el.loc, x: el.loc.x + l / sx, y: el.loc.y + t / sy },
    width: (r - l) / sx,
    height: (b - t) / sy,
    content: { vw: r - l, vh: b - t, strokes: strokes.map((s) => ({ ...s, points: s.points.map((v, i) => v - (i % 2 ? t : l)) })) },
  });
}

/** Takes the picked strokes out; a drawing left without any goes, the others shrink to what is left. */
export function removeStrokes(m: ElMap, picks: InkPick[]) {
  for (const p of picks) {
    const el = m[p.id];
    if (!el) continue;
    const left = (el.content.strokes ?? []).filter((s) => !p.strokes.includes(s.id));
    if (!left.length) {
      delete m[p.id];
      continue;
    }
    update(m, p.id, { content: { strokes: left } });
    fitSketch(m, p.id);
  }
}

/** Puts strokes on the board, moved by (dx, dy): into their drawing when it is close, else a new one. Returns what was put. */
export function placeStrokes(m: ElMap, boardId: string, items: { sketchId: string | null; stroke: BoardStroke }[], dx: number, dy: number): InkPick[] {
  const picks = new Map<string, string[]>();
  let last: string | null = null;
  for (const it of items) {
    const moved = { ...it.stroke, points: it.stroke.points.map((v, i) => v + (i % 2 ? dy : dx)) };
    const into = it.sketchId && m[it.sketchId] ? it.sketchId : last;
    const id = addBoardStroke(m, boardId, into, moved);
    last = id;
    const strokes = m[id].content.strokes ?? [];
    picks.set(id, [...(picks.get(id) ?? []), strokes[strokes.length - 1].id]);
  }
  return Array.from(picks, ([id, strokes]) => ({ id, strokes }));
}
