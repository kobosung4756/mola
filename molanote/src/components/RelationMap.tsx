import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { ElMap, ElementType } from '../types';
import { ROOT_ID } from '../types';
import { boardPath } from '../model';
import { tr } from '../i18n';
import { textHas } from '../hangul';
import { SEARCH_KINDS } from '../blockLinks';
import { BANDS, GR, PLACE_KINDS, REL_KINDS, WH, WW, areaSpans, axisOf, hash, layout, relationGraph } from '../relations';
import type { Galaxy, Laid, MapAxis, MapView, Placed, RelKind, RelNode } from '../relations';
import { Icon } from './Icon';
import { RelationPreview } from './RelationPreview';

/*
 * The relation map: every block as a star, tied by connector lines, [[ ]] links, ![[ ]] embeds,
 * linked copies, board shortcuts and where blocks are (boards in boards, blocks in columns and on
 * boards). Its levels and its three views (Emergence, Gravity, Starfield) follow ideaverse-maps
 * by Nick Milo (github.com/nickmilo/ideaverse-maps, MIT licence).
 */

/*
 * Keys go to the map while it is open, and to nothing behind it. Put on the window when this file
 * loads, so it comes before every other key handler (those are put on later, as the app mounts).
 */
const guard: { on: ((e: KeyboardEvent) => 'pass' | void) | null } = { on: null };
const typingOutside = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el?.closest?.('input, textarea, [contenteditable="true"]') && !el.closest('.rmap');
};
if (typeof window !== 'undefined') {
  window.addEventListener(
    'keydown',
    (e) => {
      if (!guard.on) return;
      // (Typing in a box opened over the map, such as Ctrl+O's board finder, goes to that box.)
      if (typingOutside(e.target)) return;
      // ('pass': a key the app itself handles, such as Ctrl+Space; it closes the map.)
      if (guard.on(e) !== 'pass') e.stopImmediatePropagation();
    },
    true,
  );
  for (const type of ['keyup', 'paste', 'copy', 'cut'] as const)
    window.addEventListener(
      type,
      (e) => {
        if (!guard.on || typingOutside(e.target)) return;
        // (Text in the search box, and text picked in the side card's preview, can be copied.)
        if (!(e.target as HTMLElement | null)?.closest?.('.rmap input, .rmap-pv') && !(type === 'copy' && getSelection()?.anchorNode?.parentElement?.closest('.rmap-pv'))) e.preventDefault();
        e.stopImmediatePropagation();
      },
      true,
    );
}

export const REL_COLORS: Record<RelKind, string> = {
  line: '#e8590c',
  link: '#1c7ed6',
  embed: '#7048e8',
  copy: '#0ca678',
  shortcut: '#0ca678',
  board: '#868e96',
  column: '#a0a7b0',
  on: '#b8bec6',
};
const REL_DASH: Partial<Record<RelKind, string>> = { copy: '5 4', shortcut: '1.5 4', on: '2 3' };

const relName = (k: RelKind) =>
  ({
    line: tr('연결선', 'Connector'),
    link: tr('링크 [[ ]]', 'Link [[ ]]'),
    embed: tr('임베드 ![[ ]]', 'Embed ![[ ]]'),
    copy: tr('복사본 ↔ 원본', 'Copy ↔ original'),
    shortcut: tr('보드 바로가기', 'Board shortcut'),
    board: tr('보드 안 보드', 'Board in board'),
    column: tr('컬럼 안 블록', 'In a column'),
    on: tr('보드 위 블록', 'On a board'),
  })[k];

/** What a tie is called from one end: out (this block links, holds, is the copy) or in. */
const relSide = (k: RelKind, out: boolean) =>
  ({
    line: [tr('연결선', 'Connector'), tr('연결선', 'Connector')],
    link: [tr('링크함', 'Links to'), tr('링크됨', 'Linked from')],
    embed: [tr('임베드함', 'Embeds'), tr('임베드됨', 'Embedded in')],
    copy: [tr('원본', 'Original'), tr('복사본', 'Copies')],
    shortcut: [tr('바로가기 대상', 'Shortcut to'), tr('바로가기', 'Shortcuts')],
    board: [tr('하위 보드', 'Sub-boards'), tr('상위 보드', 'Parent board')],
    column: [tr('컬럼 안 블록', 'Blocks in it'), tr('담긴 컬럼', 'In column')],
    on: [tr('보드 위 블록', 'Blocks on it'), tr('놓인 보드', 'On board')],
  })[k][out ? 0 : 1];

const LEVEL_NAMES: Record<number, () => string> = {
  5: () => tr('5 · 허브', '5 · Hubs'),
  4: () => tr('4 · 지도의 지도', '4 · Maps of maps'),
  3: () => tr('3 · 지도', '3 · Maps'),
  2: () => tr('2 · 이어진 블록', '2 · Linked'),
  1: () => tr('1 · 홀로 있는 블록', '1 · Unlinked'),
};
const WHY: Record<string, () => string> = {
  home: () => tr('홈 보드', 'Home board'),
  top: () => tr('연결 점수 상위', 'Top score'),
  mapOfMaps: () => tr('하위 보드 3개 이상', '3+ sub-boards'),
  highlyTied: () => tr('아주 많이 이어짐', 'Highly linked'),
  map: () => tr('보드·컬럼 (지도)', 'Board or column (a map)'),
  wellTied: () => tr('많이 이어짐', 'Well linked'),
  tied: () => tr('이어짐', 'Linked'),
  alone: () => tr('이어진 것 없음', 'No links'),
};

const TYPE_COLORS: Partial<Record<ElementType, string>> = {
  BOARD: '#4c6ef5',
  CARD: '#f2b705',
  TASK_LIST: '#40c057',
  COLUMN: '#868e96',
  IMAGE: '#e64980',
  LINK: '#15aabf',
  FILE: '#a0785a',
  TABLE: '#fd7e14',
  SKETCH: '#be4bdb',
  DIAGRAM: '#7950f2',
  COLOR_SWATCH: '#fa5252',
};
/*
 * A block's mark on the map, by what it is: a square for what holds blocks (boards, columns), a
 * diamond for pictures (photos, drawings, block diagrams, colours), a circle for the rest (notes,
 * to-dos, tables, links, files). All about the same area, so sizes still compare.
 */
type MarkShape = 'square' | 'diamond' | 'circle';
const SHAPES: Partial<Record<ElementType, MarkShape>> = {
  BOARD: 'square',
  COLUMN: 'square',
  IMAGE: 'diamond',
  SKETCH: 'diamond',
  DIAGRAM: 'diamond',
  COLOR_SWATCH: 'diamond',
};
const shapeOf = (t: ElementType): MarkShape => SHAPES[t] ?? 'circle';
function Mark({ shape, x, y, r, ...rest }: { shape: MarkShape; x: number; y: number; r: number } & React.SVGProps<SVGElement>) {
  const p = rest as Record<string, unknown>;
  if (shape === 'square') return <rect x={x - r * 0.9} y={y - r * 0.9} width={r * 1.8} height={r * 1.8} rx={r * 0.28} {...p} data-shape="square" />;
  if (shape === 'diamond') return <path d={`M${x},${y - r * 1.25}L${x + r * 1.25},${y}L${x},${y + r * 1.25}L${x - r * 1.25},${y}Z`} {...p} data-shape="diamond" />;
  return <circle cx={x} cy={y} r={r} {...p} data-shape="circle" />;
}
/** The same mark, small, for the legend and the side card. */
const MarkIcon = ({ type, colour, size = 10 }: { type: ElementType; colour: string; size?: number }) => (
  <svg width={size} height={size} viewBox="-6 -6 12 12" className="rmap-mark-icon" aria-hidden="true">
    <Mark shape={shapeOf(type)} x={0} y={0} r={shapeOf(type) === 'diamond' ? 4.6 : shapeOf(type) === 'square' ? 5.2 : 5.4} fill={colour} />
  </svg>
);

