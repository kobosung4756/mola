/*
 * Block diagrams (the Shape tool): shapes joined by connector lines, drawn in their own editor
 * (DiagramEditor) and shown on the board as one block. This file holds the geometry: outlines,
 * connection sites, line routes (rounded elbows or straight), the hops where lines cross, and the
 * points of an outline edited by hand (as PowerPoint's Edit Points).
 */

export type Pt = { x: number; y: number };

export type ShapeKind = 'rect' | 'ellipse' | 'diamond' | 'parallelogram' | 'trapezoid' | 'triangle' | 'hexagon' | 'text' | 'curve' | 'image';

/** A colour stop of a gradient: where it is (0–1), its colour, how see-through, lighter (+) or darker (−). */
export type GradStop = { pos: number; color: string; opacity: number; bright: number };

/**
 * A gradient fill (a shape) or stroke (a line), as in PowerPoint: linear (at an angle), radial,
 * rectangular, or along the shape's outline (path); the last three grow from the middle or a corner.
 */
export type Grad = { type: 'linear' | 'radial' | 'rect' | 'path'; angle: number; from: 'center' | 'tl' | 'tr' | 'bl' | 'br'; stops: GradStop[] };

/** A shadow: its colour and see-through-ness, size (% of the thing), blur, and where (angle, distance). */
export type Shadow = { color: string; opacity: number; size: number; blur: number; angle: number; distance: number };

/** What shapes and lines both have: how see-through, a shadow, a gradient. */
export type Looks = { opacity?: number; shadow?: Shadow; grad?: Grad };

export const DEFAULT_SHADOW: Shadow = { color: '#000000', opacity: 0.35, size: 100, blur: 6, angle: 45, distance: 4 };

export const defaultGrad = (color: string): Grad => ({
  type: 'linear',
  angle: 90,
  from: 'center',
  stops: [
    { pos: 0, color, opacity: 1, bright: 40 },
    { pos: 1, color, opacity: 1, bright: -10 },
  ],
});

/**
 * A point of an outline edited by hand, in the shape's own box (0–1 across and down). Its handles
 * (where the curve leaves and comes in) are offsets from it in the same units; none means a sharp
 * corner. corner: the two handles move on their own; smooth: in one line, the same length;
 * straight: in one line, each its own length.
 */
export type DNode = { x: number; y: number; kind: 'corner' | 'smooth' | 'straight'; hin?: Pt; hout?: Pt };

export type DShape = Looks & {
  id: string;
  kind: ShapeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Corner rounding of a rectangle (px); 0 or `sharp` for square corners. */
  r?: number;
  sharp?: boolean;
  fill: string;
  stroke: string;
  strokeW?: number;
  text?: string;
  textColor?: string;
  /** How solid the fill, the border and the words are, each on its own (0…1, solid when not set). */
  fillOpacity?: number;
  strokeOpacity?: number;
  textOpacity?: number;
  /** The words' size (px, 14 when not set) and where they sit in the shape (centred when not set). */
  fontSize?: number;
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'middle' | 'bottom';
  /** The outline once its points were edited (replaces the kind's own outline). */
  nodes?: DNode[];
  /** A curve that does not close (drawn with the Spline tool and finished on its last point). */
  open?: boolean;
  /** A pasted picture (data URL). */
  href?: string;
  /** Turned this many degrees (clockwise) about its middle. */
  rot?: number;
  /** A stroke drawn with the pen (the eraser rubs these out). */
  ink?: boolean;
};

export type Side = 'top' | 'right' | 'bottom' | 'left';

/** An end of a line: on a shape's side (it follows the shape), or a free point. */
export type DEnd = { shape?: string; side?: Side; x: number; y: number };

export type DLine = Looks & {
  id: string;
  a: DEnd;
  b: DEnd;
  route: 'elbow' | 'straight';
  color: string;
  width?: number;
  arrow: 'end' | 'both' | 'none';
  /** The arrow heads' shape (a filled triangle when not set). */
  head?: HeadKind;
};

export type HeadKind = 'triangle' | 'open' | 'diamond' | 'circle' | 'bar';

/** A shape's border is thin unless set otherwise. */
export const DEFAULT_STROKE_W = 1;

export type Diagram = { shapes: DShape[]; lines: DLine[] };

export const emptyDiagram = (): Diagram => ({ shapes: [], lines: [] });

export const DEFAULT_FILL = '#e7f0ff';
export const DEFAULT_STROKE = '#1e1e1e';
export const DEFAULT_LINE = '#495057';
export const DEFAULT_RADIUS = 12;

