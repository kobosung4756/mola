import { Fragment, useId } from 'react';
import { MathText } from './MathEditor';
import type { ReactNode } from 'react';
import { DEFAULT_STROKE_W, arrowHead, diagramBounds, gradAt, linePaths, rotTransform, shapePath } from '../diagram';
import type { Diagram, DShape, Grad, Pt, Shadow } from '../diagram';

/** A shape's words as SVG text (for pictures made from a diagram: no HTML inside), one line per line. */
function SvgText({ s }: { s: DShape }) {
  const lines = (s.text ?? '').split('\n');
  const fs = s.fontSize ?? 14;
  const lh = fs * 1.3;
  const total = lines.length * lh;
  const align = s.align ?? 'center';
  const x = align === 'left' ? s.x + 10 : align === 'right' ? s.x + s.w - 10 : s.x + s.w / 2;
  const v = s.valign ?? 'middle';
  const top = v === 'top' ? s.y + 6 : v === 'bottom' ? s.y + s.h - 6 - total : s.y + s.h / 2 - total / 2;
  return (
    <text x={x} fontSize={fs} fill={s.textColor ?? '#1e1e1e'} fillOpacity={s.textOpacity} textAnchor={align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle'}>
      {lines.map((t, i) => (
        <tspan key={i} x={x} y={top + lh * i + fs * 0.98}>
          {t}
        </tspan>
      ))}
    </text>
  );
}

/** A shape's words, centred in it (wrapping inside its box). */
function ShapeText({ s, hidden, plain }: { s: DShape; hidden?: boolean; plain?: boolean }) {
  if (!s.text || hidden) return null;
  if (plain) return <SvgText s={s} />;
  return (
    <foreignObject x={s.x} y={s.y} width={Math.max(1, s.w)} height={Math.max(1, s.h)} pointerEvents="none">
      <div
        className="dg-text"
        style={{
          color: s.textColor ?? '#1e1e1e',
          opacity: s.textOpacity,
          padding: s.kind === 'text' ? 2 : '6px 10px',
          fontSize: s.fontSize ?? 14,
          textAlign: s.align ?? 'center',
          justifyContent: { left: 'flex-start', center: 'center', right: 'flex-end' }[s.align ?? 'center'],
          alignItems: { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[s.valign ?? 'middle'],
        }}
      >
        <span className="dg-text-in">
          <MathText text={s.text} />
        </span>
      </div>
    </foreignObject>
  );
}

type Box = { x: number; y: number; w: number; h: number };

/** Where a radial / rectangular / path gradient grows from. */
function originOf(g: Grad, b: Box): Pt {
  switch (g.from) {
    case 'tl':
      return { x: b.x, y: b.y };
    case 'tr':
      return { x: b.x + b.w, y: b.y };
    case 'bl':
      return { x: b.x, y: b.y + b.h };
    case 'br':
      return { x: b.x + b.w, y: b.y + b.h };
    default:
      return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  }
}

/** A linear or radial gradient as an SVG paint (in board units, so a flat line still gets one). */
function GradDef({ id, g, b }: { id: string; g: Grad; b: Box }) {
  const stops = [...g.stops]
    .sort((x, y) => x.pos - y.pos)
    .map((st, i) => <stop key={i} offset={st.pos} stopColor={gradAt(g, st.pos).color} stopOpacity={st.opacity} />);
  if (g.type === 'linear') {
    const a = (g.angle * Math.PI) / 180;
    const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    const half = (Math.abs(b.w * Math.cos(a)) + Math.abs(b.h * Math.sin(a))) / 2 || 1;
    return (
      <linearGradient id={id} gradientUnits="userSpaceOnUse" x1={c.x - Math.cos(a) * half} y1={c.y - Math.sin(a) * half} x2={c.x + Math.cos(a) * half} y2={c.y + Math.sin(a) * half}>
        {stops}
      </linearGradient>
    );
  }
  const o = originOf(g, b);
  const far = g.from === 'center' ? Math.hypot(b.w, b.h) / 2 : Math.hypot(b.w, b.h);
  return (
    <radialGradient id={id} gradientUnits="userSpaceOnUse" cx={o.x} cy={o.y} r={far || 1}>
      {stops}
    </radialGradient>
  );
}

/**
 * The rectangular and path gradients SVG has no paint for: rings of colour stacked from the edge
 * in (rectangles, or the outline made smaller), inside the shape's outline.
 */
function StackedFill({ s, g, clip }: { s: DShape; g: Grad; clip: string }) {
  const steps = 40;
  const o = originOf(g, s);
  const parts: ReactNode[] = [];
  for (let i = steps; i >= 1; i--) {
    const t = i / steps;
    const c = gradAt(g, t);
    if (g.type === 'rect') {
      const center = g.from === 'center';
      const w = s.w * t * (center ? 1 : 1);
      const h = s.h * t;
      const x = center ? o.x - w / 2 : g.from === 'tl' || g.from === 'bl' ? o.x : o.x - w;
      const y = center ? o.y - h / 2 : g.from === 'tl' || g.from === 'tr' ? o.y : o.y - h;
      // From a corner the rectangles reach the far corner.
      const ww = center ? w : s.w * t;
      parts.push(<rect key={i} x={x} y={y} width={ww} height={h} fill={c.color} fillOpacity={c.opacity} />);
    } else {
      parts.push(
        <path key={i} d={shapePath(s)} transform={`translate(${o.x} ${o.y}) scale(${t}) translate(${-o.x} ${-o.y})`} fill={c.color} fillOpacity={c.opacity} />,
      );
    }
  }
  return <g clipPath={`url(#${clip})`}>{parts}</g>;
}

/** A blur for shadows (one per amount), over a region big enough for the thing it blurs. */
function BlurDef({ id, blur, b }: { id: string; blur: number; b: Box }) {
  const m = blur * 3 + 40;
  return (
    <filter id={id} filterUnits="userSpaceOnUse" x={b.x - m} y={b.y - m} width={b.w + m * 2} height={b.h + m * 2}>
      <feGaussianBlur stdDeviation={blur / 2} />
    </filter>
  );
}

/** Where a shadow goes and how big it is: a move, then a scale around the thing's middle. */
function shadowMove(sh: Shadow, b: Box) {
  const dx = Math.cos((sh.angle * Math.PI) / 180) * sh.distance;
  const dy = Math.sin((sh.angle * Math.PI) / 180) * sh.distance;
  const k = sh.size / 100;
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  return `translate(${dx} ${dy}) translate(${cx} ${cy}) scale(${k}) translate(${-cx} ${-cy})`;
}

const boundsOf = (pts: Pt[]): Box => {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(1, Math.max(...xs) - x), h: Math.max(1, Math.max(...ys) - y) };
};

/**
 * The shapes and lines of a diagram as SVG parts (inside an <svg> given by the caller). The editor
 * gives its own props for hit-testing and leaves out the words of the shape being typed in.
 */
export function DiagramParts({
  d,
  editingText,
  shapeProps,
  lineProps,
  plainText,
}: {
  d: Diagram;
  editingText?: string | null;
  /** Words as SVG text, not HTML (for making a picture of the diagram). */
  plainText?: boolean;
  shapeProps?: (s: DShape) => Record<string, unknown>;
  lineProps?: (id: string) => Record<string, unknown>;
}) {
  const uidBase = useId().replace(/:/g, '');
  const paths = linePaths(d);
  const defs: ReactNode[] = [];
  const shapes: ReactNode[] = d.shapes.map((s) => {
    const path = shapePath(s);
    const filled = s.kind !== 'text' && s.kind !== 'image' && !s.open;
    const sid = `${uidBase}-${s.id}`;
    let fill: string = filled ? s.fill : 'none';
    let stacked: ReactNode = null;
    if (filled && s.grad) {
      if (s.grad.type === 'linear' || s.grad.type === 'radial') {
        defs.push(<GradDef key={'g' + sid} id={'g' + sid} g={s.grad} b={s} />);
        fill = `url(#g${sid})`;
      } else {
        defs.push(
          <clipPath key={'c' + sid} id={'c' + sid}>
            <path d={path} />
          </clipPath>,
        );
        stacked = <StackedFill s={s} g={s.grad} clip={'c' + sid} />;
        fill = 'none';
      }
    }
    let shadow: ReactNode = null;
    if (s.shadow && s.kind !== 'text') {
      defs.push(<BlurDef key={'b' + sid} id={'b' + sid} blur={s.shadow.blur} b={s} />);
      shadow = (
        <path
          d={path}
          transform={shadowMove(s.shadow, s)}
          fill={filled || s.kind === 'image' ? s.shadow.color : 'none'}
          stroke={s.open ? s.shadow.color : 'none'}
          strokeWidth={s.strokeW ?? DEFAULT_STROKE_W}
          opacity={s.shadow.opacity}
          filter={s.shadow.blur > 0 ? `url(#b${sid})` : undefined}
          pointerEvents="none"
        />
      );
    }
    const stroke = s.kind === 'text' ? 'none' : s.kind === 'image' ? (s.stroke === 'transparent' ? 'none' : s.stroke) : s.stroke;
    return (
      <g key={s.id} data-shape={s.id} opacity={s.opacity ?? 1} transform={rotTransform(s)} {...(shapeProps?.(s) ?? {})}>
        {shadow}
        {s.kind === 'image' && s.href && <image href={s.href} x={s.x} y={s.y} width={s.w} height={s.h} preserveAspectRatio="none" />}
        {stacked && <g opacity={s.fillOpacity}>{stacked}</g>}
        <path
          d={path}
          fill={s.kind === 'text' || s.kind === 'image' ? 'transparent' : fill}
          fillOpacity={s.fillOpacity}
          stroke={stroke}
          strokeOpacity={s.strokeOpacity}
          strokeWidth={s.strokeW ?? DEFAULT_STROKE_W}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* an open curve is easier to hit with a wider see-through line along it */}
        {s.open && <path d={path} fill="none" stroke="transparent" strokeWidth={12} />}
        <ShapeText s={s} hidden={editingText === s.id} plain={plainText} />
      </g>
    );
  });
  const lines: ReactNode[] = d.lines.map((l) => {
    const p = paths.get(l.id);
    if (!p) return null;
    const { pts } = p;
    const w = l.width ?? 1.6;
    const lid = `${uidBase}-${l.id}`;
    const b = boundsOf(pts);
    let paint = l.color;
    if (l.grad) {
      // (A rectangular or path gradient has no meaning along a line: it runs like a radial one.)
      const g: Grad = l.grad.type === 'linear' ? l.grad : { ...l.grad, type: 'radial' };
      defs.push(<GradDef key={'g' + lid} id={'g' + lid} g={g} b={b} />);
      paint = `url(#g${lid})`;
    }
    const head = 7 + w * 1.5;
    const heads = (color: string) => {
      const one = (from: Pt, tip: Pt) => {
        const h = arrowHead(from, tip, head, l.head);
        return <path d={h.d} fill={h.filled ? color : 'none'} stroke={color} strokeWidth={h.filled ? 0.6 : w} strokeLinecap="round" strokeLinejoin="round" />;
      };
      return (
        <>
          {(l.arrow === 'end' || l.arrow === 'both') && pts.length > 1 && one(pts[pts.length - 2], pts[pts.length - 1])}
          {l.arrow === 'both' && pts.length > 1 && one(pts[1], pts[0])}
        </>
      );
    };
    let shadow: ReactNode = null;
    if (l.shadow) {
      defs.push(<BlurDef key={'b' + lid} id={'b' + lid} blur={l.shadow.blur} b={b} />);
      shadow = (
        <g transform={shadowMove(l.shadow, b)} opacity={l.shadow.opacity} filter={l.shadow.blur > 0 ? `url(#b${lid})` : undefined} pointerEvents="none">
          <path d={p.d} fill="none" stroke={l.shadow.color} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />
          {heads(l.shadow.color)}
        </g>
      );
    }
    return (
      <g key={l.id} data-line={l.id} opacity={l.opacity ?? 1} {...(lineProps?.(l.id) ?? {})}>
        {shadow}
        {/* a wide see-through line, easier to hit than the drawn one */}
        <path d={p.d} fill="none" stroke="transparent" strokeWidth={12} />
        <path d={p.d} fill="none" stroke={paint} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" />
        {heads(l.grad ? gradAt(l.grad, 1).color : l.color)}
      </g>
    );
  });
  // Lines under the shapes would hide behind fills: lines are drawn over them.
  return (
    <Fragment>
      <defs>{defs}</defs>
      {shapes}
      {lines}
    </Fragment>
  );
}

/** A diagram as it shows on the board (and in its thumbnails): fitted to its own contents. */
export function DiagramView({ d }: { d: Diagram | undefined }) {
  const b = d ? diagramBounds(d, 12) : null;
  if (!d || !b) return <div className="dg-empty">{'□ → ○'}</div>;
  return (
    <svg className="dg-view" viewBox={`${b.x} ${b.y} ${b.w} ${b.h}`} width="100%" style={{ aspectRatio: `${b.w} / ${b.h}` }}>
      <DiagramParts d={d} />
    </svg>
  );
}
