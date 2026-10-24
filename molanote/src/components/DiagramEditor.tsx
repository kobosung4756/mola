import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import { tr } from '../i18n';
import { uid } from '../model';
import {
  CORNERED,
  DEFAULT_FILL,
  DEFAULT_LINE,
  DEFAULT_RADIUS,
  DEFAULT_STROKE,
  SIDES,
  cornerRadius,
  defaultGrad,
  splineShape,
  boxCorners,
  rotTransform,
  sideDir,
  toLocal,
  turn,
  diagramBounds,
  endPoint,
  insertNode,
  insideShape,
  moveHandle,
  nearestOnOutline,
  nearestSide,
  nodePlace,
  nodesOf,
  presetNodes,
  refitNodes,
  retypeNode,
  routePoints,
  shapePath,
  sitePoint,
} from '../diagram';
import type { DEnd, Diagram, DLine, DNode, DShape, HeadKind, Pt, ShapeKind, Side } from '../diagram';
import { DiagramParts } from './DiagramView';
import { isMathShortcut, mathAt, MathEditor } from './MathEditor';
import { ColorPicker } from './ColorPicker';
import { Fold, GradEditor, ShadowEditor, Slider } from './DiagramLooks';
import { ALIGN_KEYS, alignedPlaces } from '../align';
import type { AlignKind } from '../align';

/*
 * The block-diagram editor, in a large window in the middle of the screen (Excalidraw and
 * PowerPoint were the models): a tool bar on top (with a key for each tool), the drawing in the
 * middle (Ctrl+wheel zooms, the wheel or Space+drag moves around), the picked thing's settings on
 * the left. Shapes are added from the bar; lines are drawn from the dots on a shape's sides (or with
 * the Line tool) and stick to the shapes they end on. A right-click on a shape offers Edit points.
 */

type Tool = 'select' | ShapeKind | 'line' | 'spline' | 'pen';

/** Fewer points along a drawn stroke (Ramer–Douglas–Peucker): the ones the shape needs, within `eps`. */
function simplify(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts;
  const a = pts[0];
  const b = pts[pts.length - 1];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const L = Math.hypot(dx, dy) || 1;
  let far = 0;
  let at = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs(dy * pts[i].x - dx * pts[i].y + b.x * a.y - b.y * a.x) / L;
    if (d > far) (far = d), (at = i);
  }
  if (far <= eps) return [a, b];
  return [...simplify(pts.slice(0, at + 1), eps).slice(0, -1), ...simplify(pts.slice(at), eps)];
}

/** What was copied in a diagram (kept here too, for a browser that does not pass our own clipboard type on). */
let diagramClip: Diagram | null = null;
const CLIP_TYPE = 'application/x-molanote-diagram';

const SHAPE_TOOLS: { kind: ShapeKind; key: string; ko: string; en: string; size: [number, number] }[] = [
  { kind: 'rect', key: 'R', ko: '사각형', en: 'Rectangle', size: [150, 70] },
  { kind: 'ellipse', key: 'O', ko: '타원', en: 'Ellipse', size: [130, 80] },
  { kind: 'diamond', key: 'D', ko: '마름모', en: 'Diamond', size: [130, 90] },
  { kind: 'parallelogram', key: 'P', ko: '평행사변형', en: 'Parallelogram', size: [150, 70] },
  { kind: 'trapezoid', key: 'Z', ko: '사다리꼴', en: 'Trapezoid', size: [150, 80] },
  { kind: 'triangle', key: 'G', ko: '삼각형', en: 'Triangle', size: [110, 90] },
  { kind: 'hexagon', key: 'X', ko: '육각형', en: 'Hexagon', size: [140, 80] },
  { kind: 'text', key: 'T', ko: '글상자', en: 'Text', size: [120, 32] },
];

const TOOL_ICONS: Record<string, ReactNode> = {
  select: <path d="M6 3.5l11.5 10-5.2.6 3 5.6-2.2 1.1-3-5.6L6 19z" />,
  rect: <rect x="3.5" y="6.5" width="17" height="11" rx="2.5" />,
  ellipse: <ellipse cx="12" cy="12" rx="8.5" ry="6" />,
  diamond: <path d="M12 3.5l8.5 8.5-8.5 8.5L3.5 12z" />,
  parallelogram: <path d="M7 6.5h13.5L17 17.5H3.5z" />,
  trapezoid: <path d="M7.5 6.5h9l4 11h-17z" />,
  spline: <path d="M3.5 17c2.5-9 6-10 8.5-5s6 4 8.5-5" />,
  pen: <path d="M4 20l1.2-4.4L16.5 4.3a2 2 0 012.8 0l.4.4a2 2 0 010 2.8L8.4 18.8zM14.5 6.3l3.2 3.2" />,
  triangle: <path d="M12 4.5l8.5 14.5h-17z" />,
  hexagon: <path d="M7.5 5.5h9l4.5 6.5-4.5 6.5h-9L3 12z" />,
  text: <path d="M5 6.5V5h14v1.5M12 5v14M9 19h6" />,
  line: <path d="M4 18h6.5a3 3 0 003-3V9a3 3 0 013-3H20M17.5 3.5L20 6l-2.5 2.5" />,
};

const ICON = (name: string, size = 19) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {TOOL_ICONS[name]}
  </svg>
);

const clone = (d: Diagram): Diagram => JSON.parse(JSON.stringify(d));

/** Below this zoom the grid dots are left out. */
const DIAGRAM_DOTS_MIN_ZOOM = 0.5;

type Drag =
  | { kind: 'pan'; x: number; y: number; vx: number; vy: number }
  | { kind: 'move'; from: Pt; start: Map<string, Pt>; before: Diagram; moved: boolean; copyOf?: string[]; toggle?: string }
  | { kind: 'create'; tool: ShapeKind; from: Pt; to: Pt }
  | { kind: 'line'; from: DEnd; to: Pt; straight: boolean }
  | { kind: 'end'; line: string; which: 'a' | 'b'; before: Diagram }
  | { kind: 'resize'; id: string; dir: string; box: { x: number; y: number; w: number; h: number }; from: Pt; before: Diagram }
  | { kind: 'radius'; id: string; before: Diagram }
  | { kind: 'rotate'; id: string; before: Diagram }
  | { kind: 'pen'; pts: Pt[] }
  | { kind: 'erase'; before: Diagram }
  | { kind: 'node'; id: string; i: number; before: Diagram }
  | { kind: 'handle'; id: string; i: number; which: 'hin' | 'hout'; before: Diagram }
  | { kind: 'marquee'; from: Pt; to: Pt; add: boolean };

/** A guide line: where it is across (or down), and from where to where it runs along. */
type Guide = { at: number; from: number; to: number };
/** A line a shape can settle on: where it is, and how far the shape it belongs to runs along it. */
type SnapLine = { v: number; a: number; b: number };

type Menu = { x: number; y: number; items: { label: string; act: () => void; danger?: boolean; off?: boolean; icon?: string }[] };

/** The board's own menu pictures, used again here (front and back, as on a block's right-click menu). */
const BOARD_MENU_ICONS: Record<string, IconName | undefined> = { front: 'front', back: 'back', copy: 'copy', delete: 'trash', settings: 'settings' };

/** Small pictures for the right-click menu (24-unit SVG paths). */
const MENU_ICONS: Record<string, string> = {
  points: 'M5 19L9 6l6 5 4-6M3.5 17.5h3v3h-3zM7.5 4.5h3v3h-3zM13.5 9.5h3v3h-3zM17.5 3.5h3v3h-3z',
  text: 'M5 6.5V5h14v1.5M12 5v14M9 19h6',
  round: 'M4 20V11a7 7 0 017-7h9',
  square: 'M4 20V4h16',
  reset: 'M4 12a8 8 0 108-8H8M8 1v6h6',
  front: 'M8 8h12v12H8zM4 4h12v12',
  // One step (a layer and an arrow), unlike all the way (the board's front / back pictures).
  forward: 'M4 13h11v7H4zM16 10V3M13 6l3-3 3 3',
  backward: 'M4 4h11v7H4zM16 14v7M13 18l3 3 3-3',
  back: 'M4 4h12v12H4zM8 8h12v12',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  delete: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  rotr: 'M20 12a8 8 0 11-3-6.2M20 3v5h-5',
  rotl: 'M4 12a8 8 0 103-6.2M4 3v5h5',
  rot0: 'M12 3v4M12 17v4M3 12h4M17 12h4M12 12h.01',
  add: 'M12 5v14M5 12h14',
  remove: 'M5 12h14',
  smooth: 'M3 17c4-12 14-12 18 0',
  straightPt: 'M3 12h18M12 8v8',
  corner: 'M4 18l8-12 8 12',
  exit: 'M5 12l5 5L20 7',
};