/** Colours offered first, as in Excalidraw: a row of light fills and a row of strong ones. */
export const PALETTE = [
  'transparent', '#ffffff', '#f1f3f5', '#ffe3e3', '#fff3bf', '#d3f9d8', '#e7f0ff', '#f3d9fa',
  '#1e1e1e', '#868e96', '#e03131', '#f08c00', '#2f9e44', '#1971c2', '#7048e8', '#c2255c',
];

const K = 0.5523; // a quarter circle as a cubic curve

const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
const len = (a: Pt) => Math.hypot(a.x, a.y);
const fmt = (n: number) => Math.round(n * 100) / 100;

/** Kinds with corners (they can be rounded). */
export const CORNERED = new Set<ShapeKind>(['rect', 'diamond', 'parallelogram', 'trapezoid', 'triangle', 'hexagon']);

/** The corners of a kind (0–1 in the shape's box). */
function cornersOf(kind: ShapeKind): Pt[] {
  switch (kind) {
    case 'diamond':
      return [{ x: 0.5, y: 0 }, { x: 1, y: 0.5 }, { x: 0.5, y: 1 }, { x: 0, y: 0.5 }];
    case 'parallelogram':
      return [{ x: 0.2, y: 0 }, { x: 1, y: 0 }, { x: 0.8, y: 1 }, { x: 0, y: 1 }];
    case 'trapezoid':
      return [{ x: 0.22, y: 0 }, { x: 0.78, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
    case 'triangle':
      return [{ x: 0.5, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
    case 'hexagon':
      return [{ x: 0.2, y: 0 }, { x: 0.8, y: 0 }, { x: 1, y: 0.5 }, { x: 0.8, y: 1 }, { x: 0.2, y: 1 }, { x: 0, y: 0.5 }];
    default:
      return [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  }
}

/** How much a shape's corners are rounded (px). */
export const cornerRadius = (s: DShape) => (s.sharp ? 0 : Math.max(0, s.r ?? (s.kind === 'rect' ? DEFAULT_RADIUS : 0)));

/**
 * A polygon with rounded corners: each corner cut `r` px back along both sides and joined by a
 * curve that bends toward the corner.
 */
function roundedNodes(s: DShape, corners: Pt[], r: number): DNode[] {
  if (r <= 0) return corners.map((c) => ({ x: c.x, y: c.y, kind: 'corner' as const }));
  const px = corners.map((c) => ({ x: c.x * s.w, y: c.y * s.h }));
  const out: DNode[] = [];
  const n = px.length;
  for (let i = 0; i < n; i++) {
    const v = px[i];
    const a = px[(i - 1 + n) % n];
    const b = px[(i + 1) % n];
    const la = len(sub(a, v));
    const lb = len(sub(b, v));
    const t = Math.min(r, la / 2, lb / 2);
    const A = add(v, mul(sub(a, v), t / la));
    const B = add(v, mul(sub(b, v), t / lb));
    const norm = (p: Pt) => ({ x: p.x / s.w, y: p.y / s.h });
    const hA = norm(mul(sub(v, A), K));
    const hB = norm(mul(sub(v, B), K));
    out.push({ ...norm(A), kind: 'corner', hout: hA }, { ...norm(B), kind: 'corner', hin: hB });
  }
  return out;
}

/** The outline of a kind as points (0–1 in the shape's box), for editing it by hand. */
export function presetNodes(s: DShape): DNode[] {
  if (CORNERED.has(s.kind)) return roundedNodes(s, cornersOf(s.kind), cornerRadius(s));
  const c = (x: number, y: number): DNode => ({ x, y, kind: 'corner' });
  switch (s.kind) {
    case 'ellipse':
      return [
        { x: 0.5, y: 0, kind: 'smooth', hin: { x: -0.5 * K, y: 0 }, hout: { x: 0.5 * K, y: 0 } },
        { x: 1, y: 0.5, kind: 'smooth', hin: { x: 0, y: -0.5 * K }, hout: { x: 0, y: 0.5 * K } },
        { x: 0.5, y: 1, kind: 'smooth', hin: { x: 0.5 * K, y: 0 }, hout: { x: -0.5 * K, y: 0 } },
        { x: 0, y: 0.5, kind: 'smooth', hin: { x: 0, y: 0.5 * K }, hout: { x: 0, y: -0.5 * K } },
      ];
    case 'diamond':
      return [c(0.5, 0), c(1, 0.5), c(0.5, 1), c(0, 0.5)];
    case 'parallelogram':
      return [c(0.2, 0), c(1, 0), c(0.8, 1), c(0, 1)];
    case 'triangle':
      return [c(0.5, 0), c(1, 1), c(0, 1)];
    case 'hexagon':
      return [c(0.2, 0), c(0.8, 0), c(1, 0.5), c(0.8, 1), c(0.2, 1), c(0, 0.5)];
    default: {
      const r = s.sharp ? 0 : Math.min(s.r ?? DEFAULT_RADIUS, s.w / 2, s.h / 2);
      if (!r) return [c(0, 0), c(1, 0), c(1, 1), c(0, 1)];
      // A rounded rectangle: two points per corner, joined by quarter curves.
      const rx = r / s.w;
      const ry = r / s.h;
      const p = (x: number, y: number, hin?: Pt, hout?: Pt): DNode => ({ x, y, kind: 'corner', hin, hout });
      return [
        p(rx, 0, { x: -rx * K, y: 0 }, undefined),
        p(1 - rx, 0, undefined, { x: rx * K, y: 0 }),
        p(1, ry, { x: 0, y: -ry * K }, undefined),
        p(1, 1 - ry, undefined, { x: 0, y: ry * K }),
        p(1 - rx, 1, { x: rx * K, y: 0 }, undefined),
        p(rx, 1, undefined, { x: -rx * K, y: 0 }),
        p(0, 1 - ry, { x: 0, y: ry * K }, undefined),
        p(0, ry, undefined, { x: 0, y: -ry * K }),
      ];
    }
  }
}

/** The points of a shape's outline on the board (edited ones, or its kind's). */
export function nodesOf(s: DShape): DNode[] {
  return s.nodes ?? presetNodes(s);
}

/** A point of the outline (and its handles) in board units. */
export function nodePlace(s: DShape, n: DNode) {
  const at = { x: s.x + n.x * s.w, y: s.y + n.y * s.h };
  return {
    at,
    hin: n.hin ? { x: at.x + n.hin.x * s.w, y: at.y + n.hin.y * s.h } : null,
    hout: n.hout ? { x: at.x + n.hout.x * s.w, y: at.y + n.hout.y * s.h } : null,
  };
}

/** The outline as an SVG path (closed). */
/** How many pieces an outline has (an open curve has no closing piece). */
export const segCount = (s: DShape, n = nodesOf(s).length) => (s.open ? Math.max(0, n - 1) : n);

export function shapePath(s: DShape): string {
  if (s.kind === 'text' || s.kind === 'image') return `M${fmt(s.x)} ${fmt(s.y)}h${fmt(s.w)}v${fmt(s.h)}h${fmt(-s.w)}Z`;
  const nodes = nodesOf(s);
  if (!nodes.length) return '';
  const places = nodes.map((n) => nodePlace(s, n));
  let d = `M${fmt(places[0].at.x)} ${fmt(places[0].at.y)}`;
  for (let i = 0; i < segCount(s, places.length); i++) {
    const p = places[i];
    const q = places[(i + 1) % places.length];
    if (p.hout || q.hin) {
      const c1 = p.hout ?? p.at;
      const c2 = q.hin ?? q.at;
      d += `C${fmt(c1.x)} ${fmt(c1.y)} ${fmt(c2.x)} ${fmt(c2.y)} ${fmt(q.at.x)} ${fmt(q.at.y)}`;
    } else d += `L${fmt(q.at.x)} ${fmt(q.at.y)}`;
  }
  return s.open ? d : d + 'Z';
}

const cubic = (p0: Pt, c1: Pt, c2: Pt, p1: Pt, t: number): Pt => {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p1.x,
    y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p1.y,
  };
};

/** The outline as a closed polygon (curves cut into short pieces), with which segment each piece is on. */
export function outlinePolygon(s: DShape, steps = 16): { pts: Pt[]; seg: number[] } {
  const nodes = nodesOf(s);
  const places = nodes.map((n) => nodePlace(s, n));
  const pts: Pt[] = [];
  const seg: number[] = [];
  for (let i = 0; i < segCount(s, places.length); i++) {
    const p = places[i];
    const q = places[(i + 1) % places.length];
    if (p.hout || q.hin) {
      for (let k = 0; k < steps; k++) {
        pts.push(cubic(p.at, p.hout ?? p.at, q.hin ?? q.at, q.at, k / steps));
        seg.push(i);
      }
    } else {
      pts.push(p.at);
      seg.push(i);
    }
  }
  if (s.open && places.length) {
    pts.push(places[places.length - 1].at);
    seg.push(places.length - 2);
  }
  return { pts, seg };
}

const center = (s: DShape): Pt => ({ x: s.x + s.w / 2, y: s.y + s.h / 2 });

/** A point turned `deg` degrees (clockwise on screen) about `c`. */
export function turn(p: Pt, c: Pt, deg: number): Pt {
  if (!deg) return p;
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}
/** A board point in the shape's own (unturned) frame, and back. */
export const toLocal = (s: DShape, p: Pt): Pt => turn(p, center(s), -(s.rot ?? 0));
export const toWorld = (s: DShape, p: Pt): Pt => turn(p, center(s), s.rot ?? 0);
/** The SVG transform that turns a shape about its middle. */
export const rotTransform = (s: DShape) => (s.rot ? `rotate(${fmt(s.rot)} ${fmt(s.x + s.w / 2)} ${fmt(s.y + s.h / 2)})` : undefined);
/** The four corners of a shape's box on the board (turned with it). */
export const boxCorners = (s: DShape): Pt[] =>
  [
    { x: s.x, y: s.y },
    { x: s.x + s.w, y: s.y },
    { x: s.x + s.w, y: s.y + s.h },
    { x: s.x, y: s.y + s.h },
  ].map((q) => toWorld(s, q));
const DIR: Record<Side, Pt> = { top: { x: 0, y: -1 }, right: { x: 1, y: 0 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 } };
export const SIDES: Side[] = ['top', 'right', 'bottom', 'left'];

/** Where a ray from `o` along `d` first leaves the polygon. */
function rayExit(o: Pt, d: Pt, poly: Pt[]): Pt | null {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const e = sub(b, a);
    const den = d.x * e.y - d.y * e.x;
    if (Math.abs(den) < 1e-9) continue;
    const w = sub(a, o);
    const t = (w.x * e.y - w.y * e.x) / den;
    const u = (w.x * d.y - w.y * d.x) / den;
    if (t > 1e-6 && u >= -1e-6 && u <= 1 + 1e-6 && t < best) best = t;
  }
  return best < Infinity ? add(o, mul(d, best)) : null;
}

/** A shape's connection site on a side: where its outline meets the line from its centre that way. */
export function sitePoint(s: DShape, side: Side): Pt {
  const c = center(s);
  const box = { top: { x: c.x, y: s.y }, right: { x: s.x + s.w, y: c.y }, bottom: { x: c.x, y: s.y + s.h }, left: { x: s.x, y: c.y } }[side];
  if (s.kind === 'text' || s.kind === 'image' || (s.kind === 'rect' && !s.nodes && !cornerRadius(s))) return toWorld(s, box);
  return toWorld(s, rayExit(c, DIR[side], outlinePolygon(s).pts) ?? box);
}

/** The way out of a shape's side on the board (turned with the shape). */
export function sideDir(s: DShape, side: Side): Pt {
  return turn(DIR[side], { x: 0, y: 0 }, s.rot ?? 0);
}

/** The connection site of a shape nearest to a point. */
export function nearestSide(s: DShape, p: Pt): Side {
  let best: Side = 'top';
  let bd = Infinity;
  for (const side of SIDES) {
    const q = sitePoint(s, side);
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < bd) (bd = d), (best = side);
  }
  return best;
}

/** Where an end of a line is now (an end on a shape follows it). */
export function endPoint(d: Diagram, e: DEnd): Pt {
  const s = e.shape ? d.shapes.find((x) => x.id === e.shape) : undefined;
  return s && e.side ? sitePoint(s, e.side) : { x: e.x, y: e.y };
}

/** The way a line leaves (or comes into) an end: out of the shape's side, or toward the other end. */
function endDir(d: Diagram, e: DEnd, other: Pt): Pt {
  const s = e.shape ? d.shapes.find((x) => x.id === e.shape) : undefined;
  if (s && e.side) {
    // A turned shape: the nearest of the four straight ways (elbows have right angles only).
    const v = sideDir(s, e.side);
    return Math.abs(v.x) >= Math.abs(v.y) ? { x: Math.sign(v.x), y: 0 } : { x: 0, y: Math.sign(v.y) };
  }
  const p = endPoint(d, e);
  const v = sub(other, p);
  return Math.abs(v.x) >= Math.abs(v.y) ? { x: Math.sign(v.x) || 1, y: 0 } : { x: 0, y: Math.sign(v.y) || 1 };
}

/** The corner points of a line: two for a straight one, more for an elbow (right angles only). */
export function routePoints(d: Diagram, l: DLine): Pt[] {
  const a = endPoint(d, l.a);
  const b = endPoint(d, l.b);
  if (l.route === 'straight') return [a, b];
  const da = endDir(d, l.a, b);
  const db = endDir(d, l.b, a);
  const m = 22;
  const A = add(a, mul(da, m));
  const B = add(b, mul(db, m));
  const ha = da.x !== 0;
  const hb = db.x !== 0;
  let mid: Pt[];
  if (ha && hb) {
    const mx = (A.x + B.x) / 2;
    // Facing each other with room between: the middle; otherwise the step goes around.
    mid = [{ x: mx, y: A.y }, { x: mx, y: B.y }];
    if (da.x === db.x) {
      const x = da.x > 0 ? Math.max(A.x, B.x) : Math.min(A.x, B.x);
      mid = [{ x, y: A.y }, { x, y: B.y }];
    }
  } else if (!ha && !hb) {
    const my = (A.y + B.y) / 2;
    mid = [{ x: A.x, y: my }, { x: B.x, y: my }];
    if (da.y === db.y) {
      const y = da.y > 0 ? Math.max(A.y, B.y) : Math.min(A.y, B.y);
      mid = [{ x: A.x, y }, { x: B.x, y }];
    }
  } else if (ha) mid = [{ x: B.x, y: A.y }];
  else mid = [{ x: A.x, y: B.y }];
  const pts = [a, A, ...mid, B, b];
  // Points on one straight run (or the same point twice) are dropped.
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < 0.5) continue;
    if (out.length >= 2) {
      const prev = out[out.length - 2];
      const cross = (last.x - prev.x) * (p.y - last.y) - (last.y - prev.y) * (p.x - last.x);
      if (Math.abs(cross) < 0.5) {
        out[out.length - 1] = p;
        continue;
      }
    }
    out.push(p);
  }
  return out;
}

