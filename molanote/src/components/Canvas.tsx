import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent, MutableRefObject, PointerEvent as ReactPointerEvent } from 'react';
import type { Commit, Content, El, ElMap, ElementType } from '../types';
import { COLORS, dashFor, LINE_WEIGHTS, ROOT_ID } from '../types';

const DEFAULT_LINE = '#8d8a85';
const SELECTED_LINE = '#3f6fd8';
import { canvasItems, containingBoard, descendants, elTitle, inboxOf, isHidden, linesOf, makeEl, pruneLines, scoresAt, toInbox, update } from '../model';
import { BoardCtx } from '../context';
import type { BoardCtxValue, DropTarget } from '../context';
import { DRAW_ON_EVENT, SLIDE_UP_EVENT } from '../context';
import { ElementView } from './ElementView';
import { CONTEXT_OPTIONS } from './ContextBar';
import { Icon } from './Icon';
import { tr } from '../i18n';
import type { DrawSettings, InkPick } from '../draw';
import * as sheetOps from '../table';
import type { TableCell } from '../types';
import { addBoardStroke, eraseBoardInk, HIGHLIGHT_FACTOR, HIGHLIGHT_OPACITY, pushPoint, strokeD, strokesInLasso, pickedStrokes, pickedBounds, removeStrokes, placeStrokes, inkWidth } from '../draw';
import { addElement, addFiles } from '../actions';
import type { ColumnSlot, Point } from '../actions';

export interface View {
  x: number;
  y: number;
  zoom: number;
}

export interface CanvasApi {
  center(): Point;
  focusOn(id: string): void;
  zoomBy(factor: number): void;
  resetZoom(): void;
  fitAll(): void;
  /** The given blocks filling the screen (Shift+2). */
  fitTo(ids: string[]): void;
  /** Nearest point to the viewport centre where a box of this size fits without overlap. */
  /** `onScreen`: only spots wholly on screen; with none free there, `near` itself. */
  freeSpot(width: number, height: number, near?: Point, exclude?: string, onScreen?: boolean): Point;
}

const views = new Map<string, View>();
/** Strokes cut or copied with the lasso, as drawn on the board, and how often they were pasted. */
let inkClipboard: { items: { sketchId: string | null; stroke: Omit<import('../types').Stroke, 'id'> }[]; times: number } | null = null;
/** Below this zoom the background dots are hidden. */
const DOTS_MIN_ZOOM = 0.5;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

interface DragState {
  ids: string[];
  mode: 'canvas' | 'attached';
  started: boolean;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
  dx: number;
  dy: number;
  px: number;
  py: number;
  grabX: number;
  grabY: number;
  width: number;
}

interface Props {
  els: ElMap;
  boardId: string;
  commit: Commit;
  selection: string[];
  setSelection: (ids: string[]) => void;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  connecting: boolean;
  setConnecting: (on: boolean) => void;
  openBoard: (id: string) => void;
  goToOriginal: (id: string) => void;
  /** Shows a block on its board (goes there, selects it, lights it up). */
  showBlock: (id: string) => void;
  apiRef: MutableRefObject<CanvasApi | null>;
  onZoom: (zoom: number) => void;
  /** Style applied to lines drawn in connect mode. */
  newLine: Content;
  newLineColor?: string;
  onOpenComments: (id: string) => void;
  /** Actions offered in the right-click menu, carried out by the app. */
  onMenuAction: (action: 'open' | 'edit' | 'comment' | 'duplicate' | 'delete' | 'label' | 'unlink' | 'original' | 'tag', ids: string[]) => void;
  meId: string;
  tableCell: TableCell | null;
  setTableCell: (cell: TableCell | null) => void;
  unsortedOpen: boolean;
  setUnsortedOpen: (open: boolean) => void;
  /** The side panel the Unsorted list is drawn into (beside the board, where search and the trash open). */
  unsortedSlot: HTMLElement | null;
  /** Draw mode: pointer drags put ink on the board instead of selecting or moving. */
  drawing: DrawSettings | null;
  /** Goes on drawing into this drawing block (a double-click on it). */
  onDrawOn?: (id: string) => void;
}

interface LineDraft {
  /** The end that stays put: an element or a free point. */
  anchor: { id?: string; point?: Point };
  /** Set when an existing line's end is being moved. */
  edit?: { lineId: string; end: 'from' | 'to' };
  pt: Point;
  targetId: string | null;
}

interface Geo {
  /** The path between the two borders only (for lines drawn over the blocks, which hide nothing). */
  dEdge: string;
  /** Path ends: the centres of the two blocks (or free points). The path runs under the blocks. */
  sx: number;
  sy: number;
  ex: number;
  ey: number;
  /** Where the line leaves each block's border, for arrowheads and the end handles. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Curve parameters of those border points, and arrow directions there. */
  t1: number;
  t2: number;
  a1: number;
  a2: number;
  /** Quadratic control point (the midpoint for straight lines). */
  qx: number;
  qy: number;
  /** Point on the line where the curvature handle sits. */
  hx: number;
  hy: number;
  /** Midpoint and unit normal of the centre-to-centre chord; `bend` is measured along the normal. */
  mx: number;
  my: number;
  nx: number;
  ny: number;
  d: string;
  /** Changes whenever anything visible changes; used to skip needless re-renders. */
  key: string;
}