export function DiagramEditor({ initial, onDone, onCancel }: { initial: Diagram; onDone: (d: Diagram) => void; onCancel: () => void }) {
  const [d, setD] = useState<Diagram>(() => clone(initial));
  const live = useRef(d);
  live.current = d;
  const hist = useRef<{ past: Diagram[]; future: Diagram[] }>({ past: [], future: [] });
  const [tool, setTool] = useState<Tool>('select');
  const [sel, setSel] = useState<string[]>([]);
  const [view, setView] = useState({ x: 0, y: 0, z: 1 });
  const [size, setSize] = useState({ w: 1000, h: 700 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  const [hover, setHover] = useState<string | null>(null);
  const [snap, setSnap] = useState<{ shape: string; side: Side } | null>(null);
  const [textEdit, setTextEdit] = useState<string | null>(null);
  const [pointEdit, setPointEdit] = useState<string | null>(null);
  const [selNode, setSelNode] = useState<number | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [picker, setPicker] = useState<null | 'fill' | 'stroke' | 'text' | 'line'>(null);
  /**
   * The settings panel on the left: opened when wanted (the bar's button, I), not each time a
   * shape is picked, so it does not take room from the drawing. Remembered in this browser.
   */
  const [panelOpen, setPanelOpenRaw] = useState(() => {
    try {
      return localStorage.getItem('molanote.dg-panel') === '1';
    } catch {
      return false;
    }
  });
  /** The panel folding back into its button (kept on screen for that moment). */
  const [panelClosing, setPanelClosing] = useState(false);
  const closingTimer = useRef(0);
  const setPanelOpen = (on: boolean) => {
    setPanelOpenRaw(on);
    if (!on) setPicker(null);
    clearTimeout(closingTimer.current);
    setPanelClosing(!on);
    if (!on) closingTimer.current = window.setTimeout(() => setPanelClosing(false), 200);
    try {
      localStorage.setItem('molanote.dg-panel', on ? '1' : '0');
    } catch {
      // Storage blocked: it just is not remembered.
    }
  };
  /** Where the open colour picker's bubble is (beside its button, right of the panel). */
  const [pickerAt, setPickerAt] = useState({ left: 0, top: 0 });
  /** Leaving with changes: the question whether to keep them. */
  const [asking, setAskingRaw] = useState(false);
  /** The answer picked with the arrow keys (0 close without changes, 1 keep editing, 2 save); -1: none yet. */
  const [askAt, setAskAt] = useState(-1);
  const askAtRef = useRef(-1);
  askAtRef.current = askAt;
  const setAsking = (on: boolean) => {
    setAskingRaw(on);
    setAskAt(-1);
  };
  const startRef = useRef(JSON.stringify(initial));
  const [look, setLook] = useState({ fill: DEFAULT_FILL, stroke: DEFAULT_STROKE, line: DEFAULT_LINE });
  /** The points clicked so far with the Spline tool, and where the pointer is (for the piece to it). */
  const [spline, setSpline] = useState<Pt[] | null>(null);
  /** Which of the spline's points were clicked with Ctrl (sharp corners). */
  const [splineSharp, setSplineSharp] = useState<boolean[]>([]);
  /** Whether Ctrl is held (the next spline point would be sharp). */
  const [ctrlHeld, setCtrlHeld] = useState(false);
  const [pointer, setPointer] = useState<Pt | null>(null);
  /** A formula being written (Ctrl+M while typing in a shape): its shape, the text and where it goes. */
  const [mathEdit, setMathEdit] = useState<{ id: string; text: string; start: number; end: number; tex: string } | null>(null);
  const mathOpen = useRef(false);
  mathOpen.current = !!mathEdit;
  /** The lines shown while a shape snaps to another (as PowerPoint's smart guides). */
  const [guides, setGuides] = useState<{ x: Guide[]; y: Guide[] }>({ x: [], y: [] });
  /** The pen's settings: pen, highlighter or eraser; its colour and size. */
  const [penOpts, setPenOpts] = useState<{ mode: 'pen' | 'hl' | 'eraser'; color: string; size: number }>({ mode: 'pen', color: '#1e1e1e', size: 2 });
  const [penColour, setPenColour] = useState(false);
  /** Where the pointer last was over the drawing (pasting goes there). */
  const lastPtr = useRef<Pt | null>(null);
  const pasteCount = useRef(0);
  /** Ctrl+X under way (the copy it asks for must not remove the parts a second time). */
  const cutting = useRef(false);
  /** The last slider moved, so dragging it is one step for Ctrl+Z. */
  const lastTweak = useRef<{ key: string; t: number } | null>(null);
  const space = useRef(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  /** A change of the drawing as one step (Ctrl+Z takes it back). */
  const change = (fn: (d: Diagram) => void, before: Diagram = live.current) => {
    const next = clone(live.current);
    fn(next);
    hist.current.past.push(clone(before));
    if (hist.current.past.length > 200) hist.current.past.shift();
    hist.current.future = [];
    live.current = next;
    setD(next);
  };
  /** A change in the middle of a drag (the step is kept when the drag ends). */
  const live_ = (fn: (d: Diagram) => void) => {
    const next = clone(live.current);
    fn(next);
    // (At once too, so a second change in the same moment builds on this one.)
    live.current = next;
    setD(next);
  };
  const keepStep = (before: Diagram) => {
    if (JSON.stringify(before) === JSON.stringify(live.current)) return;
    hist.current.past.push(clone(before));
    hist.current.future = [];
  };
  const undo = (back: boolean) => {
    const h = hist.current;
    const s = (back ? h.past : h.future).pop();
    if (!s) return;
    (back ? h.future : h.past).push(clone(live.current));
    setD(s);
    setSel((old) => old.filter((id) => s.shapes.some((x) => x.id === id) || s.lines.some((x) => x.id === id)));
  };

  // The window's size, and the view on the drawing (fitted around it at the start).
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const fit = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    fit();
    fitAll(initial);
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Everything in sight (Shift+1, and at the start): fitted to the window, not over 150%. */
  const fitAll = (dg: Diagram = live.current, most = 1.5) => {
    const el = stageRef.current;
    if (!el) return;
    const b = diagramBounds(dg, 60);
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (b) {
      const z = Math.min(most, Math.max(0.2, Math.min(w / b.w, h / b.h)));
      setView({ z, x: b.x + b.w / 2 - w / z / 2, y: b.y + b.h / 2 - h / z / 2 });
    } else setView({ z: 1, x: -w / 2, y: -h / 2 });
  };

  const toBoard = (e: { clientX: number; clientY: number }): Pt => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: view.x + (e.clientX - r.left) / view.z, y: view.y + (e.clientY - r.top) / view.z };
  };
  const shapeById = (id: string | null | undefined) => (id ? d.shapes.find((s) => s.id === id) : undefined);
  /** The shape under a point (the top one), leaving out one. */
  const shapeAt = (p: Pt, skip?: string, slack = 0) => {
    for (let i = d.shapes.length - 1; i >= 0; i--) {
      const s = d.shapes[i];
      if (s.id === skip) continue;
      const q = toLocal(s, p);
      const near = q.x >= s.x - slack && q.x <= s.x + s.w + slack && q.y >= s.y - slack && q.y <= s.y + s.h + slack;
      if (near && (slack ? true : insideShape(s, p))) return s;
    }
    return undefined;
  };
  /** Where a line end dragged to `p` goes: onto the nearest side of a shape it is over (or near), else free. */
  const endFor = (p: Pt, skip?: string, straightFrom?: Pt): DEnd => {
    const s = shapeAt(p, skip, 14 / view.z);
    if (!s) {
      // A straight line settles on level or upright when it is near either (within 7°).
      if (straightFrom) {
        const dx = p.x - straightFrom.x;
        const dy = p.y - straightFrom.y;
        const k = Math.tan((7 * Math.PI) / 180);
        if (Math.abs(dy) <= Math.abs(dx) * k) return { x: p.x, y: straightFrom.y };
        if (Math.abs(dx) <= Math.abs(dy) * k) return { x: straightFrom.x, y: p.y };
      }
      return { x: p.x, y: p.y };
    }
    const side = nearestSide(s, p);
    const q = sitePoint(s, side);
    return { shape: s.id, side, x: q.x, y: q.y };
  };

  /** Whether anything changed since the editor opened. */
  const changed = () => !!textEdit || JSON.stringify(live.current) !== startRef.current;
  /** Esc with nothing picked, or Cancel: straight out when nothing changed, else asked first. */
  const leave = () => {
    if (changed()) setAsking(true);
    else onCancel();
  };
  /** Done: the drawing goes back to the board (with what is being typed, if anything). */
  const finish = () => {
    let out = live.current;
    if (textEdit) {
      const t = textRef.current?.value ?? '';
      out = clone(out);
      const s = out.shapes.find((x) => x.id === textEdit);
      if (s && s.kind === 'text' && !t.trim()) {
        out.shapes = out.shapes.filter((x) => x.id !== s.id);
        out.lines = out.lines.filter((l) => l.a.shape !== s.id && l.b.shape !== s.id);
      } else if (s) s.text = t;
    }
    onDone(out);
  };

  /* ---------- formulas in a shape's text ($…$, Ctrl+M) ---------- */
  /**
   * The formula written: into the text where it was asked for (null: the formula taken out;
   * undefined: cancelled, the text as it was), then typing goes on after it.
   */
  const putMath = (tex: string | null | undefined) => {
    const m = mathEdit;
    setMathEdit(null);
    if (!m) return;
    const keep = tex === undefined;
    const piece = keep ? m.text.slice(m.start, m.end) : tex ? `$${tex}$` : '';
    const text = m.text.slice(0, m.start) + piece + m.text.slice(m.end);
    change((x) => {
      const sh = x.shapes.find((y) => y.id === m.id);
      if (sh) sh.text = text;
    });
    const caret = m.start + piece.length;
    setTimeout(() => {
      startText(m.id);
      requestAnimationFrame(() => textRef.current?.setSelectionRange(caret, caret));
    }, 0);
  };

  /* ---------- text in a shape ---------- */
  const startText = (id: string) => {
    setPointEdit(null);
    setSel([id]);
    setTextEdit(id);
    requestAnimationFrame(() => {
      const t = textRef.current;
      if (t) {
        t.focus();
        t.setSelectionRange(t.value.length, t.value.length);
      }
    });
  };
  const commitText = () => {
    const id = textEdit;
    if (!id) return;
    const t = textRef.current?.value ?? '';
    setTextEdit(null);
    const s = live.current.shapes.find((x) => x.id === id);
    if (!s) return;
    if (s.kind === 'text' && !t.trim()) {
      change((m) => {
        m.shapes = m.shapes.filter((x) => x.id !== id);
        m.lines = m.lines.filter((l) => l.a.shape !== id && l.b.shape !== id);
      });
      setSel([]);
      return;
    }
    if ((s.text ?? '') !== t) change((m) => (m.shapes.find((x) => x.id === id)!.text = t));
  };

  /* ---------- adding, removing ---------- */
  const addShape = (kind: ShapeKind, box?: { x: number; y: number; w: number; h: number }) => {
    const def = SHAPE_TOOLS.find((t) => t.kind === kind)!;
    const [w, h] = def.size;
    const c = { x: view.x + size.w / view.z / 2, y: view.y + size.h / view.z / 2 };
    const s: DShape = {
      id: uid(),
      kind,
      ...(box ?? { x: Math.round(c.x - w / 2), y: Math.round(c.y - h / 2), w, h }),
      r: CORNERED.has(kind) ? DEFAULT_RADIUS : undefined,
      fill: kind === 'text' ? 'transparent' : look.fill,
      stroke: kind === 'text' ? 'transparent' : look.stroke,
      text: '',
    };
    change((m) => m.shapes.push(s));
    setSel([s.id]);
    setTool('select');
    if (kind === 'text') startText(s.id);
    return s.id;
  };
  const removeSel = () => {
    if (!sel.length) return;
    const ids = new Set(sel);
    change((m) => {
      m.shapes = m.shapes.filter((s) => !ids.has(s.id));
      // Lines go with a shape they were on.
      m.lines = m.lines.filter((l) => !ids.has(l.id) && !(l.a.shape && ids.has(l.a.shape)) && !(l.b.shape && ids.has(l.b.shape)));
    });
    setSel([]);
    setPointEdit(null);
  };
  const duplicateSel = () => {
    const shapes = d.shapes.filter((s) => sel.includes(s.id));
    if (!shapes.length) return;
    const map = new Map<string, string>();
    const copies = shapes.map((s) => {
      const id = uid();
      map.set(s.id, id);
      return { ...clone({ shapes: [s], lines: [] }).shapes[0], id, x: s.x + 20, y: s.y + 20 };
    });
    // Lines between the copied shapes are copied too.
    const lines = d.lines
      .filter((l) => l.a.shape && l.b.shape && map.has(l.a.shape) && map.has(l.b.shape))
      .map((l) => ({ ...l, id: uid(), a: { ...l.a, shape: map.get(l.a.shape!) }, b: { ...l.b, shape: map.get(l.b.shape!) } }));
    change((m) => {
      m.shapes.push(...copies);
      m.lines.push(...lines);
    });
    setSel(copies.map((s) => s.id));
  };
  const reorder = (front: boolean) => {
    const ids = new Set(sel);
    change((m) => {
      const picked = m.shapes.filter((s) => ids.has(s.id));
      const rest = m.shapes.filter((s) => !ids.has(s.id));
      m.shapes = front ? [...rest, ...picked] : [...picked, ...rest];
    });
  };
  /** A change to the picked things; one with a key (a slider being dragged) merges with the last one of that key. */
  const tweak = (fn: (m: Diagram) => void, key?: string) => {
    const now = Date.now();
    const l = lastTweak.current;
    if (key && l && l.key === key && now - l.t < 1500) live_(fn);
    else change(fn);
    lastTweak.current = key ? { key, t: now } : null;
  };
  const setOnSel = (fn: (s: DShape) => void, key?: string) => tweak((m) => m.shapes.filter((s) => sel.includes(s.id)).forEach(fn), key);
  const setOnLines = (fn: (l: DLine) => void, key?: string) => tweak((m) => m.lines.filter((l) => sel.includes(l.id)).forEach(fn), key);
  /** The picked shapes turned by `by` degrees (null: no turn). */
  const turnSel = (by: number | null) =>
    setOnSel((s) => {
      const a = by === null ? 0 : ((((s.rot ?? 0) + by) % 360) + 360) % 360;
      if (a) s.rot = a;
      else delete s.rot;
    });
  /** The picked shapes one step to the front (or back). */
  const stepOrder = (front: boolean) => {
    const ids = new Set(sel);
    change((m) => {
      const a = m.shapes;
      if (front) {
        for (let i = a.length - 2; i >= 0; i--) if (ids.has(a[i].id) && !ids.has(a[i + 1].id)) [a[i], a[i + 1]] = [a[i + 1], a[i]];
      } else {
        for (let i = 1; i < a.length; i++) if (ids.has(a[i].id) && !ids.has(a[i - 1].id)) [a[i], a[i - 1]] = [a[i - 1], a[i]];
      }
    });
  };
  /** The picked shapes lined up (as on the board: Shift+L/C/R/T/M/B, Shift+H/V). */
  const alignSel = (kind: AlignKind) => {
    const places = alignedPlaces(
      d.shapes.filter((s) => sel.includes(s.id)).map((s) => ({ id: s.id, x: s.x, y: s.y, w: s.w, h: s.h })),
      kind,
    );
    if (!places.size) return;
    change((m) => {
      for (const s of m.shapes) {
        const q = places.get(s.id);
        if (q) (s.x = q.x), (s.y = q.y);
      }
    });
  };

  /* ---------- the pen's eraser ---------- */
  const eraserR = () => Math.max(6, penOpts.size * 3) / view.z;
  /** The drawn strokes the eraser touches at `p` are rubbed out. */
  const eraseAt = (p: Pt) => {
    const r = eraserR();
    const hit = live.current.shapes.filter((s) => s.ink && nearestOnOutline(s, p).dist <= r + (s.strokeW ?? 1) / 2).map((s) => s.id);
    if (hit.length) live_((m) => (m.shapes = m.shapes.filter((s) => !hit.includes(s.id))));
  };

  /* ---------- the Spline tool ---------- */
  /** The clicked points made a curve: closed (back on the first point) it is a filled shape. */
  const finishSpline = (pts: Pt[], closed: boolean) => {
    setSpline(null);
    setTool('select');
    if (pts.length < 2) return;
    const sh = splineShape(pts, closed, splineSharp);
    setSplineSharp([]);
    const shape: DShape = {
      id: uid(),
      kind: 'curve',
      ...sh,
      open: !closed,
      fill: closed ? look.fill : 'transparent',
      stroke: look.stroke,
      strokeW: 1.8,
      text: '',
    };
    change((m) => m.shapes.push(shape));
    setSel([shape.id]);
  };

  /* ---------- copy, cut, paste ---------- */
  /** The picked shapes and lines, with line ends on shapes left behind made free points. */
  const pickedParts = (): Diagram | null => {
    const shapes = d.shapes.filter((s) => sel.includes(s.id));
    const ids = new Set(shapes.map((s) => s.id));
    const lines = d.lines
      .filter((l) => sel.includes(l.id) || (l.a.shape && l.b.shape && ids.has(l.a.shape) && ids.has(l.b.shape)))
      .map((l) => {
        const free = (e: DEnd): DEnd => (e.shape && !ids.has(e.shape) ? { ...endPoint(d, e) } : { ...e });
        return { ...l, a: free(l.a), b: free(l.b) };
      });
    if (!shapes.length && !lines.length) return null;
    return clone({ shapes, lines });
  };
  /** Copied parts put in again: new ids, under the pointer (or a little down and right of where they were). */
  const pasteParts = (parts: Diagram) => {
    const b = diagramBounds(parts);
    if (!b) return;
    const at = lastPtr.current;
    pasteCount.current += 1;
    const dx = at ? at.x - (b.x + b.w / 2) : 20 * pasteCount.current;
    const dy = at ? at.y - (b.y + b.h / 2) : 20 * pasteCount.current;
    const map = new Map<string, string>();
    const shapes = parts.shapes.map((s) => {
      const id = uid();
      map.set(s.id, id);
      return { ...s, id, x: Math.round(s.x + dx), y: Math.round(s.y + dy) };
    });
    const moveEnd = (e: DEnd): DEnd => (e.shape && map.has(e.shape) ? { ...e, shape: map.get(e.shape) } : { x: e.x + dx, y: e.y + dy });
    const lines = parts.lines.map((l) => ({ ...l, id: uid(), a: moveEnd(l.a), b: moveEnd(l.b) }));
    change((m) => {
      m.shapes.push(...shapes);
      m.lines.push(...lines);
    });
    setSel([...shapes.map((s) => s.id), ...lines.map((l) => l.id)]);
  };
  /** Text from outside: a text box with no background, sized to the text. */
  const pasteText = (text: string) => {
    const rows = text.replace(/\r/g, '').split('\n');
    const w = Math.min(460, Math.max(60, Math.max(...rows.map((r) => r.length)) * 8.5 + 24));
    const h = rows.length * 19 + 14;
    const c = lastPtr.current ?? { x: view.x + size.w / view.z / 2, y: view.y + size.h / view.z / 2 };
    const t: DShape = { id: uid(), kind: 'text', x: Math.round(c.x - w / 2), y: Math.round(c.y - h / 2), w: Math.round(w), h, fill: 'transparent', stroke: 'transparent', text: rows.join('\n') };
    change((m) => m.shapes.push(t));
    setSel([t.id]);
  };
  /** A picture from outside: an image in the drawing (made smaller when it is very big). */
  const pasteImage = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 1200;
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(img.width * k));
        cv.height = Math.max(1, Math.round(img.height * k));
        cv.getContext('2d')?.drawImage(img, 0, 0, cv.width, cv.height);
        const href = file.type === 'image/png' || k < 1 ? cv.toDataURL(file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.9) : String(reader.result);
        const shown = Math.min(1, 420 / Math.max(img.width, img.height));
        const w = Math.round(img.width * shown);
        const h = Math.round(img.height * shown);
        const c = lastPtr.current ?? { x: view.x + size.w / view.z / 2, y: view.y + size.h / view.z / 2 };
        const s: DShape = { id: uid(), kind: 'image', x: Math.round(c.x - w / 2), y: Math.round(c.y - h / 2), w, h, fill: 'transparent', stroke: 'transparent', href };
        change((m) => m.shapes.push(s));
        setSel([s.id]);
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };
  const clipRef = useRef<{ copy: (e: ClipboardEvent) => void; paste: (e: ClipboardEvent) => void }>({ copy: () => {}, paste: () => {} });
  clipRef.current = {
    copy: (e) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('input, textarea')) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const parts = pickedParts();
      if (!parts) return;
      diagramClip = parts;
      e.clipboardData?.setData(CLIP_TYPE, JSON.stringify(parts));
      e.clipboardData?.setData('text/plain', parts.shapes.map((s) => s.text ?? '').filter(Boolean).join('\n') || ' ');
      if (e.type === 'cut' && !cutting.current) removeSel();
    },
    paste: (e) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('input, textarea')) return;
      // Pasted into the drawing itself, never to the board's Unsorted.
      e.preventDefault();
      e.stopImmediatePropagation();
      const data = e.clipboardData;
      const own = data?.getData(CLIP_TYPE);
      if (own) {
        try {
          return pasteParts(JSON.parse(own));
        } catch {
          // Not ours after all.
        }
      }
      const file = Array.from(data?.files ?? []).find((f) => f.type.startsWith('image/'));
      if (file) return pasteImage(file);
      const text = data?.getData('text/plain') ?? '';
      if (text.trim() && !(diagramClip && text === (diagramClip.shapes.map((s) => s.text ?? '').filter(Boolean).join('\n') || ' '))) return pasteText(text);
      if (diagramClip) pasteParts(diagramClip);
    },
  };
  useEffect(() => {
    const copy = (e: ClipboardEvent) => clipRef.current.copy(e);
    const paste = (e: ClipboardEvent) => clipRef.current.paste(e);
    addEventListener('copy', copy, true);
    addEventListener('cut', copy, true);
    addEventListener('paste', paste, true);
    return () => {
      removeEventListener('copy', copy, true);
      removeEventListener('cut', copy, true);
      removeEventListener('paste', paste, true);
    };
  }, []);

  /* ---------- point editing ---------- */
  const startPoints = (id: string) => {
    const s = shapeById(id);
    if (!s || s.kind === 'text') return;
    if (!s.nodes) change((m) => (m.shapes.find((x) => x.id === id)!.nodes = presetNodes(s)));
    setSel([id]);
    setPointEdit(id);
    setSelNode(null);
  };
  const setNodes = (id: string, nodes: DNode[], step = true) => {
    const fn = (m: Diagram) => {
      const i = m.shapes.findIndex((x) => x.id === id);
      m.shapes[i] = refitNodes({ ...m.shapes[i], nodes });
    };
    if (step) change(fn);
    else live_(fn);
  };

  /**
   * Where a shape's connection dot shows: on its side, or a little out of it on the picked shape
   * (whose resize handles sit on the sides' middles).
   */
  const dotAt = (shape: DShape, side: Side): Pt => {
    const q = sitePoint(shape, side);
    if (!(sel.length === 1 && sel[0] === shape.id)) return q;
    const v = sideDir(shape, side);
    return { x: q.x + (v.x * 16) / view.z, y: q.y + (v.y * 16) / view.z };
  };

  /* ---------- smart guides: settling on the other shapes ---------- */
  const SNAP = 6;
  /** The left / middle / right (or top / middle / bottom) lines of the shapes not being moved. */
  const snapLines = (skip: Set<string>) => {
    const xs: SnapLine[] = [];
    const ys: SnapLine[] = [];
    for (const o of live.current.shapes) {
      if (skip.has(o.id)) continue;
      const cs = boxCorners(o);
      const x0 = Math.min(...cs.map((q) => q.x));
      const x1 = Math.max(...cs.map((q) => q.x));
      const y0 = Math.min(...cs.map((q) => q.y));
      const y1 = Math.max(...cs.map((q) => q.y));
      for (const v of [x0, (x0 + x1) / 2, x1]) xs.push({ v, a: y0, b: y1 });
      for (const v of [y0, (y0 + y1) / 2, y1]) ys.push({ v, a: x0, b: x1 });
    }
    return { xs, ys };
  };
  /** The nearest line within reach of any of `mine`: how far to go to it, where it is, and every shape's line there. */
  const nearest = (mine: number[], lines: SnapLine[]) => {
    let best: { by: number; at: number } | null = null;
    for (const m of mine)
      for (const l of lines) {
        const by = l.v - m;
        if (Math.abs(by) * view.z <= SNAP && (!best || Math.abs(by) < Math.abs(best.by))) best = { by, at: l.v };
      }
    return best ? { ...best, hits: lines.filter((l) => Math.abs(l.v - best!.at) < 0.5) } : null;
  };
  /** A guide from the moved box (a..b along it) to the shapes it lines up with. */
  const guideTo = (at: number, a: number, b: number, hits: SnapLine[]): Guide => {
    const pad = 8 / view.z;
    return { at, from: Math.min(a, ...hits.map((h) => h.a)) - pad, to: Math.max(b, ...hits.map((h) => h.b)) + pad };
  };
  /** A move by (dx, dy) of the shapes in `start`, settled on the other shapes' lines when near them. */
  const snapMove = (start: Map<string, Pt>, dx: number, dy: number) => {
    const moving = live.current.shapes.filter((x) => start.has(x.id));
    if (!moving.length) return { dx, dy };
    const boxAt = (ddx: number, ddy: number) => {
      const bs = moving.map((x) => {
        const o = start.get(x.id)!;
        const cs = boxCorners({ ...x, x: o.x + ddx, y: o.y + ddy });
        return [Math.min(...cs.map((q) => q.x)), Math.max(...cs.map((q) => q.x)), Math.min(...cs.map((q) => q.y)), Math.max(...cs.map((q) => q.y))];
      });
      return [Math.min(...bs.map((b) => b[0])), Math.max(...bs.map((b) => b[1])), Math.min(...bs.map((b) => b[2])), Math.max(...bs.map((b) => b[3]))];
    };
    const [x0, x1, y0, y1] = boxAt(dx, dy);
    const { xs, ys } = snapLines(new Set(start.keys()));
    const sx = nearest([x0, (x0 + x1) / 2, x1], xs);
    const sy = nearest([y0, (y0 + y1) / 2, y1], ys);
    const ndx = dx + (sx?.by ?? 0);
    const ndy = dy + (sy?.by ?? 0);
    const [a0, a1, b0, b1] = boxAt(ndx, ndy);
    setGuides({ x: sx ? [guideTo(sx.at, b0, b1, sx.hits)] : [], y: sy ? [guideTo(sy.at, a0, a1, sy.hits)] : [] });
    return { dx: ndx, dy: ndy };
  };
  /** A box being resized: its moving edges settled on the other shapes' lines when near them. */
  const snapEdges = (id: string, b: { x: number; y: number; w: number; h: number }, dir: string) => {
    const { xs, ys } = snapLines(new Set([id]));
    let { x, y, w, h } = b;
    const nx = dir.includes('e') ? nearest([x + w], xs) : dir.includes('w') ? nearest([x], xs) : null;
    if (nx && dir.includes('e')) w += nx.by;
    else if (nx) (x += nx.by), (w -= nx.by);
    const ny = dir.includes('s') ? nearest([y + h], ys) : dir.includes('n') ? nearest([y], ys) : null;
    if (ny && dir.includes('s')) h += ny.by;
    else if (ny) (y += ny.by), (h -= ny.by);
    setGuides({ x: nx ? [guideTo(nx.at, y, y + h, nx.hits)] : [], y: ny ? [guideTo(ny.at, x, x + w, ny.hits)] : [] });
    return { x, y, w: Math.max(16, w), h: Math.max(12, h) };
  };

  /* ---------- the pointer ---------- */
  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    setMenu(null);
    setPicker(null);
    if (textEdit) commitText();
    const p = toBoard(e);
    const t = e.target as Element;
    if (e.button === 1 || (e.button === 0 && space.current)) {
      e.preventDefault();
      setDrag({ kind: 'pan', x: e.clientX, y: e.clientY, vx: view.x, vy: view.y });
      return;
    }
    if (e.button !== 0) return;
    (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
    const before = clone(d);

    // Editing the points of a shape.
    if (pointEdit) {
      const s = shapeById(pointEdit)!;
      const nodeEl = t.closest('[data-node]');
      const handleEl = t.closest('[data-handle]');
      if (handleEl && selNode !== null) {
        setDrag({ kind: 'handle', id: s.id, i: selNode, which: handleEl.getAttribute('data-handle') as 'hin' | 'hout', before });
        return;
      }
      if (nodeEl) {
        const i = Number(nodeEl.getAttribute('data-node'));
        setSelNode(i);
        setDrag({ kind: 'node', id: s.id, i, before });
        return;
      }
      const near = nearestOnOutline(s, p);
      if (near.dist < 7 / view.z) {
        // On the outline where there is no point: a new point there, dragged.
        const nodes = insertNode(s, near.seg, near.t);
        live_((m) => (m.shapes.find((x) => x.id === s.id)!.nodes = nodes));
        setSelNode(near.seg + 1);
        setDrag({ kind: 'node', id: s.id, i: near.seg + 1, before });
        return;
      }
      // Inside the shape: nothing (it is not moved while its points are edited). Outside: done.
      if (insideShape(s, p)) return;
      setPointEdit(null);
      setSelNode(null);
    }

    if (tool === 'pen' && penOpts.mode === 'eraser') {
      setDrag({ kind: 'erase', before });
      eraseAt(p);
      return;
    }
    if (tool === 'pen') {
      setDrag({ kind: 'pen', pts: [p] });
      return;
    }
    if (tool === 'spline') {
      // Click by click; on the first point again: a closed, filled shape; on the last one again: done.
      const pts = spline ?? [];
      const near = (q: Pt) => Math.hypot(q.x - p.x, q.y - p.y) * view.z < 9;
      if (pts.length >= 3 && near(pts[0])) finishSpline(pts, true);
      else if (pts.length >= 2 && near(pts[pts.length - 1])) finishSpline(pts, false);
      else {
        setSpline([...pts, p]);
        setSplineSharp([...(pts.length ? splineSharp : []), e.ctrlKey || e.metaKey]);
      }
      return;
    }
    if (tool === 'line') {
      setDrag({ kind: 'line', from: endFor(p), to: p, straight: e.shiftKey });
      return;
    }
    if (tool !== 'select') {
      setDrag({ kind: 'create', tool, from: p, to: p });
      return;
    }
    const site = t.closest('[data-site]');
    if (site) {
      const [shape, side] = site.getAttribute('data-site')!.split(':') as [string, Side];
      const q = sitePoint(shapeById(shape)!, side);
      setDrag({ kind: 'line', from: { shape, side, x: q.x, y: q.y }, to: p, straight: e.shiftKey });
      return;
    }
    const rotEl = t.closest('[data-rotate]');
    if (rotEl) {
      setDrag({ kind: 'rotate', id: rotEl.getAttribute('data-rotate')!, before });
      return;
    }
    const rad = t.closest('[data-radius]');
    if (rad) {
      setDrag({ kind: 'radius', id: rad.getAttribute('data-radius')!, before });
      return;
    }
    const rz = t.closest('[data-resize]');
    if (rz) {
      const s = shapeById(sel[0])!;
      setDrag({ kind: 'resize', id: s.id, dir: rz.getAttribute('data-resize')!, box: { x: s.x, y: s.y, w: s.w, h: s.h }, from: p, before });
      return;
    }
    const end = t.closest('[data-end]');
    if (end) {
      const [line, which] = end.getAttribute('data-end')!.split(':') as [string, 'a' | 'b'];
      setDrag({ kind: 'end', line, which, before });
      return;
    }
    const lineEl = t.closest('[data-line]');
    const shapeEl = t.closest('[data-shape]');
    if (shapeEl || lineEl) {
      const id = (shapeEl ?? lineEl)!.getAttribute(shapeEl ? 'data-shape' : 'data-line')!;
      let next = sel;
      // Ctrl on a shape: dragged, a copy goes (the original stays); only clicked, it is picked or left out.
      const ctrl = (e.ctrlKey || e.metaKey) && !!shapeEl;
      if (ctrl) {
        const moving = sel.includes(id) ? d.shapes.filter((x) => sel.includes(x.id)).map((x) => x.id) : [id];
        const start0 = new Map<string, Pt>();
        for (const x of d.shapes) if (moving.includes(x.id)) start0.set(x.id, { x: x.x, y: x.y });
        setDrag({ kind: 'move', from: p, start: start0, before, moved: false, copyOf: moving, toggle: id });
        return;
      }
      if (e.shiftKey) next = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id];
      else if (!sel.includes(id)) next = [id];
      setSel(next);
      const start = new Map<string, Pt>();
      for (const s of d.shapes) if (next.includes(s.id)) start.set(s.id, { x: s.x, y: s.y });
      for (const l of d.lines)
        if (next.includes(l.id)) {
          if (!l.a.shape) start.set(l.id + ':a', { x: l.a.x, y: l.a.y });
          if (!l.b.shape) start.set(l.id + ':b', { x: l.b.x, y: l.b.y });
        }
      setDrag({ kind: 'move', from: p, start, before, moved: false });
      return;
    }
    const adding = e.shiftKey || e.ctrlKey || e.metaKey;
    if (!adding) setSel([]);
    setDrag({ kind: 'marquee', from: p, to: p, add: adding });
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const p = toBoard(e);
    lastPtr.current = p;
    if (tool !== 'select' && tool !== 'line') setPointer(p);
    if (ctrlHeld !== (e.ctrlKey || e.metaKey)) setCtrlHeld(e.ctrlKey || e.metaKey);
    const g = dragRef.current;
    if (!g) {
      // Pointing at a shape shows its connection dots.
      // (Far enough around it to reach the dots, which stand out from a picked shape.)
      const s = shapeAt(p, undefined, 24 / view.z);
      // The dots come only when a line is wanted: with the Line tool, or right by a dot (connection site).
      let near: string | null = null;
      if (s && !pointEdit && tool === 'line') near = s.id;
      else if (s && !pointEdit && tool === 'select')
        near = SIDES.some((side) => {
          const q = dotAt(s, side);
          return Math.hypot(q.x - p.x, q.y - p.y) * view.z <= 14;
        })
          ? s.id
          : null;
      setHover(near);
      return;
    }
    if (g.kind === 'pan') {
      setView((v) => ({ ...v, x: g.vx - (e.clientX - g.x) / v.z, y: g.vy - (e.clientY - g.y) / v.z }));
    } else if (g.kind === 'move') {
      let dx = p.x - g.from.x;
      let dy = p.y - g.from.y;
      // Shift: straight across or down.
      if (e.shiftKey) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0);
      if (!g.moved && Math.hypot(dx, dy) * view.z < 3) return;
      if (!g.moved && g.copyOf) {
        // Ctrl+drag: copies of the shapes (and the lines between them) are what moves.
        const map = new Map<string, string>();
        const copies = live.current.shapes.filter((x) => g.copyOf!.includes(x.id)).map((x) => {
          const nid = uid();
          map.set(x.id, nid);
          return { ...clone({ shapes: [x], lines: [] }).shapes[0], id: nid };
        });
        const lines = live.current.lines
          .filter((l) => l.a.shape && l.b.shape && map.has(l.a.shape) && map.has(l.b.shape))
          .map((l) => ({ ...l, id: uid(), a: { ...l.a, shape: map.get(l.a.shape!) }, b: { ...l.b, shape: map.get(l.b.shape!) } }));
        live_((m) => {
          m.shapes.push(...copies);
          m.lines.push(...lines);
        });
        g.start = new Map(copies.map((x) => [x.id, { x: x.x, y: x.y }]));
        g.copyOf = undefined;
        g.toggle = undefined;
        setSel(copies.map((x) => x.id));
      }
      g.moved = true;
      // Alt: no snapping. Otherwise the moved shapes settle on the edges and middles of the others.
      if (!e.altKey) {
        const snap = snapMove(g.start, dx, dy);
        dx = snap.dx;
        dy = snap.dy;
      } else setGuides({ x: [], y: [] });
      live_((m) => {
        for (const s of m.shapes) {
          const o = g.start.get(s.id);
          if (o) (s.x = Math.round(o.x + dx)), (s.y = Math.round(o.y + dy));
        }
        for (const l of m.lines) {
          const a = g.start.get(l.id + ':a');
          const b = g.start.get(l.id + ':b');
          if (a) (l.a.x = a.x + dx), (l.a.y = a.y + dy);
          if (b) (l.b.x = b.x + dx), (l.b.y = b.y + dy);
        }
      });
    } else if (g.kind === 'create') {
      // Shift: as wide as high (a square, a circle).
      let to = p;
      if (e.shiftKey) {
        const side = Math.max(Math.abs(p.x - g.from.x), Math.abs(p.y - g.from.y));
        to = { x: g.from.x + Math.sign(p.x - g.from.x || 1) * side, y: g.from.y + Math.sign(p.y - g.from.y || 1) * side };
      }
      setDrag({ ...g, to });
    } else if (g.kind === 'marquee') {
      setDrag({ ...g, to: p });
    } else if (g.kind === 'erase') {
      eraseAt(p);
    } else if (g.kind === 'pen') {
      const last = g.pts[g.pts.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) * view.z >= 3) setDrag({ ...g, pts: [...g.pts, p] });
    } else if (g.kind === 'line') {
      const skip = g.from.shape;
      const to = endFor(p, skip, e.shiftKey ? endPoint(d, g.from) : undefined);
      setSnap(to.shape ? { shape: to.shape, side: to.side! } : null);
      setDrag({ ...g, to: to.shape ? p : { x: to.x, y: to.y }, straight: e.shiftKey });
    } else if (g.kind === 'end') {
      const l = d.lines.find((x) => x.id === g.line)!;
      const other = g.which === 'a' ? l.b.shape : l.a.shape;
      const to = endFor(p, other, l.route === 'straight' ? endPoint(d, g.which === 'a' ? l.b : l.a) : undefined);
      setSnap(to.shape ? { shape: to.shape, side: to.side! } : null);
      live_((m) => (m.lines.find((x) => x.id === g.line)![g.which] = to));
    } else if (g.kind === 'resize') {
      const b = g.box;
      let { x, y, w, h } = b;
      // A turned shape is sized in its own frame; its middle then goes back where that puts it.
      const rot = shapeById(g.id)?.rot ?? 0;
      const c0 = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
      const lp = turn(p, c0, -rot);
      const lf = turn(g.from, c0, -rot);
      const dx = lp.x - lf.x;
      const dy = lp.y - lf.y;
      if (g.dir.includes('e')) w = b.w + dx;
      if (g.dir.includes('s')) h = b.h + dy;
      if (g.dir.includes('w')) (w = b.w - dx), (x = b.x + dx);
      if (g.dir.includes('n')) (h = b.h - dy), (y = b.y + dy);
      if (e.ctrlKey || e.metaKey) {
        // Ctrl: grown the same on both sides, about the middle (as in PowerPoint).
        let W = b.w;
        let H = b.h;
        if (g.dir.includes('e')) W = b.w + 2 * dx;
        if (g.dir.includes('w')) W = b.w - 2 * dx;
        if (g.dir.includes('s')) H = b.h + 2 * dy;
        if (g.dir.includes('n')) H = b.h - 2 * dy;
        if (e.shiftKey && g.dir.length === 2) {
          const k = Math.max(W / b.w, H / b.h);
          W = b.w * k;
          H = b.h * k;
        }
        w = Math.max(16, W);
        h = Math.max(12, H);
        x = b.x + b.w / 2 - w / 2;
        y = b.y + b.h / 2 - h / 2;
      } else {
        if (e.shiftKey && g.dir.length === 2) {
          const k = Math.max(w / b.w, h / b.h);
          w = b.w * k;
          h = b.h * k;
          if (g.dir.includes('w')) x = b.x + b.w - w;
          if (g.dir.includes('n')) y = b.y + b.h - h;
        }
        if (w < 16) (x = g.dir.includes('w') ? b.x + b.w - 16 : x), (w = 16);
        if (h < 12) (y = g.dir.includes('n') ? b.y + b.h - 12 : y), (h = 12);
      }
      if (!rot && !e.altKey && !(e.ctrlKey || e.metaKey)) {
        const sn = snapEdges(g.id, { x, y, w, h }, g.dir);
        ({ x, y, w, h } = sn);
      }
      if (rot) {
        const mid = turn({ x: x + w / 2, y: y + h / 2 }, c0, rot);
        x = mid.x - w / 2;
        y = mid.y - h / 2;
      }
      live_((m) => Object.assign(m.shapes.find((s) => s.id === g.id)!, { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) }));
    } else if (g.kind === 'rotate') {
      // Turning: it settles on the quarter turns when near them (Shift: 15° steps).
      const s = shapeById(g.id)!;
      const c = { x: s.x + s.w / 2, y: s.y + s.h / 2 };
      let a = (Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI + 90;
      a = ((a % 360) + 360) % 360;
      if (e.shiftKey) a = Math.round(a / 15) * 15;
      else {
        const q = Math.round(a / 90) * 90;
        if (Math.abs(a - q) < 7) a = q;
      }
      a = Math.round(a) % 360;
      live_((m) => {
        const t = m.shapes.find((x) => x.id === g.id)!;
        if (a) t.rot = a;
        else delete t.rot;
      });
    } else if (g.kind === 'radius') {
      const s = shapeById(g.id)!;
      const r = Math.max(0, Math.min(s.w / 2, s.h / 2, toLocal(s, p).x - s.x));
      live_((m) => {
        const t = m.shapes.find((x) => x.id === g.id)!;
        t.r = Math.round(r);
        t.sharp = r < 1;
      });
    } else if (g.kind === 'node') {
      const s = shapeById(g.id)!;
      const nodes = nodesOf(s).map((n) => ({ ...n }));
      const lp = toLocal(s, p);
      nodes[g.i] = { ...nodes[g.i], x: (lp.x - s.x) / s.w, y: (lp.y - s.y) / s.h };
      live_((m) => (m.shapes.find((x) => x.id === g.id)!.nodes = nodes));
    } else if (g.kind === 'handle') {
      const s = shapeById(g.id)!;
      const nodes = nodesOf(s).map((n) => ({ ...n }));
      const at = nodePlace(s, nodes[g.i]).at;
      const lp = toLocal(s, p);
      nodes[g.i] = moveHandle(nodes[g.i], g.which, { x: (lp.x - at.x) / s.w, y: (lp.y - at.y) / s.h });
      live_((m) => (m.shapes.find((x) => x.id === g.id)!.nodes = nodes));
    }
  };

  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    const g = dragRef.current;
    setDrag(null);
    setSnap(null);
    if (!g) return;
    const p = toBoard(e);
    setGuides({ x: [], y: [] });
    if (g.kind === 'move' && !g.moved && g.toggle) {
      // Ctrl+click (no drag): picked, or left out of what is picked.
      const id = g.toggle;
      setSel((old) => (old.includes(id) ? old.filter((x) => x !== id) : [...old, id]));
    } else if (g.kind === 'move' && g.moved) keepStep(g.before);
    else if (g.kind === 'end' || g.kind === 'resize' || g.kind === 'radius' || g.kind === 'handle' || g.kind === 'rotate') keepStep(g.before);
    else if (g.kind === 'node') {
      // The box fitted around the moved points again.
      live_((m) => {
        const i = m.shapes.findIndex((x) => x.id === g.id);
        m.shapes[i] = refitNodes(m.shapes[i]);
      });
      keepStep(g.before);
    } else if (g.kind === 'create') {
      const w = Math.abs(g.to.x - g.from.x);
      const h = Math.abs(g.to.y - g.from.y);
      if (w * view.z < 8 && h * view.z < 8) {
        // A click: the shape's own size, there.
        const [dw, dh] = SHAPE_TOOLS.find((t) => t.kind === g.tool)!.size;
        addShape(g.tool, { x: Math.round(p.x - dw / 2), y: Math.round(p.y - dh / 2), w: dw, h: dh });
      } else addShape(g.tool, { x: Math.round(Math.min(g.from.x, g.to.x)), y: Math.round(Math.min(g.from.y, g.to.y)), w: Math.round(Math.max(16, w)), h: Math.round(Math.max(12, h)) });
    } else if (g.kind === 'line') {
      const a = g.from;
      const b = endFor(g.straight ? g.to : p, a.shape, g.straight ? endPoint(d, a) : undefined);
      const pa = endPoint(d, a);
      if (Math.hypot(b.x - pa.x, b.y - pa.y) * view.z < 10 && !b.shape) return;
      const l: DLine = { id: uid(), a, b, route: g.straight ? 'straight' : 'elbow', color: look.line, arrow: 'end' };
      change((m) => m.lines.push(l));
      setSel([l.id]);
      setTool('select');
    } else if (g.kind === 'erase') {
      keepStep(g.before);
    } else if (g.kind === 'pen') {
      // A drawn stroke: a smooth open curve through the points it needs (the pen stays on for the next).
      const all = [...g.pts, p];
      const pts = simplify(all, 1.2 / view.z);
      const span = Math.max(Math.max(...all.map((q) => q.x)) - Math.min(...all.map((q) => q.x)), Math.max(...all.map((q) => q.y)) - Math.min(...all.map((q) => q.y)));
      if (pts.length < 2 || span * view.z < 3) return;
      const sh = splineShape(pts, false);
      const hl = penOpts.mode === 'hl';
      const stroke: DShape = {
        id: uid(),
        kind: 'curve',
        ...sh,
        open: true,
        ink: true,
        fill: 'transparent',
        stroke: penOpts.color,
        strokeW: hl ? penOpts.size * 4 : penOpts.size,
        ...(hl ? { opacity: 0.4 } : {}),
        text: '',
      };
      change((m) => m.shapes.push(stroke));
    } else if (g.kind === 'marquee') {
      const x0 = Math.min(g.from.x, g.to.x);
      const x1 = Math.max(g.from.x, g.to.x);
      const y0 = Math.min(g.from.y, g.to.y);
      const y1 = Math.max(g.from.y, g.to.y);
      if ((x1 - x0) * view.z < 4 && (y1 - y0) * view.z < 4) return;
      const inside = d.shapes.filter((s) => boxCorners(s).every((q) => q.x >= x0 && q.y >= y0 && q.x <= x1 && q.y <= y1)).map((s) => s.id);
      const lines = d.lines
        .filter((l) => routePoints(d, l).every((q) => q.x >= x0 && q.x <= x1 && q.y >= y0 && q.y <= y1))
        .map((l) => l.id);
      setSel(g.add ? [...new Set([...sel, ...inside, ...lines])] : [...inside, ...lines]);
    }
  };

  const onDoubleClick = (e: ReactMouseEvent<SVGSVGElement>) => {
    if (pointEdit || tool === 'spline') return;
    const p = toBoard(e);
    const s = shapeAt(p);
    if (s?.kind === 'image') return;
    if (s) {
      startText(s.id);
      return;
    }
    // On empty space: a text box there (as in Excalidraw).
    if ((e.target as Element).closest('[data-line]')) return;
    const id = uid();
    const t: DShape = { id, kind: 'text', x: Math.round(p.x - 60), y: Math.round(p.y - 16), w: 120, h: 32, fill: 'transparent', stroke: 'transparent', text: '' };
    change((m) => m.shapes.push(t));
    startText(id);
  };

  const onContextMenu = (e: ReactMouseEvent<SVGSVGElement>) => {
    e.preventDefault();
    const p = toBoard(e);
    const at = { x: e.clientX, y: e.clientY };
    if (pointEdit) {
      const s = shapeById(pointEdit)!;
      const nodeEl = (e.target as Element).closest('[data-node]');
      const nodes = nodesOf(s);
      if (nodeEl) {
        const i = Number(nodeEl.getAttribute('data-node'));
        setSelNode(i);
        const kind = nodes[i].kind;
        setMenu({
          ...at,
          items: [
            { label: tr('점 추가', 'Add point'), icon: 'add', act: () => setNodes(s.id, insertNode(s, i, 0.5)) },
            { label: tr('점 삭제', 'Delete point'), icon: 'remove', act: () => (setNodes(s.id, nodes.filter((_, j) => j !== i)), setSelNode(null)), off: nodes.length <= 3, danger: true },
            { label: (kind === 'smooth' ? '✓ ' : '') + tr('부드러운 점', 'Smooth point'), icon: 'smooth', act: () => setNodes(s.id, retypeNode(s, i, 'smooth')) },
            { label: (kind === 'straight' ? '✓ ' : '') + tr('직선 점', 'Straight point'), icon: 'straightPt', act: () => setNodes(s.id, retypeNode(s, i, 'straight')) },
            { label: (kind === 'corner' ? '✓ ' : '') + tr('꼭짓점', 'Corner point'), icon: 'corner', act: () => setNodes(s.id, retypeNode(s, i, 'corner')) },
            { label: tr('점 편집 끝내기', 'Exit edit points'), icon: 'exit', act: () => setPointEdit(null) },
          ],
        });
        return;
      }
      const near = nearestOnOutline(s, p);
      setMenu({
        ...at,
        items: [
          ...(near.dist < 9 / view.z ? [{ label: tr('점 추가', 'Add point'), icon: 'add', act: () => setNodes(s.id, insertNode(s, near.seg, near.t)) }] : []),
          { label: tr('점 편집 끝내기', 'Exit edit points'), icon: 'exit', act: () => setPointEdit(null) },
        ],
      });
      return;
    }
    const s = shapeAt(p);
    const lineEl = (e.target as Element).closest('[data-line]');
    if (s) {
      if (!sel.includes(s.id)) setSel([s.id]);
      setMenu({
        ...at,
        items: [
          ...(s.kind !== 'text' && s.kind !== 'image' ? [{ label: tr('점 편집', 'Edit points'), icon: 'points', act: () => startPoints(s.id) }] : []),
          ...(s.kind !== 'image' ? [{ label: tr('글자 넣기', 'Type text'), icon: 'text', act: () => startText(s.id) }] : []),
          ...(CORNERED.has(s.kind) && !s.nodes
            ? [{ label: !cornerRadius(s) ? tr('둥근 모서리로', 'Round corners') : tr('각진 모서리로', 'Square corners'), icon: !cornerRadius(s) ? 'round' : 'square', act: () => toggleSharp() }]
            : []),
          ...(s.nodes && s.kind !== 'curve' ? [{ label: tr('점 편집 되돌리기 (원래 모양)', 'Reset points (original shape)'), icon: 'reset', act: () => change((m) => delete m.shapes.find((x) => x.id === s.id)!.nodes) }] : []),
          { label: tr('오른쪽으로 90° 회전', 'Turn right 90°'), icon: 'rotr', act: () => turnSel(90) },
          { label: tr('왼쪽으로 90° 회전', 'Turn left 90°'), icon: 'rotl', act: () => turnSel(-90) },
          ...(s.rot ? [{ label: tr('회전 없애기', 'Clear the turn'), icon: 'rot0', act: () => turnSel(null) }] : []),
          ...(!panelOpen ? [{ label: tr('설정 패널 열기 (I)', 'Open settings (I)'), icon: 'settings', act: () => setPanelOpen(true) }] : []),
          { label: tr('맨 앞으로', 'Bring to front'), icon: 'front', act: () => reorder(true) },
          { label: tr('앞으로 한 칸', 'Bring forward'), icon: 'forward', act: () => stepOrder(true) },
          { label: tr('뒤로 한 칸', 'Send backward'), icon: 'backward', act: () => stepOrder(false) },
          { label: tr('맨 뒤로', 'Send to back'), icon: 'back', act: () => reorder(false) },
          { label: tr('복제 (Ctrl+D)', 'Duplicate (Ctrl+D)'), icon: 'copy', act: duplicateSel },
          { label: tr('삭제', 'Delete'), icon: 'delete', act: removeSel, danger: true },
        ],
      });
    } else if (lineEl) {
      const id = lineEl.getAttribute('data-line')!;
      setSel([id]);
      setMenu({
        ...at,
        items: [
          { label: tr('꺾은선으로', 'Elbow'), icon: 'corner', act: () => change((m) => (m.lines.find((l) => l.id === id)!.route = 'elbow')) },
          { label: tr('직선으로', 'Straight'), icon: 'remove', act: () => change((m) => (m.lines.find((l) => l.id === id)!.route = 'straight')) },
          { label: tr('방향 바꾸기', 'Reverse'), icon: 'rotr', act: () => change((m) => { const l = m.lines.find((x) => x.id === id)!; [l.a, l.b] = [l.b, l.a]; }) },
          { label: tr('삭제', 'Delete'), icon: 'delete', act: () => (change((m) => (m.lines = m.lines.filter((l) => l.id !== id))), setSel([])), danger: true },
        ],
      });
    }
  };

  const toggleSharp = () => {
    const shapes = d.shapes.filter((s) => sel.includes(s.id) && CORNERED.has(s.kind));
    const toSharp = shapes.some((s) => cornerRadius(s) > 0);
    setOnSel((s) => {
      if (!CORNERED.has(s.kind)) return;
      s.sharp = toSharp;
      if (!toSharp && !s.r) s.r = DEFAULT_RADIUS;
    });
  };

  // Ctrl+wheel zooms around the pointer; the wheel alone moves around.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        setView((v) => {
          const z = Math.max(0.2, Math.min(4, v.z * Math.exp(-e.deltaY * 0.0015)));
          const px = v.x + (e.clientX - r.left) / v.z;
          const py = v.y + (e.clientY - r.top) / v.z;
          return { z, x: px - (e.clientX - r.left) / z, y: py - (e.clientY - r.top) / z };
        });
      } else setView((v) => ({ ...v, x: v.x + (e.shiftKey ? e.deltaY : e.deltaX) / v.z, y: v.y + (e.shiftKey ? 0 : e.deltaY) / v.z }));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);

  // The keys, before the board below sees them.
  const keysRef = useRef<(e: KeyboardEvent) => void>(() => {});
  const askingRef = useRef(false);
  askingRef.current = asking;
  keysRef.current = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    const mod = e.ctrlKey || e.metaKey;
    if (mathOpen.current) return;
    if (t.closest?.('.dg-text-edit')) {
      e.stopPropagation();
      if (isMathShortcut(e)) {
        // Ctrl+M: the formula editor, as on the board (a formula at the caret opens for changing).
        e.preventDefault();
        const ta = t as HTMLTextAreaElement;
        const text = ta.value;
        const at = mathAt(text, ta.selectionStart);
        if (textEdit) setMathEdit(at ? { id: textEdit, text, start: at.start, end: at.end, tex: at.tex } : { id: textEdit, text, start: ta.selectionStart, end: ta.selectionEnd, tex: '' });
        return;
      }
      if (e.key === 'Escape' || (e.key === 'Enter' && mod)) {
        e.preventDefault();
        commitText();
      }
      return;
    }
    // Typing boxes keep their keys; a tick box (the shadow's, say) does not: the editor's keys still work.
    if (t.closest?.('textarea, input:not([type=checkbox])')) {
      e.stopPropagation();
      return;
    }
    e.stopPropagation();
    if (askingRef.current) {
      // The question: the arrow keys (or Tab) go through the answers and Enter takes the one picked;
      // Enter with none picked keeps the changes; Esc goes back to editing.
      const at = askAtRef.current;
      const answers = [onCancel, () => setAsking(false), finish];
      if (e.key === 'Enter') {
        e.preventDefault();
        answers[at >= 0 ? at : 2]();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setAsking(false);
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
        e.preventDefault();
        setAskAt(at < 0 ? 0 : (at + 1) % 3);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
        e.preventDefault();
        setAskAt(at < 0 ? 2 : (at + 2) % 3);
      }
      return;
    }
    if (e.key === ' ') {
      space.current = true;
      e.preventDefault();
      return;
    }
    const k = e.key.toLowerCase();
    if (spline && (e.key === 'Escape' || e.key === 'Enter')) {
      // The Spline tool: Esc or Enter ends the curve where it is.
      e.preventDefault();
      finishSpline(spline, false);
      return;
    }
    if (e.shiftKey && !mod && !e.altKey && ALIGN_KEYS[e.code] && d.shapes.filter((s) => sel.includes(s.id)).length >= 2) {
      e.preventDefault();
      alignSel(ALIGN_KEYS[e.code]);
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      if (menu) setMenu(null);
      else if (picker) setPicker(null);
      else if (pointEdit) setPointEdit(null);
      else if (tool !== 'select') setTool('select');
      else if (sel.length) setSel([]);
      else leave();
    } else if (e.key === 'Enter' && mod) {
      e.preventDefault();
      finish();
    } else if (e.key === 'Enter' && sel.length === 1 && shapeById(sel[0])) {
      e.preventDefault();
      startText(sel[0]);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      if (pointEdit && selNode !== null) {
        const s = shapeById(pointEdit)!;
        const nodes = nodesOf(s);
        if (nodes.length > 3) setNodes(s.id, nodes.filter((_, j) => j !== selNode));
        setSelNode(null);
      } else removeSel();
    } else if (mod && (k === 'z' || k === 'y')) {
      e.preventDefault();
      undo(k === 'z' && !e.shiftKey);
    } else if (mod && (k === 'c' || k === 'x') && !e.shiftKey) {
      // With nothing selected on the page the browser sends no copy event by itself: asked for here.
      e.preventDefault();
      const parts = pickedParts();
      if (!parts) return;
      diagramClip = parts;
      cutting.current = k === 'x';
      document.execCommand('copy');
      if (cutting.current) {
        cutting.current = false;
        removeSel();
      }
    } else if (!mod && !e.altKey && e.shiftKey && e.code === 'Digit1') {
      // Shift+1: everything in sight.
      e.preventDefault();
      fitAll();
    } else if (!mod && !e.altKey && e.shiftKey && e.code === 'Digit2') {
      // Shift+2: what is picked fills the window (up to 300%; nothing picked: everything).
      e.preventDefault();
      const shapes = d.shapes.filter((x) => sel.includes(x.id));
      const lines = d.lines.filter((l) => sel.includes(l.id));
      // (A picked line brings the shapes at its ends, which its route needs.)
      const ends = d.shapes.filter((x) => lines.some((l) => l.a.shape === x.id || l.b.shape === x.id));
      if (shapes.length || lines.length) fitAll({ shapes: [...new Set([...shapes, ...ends])], lines }, 3);
      else fitAll();
    } else if (mod && k === 'd') {
      e.preventDefault();
      duplicateSel();
    } else if (mod && k === 'a') {
      e.preventDefault();
      setSel([...d.shapes.map((s) => s.id), ...d.lines.map((l) => l.id)]);
    } else if (e.key.startsWith('Arrow') && sel.length) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      setOnSel((s) => ((s.x += dx), (s.y += dy)));
    } else if (!mod && !e.altKey) {
      const shape = SHAPE_TOOLS.find((s) => s.key.toLowerCase() === k);
      if (k === 'v' || k === '1') setTool('select');
      else if (k === 'a' || k === 'l') setTool('line');
      else if (k === 's') setTool('spline');
      else if (k === 'f') setTool('pen');
      else if (k === 'i') setPanelOpen(!panelOpen);
      else if (shape) setTool(shape.kind);
      if (k !== 's' && spline) setSpline(null);
    }
  };
  useEffect(() => {
    const down = (e: KeyboardEvent) => keysRef.current(e);
    const up = (e: KeyboardEvent) => {
      if (e.key === ' ') space.current = false;
    };
    addEventListener('keydown', down, true);
    addEventListener('keyup', up, true);
    return () => {
      removeEventListener('keydown', down, true);
      removeEventListener('keyup', up, true);
    };
  }, []);

  /* ---------- drawing ---------- */
  const one = sel.length === 1 ? shapeById(sel[0]) : undefined;
  const selShapes = d.shapes.filter((s) => sel.includes(s.id));
  const selLines = d.lines.filter((l) => sel.includes(l.id));
  const px = 1 / view.z;
  const handles: ReactNode[] = [];
  for (const s of selShapes) {
    if (s.id === pointEdit) continue;
    // (Picked: its own outline drawn over in the accent colour, no dashed box around it.)
    handles.push(<path key={'sel' + s.id} d={shapePath(s)} className="dg-sel" strokeWidth={1.5 * px} transform={rotTransform(s)} />);
  }
  const own: ReactNode[] = [];
  if (one && !pointEdit && !textEdit) {
    // The rotation handle: a turning arrow above the top middle (as in PowerPoint).
    const cx = one.x + one.w / 2;
    const top = one.y - 4 * px;
    const ry = top - 30 * px;
    own.push(
      <g key="rotate" data-rotate={one.id} className="dg-rot">
        <title>{tr('끌어서 회전 (90°마다 멈춤 · Shift: 15°씩)', 'Drag to turn (stops at each 90° · Shift: 15° steps)')}</title>
        <circle cx={cx} cy={ry} r={9 * px} className="dg-rot-hit" />
        <path
          className="dg-rot-arrow"
          d={`M${cx + 5.2 * px} ${ry - 3 * px}A${6 * px} ${6 * px} 0 1 0 ${cx + 6 * px} ${ry + 1.5 * px}M${cx + 5.6 * px} ${ry - 7.2 * px}L${cx + 5.4 * px} ${ry - 2.6 * px}L${cx + 1 * px} ${ry - 3.4 * px}`}
          strokeWidth={1.7 * px}
        />
      </g>,
    );
    // The angle while turning, upright beside the handle.
    if (drag?.kind === 'rotate') {
      const at = turn({ x: cx, y: ry }, { x: cx, y: one.y + one.h / 2 }, one.rot ?? 0);
      handles.push(
        <text key="rot-label" x={at.x + 12 * px} y={at.y - 8 * px} className="dg-rot-label" fontSize={12 * px}>
          {(one.rot ?? 0) + '°'}
        </text>,
      );
    }
    const pts: [string, number, number][] = [
      ['nw', one.x, one.y], ['n', one.x + one.w / 2, one.y], ['ne', one.x + one.w, one.y], ['e', one.x + one.w, one.y + one.h / 2],
      ['se', one.x + one.w, one.y + one.h], ['s', one.x + one.w / 2, one.y + one.h], ['sw', one.x, one.y + one.h], ['w', one.x, one.y + one.h / 2],
    ];
    for (const [dir, x, y] of pts)
      own.push(<rect key={dir} data-resize={dir} className={`dg-handle r-${dir}`} x={x - 4.5 * px} y={y - 4.5 * px} width={9 * px} height={9 * px} strokeWidth={px} />);
    // The yellow handle of a rounded rectangle: dragged along the top edge, it sets the rounding.
    if (CORNERED.has(one.kind) && !one.nodes) {
      const r = Math.min(cornerRadius(one), one.w / 2, one.h / 2);
      const hx = one.x + Math.max(r, 0);
      const hy = one.y - 0;
      own.push(
        <path
          key="radius"
          data-radius={one.id}
          className="dg-radius"
          d={`M${hx} ${hy - 5 * px}l${5 * px} ${5 * px}l${-5 * px} ${5 * px}l${-5 * px} ${-5 * px}Z`}
          strokeWidth={px}
        >
          <title>{tr('끌어서 모서리 둥글기 조절', 'Drag to set the corner rounding')}</title>
        </path>,
      );
    }
    handles.push(
      <g key="own" transform={rotTransform(one)}>
        {own}
      </g>,
    );
  }
  for (const l of selLines) {
    const pts = routePoints(d, l);
    const a = pts[0];
    const b = pts[pts.length - 1];
    handles.push(<circle key={l.id + 'a'} data-end={`${l.id}:a`} className="dg-end" cx={a.x} cy={a.y} r={5 * px} strokeWidth={1.5 * px} />);
    handles.push(<circle key={l.id + 'b'} data-end={`${l.id}:b`} className="dg-end" cx={b.x} cy={b.y} r={5 * px} strokeWidth={1.5 * px} />);
  }
  // Connection dots of the shape pointed at (or the one a line is being dragged onto).
  const dotsFor = drag && (drag.kind === 'line' || drag.kind === 'end') ? snap?.shape : hover;
  const dotShape = shapeById(dotsFor);
  const dots =
    dotShape && !pointEdit
      ? SIDES.map((side) => {
          const q = drag ? sitePoint(dotShape, side) : dotAt(dotShape, side);
          const on = snap?.shape === dotShape.id && snap.side === side;
          return <circle key={side} data-site={`${dotShape.id}:${side}`} className={on ? 'dg-site on' : 'dg-site'} cx={q.x} cy={q.y} r={(on ? 6 : 4.5) * px} strokeWidth={1.5 * px} />;
        })
      : null;
  // The line being drawn.
  let preview: ReactNode = null;
  if (drag?.kind === 'line') {
    const tmp: Diagram = { shapes: d.shapes, lines: [] };
    const b = endFor(drag.to, drag.from.shape, drag.straight ? endPoint(d, drag.from) : undefined);
    const l: DLine = { id: 'preview', a: drag.from, b, route: drag.straight ? 'straight' : 'elbow', color: look.line, arrow: 'end' };
    tmp.lines = [l];
    const pts = routePoints(tmp, l);
    preview = <polyline className="dg-preview" points={pts.map((q) => `${q.x},${q.y}`).join(' ')} strokeWidth={1.6 * px} />;
  }
  if (spline?.length) {
    const pts = pointer ? [...spline, pointer] : spline;
    const sh = pts.length >= 2 ? splineShape(pts, false, pointer ? [...splineSharp, ctrlHeld] : splineSharp) : null;
    const tmp: DShape | null = sh ? { id: 'spline', kind: 'curve', ...sh, open: true, fill: 'none', stroke: look.stroke } : null;
    preview = (
      <g pointerEvents="none">
        {tmp && <path d={shapePath(tmp)} className="dg-spline" strokeWidth={1.8 * px} />}
        {spline.map((q, i) => (
          <circle key={i} cx={q.x} cy={q.y} r={(i === 0 && spline.length >= 3 ? 6 : 3.5) * px} className={i === 0 && spline.length >= 3 ? 'dg-spline-start' : 'dg-spline-dot'} strokeWidth={1.2 * px} />
        ))}
      </g>
    );
  }
  /** A shape of the tool's kind, as it would be put in that box (for showing before it is). */
  const ghost = (kind: ShapeKind, box: { x: number; y: number; w: number; h: number }, faint: boolean): ReactNode => {
    const tmp: DShape = { id: 'ghost', kind, ...box, r: CORNERED.has(kind) ? DEFAULT_RADIUS : undefined, fill: look.fill, stroke: look.stroke };
    if (kind === 'text') return <rect className="dg-preview" x={box.x} y={box.y} width={box.w} height={box.h} strokeWidth={px} />;
    return <path className={faint ? 'dg-ghost faint' : 'dg-ghost'} d={shapePath(tmp)} fill={look.fill === 'transparent' ? 'none' : look.fill} stroke={look.stroke} strokeWidth={1} />;
  };
  if (drag?.kind === 'pen') {
    const hl = penOpts.mode === 'hl';
    preview = (
      <polyline
        className="dg-pen"
        points={drag.pts.map((q) => `${q.x},${q.y}`).join(' ')}
        stroke={penOpts.color}
        strokeWidth={hl ? penOpts.size * 4 : penOpts.size}
        opacity={hl ? 0.4 : 1}
      />
    );
  }
  if (tool === 'pen' && penOpts.mode === 'eraser' && pointer) {
    // The eraser: a ring as big as what it rubs out.
    preview = <circle className="dg-eraser" cx={pointer.x} cy={pointer.y} r={eraserR()} strokeWidth={px} />;
  }
  if (drag?.kind === 'marquee') {
    const x = Math.min(drag.from.x, drag.to.x);
    const y = Math.min(drag.from.y, drag.to.y);
    preview = <rect className="dg-marquee" x={x} y={y} width={Math.abs(drag.to.x - drag.from.x)} height={Math.abs(drag.to.y - drag.from.y)} strokeWidth={px} />;
  }
  if (drag?.kind === 'create') {
    const w = Math.abs(drag.to.x - drag.from.x);
    const h = Math.abs(drag.to.y - drag.from.y);
    const [dw, dh] = SHAPE_TOOLS.find((t) => t.kind === drag.tool)!.size;
    const box = w * view.z < 8 && h * view.z < 8 ? { x: drag.from.x - dw / 2, y: drag.from.y - dh / 2, w: dw, h: dh } : { x: Math.min(drag.from.x, drag.to.x), y: Math.min(drag.from.y, drag.to.y), w: Math.max(16, w), h: Math.max(12, h) };
    preview = ghost(drag.tool, box, false);
  } else if (!drag && pointer && tool !== 'select' && tool !== 'line' && tool !== 'spline' && tool !== 'pen') {
    // Before the click: the shape faintly under the pointer, at the size a click gives it.
    const [dw, dh] = SHAPE_TOOLS.find((t) => t.kind === tool)!.size;
    preview = <g pointerEvents="none">{ghost(tool, { x: pointer.x - dw / 2, y: pointer.y - dh / 2, w: dw, h: dh }, true)}</g>;
  }
  // Points of the shape being point-edited, and the handles of the picked point.
  let points: ReactNode = null;
  const pe = shapeById(pointEdit);
  if (pe) {
    const nodes = nodesOf(pe);
    points = (
      <g transform={rotTransform(pe)}>
        <path d={shapePath(pe)} className="dg-pe-outline" strokeWidth={1.5 * px} />
        {/* where a drag adds a point: the pointer shows it */}
        <path d={shapePath(pe)} className="dg-pe-hit" strokeWidth={14 * px} data-pe-hit />
        {selNode !== null &&
          nodes[selNode] &&
          (() => {
            const pl = nodePlace(pe, nodes[selNode]);
            return (['hin', 'hout'] as const).map((w) =>
              pl[w] ? (
                <g key={w}>
                  <line x1={pl.at.x} y1={pl.at.y} x2={pl[w]!.x} y2={pl[w]!.y} className="dg-hline" strokeWidth={px} />
                  <circle data-handle={w} cx={pl[w]!.x} cy={pl[w]!.y} r={4.5 * px} className="dg-hdot" strokeWidth={px} />
                </g>
              ) : null,
            );
          })()}
        {nodes.map((n, i) => {
          const q = nodePlace(pe, n).at;
          return <rect key={i} data-node={i} className={i === selNode ? 'dg-node on' : 'dg-node'} x={q.x - 4.5 * px} y={q.y - 4.5 * px} width={9 * px} height={9 * px} strokeWidth={px} />;
        })}
      </g>
    );
  }

  // The box for typing in a shape.
  const te = shapeById(textEdit);
  const textBox: CSSProperties | undefined = te
    ? {
        left: (te.x - view.x) * view.z,
        top: (te.y - view.y) * view.z,
        width: Math.max(60, te.w) * view.z,
        height: Math.max(24, te.h) * view.z,
        alignItems: { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[te.valign ?? 'middle'],
        transform: te.rot ? `rotate(${te.rot}deg)` : undefined,
      }
    : undefined;
  /** The typing box grows with its lines, so it sits where the words will (in the middle by default). */
  const fitText = (t: HTMLTextAreaElement | null) => {
    if (!t) return;
    t.style.height = 'auto';
    t.style.height = Math.min(t.scrollHeight, t.parentElement?.clientHeight ?? t.scrollHeight) + 'px';
  };

  /** A width typed or stepped (0.5 at a time), in px. */
  const widthInput = (attr: string, value: number, min: number, set: (w: number) => void) => (
    <label className="dg-width">
      <input
        type="number"
        min={min}
        max={40}
        step={0.5}
        value={Math.round(value * 100) / 100}
        {...{ [attr]: '' }}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (e.target.value !== '' && v >= min && v <= 40) set(v);
        }}
      />
      <span>px</span>
    </label>
  );
  /** The width of a border or a line, in its colour bubble: named as the sliders are. */
  const widthRow = (attr: string, value: number, min: number, set: (w: number) => void) => (
    <div className="dg-width-row">
      <span className="dg-label">{tr('두께', 'Width')}</span>
      {widthInput(attr, value, min, set)}
    </div>
  );
  const swatch = (c: string) => <span className="dg-swatch" style={c === 'transparent' ? undefined : { background: c }} data-none={c === 'transparent' || undefined} />;
  /** The colour pickers open in a bubble to the right of the panel, beside their button. */
  const pickers = useRef<Record<string, { value: string; set: (c: string) => void; allowNone: boolean }>>({});
  const pickerFor = (which: 'fill' | 'stroke' | 'text' | 'line', value: string, set: (c: string) => void, allowNone = false) => {
    pickers.current[which] = { value, set, allowNone };
    return (
      <button
        className={picker === which ? 'dg-colour on' : 'dg-colour'}
        data-prop={which}
        onClick={(e) => {
          if (picker === which) return setPicker(null);
          const stage = stageRef.current!.getBoundingClientRect();
          const b = e.currentTarget.getBoundingClientRect();
          const panelBox = e.currentTarget.closest('.dg-panel')!.getBoundingClientRect();
          setPickerAt({ left: panelBox.right - stage.left + 12, top: Math.max(8, Math.min(stage.height - 330, b.top - stage.top - 10)) });
          setPicker(which);
        }}
      >
        {swatch(value)}
        <span>{{ fill: tr('채우기', 'Fill'), stroke: tr('테두리', 'Border'), text: tr('글자', 'Text'), line: tr('선 색', 'Line') }[which]}</span>
      </button>
    );
  };

  const firstShape = selShapes[0];
  const firstLine = selLines[0];
  /** A transparency slider (0% solid … 100% gone) for one part. */
  const seeThrough = (name: string, label: string, value: number | undefined, set: (v: number) => void) => (
    <Slider name={name} label={label} value={Math.round((1 - (value ?? 1)) * 100)} min={0} max={100} unit="%" onChange={(v) => set(1 - v / 100)} />
  );
  /** Solid colour or gradient (fills and lines). */
  const solidOrGrad = (attr: string, isGrad: boolean, solid: () => void, grad: () => void) => (
    <div className="dg-seg dg-paint-kind">
      <button className={!isGrad ? 'on' : ''} {...{ [attr]: 'solid' }} onClick={solid}>
        {tr('단색', 'Solid')}
      </button>
      <button className={isGrad ? 'on' : ''} {...{ [attr]: 'gradient' }} onClick={grad}>
        {tr('그라데이션', 'Gradient')}
      </button>
    </div>
  );
  /** What a colour button's bubble holds. */
  const popBody = (which: string) => {
    const pk = pickers.current[which];
    const colour = <ColorPicker value={pk.value} allowNone={pk.allowNone} onChange={(c) => pickers.current[which]?.set(c)} />;
    if (which === 'fill' && firstShape) {
      const canGrad = firstShape.kind !== 'text' && firstShape.kind !== 'image' && !firstShape.open;
      return (
        <>
          {canGrad &&
            solidOrGrad(
              'data-fill-kind',
              !!firstShape.grad,
              () => setOnSel((s) => delete s.grad),
              () => setOnSel((s) => (s.grad = s.grad ?? defaultGrad(s.fill === 'transparent' ? DEFAULT_FILL : s.fill))),
            )}
          {firstShape.grad && canGrad ? <GradEditor value={firstShape.grad} onChange={(g) => setOnSel((s) => (s.grad = JSON.parse(JSON.stringify(g))), 'grad')} /> : colour}
          {seeThrough('fill-transparency', tr('투명도', 'Transparency'), firstShape.fillOpacity, (v) => setOnSel((s) => (v < 1 ? (s.fillOpacity = v) : delete s.fillOpacity), 'fill-opacity'))}
        </>
      );
    }
    if (which === 'stroke' && firstShape)
      return (
        <>
          {colour}
          {widthRow('data-border-w-input', firstShape.strokeW ?? 1, 0, (w) => setOnSel((s) => (s.strokeW = w), 'border-w'))}
          {seeThrough('stroke-transparency', tr('투명도', 'Transparency'), firstShape.strokeOpacity, (v) => setOnSel((s) => (v < 1 ? (s.strokeOpacity = v) : delete s.strokeOpacity), 'stroke-opacity'))}
        </>
      );
    if (which === 'text' && firstShape)
      return (
        <>
          {colour}
          {seeThrough('text-transparency', tr('투명도', 'Transparency'), firstShape.textOpacity, (v) => setOnSel((s) => (v < 1 ? (s.textOpacity = v) : delete s.textOpacity), 'text-opacity'))}
        </>
      );
    if (which === 'line' && firstLine)
      return (
        <>
          {solidOrGrad(
            'data-line-kind',
            !!firstLine.grad,
            () => setOnLines((l) => delete l.grad),
            () => setOnLines((l) => (l.grad = l.grad ?? defaultGrad(l.color))),
          )}
          {firstLine.grad ? <GradEditor value={firstLine.grad} onChange={(g) => setOnLines((l) => (l.grad = JSON.parse(JSON.stringify(g))), 'line-grad')} /> : colour}
          {widthRow('data-line-w-input', firstLine.width ?? 1.6, 0.25, (w) => setOnLines((l) => (l.width = w), 'line-w'))}
          {seeThrough('line-transparency', tr('투명도', 'Transparency'), firstLine.opacity, (v) => setOnLines((l) => (v < 1 ? (l.opacity = v) : delete l.opacity), 'line-opacity'))}
        </>
      );
    return colour;
  };
  const panel = sel.length && (panelOpen || panelClosing) ? (
    <div className="dg-panel" data-dg-panel={panelOpen ? '' : undefined} onPointerDown={(e) => e.stopPropagation()}>
      {firstShape && (
        <>
          <div className="dg-colours">
            {firstShape.kind !== 'text' &&
              pickerFor('fill', firstShape.fill, (c) => (setOnSel((s) => (s.fill = c), 'fill'), setLook((l) => ({ ...l, fill: c }))), true)}
            {firstShape.kind !== 'text' &&
              pickerFor('stroke', firstShape.stroke, (c) => (setOnSel((s) => (s.stroke = c), 'stroke'), setLook((l) => ({ ...l, stroke: c }))), true)}
            {pickerFor('text', firstShape.textColor ?? '#1e1e1e', (c) => setOnSel((s) => (s.textColor = c), 'text-colour'))}
          </div>
          <div className="dg-prop" data-dg-text>
            <span className="dg-label">{tr('글자', 'Text')}</span>
            <div className="dg-row">
              <div className="dg-seg dg-font">
                <button title={tr('글자 작게', 'Smaller text')} data-font="down" onClick={() => setOnSel((s) => (s.fontSize = Math.max(8, (s.fontSize ?? 14) - 1)), 'font')}>
                  A−
                </button>
                <input
                  className="dg-font-size"
                  data-font-size
                  type="number"
                  min={6}
                  max={96}
                  value={firstShape.fontSize ?? 14}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (v >= 6 && v <= 96) setOnSel((s) => (s.fontSize = v), 'font');
                  }}
                />
                <button title={tr('글자 크게', 'Larger text')} data-font="up" onClick={() => setOnSel((s) => (s.fontSize = Math.min(96, (s.fontSize ?? 14) + 1)), 'font')}>
                  A+
                </button>
              </div>
            </div>
            <div className="dg-seg dg-talign">
              {(
                [
                  ['left', 'M4 6h16M4 10h10M4 14h16M4 18h10', tr('왼쪽 정렬', 'Left')],
                  ['center', 'M4 6h16M7 10h10M4 14h16M7 18h10', tr('가운데 정렬', 'Centre')],
                  ['right', 'M4 6h16M10 10h10M4 14h16M10 18h10', tr('오른쪽 정렬', 'Right')],
                ] as const
              ).map(([a, path, name]) => (
                <button key={a} title={name} data-text-align={a} className={(firstShape.align ?? 'center') === a ? 'on' : ''} onClick={() => setOnSel((s) => (s.align = a))}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden>
                    <path d={path} />
                  </svg>
                </button>
              ))}
              {(
                [
                  ['top', 'M4 4h16M9 8h6v12H9z', tr('위쪽 정렬', 'Top')],
                  ['middle', 'M4 12h4M16 12h4M8 6h8v12H8z', tr('가운데(세로) 정렬', 'Middle')],
                  ['bottom', 'M4 20h16M9 4h6v12H9z', tr('아래쪽 정렬', 'Bottom')],
                ] as const
              ).map(([a, path, name]) => (
                <button key={a} title={name} data-text-valign={a} className={(firstShape.valign ?? 'middle') === a ? 'on' : ''} onClick={() => setOnSel((s) => (s.valign = a))}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" aria-hidden>
                    <path d={path} />
                  </svg>
                </button>
              ))}
            </div>
          </div>
          {selShapes.some((s) => CORNERED.has(s.kind) && !s.nodes) && (
            <div className="dg-prop">
              <span className="dg-label">{tr('모서리', 'Corners')}</span>
              <div className="dg-seg">
                <button data-corner="round" className={cornerRadius(firstShape) > 0 ? 'on' : ''} onClick={() => setOnSel((s) => CORNERED.has(s.kind) && ((s.sharp = false), (s.r = s.r || DEFAULT_RADIUS)))}>
                  {tr('둥글게', 'Round')}
                </button>
                <button data-corner="sharp" className={cornerRadius(firstShape) === 0 ? 'on' : ''} onClick={() => setOnSel((s) => CORNERED.has(s.kind) && (s.sharp = true))}>
                  {tr('각지게', 'Square')}
                </button>
              </div>
            </div>
          )}
          {selShapes.length >= 2 && (
            <div className="dg-prop" data-dg-align>
              <span className="dg-label">{tr('맞춤 (Shift+L C R T M B · H V)', 'Align (Shift+L C R T M B · H V)')}</span>
              <div className="dg-seg dg-align">
                {(
                  [
                    ['left', 'M4 3v18M7 6h12v4.5H7zM7 13.5h7V18H7z', tr('왼쪽 맞춤', 'Left')],
                    ['center', 'M12 3v18M5 6h14v4.5H5zM8 13.5h8V18H8z', tr('가운데 맞춤', 'Centre')],
                    ['right', 'M20 3v18M5 6h12v4.5H5zM10 13.5h7V18h-7z', tr('오른쪽 맞춤', 'Right')],
                    ['top', 'M3 4h18M6 7h4.5v12H6zM13.5 7H18v7h-4.5z', tr('위쪽 맞춤', 'Top')],
                    ['middle', 'M3 12h18M6 5h4.5v14H6zM13.5 8H18v8h-4.5z', tr('중간 맞춤', 'Middle')],
                    ['bottom', 'M3 20h18M6 5h4.5v12H6zM13.5 10H18v7h-4.5z', tr('아래쪽 맞춤', 'Bottom')],
                    ['hspace', 'M3.5 4v16M20.5 4v16M9.75 7h4.5v10h-4.5z', tr('가로 간격 동일 (3개 이상)', 'Same gaps across (3+)')],
                    ['vspace', 'M4 3.5h16M4 20.5h16M7 9.75h10v4.5H7z', tr('세로 간격 동일 (3개 이상)', 'Same gaps down (3+)')],
                  ] as [AlignKind, string, string][]
                ).map(([k, path, name]) => (
                  <button key={k} title={name} data-dg-align={k} disabled={(k === 'hspace' || k === 'vspace') && selShapes.length < 3} onClick={() => alignSel(k)}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" aria-hidden>
                      <path d={path} />
                    </svg>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="dg-prop">
            <span className="dg-label">{tr('순서', 'Order')}</span>
            <div className="dg-seg dg-order">
              {(
                [
                  ['front', () => reorder(true), tr('맨 앞으로', 'Bring to front')],
                  ['forward', () => stepOrder(true), tr('앞으로 한 칸', 'Bring forward')],
                  ['backward', () => stepOrder(false), tr('뒤로 한 칸', 'Send backward')],
                  ['back', () => reorder(false), tr('맨 뒤로', 'Send to back')],
                ] as [string, () => void, string][]
              ).map(([k, act, name]) => (
                <button key={k} data-order={k} title={name} aria-label={name} onClick={act}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d={MENU_ICONS[k]} />
                  </svg>
                </button>
              ))}
            </div>
          </div>
          <Fold name="size" title={tr('크기 (가로 · 세로 · 회전)', 'Size (width · height · turn)')}>
          <div data-dg-size>
            <div className="dg-row dg-size">
              {(['w', 'h'] as const).map((k) => (
                <label key={k} className="dg-size-field">
                  <span>{k === 'w' ? tr('가로', 'W') : tr('세로', 'H')}</span>
                  <input
                    type="number"
                    min={4}
                    data-size-input={k}
                    value={Math.round(firstShape[k])}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (!(v >= 4)) return;
                      // The shape keeps its middle when turned, its top left corner otherwise.
                      setOnSel((x) => {
                        if (x.rot) {
                          const c = { x: x.x + x.w / 2, y: x.y + x.h / 2 };
                          x[k] = v;
                          x.x = c.x - x.w / 2;
                          x.y = c.y - x.h / 2;
                        } else x[k] = v;
                      }, 'size-' + k);
                    }}
                  />
                </label>
              ))}
            </div>
          </div>
          <Slider name="shape-rotation" label={tr('회전', 'Turn')} value={firstShape.rot ?? 0} min={0} max={359} unit="°" onChange={(v) => setOnSel((s) => (v ? (s.rot = v) : delete s.rot), 'rot')} />
          </Fold>
          {firstShape.kind !== 'text' && <ShadowEditor value={firstShape.shadow} onChange={(sh) => setOnSel((s) => (sh ? (s.shadow = { ...sh }) : delete s.shadow), 'shadow')} />}
        </>
      )}
      {firstLine && (
        <>
          {pickerFor('line', firstLine.color, (c) => (setOnLines((l) => (l.color = c)), setLook((x) => ({ ...x, line: c }))))}
          <div className="dg-prop">
            <span className="dg-label">{tr('선 모양', 'Route')}</span>
            <div className="dg-seg">
              <button data-route="elbow" className={firstLine.route === 'elbow' ? 'on' : ''} onClick={() => setOnLines((l) => (l.route = 'elbow'))}>
                {tr('꺾은선', 'Elbow')}
              </button>
              <button data-route="straight" className={firstLine.route === 'straight' ? 'on' : ''} onClick={() => setOnLines((l) => (l.route = 'straight'))}>
                {tr('직선', 'Straight')}
              </button>
            </div>
          </div>
          <div className="dg-prop">
            <span className="dg-label">{tr('화살표', 'Arrows')}</span>
            <div className="dg-seg">
              {(['none', 'end', 'both'] as const).map((a) => (
                <button key={a} className={firstLine.arrow === a ? 'on' : ''} onClick={() => setOnLines((l) => (l.arrow = a))}>
                  {{ none: tr('없음', 'None'), end: '→', both: '↔' }[a]}
                </button>
              ))}
            </div>
          </div>
          {firstLine.arrow !== 'none' && (
            <div className="dg-prop">
              <span className="dg-label">{tr('화살표 머리', 'Arrow head')}</span>
              <div className="dg-seg dg-heads">
                {(['triangle', 'open', 'diamond', 'circle', 'bar'] as HeadKind[]).map((h) => (
                  <button
                    key={h}
                    data-head={h}
                    title={{ triangle: tr('삼각형', 'Triangle'), open: tr('열린 화살표', 'Open'), diamond: tr('마름모', 'Diamond'), circle: tr('원', 'Circle'), bar: tr('막대', 'Bar') }[h]}
                    className={(firstLine.head ?? 'triangle') === h ? 'on' : ''}
                    onClick={() => setOnLines((l) => (l.head = h))}
                  >
                    <svg width="22" height="12" viewBox="0 0 22 12" aria-hidden>
                      <path d="M1 6h13" stroke="currentColor" strokeWidth="1.4" />
                      {h === 'triangle' && <path d="M21 6l-8-4.5v9z" fill="currentColor" />}
                      {h === 'open' && <path d="M13 1.5L21 6l-8 4.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />}
                      {h === 'diamond' && <path d="M21 6l-4-3.5-4 3.5 4 3.5z" fill="currentColor" />}
                      {h === 'circle' && <circle cx="17" cy="6" r="3.6" fill="currentColor" />}
                      {h === 'bar' && <path d="M20 1v10" stroke="currentColor" strokeWidth="1.8" />}
                    </svg>
                  </button>
                ))}
              </div>
            </div>
          )}
          <ShadowEditor value={firstLine.shadow} onChange={(sh) => setOnLines((l) => (sh ? (l.shadow = { ...sh }) : delete l.shadow), 'line-shadow')} />
        </>
      )}
      <button className="dg-delete" onClick={removeSel}>
        {tr('삭제', 'Delete')}
      </button>
    </div>
  ) : null;

  const shapeProps = useMemo(() => (s: DShape) => ({ className: 'dg-shape', 'data-shape': s.id, 'data-box': `${s.x},${s.y},${s.w},${s.h}` }), []);
  const lineProps = useMemo(() => (id: string) => ({ className: 'dg-line', 'data-line': id }), []);

  return createPortal(
    <div className="gate-backdrop soft dg-backdrop" onPointerDown={(e) => e.target === e.currentTarget && setMenu(null)}>
      <div className="dg-dialog" role="dialog" aria-modal="true" aria-label={tr('블록선도', 'Block diagram')} data-diagram-editor>
        <div className="dg-bar" role="toolbar">
          <button className={tool === 'select' ? 'on' : ''} data-dg-tool="select" title={tr('선택 (V)', 'Select (V)')} onClick={() => setTool('select')}>
            {ICON('select')}
          </button>
          <span className="dg-sep" />
          {SHAPE_TOOLS.map((t) => (
            <button
              key={t.kind}
              className={tool === t.kind ? 'on' : ''}
              data-dg-tool={t.kind}
              title={`${tr(t.ko, t.en)} (${t.key}) · ${tr('클릭하면 가운데에, 화면에서 끌면 그 크기로', 'click: in the middle; drag on the drawing: that size')}`}
              onClick={() => (tool === t.kind ? addShape(t.kind) : setTool(t.kind))}
              onDoubleClick={() => addShape(t.kind)}
            >
              {ICON(t.kind)}
            </button>
          ))}
          <span className="dg-sep" />
          <button className={tool === 'line' ? 'on' : ''} data-dg-tool="line" title={tr('연결선 (A) · 끌어서 그리기, Shift: 직선', 'Connector (A) · drag to draw, Shift: straight')} onClick={() => setTool('line')}>
            {ICON('line')}
          </button>
          <button className={tool === 'pen' ? 'on' : ''} data-dg-tool="pen" title={tr('그리기 (F) · 마우스로 자유롭게 그리기', 'Draw (F) · draw freely with the mouse')} onClick={() => setTool('pen')}>
            {ICON('pen')}
          </button>
          <button
            className={tool === 'spline' ? 'on' : ''}
            data-dg-tool="spline"
            title={tr('곡선 (S) · 클릭할 때마다 점 · 시작점을 누르면 채운 도형, 마지막 점을 다시 누르거나 Enter면 끝', 'Spline (S) · a point per click · the first point again: a filled shape; the last one again or Enter: done')}
            onClick={() => (setSpline(null), setTool('spline'))}
          >
            {ICON('spline')}
          </button>
          <span className="dg-sep" />
          <button title={tr('실행 취소 (Ctrl+Z)', 'Undo (Ctrl+Z)')} onClick={() => undo(true)}>
            ↶
          </button>
          <button title={tr('다시 실행 (Ctrl+Shift+Z)', 'Redo (Ctrl+Shift+Z)')} onClick={() => undo(false)}>
            ↷
          </button>
          <button title={tr('전체 보기 (Shift+1)', 'Fit all (Shift+1)')} data-dg-fit onClick={() => fitAll()}>
            <Icon name="fit" size={17} />
          </button>
          <span className="dg-hint">
            {tool === 'spline'
              ? tr('곡선: 클릭으로 점 찍기 · 시작점 클릭: 채운 도형 · 마지막 점 다시 클릭(또는 Enter·Esc): 끝', 'Spline: click to add points · the first point: a filled shape · the last point again (or Enter / Esc): done')
              : pointEdit
              ? tr('점 편집: 점을 끌어 모양 바꾸기 · 선 위를 끌면 점 추가 · 점 오른쪽 클릭: 점 종류 · Esc: 끝내기', 'Edit points: drag a point · drag the outline to add one · right-click a point for its kind · Esc: done')
              : tr('도형 옆의 점을 끌어 연결 · 더블클릭: 글자 · 오른쪽 클릭: 점 편집', 'Drag a dot on a shape to connect · double-click: text · right-click: edit points')}
          </span>
          <span className="dg-grow" />
          <button className="dg-cancel" onClick={leave}>
            {tr('취소', 'Cancel')}
          </button>
          <button className="dg-done" data-dg-done onClick={finish} title="Ctrl+Enter">
            {tr('완료', 'Done')}
          </button>
        </div>
        <div
          className="dg-stage"
          ref={stageRef}
          data-dots={view.z < DIAGRAM_DOTS_MIN_ZOOM ? 'off' : 'on'}
          style={{
            backgroundPosition: `${-view.x * view.z}px ${-view.y * view.z}px`,
            backgroundSize: `${20 * view.z}px ${20 * view.z}px`,
            // Far out, the dots only crowd together into noise: none then (as on the board).
            backgroundImage: view.z < DIAGRAM_DOTS_MIN_ZOOM ? 'none' : undefined,
          }}
        >
          <svg
            ref={svgRef}
            className={['dg-svg', `tool-${tool}`, drag?.kind === 'pan' && 'panning', pointEdit && 'pointing'].filter(Boolean).join(' ')}
            width={size.w}
            height={size.h}
            viewBox={`${view.x} ${view.y} ${size.w / view.z} ${size.h / view.z}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={() => !drag && (setHover(null), setPointer(null))}
            onDoubleClick={onDoubleClick}
            onContextMenu={onContextMenu}
          >
            <DiagramParts d={d} editingText={textEdit} shapeProps={shapeProps} lineProps={lineProps} />
            {handles}
            {guides.x.map((g, i) => (
              <line key={'gx' + i} className="dg-guide" x1={g.at} x2={g.at} y1={g.from} y2={g.to} strokeWidth={1 / view.z} />
            ))}
            {guides.y.map((g, i) => (
              <line key={'gy' + i} className="dg-guide" y1={g.at} y2={g.at} x1={g.from} x2={g.to} strokeWidth={1 / view.z} />
            ))}
            {dots}
            {points}
            {preview}
          </svg>
          {te && textBox && (
            <div className={te.kind === 'text' ? 'dg-text-box plain' : 'dg-text-box'} style={textBox}>
              <textarea
                ref={(t) => {
                  textRef.current = t;
                  fitText(t);
                }}
                className="dg-text-edit"
                rows={1}
                style={{ fontSize: (te.fontSize ?? 14) * view.z, color: te.textColor ?? '#1e1e1e', textAlign: te.align ?? 'center' }}
                defaultValue={te.text ?? ''}
                placeholder={tr('글자 입력 (Esc: 끝)', 'Type (Esc: done)')}
                onInput={(e) => fitText(e.currentTarget)}
                onBlur={commitText}
              />
            </div>
          )}
          {/*
           * The settings: a button at the drawing's top left that grows into the panel when pressed
           * (and folds back into the button when pressed again).
           */}
          <div
            className={['dg-panel-wrap', panelOpen && sel.length > 0 && 'open', panelClosing && sel.length > 0 && 'closing'].filter(Boolean).join(' ')}
            data-dg-panel-wrap
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button
              className={panelOpen ? 'dg-panel-btn on' : 'dg-panel-btn'}
              data-dg-panel-toggle
              aria-pressed={panelOpen}
              aria-expanded={panelOpen}
              title={panelOpen ? tr('설정 패널 닫기 (I)', 'Hide the settings (I)') : tr('설정 패널 열기 (I) · 고른 도형·선의 색, 글자, 그림자 …', 'Show the settings (I) · colours, text, shadow … of what is picked')}
              onClick={() => setPanelOpen(!panelOpen)}
            >
              <Icon name="settings" size={18} />
              {(panelOpen || panelClosing) && sel.length > 0 && (
                <span className="dg-panel-x" aria-hidden>
                  <Icon name="close" size={14} />
                </span>
              )}
            </button>
            {panel}
          </div>
          {tool === 'pen' && (
            <div className="dg-penbar" data-dg-penbar onPointerDown={(e) => e.stopPropagation()}>
              {(
                [
                  ['pen', tr('펜', 'Pen'), 'M4 20l1.2-4.4L16.5 4.3a2 2 0 012.8 0l.4.4a2 2 0 010 2.8L8.4 18.8z'],
                  ['hl', tr('형광펜', 'Highlighter'), 'M9 14l-5 6h6l2-2M9 14l7-10 4 3-7 10zM9 14l4 3'],
                  ['eraser', tr('지우개 (그린 선만 지움)', 'Eraser (drawn strokes only)'), 'M8 20h12M4.5 15.5l9-9a2 2 0 012.8 0l2.2 2.2a2 2 0 010 2.8L11 19H8z'],
                ] as const
              ).map(([m, name, path]) => (
                <button
                  key={m}
                  className={penOpts.mode === m ? 'on' : ''}
                  data-pen-mode={m}
                  title={name}
                  onClick={() => setPenOpts((o) => ({ ...o, mode: m, color: m === 'hl' && o.color === '#1e1e1e' ? '#ffd43b' : m === 'pen' && o.color === '#ffd43b' ? '#1e1e1e' : o.color }))}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d={path} />
                  </svg>
                </button>
              ))}
              <span className="dg-sep" />
              {['#1e1e1e', '#e03131', '#f08c00', '#ffd43b', '#2f9e44', '#1971c2', '#7048e8', '#868e96'].map((c) => (
                <button key={c} className={penOpts.color === c ? 'dg-pen-dot on' : 'dg-pen-dot'} data-pen-color={c} style={{ background: c }} title={c} onClick={() => setPenOpts((o) => ({ ...o, color: c, mode: o.mode === 'eraser' ? 'pen' : o.mode }))} />
              ))}
              <button className={penColour ? 'dg-pen-more on' : 'dg-pen-more'} title={tr('다른 색', 'More colours')} data-pen-more onClick={() => setPenColour(!penColour)}>
                +
              </button>
              <span className="dg-sep" />
              {[1, 2, 4, 8].map((w) => (
                <button key={w} className={penOpts.size === w ? 'dg-pen-size on' : 'dg-pen-size'} data-pen-size={w} title={tr(`굵기 ${w}`, `Size ${w}`)} onClick={() => setPenOpts((o) => ({ ...o, size: w }))}>
                  <span style={{ width: w + 3, height: w + 3 }} />
                </button>
              ))}
              {penColour && (
                <div className="dg-pen-picker">
                  <ColorPicker value={penOpts.color} onChange={(c) => setPenOpts((o) => ({ ...o, color: c, mode: o.mode === 'eraser' ? 'pen' : o.mode }))} />
                </div>
              )}
            </div>
          )}
          {picker && panelOpen && pickers.current[picker] && sel.length > 0 && (
            <div className="dg-pop" data-dg-pop style={{ left: pickerAt.left, top: pickerAt.top, maxHeight: `calc(100% - ${pickerAt.top + 8}px)` }} onPointerDown={(e) => e.stopPropagation()}>
              {popBody(picker)}
            </div>
          )}
          {mathEdit && <MathEditor initial={mathEdit.tex} onInsert={(tex) => putMath(tex)} onDelete={() => putMath(null)} onClose={() => putMath(undefined)} />}
          {asking && (
            <div className="dg-ask-back" onPointerDown={(e) => e.stopPropagation()}>
              <div className="dg-ask" role="alertdialog" aria-label={tr('편집 끝내기', 'Leave editing')} data-dg-ask>
                <div className="dg-ask-title">{tr('바꾼 내용이 있습니다. 변경하지 말까요?', 'There are changes. Leave them out?')}</div>
                <div className="dg-ask-sub">{tr('저장하지 않으면 이번에 바꾼 내용은 사라집니다.', 'Without saving, the changes made now are lost.')}</div>
                <div className="dg-ask-buttons">
                  <button className={askAt === 0 ? 'dg-ask-discard picked' : 'dg-ask-discard'} data-dg-discard onClick={onCancel}>
                    {tr('변경하지 않고 닫기', 'Close without changes')}
                  </button>
                  <button className={askAt === 1 ? 'picked' : undefined} data-dg-keep-editing onClick={() => setAsking(false)}>
                    {tr('계속 편집 (Esc)', 'Keep editing (Esc)')}
                  </button>
                  <button className={askAt === 2 ? 'primary picked' : 'primary'} data-dg-save onClick={finish}>
                    {tr('저장하고 닫기 (Enter)', 'Save and close (Enter)')}
                  </button>
                </div>
              </div>
            </div>
          )}
          {!d.shapes.length && !drag && (
            <div className="dg-empty-hint">{tr('위 막대에서 도형을 고르세요 (R 사각형, O 타원, D 마름모 …)', 'Pick a shape on the bar above (R rectangle, O ellipse, D diamond …)')}</div>
          )}
        </div>
        {menu && (
          <div className="context-menu dg-menu" role="menu" style={{ left: menu.x, top: menu.y }} onPointerDown={(e) => e.stopPropagation()}>
            {menu.items.map((it, i) => (
              <button
                key={i}
                role="menuitem"
                disabled={it.off}
                className={it.danger ? 'danger' : undefined}
                onClick={() => {
                  setMenu(null);
                  it.act();
                }}
              >
                {it.icon && BOARD_MENU_ICONS[it.icon] ? (
                  <span className="dg-mi">
                    <Icon name={BOARD_MENU_ICONS[it.icon]!} size={15} />
                  </span>
                ) : (
                  <svg className="dg-mi" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    {it.icon && <path d={MENU_ICONS[it.icon]} />}
                  </svg>
                )}
                {it.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