/** Where two segments cross (not at their ends): the place along the first (0–1). */
function crossAt(p: Pt, q: Pt, r: Pt, s: Pt): number | null {
  const d1 = sub(q, p);
  const d2 = sub(s, r);
  const den = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(den) < 1e-9) return null;
  const w = sub(r, p);
  const t = (w.x * d2.y - w.y * d2.x) / den;
  const u = (w.x * d1.y - w.y * d1.x) / den;
  return t > 0.001 && t < 0.999 && u > 0.001 && u < 0.999 ? t : null;
}

const CORNER = 10;
const HOP = 6;

/**
 * The path of each line: elbows with rounded corners, and where a line crosses one drawn before it,
 * a small hop over it (bulging up, or to the left on an upright run), as in Visio and PowerPoint.
 */
export function linePaths(d: Diagram): Map<string, { d: string; pts: Pt[] }> {
  const routes = d.lines.map((l) => routePoints(d, l));
  const out = new Map<string, { d: string; pts: Pt[] }>();
  d.lines.forEach((l, li) => {
    const pts = routes[li];
    let path = `M${fmt(pts[0].x)} ${fmt(pts[0].y)}`;
    for (let k = 0; k < pts.length - 1; k++) {
      const p = pts[k];
      const q = pts[k + 1];
      const v = sub(q, p);
      const L = len(v);
      if (L < 0.01) continue;
      const dir = mul(v, 1 / L);
      const rin = k > 0 ? Math.min(CORNER, L / 2, len(sub(p, pts[k - 1])) / 2) : 0;
      const rout = k < pts.length - 2 ? Math.min(CORNER, L / 2, len(sub(pts[k + 2], q)) / 2) : 0;
      // The hops along this run: of two lines crossing, the one lying flatter hops (up) over the
      // other; when both lie alike, the one drawn later.
      const hops: number[] = [];
      for (let lj = 0; lj < d.lines.length; lj++) {
        if (lj === li) continue;
        const other = routes[lj];
        for (let m = 0; m < other.length - 1; m++) {
          const t = crossAt(p, q, other[m], other[m + 1]);
          if (t === null) continue;
          const o = sub(other[m + 1], other[m]);
          const flatHere = Math.abs(dir.x);
          const flatThere = Math.abs(o.x) / (len(o) || 1);
          const mine = Math.abs(flatHere - flatThere) > 0.05 ? flatHere > flatThere : li > lj;
          if (mine && t * L > rin + HOP + 1 && (1 - t) * L > rout + HOP + 1) hops.push(t * L);
        }
      }
      hops.sort((x, y) => x - y);
      // The bulge: up, or to the left when the run is upright.
      const bulge = Math.abs(dir.x) > 0.3 ? { x: 0, y: -1 } : { x: -1, y: 0 };
      const sweep = dir.x * bulge.y - dir.y * bulge.x < 0 ? 1 : 0;
      let lastAt = rin;
      for (const h of hops) {
        if (h - HOP < lastAt) continue;
        const s = add(p, mul(dir, h - HOP));
        const e = add(p, mul(dir, h + HOP));
        path += `L${fmt(s.x)} ${fmt(s.y)}A${HOP} ${HOP} 0 0 ${sweep} ${fmt(e.x)} ${fmt(e.y)}`;
        lastAt = h + HOP;
      }
      const end = add(p, mul(dir, L - rout));
      path += `L${fmt(end.x)} ${fmt(end.y)}`;
      if (rout > 0) {
        const n = pts[k + 2];
        const v2 = sub(n, q);
        const after = add(q, mul(v2, rout / len(v2)));
        path += `Q${fmt(q.x)} ${fmt(q.y)} ${fmt(after.x)} ${fmt(after.y)}`;
      }
    }
    out.set(l.id, { d: path, pts });
  });
  return out;
}