export function Canvas(props: Props) {
  const { els, boardId, commit, selection, setSelection, editingId, setEditingId, connecting, setConnecting } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>(() => views.get(boardId) ?? { x: 0, y: 0, zoom: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const elsRef = useRef(els);
  elsRef.current = els;

  const [drag, setDrag] = useState<DragState | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [connectPt, setConnectPt] = useState<Point | null>(null);
  const [geo, setGeo] = useState<Record<string, Geo>>({});
  const [lineDraft, setLineDraft] = useState<LineDraft | null>(null);
  const overInboxRef = useRef(false);
  const geoRef = useRef(geo);
  geoRef.current = geo;
  const spaceRef = useRef(false);
  const [panning, setPanning] = useState(false);

  const items = useMemo(
    () => canvasItems(els, boardId).sort((a, b) => (a.z ?? a.createdAt) - (b.z ?? b.createdAt)),
    [els, boardId],
  );
  const lines = useMemo(() => linesOf(els, boardId), [els, boardId]);
  const inbox = useMemo(() => inboxOf(els, boardId), [els, boardId]);
  /* Once everything has been moved out of Unsorted, the panel closes by itself. */
  const inboxBefore = useRef(inbox.length);
  useEffect(() => {
    if (props.unsortedOpen && inboxBefore.current > 0 && inbox.length === 0) props.setUnsortedOpen(false);
    inboxBefore.current = inbox.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inbox.length]);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    ids: string[];
    kind: 'blocks' | 'line' | 'cell';
    cell?: { r: number; c: number; r2?: number; c2?: number };
  } | null>(null);
  /** Stroke being drawn, in board coordinates, shown until it is saved. */
  const [liveInk, setLiveInk] = useState<{ points: number[]; settings: DrawSettings } | null>(null);
  /** Drawing block that strokes of the current draw session join. */
  const drawSketch = useRef<string | null>(null);
  const drawingOn = !!props.drawing;
  useEffect(() => {
    if (!drawingOn) drawSketch.current = null;
  }, [drawingOn]);
  // Enter or a double-click on a drawing: what is drawn next goes into it.
  useEffect(() => {
    const on = (e: Event) => {
      drawSketch.current = (e as CustomEvent<string>).detail;
    };
    addEventListener(DRAW_ON_EVENT, on);
    return () => removeEventListener(DRAW_ON_EVENT, on);
  }, []);
  /*
   * The lasso of the drawing bar: strokes it went around are picked (in one drawing or several),
   * then dragged to move them, or cut, copied, pasted and deleted with the usual keys.
   */
  const [inkSel, setInkSel] = useState<InkPick[]>([]);
  const [lasso, setLasso] = useState<number[] | null>(null);
  const [inkMove, setInkMove] = useState<{ dx: number; dy: number } | null>(null);
  const lassoOn = props.drawing?.tool === 'select';
  useEffect(() => {
    if (!lassoOn) setInkSel([]);
  }, [lassoOn]);
  const inkSelRef = useRef(inkSel);
  inkSelRef.current = inkSel;
  useEffect(() => {
    if (!lassoOn) return;
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('input, textarea, [contenteditable="true"]')) return;
      const picks = inkSelRef.current.filter((p) => elsRef.current[p.id]);
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (picks.length && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        e.stopPropagation();
        commit((m) => removeStrokes(m, picks));
        setInkSel([]);
      } else if (picks.length && mod && (k === 'c' || k === 'x')) {
        e.preventDefault();
        e.stopPropagation();
        inkClipboard = { items: pickedStrokes(elsRef.current, picks), times: 0 };
        if (k === 'x') {
          commit((m) => removeStrokes(m, picks));
          setInkSel([]);
        }
      } else if (mod && k === 'v' && inkClipboard?.items.length) {
        e.preventDefault();
        e.stopPropagation();
        const clip = inkClipboard;
        clip.times += 1;
        // Each paste a little further along (the first one where it was cut from).
        const off = 24 * (clip.times - (picks.length ? 0 : 1));
        let placed: InkPick[] = [];
        commit((m) => {
          placed = placeStrokes(m, boardId, clip.items, off, off);
        });
        setInkSel(placed);
      } else if (picks.length && e.key === 'Escape') {
        // First Escape lets go of the picked strokes (the next one ends drawing).
        e.preventDefault();
        e.stopPropagation();
        setInkSel([]);
      }
    };
    addEventListener('keydown', key, true);
    return () => removeEventListener('keydown', key, true);
  }, [lassoOn, boardId]); // eslint-disable-line react-hooks/exhaustive-deps
  const selSet = useMemo(() => new Set(selection), [selection]);

  useEffect(() => {
    views.set(boardId, view);
    props.onZoom(view.zoom);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, boardId]);

  useEffect(() => {
    if (!connecting) {
      setConnectFrom(null);
      setConnectPt(null);
    }
  }, [connecting]);

  const toBoard = (cx: number, cy: number): Point => {
    const r = rootRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (cx - r.left - v.x) / v.zoom, y: (cy - r.top - v.y) / v.zoom };
  };

  const zoomAround = (factor: number, px?: number, py?: number) => {
    const r = rootRef.current!.getBoundingClientRect();
    const ax = px ?? r.width / 2;
    const ay = py ?? r.height / 2;
    setView((v) => {
      const z = clamp(v.zoom * factor, 0.2, 3);
      return { zoom: z, x: ax - ((ax - v.x) * z) / v.zoom, y: ay - ((ay - v.y) * z) / v.zoom };
    });
  };

  /** Bounding box of the top-level canvas elements, in board units. */
  const contentBounds = (ids?: string[]) => {
    const layer = layerRef.current;
    if (!layer) return null;
    const lr = layer.getBoundingClientRect();
    const z = viewRef.current.zoom;
    let box: { l: number; t: number; r: number; b: number } | null = null;
    const nodes = ids
      ? ids.map((id) => layer.querySelector<HTMLElement>(`[data-el-id="${id}"]`)).filter((n): n is HTMLElement => !!n)
      : Array.from(layer.querySelectorAll<HTMLElement>(':scope > [data-el-id], :scope > .el-stack > [data-el-id]'));
    for (const n of nodes) {
      const r = n.getBoundingClientRect();
      const l = (r.left - lr.left) / z;
      const t = (r.top - lr.top) / z;
      const rr = l + r.width / z;
      const b = t + r.height / z;
      box = box
        ? { l: Math.min(box.l, l), t: Math.min(box.t, t), r: Math.max(box.r, rr), b: Math.max(box.b, b) }
        : { l, t, r: rr, b };
    }
    return box;
  };

  /* ---------- Content out of sight: a droplet at the edge points the way ---------- */

  /** Where the droplet sits (in the board area), the way it points, and where a click takes the view. */
  const [awayHint, setAwayHint] = useState<{ x: number; y: number; angle: number; to: Point } | null>(null);
  const glide = useRef<number | null>(null);

  /**
   * Moves the view so that board point `to` is in the middle, keeping the zoom. It glides there
   * instead of jumping: longer trips take a little longer, but never more than about a second.
   */
  const glideTo = (to: Point) => {
    const root = rootRef.current;
    if (!root) return;
    const r = root.getBoundingClientRect();
    const from = viewRef.current;
    glideView({ zoom: from.zoom, x: r.width / 2 - to.x * from.zoom, y: r.height / 2 - to.y * from.zoom });
  };
  /** Glides the view to `end` (its zoom kept). */
  const glideView = (end: View) => {
    const from = viewRef.current;
    const dist = Math.hypot(end.x - from.x, end.y - from.y);
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const ms = reduce ? 0 : Math.min(1100, 280 + 150 * Math.log2(1 + dist / 300));
    if (glide.current) cancelAnimationFrame(glide.current);
    const t0 = performance.now();
    const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
    const step = (now: number) => {
      const t = ms ? Math.min(1, (now - t0) / ms) : 1;
      const k = ease(t);
      setView({ zoom: from.zoom, x: from.x + (end.x - from.x) * k, y: from.y + (end.y - from.y) * k });
      glide.current = t < 1 ? requestAnimationFrame(step) : null;
    };
    glide.current = requestAnimationFrame(step);
  };
  // A block being typed in that has grown down to the bottom of the screen: the board slides up
  // (by the pixels asked for) so there is room to go on below it.
  useEffect(() => {
    const slide = (e: Event) => {
      const by = (e as CustomEvent<number>).detail;
      // (Not in the middle of another glide, such as to a block just made.)
      if (!(by > 0) || glide.current) return;
      const v = viewRef.current;
      glideView({ ...v, y: v.y - by });
    };
    addEventListener(SLIDE_UP_EVENT, slide);
    return () => removeEventListener(SLIDE_UP_EVENT, slide);
  });
  /*
   * A block just made (a click in the left bar, a double-click near the edge, a drop…) that is not
   * well in view: the view glides to it. Only blocks made just now on this board, not ones that come
   * back with undo or another board's blocks.
   */
  const known = useRef<{ board: string; ids: Set<string> } | null>(null);
  useEffect(() => {
    const ids = new Set(Object.values(els).filter((e) => e.loc.parentId === boardId && e.loc.section === 'CANVAS' && e.type !== 'LINE').map((e) => e.id));
    const was = known.current;
    known.current = { board: boardId, ids };
    if (!was || was.board !== boardId) return;
    if ((window as unknown as { __molanoteOldPlacement?: boolean }).__molanoteOldPlacement) return;
    const fresh = [...ids].filter((id) => !was.ids.has(id) && Date.now() - (els[id]?.createdAt ?? 0) < 3000);
    if (!fresh.length) return;
    // (Not cancelled when the board changes again right away, e.g. typing in the new note.)
    requestAnimationFrame(() => {
      const root = rootRef.current;
      const layer = layerRef.current;
      if (!root || !layer) return;
      const rr = root.getBoundingClientRect();
      const nodes = fresh.map((id) => layer.querySelector<HTMLElement>(`:scope > [data-el-id="${id}"]`)).filter((n): n is HTMLElement => !!n);
      if (!nodes.length) return;
      const rs = nodes.map((n) => n.getBoundingClientRect());
      const box = { l: Math.min(...rs.map((r) => r.left)), t: Math.min(...rs.map((r) => r.top)), r: Math.max(...rs.map((r) => r.right)), b: Math.max(...rs.map((r) => r.bottom)) };
      const m = 48;
      const inView = box.l >= rr.left + m && box.t >= rr.top + m && box.r <= rr.right - m && box.b <= rr.bottom - m;
      if (inView) return;
      const z = viewRef.current.zoom;
      const lr = layer.getBoundingClientRect();
      glideTo({ x: ((box.l + box.r) / 2 - lr.left) / z, y: ((box.t + box.b) / 2 - lr.top) / z });
    });
  }, [els, boardId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Taking hold of the board stops a glide.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const stop = () => {
      if (glide.current) cancelAnimationFrame(glide.current);
      glide.current = null;
    };
    root.addEventListener('pointerdown', stop, true);
    root.addEventListener('wheel', stop, { capture: true, passive: true });
    return () => {
      root.removeEventListener('pointerdown', stop, true);
      root.removeEventListener('wheel', stop, true);
    };
  }, []);

  /** When nothing on the board is in view, works out where the droplet goes and where it leads. */
  const placeHint = useCallback(() => {
    const root = rootRef.current;
    const layer = layerRef.current;
    if (!root || !layer) return;
    const rr = root.getBoundingClientRect();
    const nodes = Array.from(layer.querySelectorAll<HTMLElement>(':scope > [data-el-id], :scope > .el-stack > [data-el-id]'));
    if (!nodes.length) return setAwayHint(null);
    const rects = nodes.map((n) => n.getBoundingClientRect());
    if (rects.some((r) => r.right > rr.left && r.left < rr.right && r.bottom > rr.top && r.top < rr.bottom)) return setAwayHint(null);
    const cx = rr.left + rr.width / 2;
    const cy = rr.top + rr.height / 2;
    const all = rects.reduce((a, r) => ({ l: Math.min(a.l, r.left), t: Math.min(a.t, r.top), r: Math.max(a.r, r.right), b: Math.max(a.b, r.bottom) }), {
      l: Infinity,
      t: Infinity,
      r: -Infinity,
      b: -Infinity,
    });
    // Everything at once if it fits the view; otherwise the nearest block, so the trip ends on something.
    let tx = (all.l + all.r) / 2;
    let ty = (all.t + all.b) / 2;
    if (all.r - all.l > rr.width * 0.9 || all.b - all.t > rr.height * 0.9) {
      const near = rects.reduce((a, r) => (Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy) < Math.hypot(a.left + a.width / 2 - cx, a.top + a.height / 2 - cy) ? r : a));
      tx = near.left + near.width / 2;
      ty = near.top + near.height / 2;
    }
    const dx = tx - cx;
    const dy = ty - cy;
    const margin = 34;
    const s = Math.min((rr.width / 2 - margin) / Math.max(1e-6, Math.abs(dx)), (rr.height / 2 - margin) / Math.max(1e-6, Math.abs(dy)));
    const v = viewRef.current;
    setAwayHint({
      x: rr.width / 2 + dx * s,
      y: rr.height / 2 + dy * s,
      angle: (Math.atan2(dy, dx) * 180) / Math.PI,
      to: { x: (tx - rr.left - v.x) / v.zoom, y: (ty - rr.top - v.y) / v.zoom },
    });
  }, []);
  useLayoutEffect(placeHint, [view, items, placeHint]);
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(placeHint);
    ro.observe(root);
    return () => ro.disconnect();
  }, [placeHint]);

  props.apiRef.current = {
    center() {
      const r = rootRef.current!.getBoundingClientRect();
      return toBoard(r.left + r.width / 2, r.top + r.height / 2);
    },
    focusOn(id) {
      const layer = layerRef.current;
      const node = layer?.querySelector<HTMLElement>(`[data-el-id="${id}"]`);
      if (!layer || !node) return;
      const lr = layer.getBoundingClientRect();
      const nr = node.getBoundingClientRect();
      const v = viewRef.current;
      const bx = (nr.left - lr.left + nr.width / 2) / v.zoom;
      const by = (nr.top - lr.top + nr.height / 2) / v.zoom;
      // Glides there (not a jump), so it is clear where the view went.
      glideTo({ x: bx, y: by });
    },
    zoomBy: (f) => zoomAround(f),
    freeSpot(width, height, near, exclude, onScreenOnly = false) {
      const c = near ?? this.center();
      const layer = layerRef.current;
      if (!layer) return c;
      const lr = layer.getBoundingClientRect();
      const z = viewRef.current.zoom;
      // Blocks, and the labels written on lines, are in the way.
      const boxes = Array.from(rootRef.current!.querySelectorAll<HTMLElement>('.layer > [data-el-id], .layer > .el-stack > [data-el-id], .line-label-box'))
        .filter((n) => n.dataset.elId !== exclude)
        .map((n) => {
        const r = n.getBoundingClientRect();
        return { l: (r.left - lr.left) / z, t: (r.top - lr.top) / z, r: (r.right - lr.left) / z, b: (r.bottom - lr.top) / z };
      });
      // Lines are in the way too (a block put on one would hide it, or the line would run over the
      // block when it reaches a card in a column): points along each line, a little apart.
      for (const path of Array.from(layer.querySelectorAll<SVGPathElement>('svg.lines .line-path'))) {
        const len = path.getTotalLength?.() ?? 0;
        for (let d = 0; d <= len; d += 16) {
          const pt = path.getPointAtLength(d);
          boxes.push({ l: pt.x - 2, t: pt.y - 2, r: pt.x + 2, b: pt.y + 2 });
        }
      }
      const gap = 16;
      const fits = (x: number, y: number) => {
        const l = x - width / 2;
        const t = y - 40;
        return !boxes.some((b) => l < b.r + gap && l + width > b.l - gap && t < b.b + gap && t + height > b.t - gap);
      };
      const step = 40;
      const offsets: Point[] = [];
      for (let i = -15; i <= 15; i++) for (let j = -10; j <= 10; j++) offsets.push({ x: i * step, y: j * step });
      offsets.sort((a, b) => Math.hypot(a.x, a.y * 1.4) - Math.hypot(b.x, b.y * 1.4));
      // A free spot wholly on screen first (not under the top bar or past an edge). Then, when only
      // on-screen spots will do, the asked-for spot itself (a new block on top beats one out of
      // sight); otherwise any free spot.
      const rr = rootRef.current!.getBoundingClientRect();
      const v = viewRef.current;
      const pad = 12;
      const onScreen = (x: number, y: number) => {
        const l = x - width / 2;
        const t = y - 40;
        return l >= (pad - v.x) / z && t >= (pad - v.y) / z && l + width <= (rr.width - pad - v.x) / z && t + height <= (rr.height - pad - v.y) / z;
      };
      for (const o of offsets) if (onScreen(c.x + o.x, c.y + o.y) && fits(c.x + o.x, c.y + o.y)) return { x: c.x + o.x, y: c.y + o.y };
      if (onScreenOnly) return c;
      for (const o of offsets) if (fits(c.x + o.x, c.y + o.y)) return { x: c.x + o.x, y: c.y + o.y };
      return c;
    },
    resetZoom: () => zoomAround(1 / viewRef.current.zoom),
    fitAll() {
      fitBox(contentBounds(), 1.5);
    },
    fitTo(ids: string[]) {
      // (Up to 300%: a small block comes up large; with none found, everything.)
      const box = contentBounds(ids);
      if (box) fitBox(box, 3);
      else fitBox(contentBounds(), 1.5);
    },
  };

  /** The view fitted round a box (board units), not beyond `most` zoom. */
  const fitBox = (box: { l: number; t: number; r: number; b: number } | null, most: number) => {
    {
      const rr = rootRef.current!.getBoundingClientRect();
      if (!box) {
        setView({ x: 0, y: 0, zoom: 1 });
        return;
      }
      const pad = 60;
      const z = clamp(Math.min((rr.width - pad * 2) / Math.max(1, box.r - box.l), (rr.height - pad * 2) / Math.max(1, box.b - box.t)), 0.2, most);
      setView({
        zoom: z,
        x: rr.width / 2 - ((box.l + box.r) / 2) * z,
        y: rr.height / 2 - ((box.t + box.b) / 2) * z,
      });
    }
  };

  /* Wheel: scroll pans, Ctrl/⌘ + wheel or pinch zooms. */
  useEffect(() => {
    const root = rootRef.current!;
    const onWheel = (e: WheelEvent) => {
      const tgt = e.target as HTMLElement;
      if (tgt.closest('.format-bar, .icon-picker')) return;
      if (!e.ctrlKey && !e.metaKey && tgt.closest('.paper-scroll, .paper-abstract')) return;
      const col = !e.ctrlKey && !e.metaKey ? tgt.closest<HTMLElement>('[data-column-scroll]') : null;
      if (col) {
        e.preventDefault();
        col.scrollTop += e.deltaY;
        return;
      }
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const r = root.getBoundingClientRect();
        zoomAround(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
      } else {
        const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
        const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
        setView((v) => ({ ...v, x: v.x - dx, y: v.y - dy }));
      }
    };
    root.addEventListener('wheel', onWheel, { passive: false });
    return () => root.removeEventListener('wheel', onWheel);
  }, []);

  /*
   * Hold Space to pan with the mouse. A short press of Space alone (nothing picked, nothing being
   * typed in) glides to the middle of everything on the board instead.
   */
  const spacePanned = useRef(false);
  const centreRef = useRef<() => void>(() => {});
  centreRef.current = () => {
    if (selection.length || editingId || props.drawing || connecting) return;
    const b = contentBounds();
    if (b) glideTo({ x: (b.l + b.r) / 2, y: (b.t + b.b) / 2 });
  };
  useEffect(() => {
    const typing = (t: EventTarget | null) =>
      !!(t as HTMLElement | null)?.closest?.('input, textarea, select, button, [contenteditable="true"]');
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !typing(e.target) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (!e.repeat) spacePanned.current = false;
        spaceRef.current = true;
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      const held = spaceRef.current;
      spaceRef.current = false;
      if (held && !spacePanned.current && !typing(e.target) && !e.ctrlKey && !e.metaKey && !e.altKey) centreRef.current();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  /*
   * Blocks can change size without this board drawing again: an image or a link preview that
   * arrives late, a table or a formula laid out after its first draw, a web font. The lines are
   * measured again whenever any block on the board changes size, so they never keep a stale shape.
   */
  const [, setRemeasure] = useState(0);
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer || typeof ResizeObserver === 'undefined') return;
    let frame = 0;
    const again = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setRemeasure((n) => n + 1));
    };
    const ro = new ResizeObserver(again);
    const watched = new WeakSet<Element>();
    let pending = 0;
    const watch = () => {
      pending = 0;
      for (const n of layer.querySelectorAll('[data-el-id]')) {
        if (watched.has(n)) continue;
        watched.add(n);
        ro.observe(n);
      }
    };
    watch();
    // Blocks added later (another board opened, a paste…) are watched too.
    const mo = new MutationObserver(() => {
      if (!pending) pending = requestAnimationFrame(watch);
    });
    mo.observe(layer, { childList: true, subtree: true });
    // A block in a column moves when the column scrolls; a board tile settles after its hover scale.
    layer.addEventListener('scroll', again, true);
    layer.addEventListener('transitionend', again, true);
    layer.addEventListener('animationend', again, true);
    return () => {
      ro.disconnect();
      mo.disconnect();
      layer.removeEventListener('scroll', again, true);
      layer.removeEventListener('transitionend', again, true);
      layer.removeEventListener('animationend', again, true);
      cancelAnimationFrame(frame);
      cancelAnimationFrame(pending);
    };
  }, []);

  /* Line endpoints follow the rendered elements, including while dragging. */
  useLayoutEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const lr = layer.getBoundingClientRect();
    const z = view.zoom;
    const rectOf = (id?: string) => (id ? measureBox(layer, lr, id, z) : null);
    const endBox = (id?: string, p?: Point) => (p ? { x: p.x, y: p.y, w: 0, h: 0 } : rectOf(id));
    const next: Record<string, Geo> = {};
    for (const ln of lines) {
      if (lineDraft?.edit?.lineId === ln.id) continue;
      const a = endBox(ln.content.from, ln.content.fromPoint);
      const b = endBox(ln.content.to, ln.content.toPoint);
      if (!a || !b) continue;
      next[ln.id] = lineGeometry(a, b, ln.content.bend ?? 0);
    }
    const same =
      Object.keys(next).length === Object.keys(geo).length &&
      Object.entries(next).every(([k, g]) => geo[k]?.key === g.key);
    if (!same) setGeo(next);
  });

  const findDropTarget = (cx: number, cy: number, ids: string[]): DropTarget => {
    const m = elsRef.current;
    const stack = document.elementsFromPoint(cx, cy) as HTMLElement[];
    const movingColumn = ids.some((i) => m[i]?.type === 'COLUMN');
    for (const node of stack) {
      if (!rootRef.current?.contains(node)) continue;
      const bid = node.dataset?.boardCard;
      if (bid && !ids.includes(bid) && !ids.some((i) => descendants(m, i).has(bid))) {
        return { kind: 'board', id: bid };
      }
      const cid = node.dataset?.dropColumn;
      if (cid && !ids.includes(cid) && !movingColumn) {
        const kids = Array.from(
          node.querySelectorAll<HTMLElement>(':scope > .column > .column-scroll > .column-body > [data-el-id]'),
        ).filter((k) => !ids.includes(k.dataset.elId!));
        let index = kids.findIndex((k) => {
          const r = k.getBoundingClientRect();
          return cy < r.top + r.height / 2;
        });
        if (index < 0) index = kids.length;
        return { kind: 'column', id: cid, index };
      }
    }
    return null;
  };

  const finishDrop = (d: DragState, target: DropTarget) => {
    const now = Date.now();
    commit((m) => {
      const ordered = [...d.ids].sort((a, b) => m[a].loc.y - m[b].loc.y || m[a].loc.x - m[b].loc.x);
      if (target?.kind === 'inbox') {
        toInbox(m, ordered, boardId);
      } else if (target?.kind === 'board') {
        const canvas = ordered.filter((i) => m[i].loc.section === 'CANVAS');
        const minX = Math.min(...canvas.map((i) => m[i].loc.x));
        const minY = Math.min(...canvas.map((i) => m[i].loc.y));
        ordered.forEach((i, k) => {
          const l = m[i].loc;
          const onCanvas = l.section === 'CANVAS';
          update(m, i, {
            z: now + k,
            loc: {
              parentId: target.id,
              section: 'CANVAS',
              x: onCanvas ? l.x - minX + 80 : 80 + k * 24,
              y: onCanvas ? l.y - minY + 80 : 80 + k * 24,
              score: 0,
            },
          });
        });
        pruneLines(m);
      } else if (target?.kind === 'column') {
        const scores = scoresAt(m, target.id, target.index, d.ids, ordered.length);
        ordered.forEach((i, k) =>
          update(m, i, { loc: { parentId: target.id, section: 'ATTACHED', x: 0, y: 0, score: scores[k] } }),
        );
      } else if (d.mode === 'canvas') {
        for (const i of d.ids) {
          const l = m[i].loc;
          update(m, i, { z: now, loc: { ...l, x: Math.round(l.x + d.dx), y: Math.round(l.y + d.dy) } });
        }
      } else {
        update(m, d.ids[0], {
          z: now,
          loc: {
            parentId: boardId,
            section: 'CANVAS',
            x: Math.round(d.px - d.grabX),
            y: Math.round(d.py - d.grabY),
            score: 0,
          },
        });
      }
    });
  };

  const startDrag = (e: ReactPointerEvent, id: string, node: HTMLElement, sel: string[]) => {
    const m = elsRef.current;
    const el = m[id];
    const mode: DragState['mode'] = el.loc.section === 'ATTACHED' || el.loc.section === 'INBOX' ? 'attached' : 'canvas';
    const ids = (
      mode === 'attached'
        ? [id]
        : sel.filter((s) => m[s] && m[s].loc.section === 'CANVAS' && m[s].loc.parentId === boardId && m[s].type !== 'LINE')
    ).filter((s) => !m[s].locked);
    if (!ids.length) return;
    const fromInbox = el.loc.section === 'INBOX';
    const rect = node.getBoundingClientRect();
    const z = viewRef.current.zoom;
    const p = toBoard(e.clientX, e.clientY);
    const d: DragState = {
      ids,
      mode,
      started: false,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startX: p.x,
      startY: p.y,
      dx: 0,
      dy: 0,
      px: p.x,
      py: p.y,
      grabX: (e.clientX - rect.left) / z,
      grabY: (e.clientY - rect.top) / z,
      width: rect.width / z,
    };
    let target: DropTarget = null;
    const move = (ev: PointerEvent) => {
      if (!d.started) {
        if (Math.hypot(ev.clientX - d.startClientX, ev.clientY - d.startClientY) < 4) return;
        d.started = true;
        setEditingId(null);
        // No text gets selected while a block is carried across other blocks.
        window.getSelection()?.removeAllRanges();
        document.body.classList.add('dragging-block');
      }
      const q = toBoard(ev.clientX, ev.clientY);
      d.dx = q.x - d.startX;
      d.dy = q.y - d.startY;
      d.px = q.x;
      d.py = q.y;
      setDrag({ ...d });
      const overPanel = !!(document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest('.unsorted-panel');
      target = overPanel ? (fromInbox ? null : { kind: 'inbox' }) : findDropTarget(ev.clientX, ev.clientY, d.ids);
      if (target?.kind === 'column') {
        const body = rootRef.current?.querySelector<HTMLElement>(`[data-el-id="${target.id}"] > .column .column-body[data-column-scroll]`);
        const r = body?.getBoundingClientRect();
        if (body && r) {
          if (ev.clientY > r.bottom - 36) body.scrollTop += 14;
          else if (ev.clientY < r.top + 36) body.scrollTop -= 14;
        }
      }
      overInboxRef.current = overPanel && fromInbox;
      setDropTarget(target);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('dragging-block');
      setDrag(null);
      setDropTarget(null);
      // Letting go over the Unsorted panel puts an Unsorted item back where it was.
      if (d.started && !overInboxRef.current) finishDrop(d, target);
      overInboxRef.current = false;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /** Element under the pointer that a line end could attach to. */
  const lineTargetAt = (cx: number, cy: number, exclude?: string): string | null => {
    for (const node of document.elementsFromPoint(cx, cy) as HTMLElement[]) {
      if (!layerRef.current?.contains(node)) continue;
      const host = node.closest<HTMLElement>('[data-el-id]');
      const id = host?.dataset.elId;
      if (id && id !== exclude) return id;
      if (id === exclude) return null;
    }
    return null;
  };

  /**
   * Drags a line end from an element's top-right handle (new line) or from a selected line's
   * endpoint (re-attach). Dropping on an element attaches the end; dropping on empty space leaves
   * it as a free point. Shift snaps a free end to 15° steps; Escape cancels.
   */
  const startLineDrag = (e: ReactPointerEvent, anchor: LineDraft['anchor'], edit?: LineDraft['edit']) => {
    e.stopPropagation();
    e.preventDefault();
    if (editingId) setEditingId(null);
    const sx = e.clientX;
    const sy = e.clientY;
    let moved = false;
    let cancelled = false;
    let draft: LineDraft = { anchor, edit, pt: toBoard(sx, sy), targetId: null };
    const anchorCenter = (): Point | null => {
      if (anchor.point) return anchor.point;
      const layer = layerRef.current;
      const n = layer?.querySelector<HTMLElement>(`[data-el-id="${anchor.id}"]`);
      if (!layer || !n) return null;
      const lr = layer.getBoundingClientRect();
      const r = n.getBoundingClientRect();
      const z = viewRef.current.zoom;
      return { x: (r.left - lr.left + r.width / 2) / z, y: (r.top - lr.top + r.height / 2) / z };
    };
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
      moved = true;
      let pt = toBoard(ev.clientX, ev.clientY);
      const targetId = lineTargetAt(ev.clientX, ev.clientY, anchor.id);
      const c = anchorCenter();
      if (ev.shiftKey && !targetId && c) {
        const len = Math.hypot(pt.x - c.x, pt.y - c.y);
        const step = Math.PI / 12;
        const ang = Math.round(Math.atan2(pt.y - c.y, pt.x - c.x) / step) * step;
        pt = { x: c.x + Math.cos(ang) * len, y: c.y + Math.sin(ang) * len };
      }
      draft = { anchor, edit, pt, targetId };
      setLineDraft(draft);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.stopPropagation();
      cancelled = true;
      stop();
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', onKey, true);
      setLineDraft(null);
    };
    const up = () => {
      stop();
      if (cancelled) return;
      if (!moved) {
        if (!edit && anchor.id) {
          setConnecting(true);
          setConnectFrom(anchor.id);
          setConnectPt(draft.pt);
        }
        return;
      }
      const end = draft.targetId
        ? { id: draft.targetId, point: undefined }
        : { id: undefined, point: { x: Math.round(draft.pt.x), y: Math.round(draft.pt.y) } };
      if (edit) {
        commit((m) => {
          if (!m[edit.lineId]) return;
          update(m, edit.lineId, {
            content: edit.end === 'to' ? { to: end.id, toPoint: end.point } : { from: end.id, fromPoint: end.point },
          });
        });
        setSelection([edit.lineId]);
        return;
      }
      const line = makeEl('LINE', { parentId: boardId }, {
        arrow: true,
        label: '',
        ...props.newLine,
        from: anchor.id,
        to: end.id,
        toPoint: end.point,
      });
      if (props.newLineColor) line.color = props.newLineColor;
      commit((m) => {
        m[line.id] = line;
      });
      setSelection([line.id]);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('keydown', onKey, true);
  };

  /** Drags a line label along its line; the label sits at the nearest point of the curve. */
  const startLabelDrag = (e: ReactPointerEvent, lineId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX;
    const sy = e.clientY;
    const key = 'labelpos:' + lineId + ':' + Date.now();
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 3) return;
      moved = true;
      const g = geoRef.current[lineId];
      if (!g) return;
      const t = nearestT(g, toBoard(ev.clientX, ev.clientY));
      commit((m) => update(m, lineId, { content: { labelT: Math.round(t * 1000) / 1000 } }), key);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /** Drags the middle handle of a line: distance from the straight chord becomes its curvature. */
  const startBendDrag = (e: ReactPointerEvent, lineId: string) => {
    e.stopPropagation();
    e.preventDefault();
    const g0 = geoRef.current[lineId];
    if (!g0) return;
    const before = els[lineId]?.content.bend ?? 0;
    const key = 'bend:' + lineId + ':' + Date.now();
    let moved = false;
    const move = (ev: PointerEvent) => {
      moved = true;
      const p = toBoard(ev.clientX, ev.clientY);
      const g = geoRef.current[lineId] ?? g0;
      let bend = (p.x - g.mx) * g.nx + (p.y - g.my) * g.ny;
      if (Math.abs(bend) < 8) bend = 0;
      commit((m) => update(m, lineId, { content: { bend: Math.round(bend) } }), key);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.stopPropagation();
      if (moved) commit((m) => update(m, lineId, { content: { bend: before } }), key);
      stop();
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('keydown', onKey, true);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('keydown', onKey, true);
  };

  const onPanelPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    setMenu(null);
    const t = e.target as HTMLElement;
    if (t.closest('[data-link-badge], [data-tag-chip], [data-tag-popup]')) return;
    const node = t.closest<HTMLElement>('[data-el-id]');
    if (!node) return;
    const id = node.dataset.elId!;
    const interactive = t.closest('input, textarea, select, button, a, [contenteditable="true"]');
    if (editingId === id || (interactive && node.contains(interactive))) return;
    if (editingId) setEditingId(null);
    // Keeps the browser from starting a text selection that follows the drag onto the board.
    e.preventDefault();
    setSelection([id]);
    startDrag(e, id, node, [id]);
  };

  const onPanelDoubleClick = (e: ReactMouseEvent) => {
    const node = (e.target as HTMLElement).closest<HTMLElement>('[data-el-id]');
    if (!node) return;
    const el = els[node.dataset.elId!];
    if (!el || editingId === el.id) return;
    if (el.type === 'BOARD') props.openBoard(el.id);
    else if (el.type !== 'FILE') {
      setSelection([el.id]);
      setEditingId(el.id);
    }
  };

  /** Right-click menu on blocks: lock position, bring to front, send to back. */
  const onContextMenu = (e: ReactMouseEvent) => {
    const t = e.target as HTMLElement;
    const r = rootRef.current!.getBoundingClientRect();
    const at = { x: Math.min(e.clientX - r.left, r.width - 200), y: Math.min(e.clientY - r.top, r.height - 320) };
    const lineId = t.closest<SVGElement>('[data-line-id]')?.dataset.lineId ?? t.closest<HTMLElement>('[data-line-label]')?.dataset.lineLabel;
    if (lineId && els[lineId]) {
      e.preventDefault();
      if (editingId) setEditingId(null);
      setSelection([lineId]);
      setMenu({ ...at, ids: [lineId], kind: 'line' });
      return;
    }
    const cellNode = t.closest<HTMLElement>('.grid td, .grid th');
    const tableId = cellNode?.closest<HTMLElement>('[data-el-id]')?.dataset.elId;
    if (cellNode && tableId) {
      e.preventDefault();
      const r = Number(cellNode.dataset.r);
      const c = Number(cellNode.dataset.c);
      setSelection([tableId]);
      setEditingId(tableId);
      // Right-clicking inside a dragged range keeps it, so Clear contents empties the whole range.
      const cur = props.tableCell;
      const keep = cur && cur.id === tableId && editingId === tableId && sheetOps.inRange(sheetOps.rangeOf(cur), r, c);
      const picked = keep ? cur : { id: tableId, r, c };
      props.setTableCell(picked);
      setMenu({ ...at, ids: [tableId], kind: 'cell', cell: { r, c, r2: picked.r2, c2: picked.c2 } });
      return;
    }
    const node = t.closest<HTMLElement>('[data-el-id]');
    const id = node?.dataset.elId;
    if (!id || !els[id]) {
      setMenu(null);
      return;
    }
    e.preventDefault();
    if (editingId) setEditingId(null);
    const ids = selection.includes(id) ? selection.filter((s) => els[s]) : [id];
    if (!selection.includes(id)) setSelection([id]);
    setMenu({ ...at, ids, kind: 'blocks' });
  };

  /** Insert / delete / clear on the right-clicked table cell. */
  const runCellMenu = (op: 'shiftRight' | 'shiftDown' | 'insertRow' | 'insertCol' | 'deleteRow' | 'deleteCol' | 'clear') => {
    if (!menu?.cell) return;
    const id = menu.ids[0];
    const { r, c } = menu.cell;
    const range = sheetOps.rangeOf(menu.cell);
    setMenu(null);
    commit((m) => {
      const el = m[id];
      if (!el) return;
      const t: sheetOps.TableEdit = {
        cells: sheetOps.normalize(el.content.cells?.length ? el.content.cells : [['']]),
        formats: el.content.cellFmt,
        colW: el.content.colW,
        rowH: el.content.rowH,
      };
      const res =
        op === 'shiftRight'
          ? sheetOps.shiftRight(t, r, c)
          : op === 'shiftDown'
            ? sheetOps.shiftDown(t, r, c)
            : op === 'insertRow'
              ? sheetOps.insertRow(t, r)
              : op === 'insertCol'
                ? sheetOps.insertCol(t, c)
                : op === 'deleteRow'
                  ? sheetOps.deleteRow(t, r)
                  : op === 'deleteCol'
                    ? sheetOps.deleteCol(t, c)
                    : { ...t, cells: sheetOps.clearRange(t.cells, range) };
      update(m, id, { content: { cells: res.cells, cellFmt: res.formats, colW: res.colW, rowH: res.rowH } });
    });
    const el = els[id];
    const rows = el?.content.cells?.length ?? 1;
    const cols = sheetOps.width(el?.content.cells ?? [['']]);
    if (op === 'deleteRow') props.setTableCell({ id, r: Math.max(0, Math.min(r, rows - 2)), c });
    if (op === 'deleteCol') props.setTableCell({ id, r, c: Math.max(0, Math.min(c, cols - 2)) });
  };

  const runMenu = (action: Parameters<Props['onMenuAction']>[0]) => {
    if (!menu) return;
    const ids = menu.ids;
    setMenu(null);
    props.onMenuAction(action, ids);
  };

  const menuAction = (action: 'lock' | 'unlock' | 'front' | 'back') => {
    if (!menu) return;
    const ids = menu.ids;
    setMenu(null);
    commit((m) => {
      if (action === 'lock' || action === 'unlock') {
        for (const id of ids) update(m, id, { locked: action === 'lock' ? true : undefined });
        return;
      }
      const zOf = (id: string) => m[id].z ?? m[id].createdAt;
      const others = canvasItems(m, boardId).filter((e) => !ids.includes(e.id)).map((e) => zOf(e.id));
      const ordered = [...ids].sort((a, b) => zOf(a) - zOf(b));
      if (action === 'front') {
        const top = Math.max(Date.now(), ...others);
        ordered.forEach((id, k) => update(m, id, { z: top + 1 + k }));
      } else {
        const bottom = Math.min(...others, ...ordered.map(zOf));
        ordered.forEach((id, k) => update(m, id, { z: bottom - ordered.length + k }));
      }
    });
  };

  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (!(e.target as HTMLElement | null)?.closest?.('.context-menu')) setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(null);
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('wheel', close, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('wheel', close, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  /** Pen or highlighter: one drag is one stroke. Eraser: removes strokes it passes over. */
  const startInk = (e: ReactPointerEvent, settings: DrawSettings) => {
    e.preventDefault();
    if (editingId) setEditingId(null);
    setSelection([]);
    const key = 'ink:' + Date.now();
    const p0 = toBoard(e.clientX, e.clientY);
    if (settings.tool === 'select') {
      const picks = inkSel.filter((p) => elsRef.current[p.id]);
      const b = picks.length ? pickedBounds(elsRef.current, picks) : null;
      const pad = 8 / viewRef.current.zoom;
      if (b && p0.x >= b.l - pad && p0.x <= b.r + pad && p0.y >= b.t - pad && p0.y <= b.b + pad) {
        // Pressed on the picked strokes: they follow the pointer, and go where it is let go.
        const move = (ev: PointerEvent) => {
          const q = toBoard(ev.clientX, ev.clientY);
          setInkMove({ dx: q.x - p0.x, dy: q.y - p0.y });
        };
        const up = (ev: PointerEvent) => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          setInkMove(null);
          const q = toBoard(ev.clientX, ev.clientY);
          const dx = q.x - p0.x;
          const dy = q.y - p0.y;
          if (Math.hypot(dx, dy) < 1) return;
          let placed: InkPick[] = [];
          commit((m) => {
            const items = pickedStrokes(m, picks);
            removeStrokes(m, picks);
            placed = placeStrokes(m, boardId, items, dx, dy);
          });
          setInkSel(placed);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        return;
      }
      // Otherwise a lasso: the strokes it goes around are picked.
      const pts: number[] = [p0.x, p0.y];
      setLasso([...pts]);
      setInkSel([]);
      const move = (ev: PointerEvent) => {
        const q = toBoard(ev.clientX, ev.clientY);
        pushPoint(pts, q.x, q.y, 2 / viewRef.current.zoom);
        setLasso([...pts]);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        setLasso(null);
        setInkSel(strokesInLasso(elsRef.current, boardId, pts));
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      return;
    }
    if (settings.tool === 'eraser') {
      const radius = Math.max(6, settings.size * 2) / viewRef.current.zoom;
      const erase = (x: number, y: number) => {
        const m0 = elsRef.current;
        const probe = { ...m0 };
        if (eraseBoardInk(probe, boardId, x, y, radius)) commit((m) => eraseBoardInk(m, boardId, x, y, radius), key);
      };
      erase(p0.x, p0.y);
      const move = (ev: PointerEvent) => {
        const q = toBoard(ev.clientX, ev.clientY);
        erase(q.x, q.y);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      return;
    }
    const points: number[] = [];
    pushPoint(points, p0.x, p0.y, 0);
    setLiveInk({ points: [...points], settings });
    const move = (ev: PointerEvent) => {
      const q = toBoard(ev.clientX, ev.clientY);
      pushPoint(points, q.x, q.y, 1.5 / viewRef.current.zoom);
      setLiveInk({ points: [...points], settings });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setLiveInk(null);
      let id = '';
      commit((m) => {
        id = addBoardStroke(m, boardId, drawSketch.current, {
          tool: settings.tool === 'highlighter' ? 'highlighter' : 'pen',
          color: settings.color,
          size: settings.size,
          points,
        });
      });
      drawSketch.current = id;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const startPan = (e: ReactPointerEvent) => {
    e.preventDefault();
    const sx = e.clientX;
    const sy = e.clientY;
    const v0 = viewRef.current;
    setPanning(true);
    const move = (ev: PointerEvent) => setView((v) => ({ ...v, x: v0.x + ev.clientX - sx, y: v0.y + ev.clientY - sy }));
    const up = () => {
      setPanning(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /** Shift or Ctrl (Cmd on a Mac) while clicking adds to the selection, or takes the item out again. */
  const multiKey = (e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => e.shiftKey || e.ctrlKey || e.metaKey;
  const toggled = (id: string) => (selection.includes(id) ? selection.filter((x) => x !== id) : [...selection, id]);

  const startMarquee = (e: ReactPointerEvent) => {
    const root = rootRef.current!;
    const rr = root.getBoundingClientRect();
    const sx = e.clientX;
    const sy = e.clientY;
    const base = multiKey(e) ? selection : [];
    if (!multiKey(e)) setSelection([]);
    const move = (ev: PointerEvent) => {
      const l = Math.min(sx, ev.clientX);
      const t = Math.min(sy, ev.clientY);
      const w = Math.abs(ev.clientX - sx);
      const h = Math.abs(ev.clientY - sy);
      if (w < 3 && h < 3) return;
      setMarquee({ x: l - rr.left, y: t - rr.top, w, h });
      const hits: string[] = [];
      for (const n of Array.from(layerRef.current!.querySelectorAll<HTMLElement>(':scope > [data-el-id], :scope > .el-stack > [data-el-id]'))) {
        const r = n.getBoundingClientRect();
        if (r.right > l && r.left < l + w && r.bottom > t && r.top < t + h) hits.push(n.dataset.elId!);
      }
      const tl = toBoard(l, t);
      const br = toBoard(l + w, t + h);
      for (const [lid, g] of Object.entries(geoRef.current)) {
        if (curveHitsRect(g, tl, br)) hits.push(lid);
      }
      setSelection([...new Set([...base, ...hits])]);
    };
    const up = () => {
      setMarquee(null);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button === 2) return;
    const t = e.target as HTMLElement;
    if (t.closest('[data-link-badge], [data-tag-chip], [data-tag-popup]')) return;
    if (e.button === 1 || spaceRef.current) {
      if (spaceRef.current) spacePanned.current = true;
      startPan(e);
      return;
    }
    if (props.drawing) {
      startInk(e, props.drawing);
      return;
    }
    const labelBox = t.closest<HTMLElement>('[data-line-label]');
    if (labelBox) {
      const lid = labelBox.dataset.lineLabel!;
      if (editingId === lid) return;
      if (editingId) setEditingId(null);
      if (multiKey(e)) {
        setSelection(toggled(lid));
        return;
      }
      setSelection([lid]);
      startLabelDrag(e, lid);
      return;
    }
    const cellNode = t.closest<HTMLElement>('.grid td, .grid th');
    const cellHost = cellNode?.closest<HTMLElement>('[data-el-id]')?.dataset.elId;
    if (cellNode && cellHost && editingId === cellHost) {
      // The table is open for editing: the click picks a cell instead of moving the block.
      if (!selection.includes(cellHost)) setSelection([cellHost]);
      return;
    }
    if (t.closest('.resize-handle, .line-hit')) return;
    const handle = t.closest<HTMLElement>('[data-line-handle]');
    if (handle && !connecting) {
      startLineDrag(e, { id: handle.dataset.lineHandle! });
      return;
    }
    const midHandle = t.closest<SVGElement>('[data-line-mid]');
    if (midHandle) {
      startBendDrag(e, midHandle.dataset.lineMid!);
      return;
    }
    const endHandle = t.closest<SVGElement>('[data-line-end]');
    if (endHandle) {
      const ln = els[endHandle.dataset.lineId!];
      const end = endHandle.dataset.lineEnd as 'from' | 'to';
      if (ln) {
        const other = end === 'to' ? { id: ln.content.from, point: ln.content.fromPoint } : { id: ln.content.to, point: ln.content.toPoint };
        startLineDrag(e, other, { lineId: ln.id, end });
      }
      return;
    }
    const node = t.closest<HTMLElement>('[data-el-id]');
    if (!node) {
      if (connecting) {
        setConnecting(false);
        return;
      }
      if (editingId) setEditingId(null);
      (document.activeElement as HTMLElement | null)?.blur?.();
      startMarquee(e);
      return;
    }
    const id = node.dataset.elId!;
    if (connecting) {
      e.preventDefault();
      if (!connectFrom) {
        setConnectFrom(id);
        setConnectPt(toBoard(e.clientX, e.clientY));
      } else if (connectFrom !== id) {
        const line = makeEl('LINE', { parentId: boardId }, { arrow: true, label: '', ...props.newLine, from: connectFrom, to: id });
        if (props.newLineColor) line.color = props.newLineColor;
        commit((m) => {
          m[line.id] = line;
        });
        setSelection([line.id]);
        setConnecting(false);
      }
      return;
    }
    if (t.closest('.paper-scroll, .paper-abstract')) {
      if (editingId) setEditingId(null);
      if (!selection.includes(id)) setSelection([id]);
      return;
    }
    const interactive = t.closest('input, textarea, select, button, a, [contenteditable="true"]');
    if (editingId === id || (interactive && node.contains(interactive))) {
      if (editingId && editingId !== id) setEditingId(null);
      return;
    }
    if (editingId) setEditingId(null);
    (document.activeElement as HTMLElement | null)?.blur?.();

    let sel = selection;
    if (multiKey(e)) {
      sel = toggled(id);
      setSelection(sel);
      if (!sel.includes(id)) return;
    } else if (!sel.includes(id)) {
      sel = [id];
      setSelection(sel);
    }
    startDrag(e, id, node, sel);
  };

  const onDoubleClick = (e: ReactMouseEvent) => {
    if (props.drawing) return;
    const t = e.target as HTMLElement;
    if (t.closest('.grid td, .grid th, .cell-input')) return;
    const lbl = t.closest<HTMLElement>('[data-line-label]');
    if (lbl) {
      setSelection([lbl.dataset.lineLabel!]);
      setEditingId(lbl.dataset.lineLabel!);
      return;
    }
    // Double-clicking anywhere on a line, including its curvature handle, edits its label.
    const mid = t.closest<SVGElement>('[data-line-mid]');
    if (mid) {
      setSelection([mid.dataset.lineMid!]);
      setEditingId(mid.dataset.lineMid!);
      return;
    }
    if (connecting || t.closest('.line-hit, [data-line-end], .paper-scroll, .paper-abstract')) return;
    const node = t.closest<HTMLElement>('[data-el-id]');
    if (node) {
      const id = node.dataset.elId!;
      if (editingId === id) return;
      const el = els[id];
      if (el.type === 'BOARD') props.openBoard(id);
      else if (el.type === 'COLUMN' && !t.closest('.column-header')) return;
      else if (el.type === 'SKETCH' && !t.closest('.sketch-title, .caption')) props.onDrawOn?.(id);
      else if (el.type !== 'FILE') {
        setSelection([id]);
        setEditingId(id);
      }
      return;
    }
    const p = toBoard(e.clientX, e.clientY);
    const id = addElement(commit, 'CARD', boardId, { x: p.x, y: p.y + 30 });
    setSelection([id]);
    setEditingId(id);
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    if (connecting && connectFrom) setConnectPt(toBoard(e.clientX, e.clientY));
  };

  /* Drag-in from the toolbar or from the file system. */
  const columnSlotAt = (cx: number, cy: number): ColumnSlot | null => {
    const target = findDropTarget(cx, cy, []);
    return target?.kind === 'column' ? { id: target.id, index: target.index } : null;
  };

  const onDragOver = (e: ReactDragEvent) => {
    if (e.dataTransfer.types.includes('application/x-board-tool') || e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  const onDrop = (e: ReactDragEvent) => {
    e.preventDefault();
    const p = toBoard(e.clientX, e.clientY);
    const slot = columnSlotAt(e.clientX, e.clientY);
    const tool = e.dataTransfer.getData('application/x-board-tool') as ElementType | '';
    if (tool) {
      window.dispatchEvent(new CustomEvent('board-tool-drop', { detail: { tool, at: p, slot } }));
      return;
    }
    const files = Array.from(e.dataTransfer.files);
    if (files.length) {
      addFiles(commit, files, boardId, p, slot).then((ids) => setSelection(ids));
      return;
    }
    const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    if (/^https?:\/\//.test(url)) {
      const id = addElement(commit, 'LINK', boardId, p, slot);
      commit((m) => update(m, id, { content: { url: url.split('\n')[0].trim() } }));
      setSelection([id]);
    }
  };

  const ctx: BoardCtxValue = {
    els,
    boardId,
    selection: selSet,
    editingId,
    setEditingId,
    commit,
    drag: drag?.started ? { ids: new Set(drag.ids), dx: drag.dx, dy: drag.dy, mode: drag.mode } : null,
    dropTarget,
    openBoard: props.openBoard,
    select: setSelection,
    goToOriginal: props.goToOriginal,
    connectFrom,
    lineTargetId: lineDraft?.targetId ?? null,
    openComments: props.onOpenComments,
    meId: props.meId,
    tableCell: props.tableCell,
    setTableCell: props.setTableCell,
    freeSpot: (w, h, near, exclude) => props.apiRef.current?.freeSpot(w, h, near, exclude) ?? near ?? { x: 0, y: 0 },
    zoom: view.zoom,
  };

  /** Whether a block sits inside a column. */
  const inColumn = (id?: string) => {
    const e = id ? els[id] : undefined;
    return !!e && e.loc.section === 'ATTACHED' && els[e.loc.parentId]?.type === 'COLUMN';
  };
  const frontLine = (ln: El) => inColumn(ln.content.from) || inColumn(ln.content.to);
  /**
   * A line reaching a card in a column is drawn just above the higher of the two blocks it joins
   * (for a card in a column: that column), not above every block: a block lying over it, such as
   * one made later, covers it as it covers any line.
   */
  const frontAfter = (() => {
    const order = new Map(items.map((e, i) => [e.id, i]));
    const hostOf = (id?: string) => {
      let e = id ? els[id] : undefined;
      let guard = 0;
      while (e && e.loc.section !== 'CANVAS' && guard++ < 50) e = els[e.loc.parentId];
      return e && order.has(e.id) ? e.id : undefined;
    };
    const after = new Map<string, El[]>();
    for (const ln of lines.filter(frontLine)) {
      // With the column a card it joins is in: over the column, under that column's own handles.
      const hosts = [ln.content.from, ln.content.to]
        .filter((id) => inColumn(id))
        .map((id) => hostOf(id))
        .filter((h): h is string => !!h && els[h]?.type === 'COLUMN');
      const top = hosts.sort((a, b) => order.get(b)! - order.get(a)!)[0] ?? '';
      after.set(top, [...(after.get(top) ?? []), ln]);
    }
    return after;
  })();
  /** How big each line label is (board units), for lines with a clear label. */
  const [labelSize, setLabelSize] = useState<Record<string, { w: number; h: number }>>({});
  /** A line's label (or its box while being written). */
  const renderLabel = (ln: El) => {
    const g = geo[ln.id];
    const editingLabel = editingId === ln.id;
    if (!g || (!ln.content.label && !editingLabel)) return null;
    const p = labelPoint(g, ln.content.labelT);
    const sel = selSet.has(ln.id);
    return (
      <LineLabel
        key={'label-' + ln.id}
        line={ln}
        x={p.x}
        y={p.y}
        editing={editingLabel}
        selected={sel}
        color={ln.color ? COLORS[ln.color] : DEFAULT_LINE}
        labelColor={ln.content.labelColor && ln.content.labelColor !== 'clear' ? COLORS[ln.content.labelColor] : undefined}
        noBorder={ln.content.labelColor === 'clear'}
        clear={ln.content.labelBg === 'clear'}
        bg={ln.content.labelBg && ln.content.labelBg !== 'clear' ? COLORS[ln.content.labelBg] : undefined}
        onSize={(w, h) => setLabelSize((cur) => (cur[ln.id]?.w === w && cur[ln.id]?.h === h ? cur : { ...cur, [ln.id]: { w, h } }))}
        commit={commit}
        onDone={() => setEditingId(null)}
      />
    );
  };
  /** One line on the board: its path, arrowheads and the wider invisible band that picks it. */
  const renderLine = (ln: El, front = false) => {
    const g = geo[ln.id];
    if (!g) return null;
    // Under the blocks a line may run centre to centre; on top of them it stops at their borders.
    const d = front ? g.dEdge : g.d;
    const sel = selSet.has(ln.id);
    const color = sel ? SELECTED_LINE : ln.color ? COLORS[ln.color] : DEFAULT_LINE;
    const w = LINE_WEIGHTS[ln.content.weight ?? 'normal'];
    // A clear label: the line is left out behind it, so it does not run through the words.
    const ls = labelSize[ln.id];
    const cut = ln.content.labelBg === 'clear' && (ln.content.label || editingId === ln.id) && ls ? labelPoint(g, ln.content.labelT) : null;
    const maskId = cut ? `label-cut-${ln.id}` : undefined;
    return (
      <g
        key={ln.id}
        className={sel ? 'line selected' : 'line'}
        data-line-id={ln.id}
        data-line-style={ln.content.lineStyle ?? 'solid'}
        data-free-end={ln.content.toPoint || ln.content.fromPoint ? 'true' : undefined}
      >
        {cut && ls && (
          <mask id={maskId} maskUnits="userSpaceOnUse" x={-1e6} y={-1e6} width={2e6} height={2e6}>
            <rect x={-1e6} y={-1e6} width={2e6} height={2e6} fill="#fff" />
            <rect x={cut.x - ls.w / 2 - 2} y={cut.y - ls.h / 2 - 2} width={ls.w + 4} height={ls.h + 4} rx={10} fill="#000" />
          </mask>
        )}
        <g mask={maskId ? `url(#${maskId})` : undefined} data-label-cut={maskId ? 'true' : undefined}>
          <path
            d={d}
            fill="none"
            className="line-path"
            stroke={color}
            strokeWidth={w}
            strokeDasharray={dashFor(ln.content.lineStyle, w)}
            strokeLinecap={ln.content.lineStyle === 'dotted' ? 'round' : 'butt'}
          />
          {ln.content.arrow && <ArrowHead x={g.x2} y={g.y2} angle={g.a2} w={w} color={color} />}
          {ln.content.arrowStart && <ArrowHead x={g.x1} y={g.y1} angle={g.a1} w={w} color={color} />}
        </g>
        <path
          d={d}
          fill="none"
          className="line-hit"
          onPointerDown={(e) => {
            e.stopPropagation();
            setEditingId(null);
            setSelection(multiKey(e) ? toggled(ln.id) : [ln.id]);
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            setSelection([ln.id]);
            // A new label: its border in the line's colour, on white.
            if (!ln.content.label) commit((m) => update(m, ln.id, { content: { labelColor: ln.color, labelBg: undefined } }), 'label:' + ln.id);
            setEditingId(ln.id);
          }}
        />
      </g>
    );
  };
  const ghostEl = drag?.started && drag.mode === 'attached' ? els[drag.ids[0]] : null;
  const grid = 24 * view.zoom;

  return (
    <BoardCtx.Provider value={ctx}>
      <div
        ref={rootRef}
        className={['canvas', connecting && 'connecting', panning && 'panning', drag?.started && 'is-dragging', props.drawing && `drawing tool-${props.drawing.tool}`]
          .filter(Boolean)
          .join(' ')}
        style={{
          backgroundSize: `${grid}px ${grid}px`,
          backgroundPosition: `${view.x}px ${view.y}px`,
          // Far out, dots only add noise; drop them.
          backgroundImage: view.zoom < DOTS_MIN_ZOOM ? 'none' : undefined,
        }}
        data-dots={view.zoom < DOTS_MIN_ZOOM ? 'off' : 'on'}
        onContextMenu={onContextMenu}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onDoubleClick={onDoubleClick}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        {/* Only the board's content zooms when a board is opened or left (not the panels and bars). */}
        <div className="board-zoom">
        <div
          ref={layerRef}
          className="layer"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}
        >
          <svg className="lines" width="1" height="1">
            {lines.filter((ln) => !frontLine(ln)).map((ln) => renderLine(ln))}
            {connecting && connectFrom && connectPt && (
              <PendingLine fromId={connectFrom} to={connectPt} layerRef={layerRef} zoom={view.zoom} style={props.newLine} />
            )}
            {lineDraft && (
              <DraftLine
                draft={lineDraft}
                layerRef={layerRef}
                zoom={view.zoom}
                line={lineDraft.edit ? els[lineDraft.edit.lineId] : undefined}
                style={props.newLine}
                color={props.newLineColor}
              />
            )}
          </svg>
          {/* Labels of the lines under the blocks: a block lying over one covers it, as it covers the line. */}
          {lines.filter((ln) => !frontLine(ln) && editingId !== ln.id).map(renderLabel)}
          {items.map((el) =>
            el.type === 'COLUMN' ? (
              // A column and the lines reaching its cards share one level: the lines over the column,
              // the cards' own handles (connect, resize) over the lines, and a block lying over the
              // column over all of it.
              <div key={el.id} className="el-stack" data-stack={el.id}>
                <ElementView el={el} placement="canvas" />
                {frontAfter.has(el.id) && (
                  <svg className="lines lines-front" width="1" height="1" data-front-after={el.id}>
                    {frontAfter.get(el.id)!.map((ln) => renderLine(ln, true))}
                  </svg>
                )}
                {frontAfter.get(el.id)?.filter((ln) => editingId !== ln.id).map(renderLabel)}
              </div>
            ) : (
              <Fragment key={el.id}>
                <ElementView el={el} placement="canvas" />
              </Fragment>
            ),
          )}
          {frontAfter.has('') && (
            <svg className="lines lines-front" width="1" height="1">
              {frontAfter.get('')!.map((ln) => renderLine(ln, true))}
            </svg>
          )}
          {frontAfter.get('')?.filter((ln) => editingId !== ln.id).map(renderLabel)}
          {/* The label being written, on top of everything. */}
          {lines.filter((ln) => editingId === ln.id).map(renderLabel)}
          {ghostEl && drag && (
            <ElementView
              el={ghostEl}
              placement="ghost"
              style={{ left: drag.px - drag.grabX, top: drag.py - drag.grabY, width: drag.width }}
            />
          )}
          {(lasso || inkSel.length > 0) && (
            <svg className="ink-pick" width="1" height="1" data-ink-pick={inkSel.reduce((n, p) => n + p.strokes.length, 0)}>
              {lasso && <path className="ink-lasso" d={'M' + lasso.join(' ') + 'Z'} fill="rgba(63,111,216,0.06)" />}
              {inkSel.length > 0 &&
                (() => {
                  const items = pickedStrokes(els, inkSel);
                  const b = pickedBounds(els, inkSel);
                  if (!b) return null;
                  const t = inkMove ? `translate(${inkMove.dx} ${inkMove.dy})` : undefined;
                  return (
                    <g transform={t}>
                      {items.map((it, i) => (
                        <path key={i} className="ink-picked" d={strokeD(it.stroke.points)} strokeWidth={inkWidth({ ...it.stroke, id: '' }) + 6 / view.zoom} fill="none" />
                      ))}
                      <rect className="ink-pick-box" x={b.l - 6} y={b.t - 6} width={b.r - b.l + 12} height={b.b - b.t + 12} rx={4} />
                    </g>
                  );
                })()}
            </svg>
          )}
          {liveInk && (
            <svg className="ink-live" width="1" height="1">
              <path
                d={strokeD(liveInk.points)}
                fill="none"
                stroke={liveInk.settings.color}
                strokeWidth={liveInk.settings.tool === 'highlighter' ? liveInk.settings.size * HIGHLIGHT_FACTOR : liveInk.settings.size}
                strokeOpacity={liveInk.settings.tool === 'highlighter' ? HIGHLIGHT_OPACITY : 1}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
          <svg className="lines lines-overlay" width="1" height="1">
            {!lineDraft && selection.length === 1 && els[selection[0]]?.type === 'LINE' && geo[selection[0]] && !editingId && (
              <circle
                className="line-mid"
                data-line-mid={selection[0]}
                cx={geo[selection[0]].hx}
                cy={geo[selection[0]].hy}
                r={6 / view.zoom}
                strokeWidth={2 / view.zoom}
              />
            )}
            {!lineDraft &&
              selection.length === 1 &&
              els[selection[0]]?.type === 'LINE' &&
              geo[selection[0]] &&
              (['from', 'to'] as const).map((end) => {
                const g = geo[selection[0]];
                return (
                  <circle
                    key={end}
                    className="line-end"
                    data-line-end={end}
                    data-line-id={selection[0]}
                    cx={end === 'from' ? g.x1 : g.x2}
                    cy={end === 'from' ? g.y1 : g.y2}
                    r={6 / view.zoom}
                    strokeWidth={2 / view.zoom}
                  />
                );
              })}
          </svg>
        </div>
        </div>
        {marquee && (
          <div className="marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />
        )}
        {awayHint && (
          <button
            className="away-hint"
            data-away-hint
            title={tr('콘텐츠가 있는 곳으로 이동', 'Go to content')}
            aria-label={tr('콘텐츠가 있는 곳으로 이동', 'Go to content')}
            style={{ left: awayHint.x, top: awayHint.y, ['--away-angle' as string]: `${awayHint.angle}deg` }}
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onClick={() => glideTo(awayHint.to)}
          >
            <span className="away-drop" />
            <svg className="away-arrow" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path d="M5 12h12M12 6.5l5.5 5.5-5.5 5.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        {items.length === 0 && (
          <div className="empty-hint">
            <div className="big">{tr('빈 보드입니다', 'This board is empty')}</div>
            <div>{tr('빈 곳을 더블클릭해서 노트를 만들거나, 왼쪽 도구를 클릭하거나 끌어다 놓으세요.', 'Double-click an empty spot to add a note, or click or drag a tool from the left.')}</div>
            <div>{tr('이미지나 파일을 이곳에 끌어다 놓아도 됩니다.', 'You can also drop images or files here.')}</div>
          </div>
        )}
      </div>
      {menu && (
        <div className="context-menu" role="menu" style={{ left: menu.x, top: menu.y }}>
          {menu.kind === 'cell' ? (
            <>
              <div className="cm-header">{tr('삽입', 'Insert')}</div>
              <button role="menuitem" onClick={() => runCellMenu('shiftRight')}>
                <span className="cm-icon">
                  <Icon name="arrowEnd" size={17} />
                </span>
                {tr('셀을 오른쪽으로 밀기', 'Shift cells right')}
              </button>
              <button role="menuitem" onClick={() => runCellMenu('shiftDown')}>
                <span className="cm-icon">
                  <Icon name="down" size={17} />
                </span>
                {tr('셀을 아래로 밀기', 'Shift cells down')}
              </button>
              <button role="menuitem" onClick={() => runCellMenu('insertRow')}>
                <span className="cm-icon">
                  <Icon name="rowPlus" size={17} />
                </span>
                {tr('행 전체', 'Entire row')}
              </button>
              <button role="menuitem" onClick={() => runCellMenu('insertCol')}>
                <span className="cm-icon">
                  <Icon name="colPlus" size={17} />
                </span>
                {tr('열 전체', 'Entire column')}
              </button>
              <div className="cm-sep" />
              <div className="cm-header">{tr('삭제', 'Delete')}</div>
              <button role="menuitem" className="cm-danger" onClick={() => runCellMenu('deleteRow')}>
                <span className="cm-icon">
                  <Icon name="rowMinus" size={17} />
                </span>
                {tr('행 전체', 'Entire row')}
              </button>
              <button role="menuitem" className="cm-danger" onClick={() => runCellMenu('deleteCol')}>
                <span className="cm-icon">
                  <Icon name="colMinus" size={17} />
                </span>
                {tr('열 전체', 'Entire column')}
              </button>
              <div className="cm-sep" />
              <button role="menuitem" onClick={() => runCellMenu('clear')}>
                <span className="cm-icon">
                  <Icon name="eraser" size={17} />
                </span>
                {tr('내용 지우기', 'Clear contents')}
              </button>
            </>
          ) : menu.kind === 'line' ? (
            <>
              <button role="menuitem" onClick={() => runMenu('label')}>
                <span className="cm-icon">
                  <Icon name="tag" size={17} />
                </span>
                {tr('라벨', 'Label')}
              </button>
              <div className="cm-sep" />
              <button role="menuitem" className="cm-danger" onClick={() => runMenu('delete')}>
                <span className="cm-icon">
                  <Icon name="trash" size={17} />
                </span>
                {tr('삭제', 'Delete')}
              </button>
            </>
          ) : (
            <>
          {menu.ids.length === 1 && els[menu.ids[0]]?.type === 'BOARD' && (
            <button role="menuitem" onClick={() => runMenu('open')}>
              <span className="cm-icon">
                <Icon name="board" size={17} />
              </span>
              {tr('열기', 'Open')}
            </button>
          )}
          {menu.ids.length === 1 && els[menu.ids[0]] && !['FILE', 'LINE'].includes(els[menu.ids[0]].type) && (
            <button role="menuitem" onClick={() => runMenu('edit')}>
              <span className="cm-icon">
                <Icon name="rename" size={17} />
              </span>
              {tr('편집', 'Edit')}
            </button>
          )}
          {menu.ids.length === 1 && (
            <button role="menuitem" onClick={() => runMenu('comment')}>
              <span className="cm-icon">
                <Icon name="comment" size={17} />
              </span>
              {tr('댓글', 'Comments')}{els[menu.ids[0]]?.content.comments?.length ? ` ${els[menu.ids[0]].content.comments!.length}` : ''}
            </button>
          )}
          <button role="menuitem" onClick={() => runMenu('duplicate')}>
            <span className="cm-icon">
              <Icon name="copy" size={17} />
            </span>
            {tr('복제', 'Duplicate')}
          </button>
          {menu.ids.length === 1 && els[menu.ids[0]] && CONTEXT_OPTIONS[els[menu.ids[0]].type]?.includes('label') && (
            <button role="menuitem" data-menu-tag onClick={() => runMenu('tag')}>
              <span className="cm-icon">
                <Icon name="tag" size={17} />
              </span>
              {tr('태그 추가', 'Add tag')}
            </button>
          )}
          {menu.ids.length === 1 && <CopiesItem els={els} id={menu.ids[0]} onPick={(cid) => (setMenu(null), props.showBlock(cid))} />}
          {menu.ids.length === 1 && els[menu.ids[0]]?.linkOf && els[els[menu.ids[0]].linkOf!] && (
            <>
              <button role="menuitem" data-menu-original onClick={() => runMenu('original')}>
                <span className="cm-icon">
                  <Icon name="link" size={17} />
                </span>
                {tr('원본으로 가기', 'Go to the original')}
              </button>
              <button role="menuitem" data-menu-unlink onClick={() => runMenu('unlink')}>
                <span className="cm-icon">
                  <Icon name="close" size={17} />
                </span>
                {tr('원본과 연결 끊기', 'Unlink from the original')}
              </button>
            </>
          )}
          {menu.ids.every((id) => els[id]?.loc.section === 'CANVAS' && els[id]?.type !== 'LINE') && (
            <>
          <div className="cm-sep" />
          {menu.ids.every((id) => els[id]?.locked) ? (
            <button role="menuitem" onClick={() => menuAction('unlock')}>
              <span className="cm-icon">
                <Icon name="unlock" size={17} />
              </span>
              {tr('위치 잠금 풀기', 'Unlock position')}
            </button>
          ) : (
            <button role="menuitem" onClick={() => menuAction('lock')}>
              <span className="cm-icon">
                <Icon name="lock" size={17} />
              </span>
              {tr('위치 잠그기', 'Lock position')}
            </button>
          )}
          <button role="menuitem" onClick={() => menuAction('front')}>
            <span className="cm-icon">
              <Icon name="front" size={17} />
            </span>
            {tr('맨 앞으로 가져오기', 'Bring to front')}
          </button>
          <button role="menuitem" onClick={() => menuAction('back')}>
            <span className="cm-icon">
              <Icon name="back" size={17} />
            </span>
            {tr('맨 뒤로 보내기', 'Send to back')}
          </button>
            </>
          )}
          <div className="cm-sep" />
          <button role="menuitem" className="cm-danger" onClick={() => runMenu('delete')}>
            <span className="cm-icon">
              <Icon name="trash" size={17} />
            </span>
            {tr('삭제', 'Delete')}
          </button>
            </>
          )}
        </div>
      )}
      {props.unsortedOpen &&
        props.unsortedSlot &&
        createPortal(
        <div
          className={dropTarget?.kind === 'inbox' ? 'unsorted-panel drop-over' : 'unsorted-panel'}
          aria-label="Unsorted"
          onPointerDown={onPanelPointerDown}
          onDoubleClick={onPanelDoubleClick}
          onContextMenu={onContextMenu}
        >
          <div className="unsorted-head">
            <strong>Unsorted</strong>
            <span className="count">{inbox.length}</span>
            <button onClick={() => props.setUnsortedOpen(false)} title={tr('Unsorted 닫기', 'Close Unsorted')}>
              <Icon name="close" size={16} />
            </button>
          </div>
          <div className="unsorted-body">
            {inbox.length === 0 && (
              <div className="unsorted-empty">
                {tr('Ctrl+V로 붙여넣은 항목이 여기에 먼저 모입니다. 보드의 원하는 곳으로 끌어다 놓으세요.', 'Items pasted with Ctrl+V land here first. Drag them where you want on the board.')}
              </div>
            )}
            {inbox.map((el) => (
              <ElementView key={el.id} el={el} placement="attached" />
            ))}
          </div>
        </div>,
          props.unsortedSlot,
        )}
      {!props.unsortedOpen && (
        <button className="unsorted-tab" onClick={() => props.setUnsortedOpen(true)} title={tr('Unsorted 열기', 'Open Unsorted')}>
          Unsorted{inbox.length > 0 && <span className="count">{inbox.length}</span>}
        </button>
      )}
    </BoardCtx.Provider>
  );
}

/**
 * The right-click menu's "Go to copies" on a block that has linked copies: one copy goes straight
 * there; several open a side menu listing them, with the board each one is on.
 */
function CopiesItem({ els, id, onPick }: { els: ElMap; id: string; onPick: (copyId: string) => void }) {
  const [open, setOpen] = useState(false);
  const copies = Object.values(els).filter((e) => e.linkOf === id && !isHidden(els, e.id));
  if (!copies.length) return null;
  const where = (e: El) => {
    const b = containingBoard(els, e.id);
    return b === ROOT_ID ? tr('홈', 'Home') : els[b]?.content.title || tr('제목 없는 보드', 'Untitled board');
  };
  if (copies.length === 1)
    return (
      <button role="menuitem" data-menu-copies onClick={() => onPick(copies[0].id)}>
        <span className="cm-icon">
          <Icon name="exchange" size={17} />
        </span>
        {tr('복사본으로 가기', 'Go to the copy')}
      </button>
    );
  return (
    <div className="cm-sub-wrap" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button role="menuitem" aria-haspopup="menu" aria-expanded={open} data-menu-copies className={open ? 'open' : ''} onClick={() => setOpen(true)}>
        <span className="cm-icon">
          <Icon name="exchange" size={17} />
        </span>
        {tr(`복사본으로 가기 (${copies.length})`, `Go to a copy (${copies.length})`)}
        <span className="cm-more" aria-hidden>
          ›
        </span>
      </button>
      {open && (
        <div className="context-menu cm-side" role="menu" data-copies-menu>
          {copies.map((c) => (
            <button key={c.id} role="menuitem" data-copy-id={c.id} onClick={() => onPick(c.id)}>
              <span className="cm-icon">
                <Icon name="board" size={15} />
              </span>
              <span className="cm-copy-text">
                <span>{where(c)}</span>
                <span className="muted small">{elTitle(c).slice(0, 40)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PendingLine({
  fromId,
  to,
  layerRef,
  zoom,
  style,
}: {
  fromId: string;
  to: Point;
  layerRef: MutableRefObject<HTMLDivElement | null>;
  zoom: number;
  style: Content;
}) {
  const layer = layerRef.current;
  const node = layer?.querySelector<HTMLElement>(`[data-el-id="${fromId}"]`);
  if (!layer || !node) return null;
  const lr = layer.getBoundingClientRect();
  const r = node.getBoundingClientRect();
  const cx = (r.left - lr.left + r.width / 2) / zoom;
  const cy = (r.top - lr.top + r.height / 2) / zoom;
  const w = LINE_WEIGHTS[style.weight ?? 'normal'];
  return (
    <line
      x1={cx}
      y1={cy}
      x2={to.x}
      y2={to.y}
      className="line-pending"
      strokeWidth={w}
      strokeDasharray={dashFor(style.lineStyle, w) ?? '6 4'}
      strokeLinecap={style.lineStyle === 'dotted' ? 'round' : 'butt'}
    />
  );
}

type Box = { x: number; y: number; w: number; h: number };

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Box of a block in board units. Boards are measured by their icon tile, not the caption under it. */
function measureBox(layer: HTMLElement, lr: DOMRect, id: string, zoom: number): Box | null {
  const n = layer.querySelector<HTMLElement>(`[data-el-id="${id}"]`);
  if (!n) return null;
  // A card scrolled out of sight in its column: its lines go out of sight with it.
  const frame = n.parentElement?.closest<HTMLElement>('.column-body[data-column-scroll]');
  if (frame) {
    const f = frame.getBoundingClientRect();
    const c = n.getBoundingClientRect();
    if (c.bottom <= f.top + 2 || c.top >= f.bottom - 2) return null;
  }
  const target = n.classList.contains('el-board') ? n.querySelector<HTMLElement>(':scope > .board-card > .board-icon') ?? n : n;
  const r = target.getBoundingClientRect();
  return { x: (r.left - lr.left) / zoom, y: (r.top - lr.top) / zoom, w: r.width / zoom, h: r.height / zoom };
}

/**
 * Line from the centre of one block to the centre of the other, drawn under the blocks so it meets
 * their borders with no gap. A non-zero `bend` pushes the middle along the chord's normal; the
 * quadratic curve passes through that point. Arrowheads go where the curve crosses each border.
 */
function lineGeometry(a: Box, b: Box, bend: number): Geo {
  const sx = a.x + a.w / 2;
  const sy = a.y + a.h / 2;
  const ex = b.x + b.w / 2;
  const ey = b.y + b.h / 2;
  const mx = (sx + ex) / 2;
  const my = (sy + ey) / 2;
  const len = Math.hypot(ex - sx, ey - sy) || 1;
  const nx = -(ey - sy) / len;
  const ny = (ex - sx) / len;
  const hx = mx + nx * bend;
  const hy = my + ny * bend;
  const qx = 2 * hx - mx;
  const qy = 2 * hy - my;
  const at = (t: number): Point => {
    const u = 1 - t;
    return { x: u * u * sx + 2 * u * t * qx + t * t * ex, y: u * u * sy + 2 * u * t * qy + t * t * ey };
  };
  const tangent = (t: number): Point => ({
    x: 2 * (1 - t) * (qx - sx) + 2 * t * (ex - qx),
    y: 2 * (1 - t) * (qy - sy) + 2 * t * (ey - qy),
  });
  const inside = (p: Point, box: Box) =>
    box.w > 0 && box.h > 0 && p.x > box.x && p.x < box.x + box.w && p.y > box.y && p.y < box.y + box.h;
  /** First curve parameter, walking from `from` towards `to`, where the curve is outside `box`. */
  const exit = (box: Box, from: number, to: number) => {
    if (!inside(at(from), box)) return from;
    const steps = 48;
    let prev = from;
    for (let i = 1; i <= steps; i++) {
      const t = from + ((to - from) * i) / steps;
      if (!inside(at(t), box)) {
        let lo = prev;
        let hi = t;
        for (let k = 0; k < 20; k++) {
          const mid = (lo + hi) / 2;
          if (inside(at(mid), box)) lo = mid;
          else hi = mid;
        }
        return hi;
      }
      prev = t;
    }
    return from;
  };
  const t1 = exit(a, 0, 1);
  const t2 = exit(b, 1, 0);
  const p1 = at(t1);
  const p2 = at(t2);
  const d1 = tangent(t1);
  const d2 = tangent(t2);
  const d = bend
    ? `M${r1(sx)} ${r1(sy)} Q${r1(qx)} ${r1(qy)} ${r1(ex)} ${r1(ey)}`
    : `M${r1(sx)} ${r1(sy)} L${r1(ex)} ${r1(ey)}`;
  // The same curve from border to border only, for lines drawn over the blocks.
  const cx = (1 - t1) * (1 - t2) * sx + ((1 - t1) * t2 + t1 * (1 - t2)) * qx + t1 * t2 * ex;
  const cy = (1 - t1) * (1 - t2) * sy + ((1 - t1) * t2 + t1 * (1 - t2)) * qy + t1 * t2 * ey;
  const dEdge = bend
    ? `M${r1(p1.x)} ${r1(p1.y)} Q${r1(cx)} ${r1(cy)} ${r1(p2.x)} ${r1(p2.y)}`
    : `M${r1(p1.x)} ${r1(p1.y)} L${r1(p2.x)} ${r1(p2.y)}`;
  return {
    sx,
    sy,
    ex,
    ey,
    x1: p1.x,
    y1: p1.y,
    x2: p2.x,
    y2: p2.y,
    t1,
    t2,
    a1: Math.atan2(-d1.y, -d1.x),
    a2: Math.atan2(d2.y, d2.x),
    qx,
    qy,
    hx,
    hy,
    mx,
    my,
    nx,
    ny,
    d,
    dEdge,
    key: `${d}|${r1(p1.x)},${r1(p1.y)},${r1(p2.x)},${r1(p2.y)}`,
  };
}

function curvePoint(g: Geo, t: number): Point {
  const u = 1 - t;
  return { x: u * u * g.sx + 2 * u * t * g.qx + t * t * g.ex, y: u * u * g.sy + 2 * u * t * g.qy + t * t * g.ey };
}

/** Label position: its stored spot along the line, kept within the part visible between blocks. */
function labelPoint(g: Geo, labelT?: number): Point {
  const t = g.t2 > g.t1 ? Math.min(g.t2, Math.max(g.t1, labelT ?? 0.5)) : 0.5;
  return curvePoint(g, t);
}

/** Curve parameter of the visible line point nearest to `p`. */
function nearestT(g: Geo, p: Point): number {
  const lo = g.t2 > g.t1 ? g.t1 : 0;
  const hi = g.t2 > g.t1 ? g.t2 : 1;
  const dist = (t: number) => {
    const q = curvePoint(g, t);
    return (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
  };
  let best = lo;
  let bestD = Infinity;
  const steps = 120;
  for (let i = 0; i <= steps; i++) {
    const t = lo + ((hi - lo) * i) / steps;
    const d = dist(t);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  let a = Math.max(lo, best - (hi - lo) / steps);
  let b = Math.min(hi, best + (hi - lo) / steps);
  for (let k = 0; k < 30; k++) {
    const m1 = a + (b - a) / 3;
    const m2 = b - (b - a) / 3;
    if (dist(m1) < dist(m2)) b = m2;
    else a = m1;
  }
  return (a + b) / 2;
}

/**
 * Rounded label on a line. Double-clicking the line opens it with a blinking caret; what is typed
 * is saved as you go, and a label left empty is removed when editing ends.
 */
function LineLabel({
  line,
  x,
  y,
  editing,
  selected,
  color,
  labelColor,
  noBorder,
  clear,
  bg,
  onSize,
  commit,
  onDone,
}: {
  line: El;
  x: number;
  y: number;
  editing: boolean;
  selected: boolean;
  color: string;
  labelColor?: string;
  noBorder?: boolean;
  clear?: boolean;
  bg?: string;
  onSize?: (w: number, h: number) => void;
  commit: Commit;
  onDone: () => void;
}) {
  const [text, setText] = useState(line.content.label ?? '');
  const inputRef = useRef<HTMLInputElement>(null);
  const lineRef = useRef(line);
  lineRef.current = line;
  const keyRef = useRef('label:' + line.id);
  const wasEditing = useRef(false);

  /** Removes a label that ended up empty; does nothing (and adds no undo step) otherwise. */
  const dropIfEmpty = () => {
    const c = lineRef.current.content;
    if ((c.label ?? '').trim()) return;
    if (c.label === undefined && c.labelT === undefined) return;
    const id = lineRef.current.id;
    commit((m) => update(m, id, { content: { label: undefined, labelT: undefined } }), keyRef.current);
  };

  useEffect(() => {
    if (editing) {
      wasEditing.current = true;
      keyRef.current = 'label:' + line.id + ':' + Date.now();
      setText(lineRef.current.content.label ?? '');
      requestAnimationFrame(() => {
        const input = inputRef.current;
        if (!input) return;
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      });
      return;
    }
    if (wasEditing.current) {
      wasEditing.current = false;
      dropIfEmpty();
    }
    // Runs when editing starts or stops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  /* Unmounting mid-edit (e.g. the label was empty) still cleans up. */
  useEffect(
    () => () => {
      if (wasEditing.current) dropIfEmpty();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // A chosen label colour tints the box and its text; otherwise it follows the line.
  // The border (and text) in the label's colour or the line's; the background white, a light tint, or none.
  const style = {
    left: x,
    top: y,
    borderColor: noBorder ? 'transparent' : (labelColor ?? color),
    ...(labelColor ? { color: labelColor } : {}),
    background: clear ? 'transparent' : bg ? `color-mix(in srgb, ${bg} 18%, white)` : 'var(--surface)',
  };
  // Its size, for a line with a clear label to be left out behind it.
  const boxRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const n = boxRef.current;
    if (n && onSize) onSize(n.offsetWidth, n.offsetHeight);
  });
  const cls = (clear ? ' clear' : '') + (selected ? ' selected' : '');
  if (editing) {
    return (
      <div ref={boxRef} className={'line-label-box editing' + (clear ? ' clear' : '')} data-line-label={line.id} data-value={text || ' '} style={style}>
        <input
          ref={inputRef}
          value={text}
          size={1}
          aria-label={tr('연결선 라벨', 'Line label')}
          onChange={(e) => {
            const v = e.target.value;
            setText(v);
            const id = line.id;
            commit((m) => update(m, id, { content: { label: v } }), keyRef.current);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              onDone();
            }
          }}
          onBlur={onDone}
        />
      </div>
    );
  }
  return (
    <div
      ref={boxRef}
      className={'line-label-box' + cls}
      data-line-label={line.id}
      style={style}
      title={tr('끌어서 선 위에서 옮기기 · 더블클릭해서 고치기', 'Drag to move along the line · Double-click to edit')}
    >
      {line.content.label}
    </div>
  );
}

/** Filled arrowhead whose tip sits exactly on the block border. */
function ArrowHead({ x, y, angle, w, color }: { x: number; y: number; angle: number; w: number; color: string }) {
  const len = 8 + w * 2.2;
  const half = len * 0.45;
  const bx = x - Math.cos(angle) * len;
  const by = y - Math.sin(angle) * len;
  const px = -Math.sin(angle) * half;
  const py = Math.cos(angle) * half;
  return (
    <path
      className="arrow-head"
      d={`M${r1(x)} ${r1(y)} L${r1(bx + px)} ${r1(by + py)} L${r1(bx - px)} ${r1(by - py)} Z`}
      fill={color}
    />
  );
}

/** True if any visible part of the (possibly curved) line lies inside the rectangle. */
function curveHitsRect(g: Geo, tl: Point, br: Point): boolean {
  const isIn = (p: Point) => p.x >= tl.x && p.x <= br.x && p.y >= tl.y && p.y <= br.y;
  const at = (t: number): Point => {
    const u = 1 - t;
    return { x: u * u * g.sx + 2 * u * t * g.qx + t * t * g.ex, y: u * u * g.sy + 2 * u * t * g.qy + t * t * g.ey };
  };
  const edges: [Point, Point][] = [
    [tl, { x: br.x, y: tl.y }],
    [{ x: br.x, y: tl.y }, br],
    [br, { x: tl.x, y: br.y }],
    [{ x: tl.x, y: br.y }, tl],
  ];
  const steps = 32;
  let prev = at(g.t1);
  if (isIn(prev)) return true;
  for (let i = 1; i <= steps; i++) {
    const cur = at(g.t1 + ((g.t2 - g.t1) * i) / steps);
    if (isIn(cur) || edges.some(([e1, e2]) => segmentsCross(prev, cur, e1, e2))) return true;
    prev = cur;
  }
  return false;
}

function segmentsCross(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const d = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Live preview while a line end is dragged; snaps to the hovered element. */
function DraftLine({
  draft,
  layerRef,
  zoom,
  line,
  style,
  color,
}: {
  draft: LineDraft;
  layerRef: MutableRefObject<HTMLDivElement | null>;
  zoom: number;
  line?: { content: Content; color?: string };
  style: Content;
  color?: string;
}) {
  const layer = layerRef.current;
  if (!layer) return null;
  const lr = layer.getBoundingClientRect();
  const boxOf = (id?: string | null, p?: Point): Box | null =>
    p ? { x: p.x, y: p.y, w: 0, h: 0 } : id ? measureBox(layer, lr, id, zoom) : null;
  const fixed = boxOf(draft.anchor.id, draft.anchor.point);
  const moving = draft.targetId ? boxOf(draft.targetId) : boxOf(null, draft.pt);
  if (!fixed || !moving) return null;
  const reversed = draft.edit?.end === 'from';
  const [a, b] = reversed ? [moving, fixed] : [fixed, moving];
  const g = lineGeometry(a, b, line?.content.bend ?? 0);
  const look = line?.content ?? { arrow: true, ...style };
  const stroke = (line ? line.color : color) ? COLORS[(line ? line.color : color)!] : SELECTED_LINE;
  const w = LINE_WEIGHTS[look.weight ?? 'normal'];
  return (
    <g className="line-draft">
      <path
        d={g.d}
        fill="none"
        stroke={stroke}
        strokeWidth={w}
        strokeDasharray={dashFor(look.lineStyle, w)}
        strokeLinecap={look.lineStyle === 'dotted' ? 'round' : 'butt'}
      />
      {look.arrow && <ArrowHead x={g.x2} y={g.y2} angle={g.a2} w={w} color={stroke} />}
      {look.arrowStart && <ArrowHead x={g.x1} y={g.y1} angle={g.a1} w={w} color={stroke} />}
      {!draft.targetId && <circle cx={draft.pt.x} cy={draft.pt.y} r={4 / zoom} fill={stroke} />}
    </g>
  );
}