const typeName = (t: ElementType) => (t === 'BOARD' ? tr('보드', 'Board') : (SEARCH_KINDS.find((k) => k.type === t)?.name ?? t));

const VIEWS: { id: MapView; ko: string; en: string; tip: [string, string] }[] = [
  { id: 'emergence', ko: '떠오름', en: 'Emergence', tip: ['레벨별 띠: 위로 갈수록 많이 이어진 허브 · 가로는 맨 위 보드별', 'Bands by level: hubs on top · across, by top-level board'] },
  { id: 'gravity', ko: '중력', en: 'Gravity', tip: ['허브가 가운데, 레벨별 동심원', 'Hubs in the middle, rings by level'] },
  { id: 'stars', ko: '별자리', en: 'Starfield', tip: ['허브마다 은하: 가장 가까이 이어진 허브로 모임', 'A galaxy per hub: each block joins its nearest hub'] },
];

const load = <T,>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
};
const save = (key: string, v: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* (not kept) */
  }
};

type Cam = { x: number; y: number; z: number };
type FocusDir = 'both' | 'out' | 'in';

/** What the app's top bar does to the map while it is open (zoom buttons, Ctrl+= / Ctrl+-, fit). */
export interface MapApi {
  zoomBy(f: number): void;
  fit(): void;
}

const AXES: { id: MapAxis; ko: string; en: string; tip: [string, string] }[] = [
  { id: 'folder', ko: '보드', en: 'Boards', tip: ['맨 위 보드별 (폴더)', 'By top-level board (folder)'] },
  { id: 'time', ko: '시간', en: 'Time', tip: ['만든 때 순서 (왼쪽이 오래된 것)', 'By when it was made (oldest on the left)'] },
  { id: 'size', ko: '크기', en: 'Size', tip: ['내용 크기 (KB, log)', 'By content size (KB, log)'] },
  { id: 'words', ko: '단어', en: 'Words', tip: ['단어 수 (log)', 'By word count (log)'] },
  { id: 'links', ko: '링크', en: 'Links', tip: ['링크 수: 들어오는 + 나가는 (log)', 'By links in + out (log)'] },
];

/** Star colours along an axis, old (or small) red to new (or big) blue, as ideaverse's Starfield. */
const TEMP = ['#ff4b3a', '#ff6d3f', '#ff8f4a', '#ffb35c', '#ffd27f', '#fff0c9', '#eef2ff', '#c9dbff', '#9fc0ff', '#78a4ff'];
const tempOf = (t: number) => TEMP[Math.max(0, Math.min(TEMP.length - 1, Math.round(t * (TEMP.length - 1))))];
/** Star colours of the boards (Starfield by boards). */
const AREA_PAL = ['#ffd166', '#5eead4', '#ff8fab', '#7cc4ff', '#c3a6ff', '#a3e635', '#ff9f43', '#f472b6', '#4f8cff', '#3ee0a0'];

const dateOf = (ms: number) => (ms ? new Date(ms).toLocaleDateString() : '');

/** Where a block is drawn; in 3D, also its depth and how much nearer (bigger) or farther it is. */
type Shown = Placed & { z?: number; s?: number };

/*
 * Stars (Starfield), as ideaverse's: small bright dots by level, not marks sized by score. On
 * screen a star grows only with the square root of the zoom, and never past 16 px.
 */
const starPx = (d: RelNode) => (d.level === 5 ? 3.4 + Math.min(d.score, 30) * 0.08 : d.level === 4 ? 2.4 : d.level === 3 ? 1.6 : d.level === 2 ? 1 + Math.min(d.score, 5) * 0.1 : 0.8) * 1.4;

/** How wide a label is on screen (px), for keeping labels from running into one another. */
let measurer: CanvasRenderingContext2D | null | undefined;
const labelPx = (text: string, size: number, bold: boolean) => {
  if (measurer === undefined) measurer = document.createElement('canvas').getContext('2d');
  if (!measurer) return text.length * size * 0.75;
  measurer.font = `${bold ? 600 : 500} ${size}px Pretendard, 'Apple SD Gothic Neo', 'Malgun Gothic', system-ui, sans-serif`;
  return measurer.measureText(text).width;
};
const labelText = (t: string) => (t.length > 34 ? t.slice(0, 33) + '…' : t);
const LABEL_SIZE: Record<number, [number, boolean]> = { 5: [14, true], 4: [12.5, true], 3: [11, false], 2: [11, false], 1: [11, false] };

/*
 * Starfield in 3D (as ideaverse's): each galaxy a thin disk tilted its own way at its own depth,
 * the loose blocks a cloud round the middle, all seen through a camera turned by yaw and pitch.
 */
function project3D(pos: Map<string, Placed>, laid: Laid, yaw: number, pitch: number): { pos: Map<string, Shown>; galaxies: Galaxy[] } {
  const cx = WW / 2;
  const cy = WH / 2;
  let span = 400;
  for (const b of laid.galaxies) span = Math.max(span, (Math.abs(b.x - cx) + b.r) * 2, (Math.abs(b.y - cy) + b.r) * 2);
  const f = span * 1.6;
  const cyw = Math.cos(yaw);
  const syw = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const cam = (x: number, y: number, z: number) => {
    const x1 = x * cyw + z * syw;
    const z1 = -x * syw + z * cyw;
    return [x1, y * cp - z1 * sp, y * sp + z1 * cp];
  };
  const look = (x: number, y: number, z: number) => {
    const [px, py, pz] = cam(x, y, z);
    const s = f / Math.max(f * 0.25, f + pz);
    return { x: cx + px * s, y: cy + py * s, s, z: pz };
  };
  const gal = new Map(
    laid.galaxies.map((b) => {
      const inc = (hash(b.id, 32) - 0.5) * Math.PI * 0.9;
      const phi = hash(b.id, 33) * Math.PI * 2;
      // The disk tilted by inc round an axis lying in it at angle phi: Rz(phi) · Rx(inc) · Rz(-phi).
      const [c, s, ci, si] = [Math.cos(phi), Math.sin(phi), Math.cos(inc), Math.sin(inc)];
      const rz = (cc: number, ss: number) => [
        [cc, -ss, 0],
        [ss, cc, 0],
        [0, 0, 1],
      ];
      const rx = [
        [1, 0, 0],
        [0, ci, -si],
        [0, si, ci],
      ];
      const mul = (A: number[][], B: number[][]) => A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
      return [b.id, { b, z: (hash(b.id, 31) - 0.5) * span * 0.75, M: mul(mul(rz(c, s), rx), rz(c, -s)) }] as const;
    }),
  );
  const out = new Map<string, Shown>();
  for (const [id, p] of pos) {
    const G = gal.get(laid.owner.get(id) ?? '');
    const h = hash(id, 34) - 0.5;
    let w: [number, number, number];
    if (G) {
      const [lx, ly, lz] = [p.x - G.b.x, p.y - G.b.y, h * G.b.r * 0.12];
      const M = G.M;
      w = [G.b.x - cx + M[0][0] * lx + M[0][1] * ly + M[0][2] * lz, G.b.y - cy + M[1][0] * lx + M[1][1] * ly + M[1][2] * lz, G.z + M[2][0] * lx + M[2][1] * ly + M[2][2] * lz];
    } else w = [p.x - cx, p.y - cy, h * 160];
    const v = look(...w);
    const s = Math.max(0.45, Math.min(2.2, v.s));
    out.set(id, { x: v.x, y: v.y, r: p.r * s, z: v.z, s });
  }
  const galaxies = laid.galaxies.map((b) => {
    const v = look(b.x - cx, b.y - cy, gal.get(b.id)!.z);
    return { id: b.id, x: v.x, y: v.y, r: b.r * v.s };
  });
  return { pos: out, galaxies };
}