/**
 * An arrow head at the end of a line coming from `from` to `tip`, of a kind: a filled triangle,
 * an open V, a diamond, a dot or a bar. `filled`: painted in (the V and the bar are lines only).
 */
export function arrowHead(from: Pt, tip: Pt, size = 9, kind: HeadKind = 'triangle'): { d: string; filled: boolean } {
  const v = sub(tip, from);
  const L = len(v) || 1;
  const u = mul(v, 1 / L);
  const n = { x: -u.y, y: u.x };
  const P = (p: Pt) => `${fmt(p.x)} ${fmt(p.y)}`;
  const base = sub(tip, mul(u, size));
  const a = add(base, mul(n, size * 0.5));
  const b = sub(base, mul(n, size * 0.5));
  switch (kind) {
    case 'open':
      return { d: `M${P(a)}L${P(tip)}L${P(b)}`, filled: false };
    case 'diamond': {
      const back = sub(tip, mul(u, size * 1.4));
      const mid = sub(tip, mul(u, size * 0.7));
      return { d: `M${P(tip)}L${P(add(mid, mul(n, size * 0.45)))}L${P(back)}L${P(sub(mid, mul(n, size * 0.45)))}Z`, filled: true };
    }
    case 'circle': {
      const r = size * 0.42;
      const c = sub(tip, mul(u, r));
      return { d: `M${fmt(c.x - r)} ${fmt(c.y)}a${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(r * 2)} 0a${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(-r * 2)} 0Z`, filled: true };
    }
    case 'bar':
      return { d: `M${P(add(tip, mul(n, size * 0.55)))}L${P(sub(tip, mul(n, size * 0.55)))}`, filled: false };
    default:
      return { d: `M${P(tip)}L${P(a)}L${P(b)}Z`, filled: true };
  }
}

/** Everything the diagram covers. */
export function diagramBounds(d: Diagram, pad = 0): { x: number; y: number; w: number; h: number } | null {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const s of d.shapes) {
    for (const q of boxCorners(s)) (xs.push(q.x), ys.push(q.y));
    if (s.shadow) {
      // The shadow shows too: as far as it is moved, grown and blurred.
      const sh = s.shadow;
      const dx = Math.cos((sh.angle * Math.PI) / 180) * sh.distance;
      const dy = Math.sin((sh.angle * Math.PI) / 180) * sh.distance;
      const grow = ((sh.size / 100 - 1) * Math.max(s.w, s.h)) / 2 + sh.blur * 1.5;
      xs.push(s.x + dx - grow, s.x + s.w + dx + grow);
      ys.push(s.y + dy - grow, s.y + s.h + dy + grow);
    }
    for (const n of s.nodes ?? []) {
      const p = nodePlace(s, n);
      for (const q of [p.at, p.hin, p.hout]) if (q) {
        const w = toWorld(s, q);
        xs.push(w.x);
        ys.push(w.y);
      }
    }
  }
  for (const r of linePaths(d).values())
    for (const p of r.pts) {
      xs.push(p.x);
      ys.push(p.y);
    }
  if (!xs.length) return null;
  const x = Math.min(...xs) - pad;
  const y = Math.min(...ys) - pad;
  return { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y };
}