/** Drift (the screensaver): radians of orbit a second, and seconds for one breath in to a galaxy and out. */
const DRIFT_SPIN = 0.035;
const DRIFT_BREATH = 44;

export default function RelationMap(props: {
  els: ElMap;
  boardId: string;
  onClose: () => void;
  onShow: (id: string) => void;
  apiRef?: MutableRefObject<MapApi | null>;
  onZoom?: (z: number) => void;
}) {
  const { els } = props;
  const g = useMemo(() => relationGraph(els), [els]);
  const [view, setViewRaw] = useState<MapView>(() => load('molanote.map-view', 'emergence'));
  const [axis, setAxisRaw] = useState<MapAxis>(() => load('molanote.map-axis', 'folder'));
  const [off, setOff] = useState<RelKind[]>(() => load('molanote.map-off', []));
  const [legendOpen, setLegendOpen] = useState<boolean>(() => load('molanote.map-legend', true));
  const [s3d, setS3d] = useState<boolean>(() => load('molanote.map-3d', false));
  const [turn, setTurn] = useState<{ yaw: number; pitch: number }>(() => load('molanote.map-turn', { yaw: 0.55, pitch: 0.62 }));
  const [drift, setDrift] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);
  const [focus, setFocus] = useState(false);
  const [depth, setDepth] = useState<number>(() => load('molanote.map-depth', 1));
  const [dir, setDir] = useState<FocusDir>(() => load('molanote.map-dir', 'both'));
  const [query, setQuery] = useState('');
  const [cam, setCam] = useState<Cam>({ x: 0, y: 0, z: 0.6 });
  /** Emergence only: how far the across is stretched (the wheel zooms the across, not the levels). */
  const [kx, setKx] = useState(1);
  const rootRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const night = view === 'stars';
  const three = night && s3d;
  const stretch = view === 'emergence' ? kx : 1;

  const kinds = useMemo(() => REL_KINDS.filter((k) => !off.includes(k)), [off]);
  const edges = useMemo(() => g.edges.filter((e) => kinds.includes(e.kind)), [g, kinds]);

  const ax = useMemo(() => axisOf(g, axis), [g, axis]);
  // Where every block is drawn: moved smoothly from view to view (and axis to axis).
  const laid = useMemo(() => layout(g, view, ax), [g, view, ax]);
  const target = laid.pos;
  const [pos, setPos] = useState<Map<string, Placed>>(target);
  const posRef = useRef(pos);
  posRef.current = pos;
  useEffect(() => {
    const from = posRef.current;
    if (from === target) return;
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / 600);
      const k = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
      if (t >= 1) {
        setPos(target);
        return;
      }
      const next = new Map<string, Placed>();
      for (const [id, b] of target) {
        const a = from.get(id) ?? b;
        next.set(id, { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, r: a.r + (b.r - a.r) * k });
      }
      setPos(next);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  // What is drawn: the picture as laid out, or (Starfield in 3D) as the camera sees it.
  const shown = useMemo(() => (three ? project3D(pos, laid, turn.yaw, turn.pitch) : { pos: pos as Map<string, Shown>, galaxies: laid.galaxies }), [three, pos, laid, turn]);
  const disp = shown.pos;

  // Focus mode (as ideaverse's): one block and what it ties to, so many steps out, one way or both.
  const near = useMemo(() => {
    if (!focus || !sel) return null;
    const keep = new Set([sel]);
    let ring = [sel];
    for (let hop = 0; hop < depth; hop++) {
      const next: string[] = [];
      for (const id of ring)
        for (const v of g.adj.get(id) ?? [])
          if (kinds.includes(v.kind) && (dir === 'both' || (dir === 'out') === v.out) && !keep.has(v.id)) {
            keep.add(v.id);
            next.push(v.id);
          }
      ring = next;
    }
    return keep;
  }, [focus, sel, g, kinds, depth, dir]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return new Set(g.nodes.filter((d) => textHas(d.title.toLowerCase(), q) || textHas(d.text, q)).map((d) => d.id));
  }, [g, query]);

  // Lit up: the block under the mouse (or the picked one) and its neighbours.
  const lit = useMemo(() => {
    const at = hover ?? sel;
    if (!at || (focus && !hover)) return null;
    const s = new Set([at]);
    for (const v of g.adj.get(at) ?? []) if (kinds.includes(v.kind)) s.add(v.id);
    return s;
  }, [hover, sel, g, kinds, focus]);

  const shownNodes = useMemo(() => (near ? g.nodes.filter((d) => near.has(d.id)) : g.nodes), [g, near]);

  /** The camera that fits these blocks in the window (the across unstretched again). */
  const fit = (ids?: Set<string> | null, glide = false) => {
    const svg = svgRef.current;
    if (!svg) return;
    const at: Map<string, Shown> = three ? project3D(target, laid, turn.yaw, turn.pitch).pos : target;
    let l = Infinity;
    let t = Infinity;
    let r = -Infinity;
    let b = -Infinity;
    for (const [id, p] of at) {
      if (ids && !ids.has(id)) continue;
      l = Math.min(l, p.x - p.r);
      t = Math.min(t, p.y - p.r);
      r = Math.max(r, p.x + p.r);
      b = Math.max(b, p.y + p.r);
    }
    if (view === 'emergence' && !ids) [l, r, t, b] = [Math.min(l, -150), Math.max(r, WW), Math.min(t, -30), Math.max(b, WH)];
    if (view === 'gravity' && !ids) [l, r, t, b] = [Math.min(l, WW / 2 - GR - 60), Math.max(r, WW / 2 + GR + 60), Math.min(t, WH / 2 - GR - 60), Math.max(b, WH / 2 + GR + 60)];
    if (!isFinite(l)) return;
    // (Clear of the bars on top, the legend on the left and the block's card on the right.)
    const inset = { l: legendOpen ? 250 : 40, t: focus ? 112 : 70, r: sel ? 330 : 40, b: 40 };
    const w = svg.clientWidth - inset.l - inset.r;
    const h = svg.clientHeight - inset.t - inset.b;
    const z = Math.max(0.05, Math.min(3, Math.min(w / Math.max(40, r - l), h / Math.max(40, b - t))));
    const to = { z, x: inset.l + w / 2 - ((l + r) / 2) * z, y: inset.t + h / 2 - ((t + b) / 2) * z };
    if (glide) return flyTo(to);
    cancelAnimationFrame(flight.current);
    setKx(1);
    setCam(to);
  };
  /*
   * The camera gliding to where it should be (focus on and off: a zoom in or out over the map, its
   * backdrop staying): the middle of the view moves in a straight line and the zoom by the same
   * ratio each moment, so it feels like one smooth zoom. Any drag or wheel stops it.
   */
  const flight = useRef(0);
  const flyTo = (to: Cam) => {
    cancelAnimationFrame(flight.current);
    const svg = svgRef.current;
    if (!svg) return;
    const from = camRef.current;
    const k0 = kxRef.current;
    const [vw, vh] = [svg.clientWidth / 2, svg.clientHeight / 2];
    const c0 = { x: (vw - from.x) / (from.z * k0), y: (vh - from.y) / from.z };
    const c1 = { x: (vw - to.x) / to.z, y: (vh - to.y) / to.z };
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / 550);
      const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
      const z = from.z * (to.z / from.z) ** e;
      const k = k0 + (1 - k0) * e;
      const cx = c0.x + (c1.x - c0.x) * e;
      const cy = c0.y + (c1.y - c0.y) * e;
      kxRef.current = k;
      setKx(k);
      setCam({ z, x: vw - cx * z * k, y: vh - cy * z });
      if (t < 1) flight.current = requestAnimationFrame(step);
    };
    flight.current = requestAnimationFrame(step);
  };
  useEffect(() => () => cancelAnimationFrame(flight.current), []);
  // (Focus on, off or moved: glide there. A new view, axis or 3D: straight there, the blocks move.)
  const nearWas = useRef(near);
  useLayoutEffect(() => {
    const glide = nearWas.current !== near;
    nearWas.current = near;
    fit(near, glide);
  }, [view, near, axis, s3d]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Zoom in or out round a point on screen (the middle when none). In Emergence, the across only. */
  const zoomBy = (f: number, at?: { x: number; y: number }) => {
    const svg = svgRef.current;
    if (!svg) return;
    const mx = at?.x ?? svg.clientWidth / 2;
    const my = at?.y ?? svg.clientHeight / 2;
    if (viewRef.current === 'emergence') {
      const k0 = kxRef.current;
      const k = Math.max(0.25, Math.min(40, k0 * f));
      kxRef.current = k;
      setKx(k);
      setCam((c) => ({ ...c, x: mx - ((mx - c.x) / (c.z * k0)) * c.z * k }));
      return;
    }
    setCam((c) => {
      const z = Math.max(0.05, Math.min(8, c.z * f));
      return { z, x: mx - ((mx - c.x) / c.z) * z, y: my - ((my - c.y) / c.z) * z };
    });
  };
  // The app's top bar (zoom buttons, Ctrl+= / Ctrl+-, fit) works on the map while it is open.
  const viewRef = useRef(view);
  viewRef.current = view;
  const kxRef = useRef(kx);
  kxRef.current = kx;
  const fitRef = useRef(fit);
  fitRef.current = fit;
  const nearRef = useRef(near);
  nearRef.current = near;
  useEffect(() => {
    if (!props.apiRef) return;
    props.apiRef.current = { zoomBy: (f) => zoomBy(f), fit: () => fitRef.current(nearRef.current) };
    return () => {
      if (props.apiRef) props.apiRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // (Emergence: the zoom of its across.)
  useEffect(() => props.onZoom?.(cam.z * stretch), [cam.z, stretch]); // eslint-disable-line react-hooks/exhaustive-deps

  const setView = (v: MapView) => {
    setViewRaw(v);
    save('molanote.map-view', v);
  };
  const setAxis = (a: MapAxis) => {
    setAxisRaw(a);
    save('molanote.map-axis', a);
  };
  const toggleKind = (k: RelKind) => {
    const next = off.includes(k) ? off.filter((x) => x !== k) : [...off, k];
    setOff(next);
    save('molanote.map-off', next);
  };
  const toggleLegend = () => {
    setLegendOpen(!legendOpen);
    save('molanote.map-legend', !legendOpen);
  };
  const toggle3d = () => {
    setS3d(!s3d);
    save('molanote.map-3d', !s3d);
    setDrift(false);
  };
  const endFocus = () => {
    setFocus(false);
    setSel(null);
  };
  const pick = (id: string | null) => {
    setSel(id);
    if (!id) setFocus(false);
  };
  /** Focus mode on (on the picked block, the board that was open, or the biggest hub) or off. */
  const toggleFocus = () => {
    if (focus) return endFocus();
    if (!sel) {
      const first = g.byId.has(props.boardId) ? props.boardId : [...g.nodes].sort((a, b) => b.level - a.level || b.score - a.score)[0]?.id;
      if (!first) return;
      setSel(first);
    }
    setFocus(true);
  };
  /** Moves the camera so the block is in the middle. */
  const centre = (id: string) => {
    const p = disp.get(id);
    const svg = svgRef.current;
    if (!p || !svg) return;
    const z = Math.max(cam.z, 1.2);
    setCam({ z, x: svg.clientWidth / 2 - p.x * stretch * z, y: svg.clientHeight / 2 - p.y * z });
  };

  // Drift, the screensaver (as ideaverse's, for 3D Starfield): the camera circles the universe, its
  // tilt sways, and every ~44 s it breathes in toward one galaxy (a different one each time, bigger
  // ones more often) and out again. Any key, click or wheel stops it.
  const camRef = useRef(cam);
  camRef.current = cam;
  const shownRef = useRef(shown);
  shownRef.current = shown;
  useEffect(() => {
    if (!drift) return;
    const svg = svgRef.current!;
    const t0 = performance.now();
    let last = t0;
    let cycle = -1;
    let gal = '';
    const k0 = camRef.current.z;
    const startPitch = turn.pitch;
    let raf = 0;
    const choose = () => {
      const gs = shownRef.current.galaxies;
      if (!gs.length) return '';
      let r = Math.random() * gs.reduce((s, b) => s + Math.sqrt(b.r), 0);
      for (const b of gs) if ((r -= Math.sqrt(b.r)) <= 0 && b.id !== gal) return b.id;
      return gs[0].id;
    };
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const t = (now - t0) / 1000;
      setTurn((v) => ({ yaw: v.yaw + DRIFT_SPIN * dt, pitch: startPitch + (0.62 - startPitch) * Math.min(1, t / 6) + 0.38 * Math.sin((t * 2 * Math.PI) / (DRIFT_BREATH * 1.7)) * Math.min(1, t / 6) }));
      const c = Math.floor(t / DRIFT_BREATH);
      if (c !== cycle) {
        cycle = c;
        gal = choose();
      }
      const inA = Math.sin(((t % DRIFT_BREATH) / DRIFT_BREATH) * Math.PI) ** 2;
      const b = shownRef.current.galaxies.find((x) => x.id === gal);
      const gx = WW / 2 + ((b?.x ?? WW / 2) - WW / 2) * inA;
      const gy = WH / 2 + ((b?.y ?? WH / 2) - WH / 2) * inA;
      const kk = k0 * (1 + 2.6 * inA);
      // (Eased, not jumped to, so it never jolts.)
      const e = Math.min(1, dt * 1.6);
      setCam((cm) => {
        const vx = svg.clientWidth / 2;
        const vy = svg.clientHeight / 2;
        const wx = (vx - cm.x) / cm.z;
        const wy = (vy - cm.y) / cm.z;
        const z = cm.z + (kk - cm.z) * e;
        return { z, x: vx - (wx + (gx - wx) * e) * z, y: vy - (wy + (gy - wy) * e) * z };
      });
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [drift]); // eslint-disable-line react-hooks/exhaustive-deps
  // Drifting, the app's own bars (top and left) go too: only the sky is left.
  useEffect(() => {
    document.body.classList.toggle('map-drifting', drift);
    return () => document.body.classList.remove('map-drifting');
  }, [drift]);
  const startDrift = () => {
    if (!s3d) {
      setS3d(true);
      save('molanote.map-3d', true);
    }
    setSel(null);
    setFocus(false);
    setHover(null);
    setTip(null);
    setDrift(true);
  };
  const stopDrift = () => {
    setDrift(false);
    save('molanote.map-turn', turn);
  };

  // Keys (see the guard above): views 1 2 3, / search, Shift+2 focus mode, L legend, Enter open on
  // its board, Esc back; Ctrl+= / Ctrl+- / Ctrl+0 / Shift+1 zoom the map. Ctrl+Space, Ctrl+O and
  // Ctrl+[ / Ctrl+] go on to the app (which closes the map).
  const keys = useRef<(e: KeyboardEvent) => 'pass' | void>(() => {});
  keys.current = (e: KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey && (e.code === 'Space' || e.code === 'KeyO' || e.code === 'BracketLeft' || e.code === 'BracketRight')) return 'pass';
    if (drift) {
      if (!['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) {
        e.preventDefault();
        stopDrift();
      }
      return;
    }
    const inSearch = (e.target as HTMLElement | null)?.closest?.('.rmap-search');
    if (e.shiftKey && !mod && !e.altKey && e.code === 'KeyG') {
      e.preventDefault();
      props.onClose();
      return;
    }
    if (mod && !e.altKey && (e.code === 'Equal' || e.code === 'NumpadAdd' || e.code === 'Minus' || e.code === 'NumpadSubtract' || e.code === 'Digit0' || e.code === 'Numpad0')) {
      e.preventDefault();
      if (e.code === 'Digit0' || e.code === 'Numpad0') fit(near);
      else zoomBy(e.code === 'Minus' || e.code === 'NumpadSubtract' ? 1 / 1.2 : 1.2);
      return;
    }
    if (inSearch) {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (query) setQuery('');
        else searchRef.current?.blur();
      } else if (e.key === 'Enter' && matches?.size) {
        e.preventDefault();
        const first = [...matches].map((id) => g.byId.get(id)!).sort((a, b) => b.score - a.score)[0];
        pick(first.id);
        centre(first.id);
        searchRef.current?.blur();
      }
      return;
    }
    if (mod || e.altKey) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (focus) endFocus();
      else if (query) setQuery('');
      else if (sel) pick(null);
      else props.onClose();
    } else if (e.key === '/') {
      e.preventDefault();
      searchRef.current?.focus();
    } else if (e.shiftKey && e.code === 'Digit1') {
      e.preventDefault();
      fit(near);
    } else if (e.shiftKey && e.code === 'Digit2') {
      e.preventDefault();
      toggleFocus();
    } else if (/^Digit[123]$/.test(e.code) && !e.shiftKey) {
      if (focus) setDepth(Number(e.code.slice(5)));
      else setView(VIEWS[Number(e.code.slice(5)) - 1].id);
    } else if (e.code === 'KeyL' && !e.shiftKey) {
      toggleLegend();
    } else if (e.key === 'Enter' && sel) {
      e.preventDefault();
      props.onShow(sel);
    }
  };
  useEffect(() => {
    guard.on = (e) => keys.current(e);
    return () => {
      guard.on = null;
    };
  }, []);
  useEffect(() => save('molanote.map-depth', depth), [depth]);
  useEffect(() => save('molanote.map-dir', dir), [dir]);

  // Drag: pans (in 3D, turns the universe; Shift+drag pans). The wheel zooms round the mouse; in
  // Emergence it stretches the across only, so the level bands keep their height.
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; yaw: number; pitch: number; orbit: boolean; moved: boolean } | null>(null);
  const onWheel = (e: React.WheelEvent) => {
    if (drift) return stopDrift();
    cancelAnimationFrame(flight.current);
    const r = svgRef.current!.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    const f = Math.exp(-e.deltaY * 0.0015);
    zoomBy(f, { x: mx, y: my });
  };
  const onDown = (e: React.PointerEvent) => {
    if (drift) {
      stopDrift();
      return;
    }
    if (e.button !== 0) return;
    cancelAnimationFrame(flight.current);
    // (No text gets selected while dragging the map; the search box lets go.)
    e.preventDefault();
    (document.activeElement as HTMLElement | null)?.blur?.();
    window.getSelection()?.removeAllRanges();
    drag.current = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, yaw: turn.yaw, pitch: turn.pitch, orbit: three && !e.shiftKey, moved: false };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (d) {
      if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 3) d.moved = true;
      if (d.moved) {
        if (d.orbit) setTurn({ yaw: d.yaw + (e.clientX - d.x) * 0.006, pitch: Math.max(-1.45, Math.min(1.45, d.pitch + (e.clientY - d.y) * 0.006)) });
        else setCam((c) => ({ ...c, x: d.cx + e.clientX - d.x, y: d.cy + e.clientY - d.y }));
        if (hover) setHover(null);
        return;
      }
    }
    if (drift) return;
    const id = (document.elementFromPoint(e.clientX, e.clientY) as Element | null)?.closest?.('[data-map-node]')?.getAttribute('data-map-node') ?? null;
    if (id !== hover) setHover(id);
    const r = rootRef.current!.getBoundingClientRect();
    setTip(id ? { x: e.clientX - r.left, y: e.clientY - r.top } : null);
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (d?.orbit && d.moved) save('molanote.map-turn', turn);
    if (!d || d.moved) return;
    // A click (no drag): the block under it (in focus mode, the new middle), or nothing.
    const hit = (document.elementFromPoint(e.clientX, e.clientY) as Element | null)?.closest('[data-map-node]');
    pick(hit?.getAttribute('data-map-node') ?? null);
    setTip(null);
  };
  const onDouble = (e: React.MouseEvent) => {
    const id = (document.elementFromPoint(e.clientX, e.clientY) as Element | null)?.closest('[data-map-node]')?.getAttribute('data-map-node');
    if (id) props.onShow(id);
  };

  /** A block's colour: its kind (Emergence, Gravity), or where it sits on the axis (Starfield, as ideaverse's stars). */
  const colourOf = (d: RelNode) => {
    if (!night) return TYPE_COLORS[d.el.type] ?? '#999';
    if (axis === 'folder') return AREA_PAL[Math.max(0, g.areas.indexOf(d.area)) % AREA_PAL.length];
    return tempOf(ax.t.get(d.id) ?? 0.5);
  };

  /*
   * Labels, as ideaverse's: the block picked or under the mouse and what it ties to first, then the
   * rest by level and score (hubs before maps before the others), each only where it runs into no
   * label already placed, at most 260. Zoomed out, only the higher levels are named. In Starfield a
   * galaxy small on screen is named under its glow (its name in capitals and how many stars), not
   * by its core's own label. Worked out again at each zoom step, not at every wheel turn.
   */
  const tier = cam.z > 1.6 ? 1 : cam.z > 0.7 ? 2 : cam.z > 0.3 ? 3 : 4;
  const zl = 2 ** (Math.round(Math.log2(cam.z) * 4) / 4);
  /** A star's radius in map units (Starfield), from its size on screen. */
  const starR = (d: RelNode, p: Shown) => Math.max(0.7, Math.min(16, starPx(d) * Math.sqrt(zl) * (p.s ?? 1))) / zl;
  const labels = useMemo(() => {
    const X = (x: number) => x * stretch;
    const taken: [number, number, number, number][] = [];
    const clear = (b: [number, number, number, number]) => !taken.some((t) => b[0] < t[0] + t[2] && b[0] + b[2] > t[0] && b[1] < t[1] + t[3] && b[1] + b[3] > t[1]);
    const galaxyNames: { id: string; x: number; y: number; name: string; sub: string }[] = [];
    const namedByGalaxy = new Set<string>();
    if (night && !near) {
      const members = new Map<string, number>();
      for (const o of laid.owner.values()) members.set(o, (members.get(o) ?? 0) + 1);
      for (const b of [...shown.galaxies].sort((p, q) => q.r - p.r)) {
        if (b.r * zl > 0.8 * Math.min(svgRef.current?.clientWidth ?? 800, svgRef.current?.clientHeight ?? 600)) continue;
        const name = labelText(g.byId.get(b.id)?.title ?? '').toUpperCase();
        const n = members.get(b.id) ?? 1;
        const w = Math.max(labelPx(name, 11, true) + name.length * 2, 60) / zl;
        const y = b.y + b.r * 0.95 + 10 / zl;
        const box: [number, number, number, number] = [b.x - w / 2, y - 12 / zl, w, 30 / zl];
        if (!clear(box)) continue;
        taken.push(box);
        galaxyNames.push({ id: b.id, x: b.x, y, name, sub: tr(`별 ${n}개`, `${n} stars`) });
        namedByGalaxy.add(b.id);
      }
    }
    const must: string[] = [];
    const lead = hover ?? sel;
    if (sel) must.push(sel);
    if (hover) must.push(hover);
    if (lit) must.push(...[...lit].filter((id) => id !== lead).sort((a, b) => g.byId.get(b)!.level - g.byId.get(a)!.level || g.byId.get(b)!.score - g.byId.get(a)!.score));
    if (matches) must.push(...[...matches].sort((a, b) => g.byId.get(b)!.score - g.byId.get(a)!.score));
    const rest = [...shownNodes].sort((a, b) => b.level - a.level || b.score - a.score).map((d) => d.id);
    const minLv = near ? 1 : drift ? 2 : tier <= 1 ? 1 : tier === 2 ? 3 : tier === 3 ? 4 : 5;
    const out = new Set<string>();
    const seen = new Set<string>();
    for (const id of [...must, ...rest]) {
      if (seen.has(id) || out.size >= 260) continue;
      seen.add(id);
      const d = g.byId.get(id);
      const p = disp.get(id);
      if (!d || !p || (near && !near.has(id))) continue;
      const isMust = must.includes(id);
      if (!isMust) {
        if (d.level < minLv && !(d.el.type === 'BOARD' && tier <= 3 && !drift)) continue;
        if (namedByGalaxy.has(id)) continue;
        if ((lit && !lit.has(id)) || (matches && !matches.has(id))) continue;
      }
      const [size, bold] = LABEL_SIZE[d.level];
      const w = (labelPx(labelText(d.title), size, bold) + 4) / zl;
      const r = night ? starR(d, p) : p.r;
      const box: [number, number, number, number] = [X(p.x) - w / 2, p.y - r - 4 - (size + 3) / zl, w, (size + 3) / zl];
      if (!clear(box) && id !== sel && id !== hover) continue;
      taken.push(box);
      out.add(id);
    }
    return { ids: out, galaxyNames };
  }, [disp, zl, tier, lit, matches, sel, hover, near, drift, shownNodes, night, shown, laid, stretch, g]); // eslint-disable-line react-hooks/exhaustive-deps

  const scene = useMemo(() => {
    const dim = (id: string) => (lit && !lit.has(id)) || (matches && !matches.has(id));
    const visible = near ?? null;
    const X = (x: number) => x * stretch;
    const lines = edges
      .filter((e) => (!visible || (visible.has(e.a) && visible.has(e.b))) && disp.has(e.a) && disp.has(e.b))
      .map((e, i) => {
        const a0 = disp.get(e.a)!;
        const b0 = disp.get(e.b)!;
        const a = { x: X(a0.x), y: a0.y };
        const b = { x: X(b0.x), y: b0.y };
        const at = hover ?? (focus ? null : sel);
        const on = lit ? lit.has(e.a) && lit.has(e.b) && (e.a === at || e.b === at) : false;
        const place = PLACE_KINDS.includes(e.kind);
        // A slight bend, so ties between the same blocks (both ways, several kinds) stay apart.
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const bend = place ? 0 : Math.min(40, len * 0.12) * (REL_KINDS.indexOf(e.kind) % 2 ? -1 : 1);
        const qx = mx - ((b.y - a.y) / len) * bend;
        const qy = my + ((b.x - a.x) / len) * bend;
        return (
          <path
            key={i}
            d={`M${a.x},${a.y}Q${qx},${qy} ${b.x},${b.y}`}
            className={on ? 'rmap-edge on' : 'rmap-edge'}
            data-map-edge={e.kind}
            data-a={e.a}
            data-b={e.b}
            stroke={REL_COLORS[e.kind]}
            strokeDasharray={REL_DASH[e.kind]}
            strokeWidth={on ? 2.2 : place ? 0.8 : 1.3}
            opacity={lit ? (on ? 0.95 : 0.06) : matches ? 0.08 : focus ? 0.75 : place ? (three ? 0.22 : 0.35) : 0.6}
            vectorEffect="non-scaling-stroke"
            fill="none"
          />
        );
      });
    // (In 3D the far ones first, so the near ones are drawn over them.)
    const order = three ? [...shownNodes].sort((a, b) => (disp.get(b.id)?.z ?? 0) - (disp.get(a.id)?.z ?? 0)) : [...shownNodes].sort((a, b) => a.level - b.level || a.score - b.score);
    const dots = order.map((d) => {
      const p = disp.get(d.id);
      if (!p) return null;
      const faint = dim(d.id);
      // (Starfield: every block a star, a bright dot; elsewhere a mark by its kind, sized by score.)
      const shape = night ? 'circle' : shapeOf(d.el.type);
      const r = night ? starR(d, p) : p.r;
      return (
        <g key={d.id} data-map-node={d.id} data-level={d.level} className={`rmap-node${d.id === sel ? ' sel' : ''}${faint ? ' faint' : ''}${d.id === props.boardId ? ' here' : ''}`}>
          <Mark shape={shape} x={X(p.x)} y={p.y} r={r} fill={colourOf(d)} className={night ? 'rmap-mark star' : 'rmap-mark'} />
          {(d.id === sel || d.id === hover) && <Mark shape={shape} x={X(p.x)} y={p.y} r={r + (night ? 4 / zl : 4)} className="rmap-ring" />}
          {labels.ids.has(d.id) && (
            <text x={X(p.x)} y={p.y - r - 4} className={`rmap-label lv${d.level}`}>
              {labelText(d.title)}
            </text>
          )}
        </g>
      );
    });
    const galaxyNames = labels.galaxyNames.map((b) => (
      <text key={'gal:' + b.id} className="rmap-gal-name" data-map-galaxy={b.id} x={b.x} y={b.y}>
        <tspan x={b.x}>{b.name}</tspan>
        <tspan x={b.x} dy={15 / zl} className="rmap-gal-sub">
          {b.sub}
        </tspan>
      </text>
    ));
    return (
      <>
        {lines}
        {dots}
        {galaxyNames}
      </>
    );
  }, [edges, disp, shownNodes, lit, matches, near, sel, hover, focus, props.boardId, night, axis, ax, three, stretch, labels, zl]); // eslint-disable-line react-hooks/exhaustive-deps

  // The view's backdrop: level bands and the axis (Emergence), rings and the axis round the clock
  // (Gravity), the galaxies' glow (Starfield).
  const backdrop = useMemo(() => {
    const X = (x: number) => x * stretch;
    if (view === 'emergence') {
      const spans = axis === 'folder' ? areaSpans(g) : null;
      return (
        <>
          {[5, 4, 3, 2, 1].map((lv) => (
            <g key={lv}>
              <rect className={`rmap-band b${lv % 2}`} x={-160} y={BANDS[lv][0]} width={X(WW) + 180} height={BANDS[lv][1] - BANDS[lv][0]} />
              <text className="rmap-band-name" x={-150} y={BANDS[lv][0] + 22}>
                {LEVEL_NAMES[lv]()}
              </text>
            </g>
          ))}
          {spans && [...spans.values()].slice(1).map(([x0], i) => <line key={i} className="rmap-col" x1={X(x0 - 15)} x2={X(x0 - 15)} y1={-30} y2={WH} />)}
          {!spans && ax.ticks.map((t, i) => <line key={i} className="rmap-col" x1={X(t.x)} x2={X(t.x)} y1={-30} y2={WH} />)}
          {ax.ticks.map((t, i) => (
            <text key={i} className="rmap-col-name" data-map-tick x={X(t.x)} y={-12}>
              {t.label}
            </text>
          ))}
        </>
      );
    }
    if (view === 'gravity')
      return (
        <>
          {[0.14, 0.32, 0.54, 0.8, 1].map((f, i, all) => {
            // (Every other ring shaded, from the middle out, as Emergence's bands.)
            if (i % 2) return null;
            const r0 = i ? GR * all[i - 1] : 0;
            const [cx, cy, r1] = [WW / 2, WH / 2, GR * f];
            const ring = (r: number) => `M${cx - r},${cy}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0Z`;
            return <path key={'band' + f} className="rmap-ring-band" data-map-ring-band={5 - i} fillRule="evenodd" d={ring(r1) + (r0 ? ring(r0) : '')} />;
          })}
          {[0.14, 0.32, 0.54, 0.8, 1].map((f, i) => (
            <g key={f}>
              <circle className="rmap-ring-guide" cx={WW / 2} cy={WH / 2} r={GR * f} />
              <text className="rmap-band-name" x={WW / 2 + 6} y={WH / 2 - GR * f + 16}>
                {LEVEL_NAMES[5 - i]()}
              </text>
            </g>
          ))}
          {ax.ticks.map((t, i) => {
            const a = -Math.PI / 2 + (t.x / WW) * Math.PI * 2;
            return (
              <g key={i}>
                <line className="rmap-col" x1={WW / 2 + GR * 1.02 * Math.cos(a)} y1={WH / 2 + GR * 1.02 * Math.sin(a)} x2={WW / 2 + GR * 1.08 * Math.cos(a)} y2={WH / 2 + GR * 1.08 * Math.sin(a)} />
                <text className="rmap-col-name" data-map-tick x={WW / 2 + (GR + 50) * Math.cos(a)} y={WH / 2 + (GR + 50) * Math.sin(a) + 4}>
                  {t.label}
                </text>
              </g>
            );
          })}
        </>
      );
    return shown.galaxies.map((b) => <circle key={b.id} className="rmap-glow" cx={b.x} cy={b.y} r={b.r * 1.25} fill="url(#rmap-glow)" />);
  }, [view, g, near, ax, axis, shown, stretch]);

  const info = sel ? g.byId.get(sel) : undefined;
  const groups = useMemo(() => {
    if (!info) return [];
    const out = new Map<string, { kind: RelKind; out: boolean; ids: string[] }>();
    for (const v of g.adj.get(info.id) ?? []) {
      const key = `${v.kind}:${v.out}`;
      if (!out.has(key)) out.set(key, { kind: v.kind, out: v.out, ids: [] });
      if (!out.get(key)!.ids.includes(v.id)) out.get(key)!.ids.push(v.id);
    }
    return [...out.values()].sort((a, b) => REL_KINDS.indexOf(a.kind) - REL_KINDS.indexOf(b.kind) || Number(b.out) - Number(a.out));
  }, [info, g]);
  const counts = useMemo(() => {
    const c = new Map<RelKind, number>();
    for (const e of g.edges) c.set(e.kind, (c.get(e.kind) ?? 0) + 1);
    return c;
  }, [g]);
  const types = useMemo(() => [...new Set(g.nodes.map((d) => d.el.type))], [g]);
  const pathOf = (d: RelNode) =>
    boardPath(els, d.board)
      .map((b) => (b.id === ROOT_ID ? 'Home' : b.content.title || tr('제목 없는 보드', 'Untitled board')))
      .join(' › ');

  const hov = hover ? g.byId.get(hover) : undefined;
  const W = rootRef.current?.clientWidth ?? 1000;
  const H = rootRef.current?.clientHeight ?? 800;

  return (
    <div ref={rootRef} className={`rmap${night ? ' night' : ''}${drift ? ' drifting' : ''}`} data-relation-map style={{ ['--z' as string]: cam.z }}>
      <svg
        ref={svgRef}
        className={three ? 'rmap-svg orbit' : 'rmap-svg'}
        onWheel={onWheel}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onDoubleClick={onDouble}
        onPointerLeave={() => {
          setHover(null);
          setTip(null);
        }}
      >
        <defs>
          <radialGradient id="rmap-glow">
            <stop offset="0" stopColor="#9fb4ff" stopOpacity="0.32" />
            <stop offset="0.45" stopColor="#7b5cff" stopOpacity="0.1" />
            <stop offset="1" stopColor="#7b5cff" stopOpacity="0" />
          </radialGradient>
        </defs>
        <g transform={`translate(${cam.x},${cam.y}) scale(${cam.z})`}>
          {backdrop}
          {scene}
        </g>
      </svg>

      <div className="rmap-top rmap-ui" onPointerDown={(e) => e.stopPropagation()}>
        <span className="rmap-cat">{tr('지도', 'Map')}</span>
        <div className="rmap-seg" role="tablist" aria-label={tr('지도', 'Map')}>
          {VIEWS.map((v, i) => (
            <button key={v.id} role="tab" className={view === v.id ? 'on' : ''} data-map-view={v.id} title={`${tr(...v.tip)} (${i + 1})`} onClick={() => setView(v.id)}>
              {tr(v.ko, v.en)}
            </button>
          ))}
        </div>
        <span className="rmap-divider" aria-hidden="true" />
        <span className="rmap-cat">{tr('기준', 'By')}</span>
        <div className="rmap-seg" role="tablist" aria-label={tr('기준', 'By')}>
          {AXES.map((a) => (
            <button key={a.id} role="tab" className={axis === a.id ? 'on' : ''} data-map-axis={a.id} title={tr(...a.tip)} onClick={() => setAxis(a.id)}>
              {tr(a.ko, a.en)}
            </button>
          ))}
        </div>
        <span className="rmap-divider" aria-hidden="true" />
        {night && (
          <>
            <button className={s3d ? 'rmap-btn on' : 'rmap-btn'} data-map-3d title={tr('별자리 3D: 끌어서 돌리기 (Shift+끌기: 이동)', 'Starfield in 3D: drag to turn (Shift+drag: pan)')} onClick={toggle3d}>
              3D
            </button>
            <button className="rmap-btn" data-map-drift title={tr('떠다니기 (스크린세이버): 천천히 우주를 돌며 은하로 들어갔다 나옵니다. 아무 키나 클릭으로 멈춤', 'Drift (screensaver): a slow orbit, breathing in to a galaxy and out. Any key or click stops it')} onClick={startDrift}>
              ▶ {tr('떠다니기', 'Drift')}
            </button>
          </>
        )}
        <label className="rmap-search">
          <Icon name="search" size={15} />
          <input ref={searchRef} value={query} placeholder={tr('블록 찾기 (/)', 'Find a block (/)')} onChange={(e) => setQuery(e.target.value)} />
          {matches && <span className="muted small">{matches.size}</span>}
        </label>
        <button className={focus ? 'rmap-btn on' : 'rmap-btn'} data-map-focus-mode title={tr('포커스 모드: 고른 블록과 이어진 블록만 (Shift+2)', 'Focus mode: the picked block and what it ties to (Shift+2)')} onClick={toggleFocus}>
          {tr('포커스', 'Focus')}
        </button>
      </div>

      {drift && <div className="rmap-drift-hint">{tr('아무 키나 누르거나 클릭하면 멈춥니다', 'Press any key or click to stop')}</div>}

      {focus && info && (
        <div className="rmap-focusbar rmap-ui" data-map-focusbar onPointerDown={(e) => e.stopPropagation()}>
          <span>
            {tr('포커스', 'Focus')}: <b>{info.title}</b> · {near ? near.size - 1 : 0}
            {tr('개', '')}
          </span>
          <div className="rmap-seg">
            <span className="rmap-seg-label">{tr('단계', 'Depth')}</span>
            {[1, 2, 3].map((n) => (
              <button key={n} className={depth === n ? 'on' : ''} data-map-depth={n} title={tr(`${n}단계까지 (${n})`, `${n} step(s) out (${n})`)} onClick={() => setDepth(n)}>
                {n}
              </button>
            ))}
          </div>
          <div className="rmap-seg">
            {(
              [
                ['both', tr('모두', 'Both')],
                ['out', tr('나가는', 'Out')],
                ['in', tr('들어오는', 'In')],
              ] as [FocusDir, string][]
            ).map(([k, name]) => (
              <button key={k} className={dir === k ? 'on' : ''} data-map-dir={k} onClick={() => setDir(k)}>
                {name}
              </button>
            ))}
          </div>
          <button className="rmap-x" title={tr('포커스 끝내기 (Esc · Shift+2)', 'End focus (Esc · Shift+2)')} onClick={endFocus}>
            <Icon name="close" size={14} />
          </button>
        </div>
      )}

      {night && axis !== 'folder' && (
        <div className="rmap-key rmap-ui" data-map-key>
          <span>{ax.ends[0]}</span>
          <span className="rmap-key-bar" style={{ background: `linear-gradient(90deg, ${TEMP.join(',')})` }} />
          <span>{ax.ends[1]}</span>
        </div>
      )}

      {legendOpen ? (
        <div className="rmap-legend rmap-ui" data-map-legend onPointerDown={(e) => e.stopPropagation()}>
          <div className="rmap-legend-title">
            <span>{tr('관계', 'Ties')}</span>
            <button className="rmap-x" data-map-legend-hide title={tr('범례 숨기기 (L)', 'Hide the legend (L)')} onClick={toggleLegend}>
              <Icon name="close" size={13} />
            </button>
          </div>
          {REL_KINDS.map((k) => (
            <button key={k} className={off.includes(k) ? 'rmap-kind off' : 'rmap-kind'} data-map-kind={k} onClick={() => toggleKind(k)} title={tr('눌러서 보이기/숨기기', 'Click to show or hide')}>
              <svg width="22" height="8">
                <line x1="1" y1="4" x2="21" y2="4" stroke={REL_COLORS[k]} strokeWidth="2" strokeDasharray={REL_DASH[k]} />
              </svg>
              <span>{relName(k)}</span>
              <span className="muted">{counts.get(k) ?? 0}</span>
            </button>
          ))}
          <div className="rmap-legend-title sub">{night ? (axis === 'folder' ? tr('별 색: 맨 위 보드', 'Star colour: top board') : tr('별 색: 기준 값', 'Star colour: the axis')) : tr('블록 종류', 'Block kinds')}</div>
          <div className="rmap-types">
            {night && axis === 'folder'
              ? ax.ticks.map((t, i) => (
                  <span key={i}>
                    <i style={{ background: AREA_PAL[Math.max(0, g.areas.indexOf(t.id ?? '')) % AREA_PAL.length] }} />
                    {t.label}
                  </span>
                ))
              : !night &&
                types.map((t) => (
                  <span key={t}>
                    <MarkIcon type={t} colour={TYPE_COLORS[t] ?? '#999'} />
                    {typeName(t)}
                  </span>
                ))}
          </div>
          <div className="rmap-credit">
            {tr('레벨·보기 방식: ', 'Levels and views after ')}
            <a href="https://github.com/nickmilo/ideaverse-maps" target="_blank" rel="noreferrer">
              ideaverse-maps
            </a>{' '}
            (MIT, Nick Milo)
          </div>
        </div>
      ) : (
        <button className="rmap-legend-show rmap-ui" data-map-legend-show title={tr('범례 보이기 (L)', 'Show the legend (L)')} onPointerDown={(e) => e.stopPropagation()} onClick={toggleLegend}>
          {tr('범례', 'Legend')}
        </button>
      )}

      {hov && tip && !drag.current && !drift && (
        <div
          className="rmap-tip"
          data-map-tip
          // (Beside the pointer, on the side away from the block's card.)
          style={{ left: tip.x + 14 + 300 > W - (info ? 330 : 0) ? Math.max(8, tip.x - 314) : tip.x + 14, top: Math.min(tip.y + 14, H - 160) }}
        >
          <b>{hov.title}</b>
          <div className="muted">
            {typeName(hov.el.type)} · {tr('레벨', 'Level')} {hov.level} · {pathOf(hov)}
          </div>
          <div className="muted">
            {tr('링크', 'Links')} ↓{hov.inn} ↑{hov.out}
            {hov.kids ? ` · ${tr('담은 블록', 'Holds')} ${hov.kids}` : ''} · {tr('단어', 'Words')} {hov.words}
          </div>
          <div className="muted" data-map-tip-date>
            {tr('만든 날', 'Made')} {dateOf(hov.created)}
          </div>
        </div>
      )}

      {info && !drift && (
        <div className="rmap-info rmap-ui" data-map-info onPointerDown={(e) => e.stopPropagation()}>
          <div className="rmap-info-head">
            <MarkIcon type={info.el.type} colour={colourOf(info)} size={12} />
            <b>{info.title}</b>
            <button className="rmap-x" title={tr('닫기 (Esc)', 'Close (Esc)')} onClick={() => pick(null)}>
              <Icon name="close" size={14} />
            </button>
          </div>
          <div className="muted small">
            {typeName(info.el.type)} · {tr('레벨', 'Level')} {info.level} ({WHY[info.why]?.()}) · {tr('점수', 'Score')} {info.score.toFixed(2)}
          </div>
          <div className="muted small rmap-path">{pathOf(info)}</div>
          <div className="muted small">
            {dateOf(info.created)} · {tr('단어', 'Words')} {info.words} · {info.kb.toFixed(1)} KB
          </div>
          <div className="rmap-info-body">
            <RelationPreview el={info.el} />
            <div className="rmap-rels">
              {groups.length === 0 && <div className="muted small">{tr('이어진 블록이 없습니다', 'Nothing is tied to it')}</div>}
              {groups.map((gr) => (
                <div key={`${gr.kind}:${gr.out}`} className="rmap-rel" data-map-rel={`${gr.kind}:${gr.out ? 'out' : 'in'}`}>
                  <div className="rmap-rel-name" style={{ color: REL_COLORS[gr.kind] }}>
                    {relSide(gr.kind, gr.out)} <span className="muted">{gr.ids.length}</span>
                  </div>
                  {gr.ids.slice(0, 12).map((id) => (
                    <button
                      key={id}
                      className="rmap-rel-item"
                      onClick={() => {
                        pick(id);
                        if (!focus) centre(id);
                      }}
                    >
                      {g.byId.get(id)?.title}
                    </button>
                  ))}
                  {gr.ids.length > 12 && <div className="muted small">+{gr.ids.length - 12}</div>}
                </div>
              ))}
            </div>
          </div>
          <div className="rmap-info-actions">
            <button className={focus ? 'on' : ''} data-map-focus onClick={toggleFocus} title={tr('포커스 모드 (Shift+2)', 'Focus mode (Shift+2)')}>
              {tr('포커스', 'Focus')}
            </button>
            <button className="primary" data-map-open onClick={() => props.onShow(info.id)} title={tr('보드에서 보기 (Enter · 더블클릭)', 'Show on board (Enter · double-click)')}>
              {tr('보드에서 보기', 'Show on board')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