/** After points were dragged: the shape's box fitted around its outline again (points kept in place). */
export function refitNodes(s: DShape): DShape {
  if (!s.nodes?.length) return s;
  const { pts } = outlinePolygon(s, 24);
  const minX = Math.min(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const w = Math.max(4, Math.max(...pts.map((p) => p.x)) - minX);
  const h = Math.max(4, Math.max(...pts.map((p) => p.y)) - minY);
  const nodes = s.nodes.map((n) => {
    const p = nodePlace(s, n);
    const to = (q: Pt) => ({ x: (q.x - minX) / w, y: (q.y - minY) / h });
    const at = to(p.at);
    return {
      ...n,
      x: at.x,
      y: at.y,
      hin: p.hin ? sub(to(p.hin), at) : undefined,
      hout: p.hout ? sub(to(p.hout), at) : undefined,
    };
  });
  return { ...s, x: minX, y: minY, w, h, nodes };
}

/** A point changed to smooth, straight or corner: its handles set to suit (in the shape's box). */
export function retypeNode(s: DShape, i: number, kind: DNode['kind']): DNode[] {
  const nodes = nodesOf(s).map((n) => ({ ...n }));
  const n = nodes[i];
  n.kind = kind;
  if (kind === 'corner') {
    delete n.hin;
    delete n.hout;
    return nodes;
  }
  // (The ends of an open curve have no point beyond them: the point itself stands in.)
  const prev = s.open && i === 0 ? n : nodes[(i - 1 + nodes.length) % nodes.length];
  const next = s.open && i === nodes.length - 1 ? n : nodes[(i + 1) % nodes.length];
  // Along the line from the point before to the point after, a third of the way to each.
  const dir = { x: next.x - prev.x, y: next.y - prev.y };
  const dl = Math.hypot(dir.x, dir.y) || 1;
  const u = { x: dir.x / dl, y: dir.y / dl };
  const lin = Math.hypot(n.x - prev.x, n.y - prev.y) / 3;
  const lout = Math.hypot(next.x - n.x, next.y - n.y) / 3;
  const l = (lin + lout) / 2;
  n.hin = mul(u, -(kind === 'smooth' ? l : lin));
  n.hout = mul(u, kind === 'smooth' ? l : lout);
  return nodes;
}

/** A handle of a point dragged: the other one follows as the point's kind says. */
export function moveHandle(n: DNode, which: 'hin' | 'hout', to: Pt): DNode {
  const out: DNode = { ...n, [which]: to };
  const other = which === 'hin' ? 'hout' : 'hin';
  const l = len(to);
  if (n.kind === 'smooth' && l > 1e-6) out[other] = mul(to, -1);
  else if (n.kind === 'straight' && l > 1e-6) {
    const ol = n[other] ? len(n[other]!) : l;
    out[other] = mul(to, -ol / l);
  }
  return out;
}

/** A point put in on segment `i` (from point i to the next) at `t` (0–1), the curve kept as it was. */
export function insertNode(s: DShape, i: number, t: number): DNode[] {
  const nodes = nodesOf(s).map((n) => ({ ...n }));
  const a = nodes[i];
  const b = nodes[(i + 1) % nodes.length];
  if (!a.hout && !b.hin) {
    nodes.splice(i + 1, 0, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, kind: 'corner' });
    return nodes;
  }
  // Split the curve in two (de Casteljau), so the outline does not change.
  const p0 = { x: a.x, y: a.y };
  const p1 = add(p0, a.hout ?? { x: 0, y: 0 });
  const p3 = { x: b.x, y: b.y };
  const p2 = add(p3, b.hin ?? { x: 0, y: 0 });
  const lerp = (u: Pt, v: Pt) => add(u, mul(sub(v, u), t));
  const q0 = lerp(p0, p1);
  const q1 = lerp(p1, p2);
  const q2 = lerp(p2, p3);
  const r0 = lerp(q0, q1);
  const r1 = lerp(q1, q2);
  const m = lerp(r0, r1);
  a.hout = sub(q0, p0);
  b.hin = sub(q2, p3);
  nodes.splice(i + 1, 0, { x: m.x, y: m.y, kind: 'smooth', hin: sub(r0, m), hout: sub(r1, m) });
  return nodes;
}

/** The nearest place on the outline to `p` (board units): which segment, how far along it, how far away. */
export function nearestOnOutline(s: DShape, p: Pt): { seg: number; t: number; dist: number } {
  return nearestLocal(s, toLocal(s, p));
}

function nearestLocal(s: DShape, p: Pt): { seg: number; t: number; dist: number } {
  const nodes = nodesOf(s);
  const places = nodes.map((n) => nodePlace(s, n));
  let best = { seg: 0, t: 0, dist: Infinity };
  for (let i = 0; i < segCount(s, places.length); i++) {
    const a = places[i];
    const b = places[(i + 1) % places.length];
    const steps = a.hout || b.hin ? 32 : 1;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const q = steps === 1 ? add(a.at, mul(sub(b.at, a.at), t)) : cubic(a.at, a.hout ?? a.at, b.hin ?? b.at, b.at, t);
      // On a straight piece, the exact nearest place.
      if (steps === 1 && k === 0) {
        const v = sub(b.at, a.at);
        const L2 = v.x * v.x + v.y * v.y || 1;
        const tt = Math.max(0, Math.min(1, ((p.x - a.at.x) * v.x + (p.y - a.at.y) * v.y) / L2));
        const r = add(a.at, mul(v, tt));
        const dd = Math.hypot(r.x - p.x, r.y - p.y);
        if (dd < best.dist) best = { seg: i, t: tt, dist: dd };
        break;
      }
      const dd = Math.hypot(q.x - p.x, q.y - p.y);
      if (dd < best.dist) best = { seg: i, t, dist: dd };
    }
  }
  return best;
}

/** Whether a point is inside the shape's outline. */
export function insideShape(s: DShape, world: Pt): boolean {
  const p = toLocal(s, world);
  if (s.kind === 'text' || s.kind === 'image' || (s.kind === 'rect' && !s.nodes)) return p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h;
  // An open curve: on (near) its line.
  if (s.open) return nearestLocal(s, p).dist <= 6;
  const { pts } = outlinePolygon(s);
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** The words of a diagram, for search and titles. */
export function diagramText(d: Diagram | undefined): string {
  return (d?.shapes ?? []).map((s) => s.text ?? '').filter(Boolean).join(' ');
}

/**
 * A smooth curve through clicked points (as a spline): each point's handles point along the line
 * from the point before to the point after it. Returns the shape's box and its points in that box.
 */
export function splineShape(points: Pt[], closed: boolean, sharp: boolean[] = []): { x: number; y: number; w: number; h: number; nodes: DNode[] } {
  const n = points.length;
  const raw = points.map((p, i) => {
    // A point clicked with Ctrl is a sharp corner: no handles, the curve meets it at an angle.
    if (sharp[i]) return { at: p, hin: null, hout: null };
    const prev = closed ? points[(i - 1 + n) % n] : points[Math.max(0, i - 1)];
    const next = closed ? points[(i + 1) % n] : points[Math.min(n - 1, i + 1)];
    const t = mul(sub(next, prev), 1 / 6);
    const end = !closed && (i === 0 || i === n - 1);
    return { at: p, hin: end && i === 0 ? null : mul(t, -1), hout: end && i === n - 1 ? null : t };
  });
  const xs = raw.flatMap((r) => [r.at.x, ...(r.hin ? [r.at.x + r.hin.x] : []), ...(r.hout ? [r.at.x + r.hout.x] : [])]);
  const ys = raw.flatMap((r) => [r.at.y, ...(r.hin ? [r.at.y + r.hin.y] : []), ...(r.hout ? [r.at.y + r.hout.y] : [])]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const w = Math.max(4, Math.max(...xs) - x);
  const h = Math.max(4, Math.max(...ys) - y);
  const nodes: DNode[] = raw.map((r, i) => ({
    x: (r.at.x - x) / w,
    y: (r.at.y - y) / h,
    kind: sharp[i] ? 'corner' : 'smooth',
    hin: r.hin ? { x: r.hin.x / w, y: r.hin.y / h } : undefined,
    hout: r.hout ? { x: r.hout.x / w, y: r.hout.y / h } : undefined,
  }));
  return { x, y, w, h, nodes };
}

/** A colour made lighter (bright > 0, toward white) or darker (< 0, toward black), −100 to 100. */
export function shade(hex: string, bright: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m || !bright) return hex;
  const n = parseInt(m[1], 16);
  const k = Math.max(-1, Math.min(1, bright / 100));
  const ch = (v: number) => Math.round(k > 0 ? v + (255 - v) * k : v * (1 + k));
  const to = (v: number) => ch(v).toString(16).padStart(2, '0');
  return `#${to((n >> 16) & 255)}${to((n >> 8) & 255)}${to(n & 255)}`;
}

/** The colour (and see-through-ness) a gradient has at `t` (0–1), between its stops. */
export function gradAt(g: Grad, t: number): { color: string; opacity: number } {
  const stops = [...g.stops].sort((a, b) => a.pos - b.pos);
  if (!stops.length) return { color: '#ffffff', opacity: 1 };
  const rgb = (st: GradStop) => {
    const n = parseInt(shade(st.color, st.bright).slice(1), 16) || 0;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  if (t <= stops[0].pos) return { color: shade(stops[0].color, stops[0].bright), opacity: stops[0].opacity };
  const last = stops[stops.length - 1];
  if (t >= last.pos) return { color: shade(last.color, last.bright), opacity: last.opacity };
  let i = 0;
  while (i < stops.length - 1 && stops[i + 1].pos < t) i++;
  const a = stops[i];
  const b = stops[i + 1];
  const u = (t - a.pos) / (b.pos - a.pos || 1);
  const ca = rgb(a);
  const cb = rgb(b);
  const c = ca.map((v, k) => Math.round(v + (cb[k] - v) * u).toString(16).padStart(2, '0')).join('');
  return { color: '#' + c, opacity: a.opacity + (b.opacity - a.opacity) * u };
}
