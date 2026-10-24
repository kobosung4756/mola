import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { tr } from '../i18n';
import { DEFAULT_SHADOW, gradAt } from '../diagram';
import type { Grad, Shadow } from '../diagram';
import { ColorPicker } from './ColorPicker';

/*
 * The diagram editor's settings for how a shape or line looks beyond its colour: see-through-ness,
 * a shadow and a gradient (as PowerPoint's Format Shape pane).
 */

/** Whether a part of the panel is folded away (remembered in this browser). */
function useFold(name: string): [boolean, () => void] {
  const key = 'molanote.dg-fold.' + name;
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(key) !== '0';
    } catch {
      return true;
    }
  });
  const toggle = () =>
    setOpen((o) => {
      try {
        localStorage.setItem(key, o ? '0' : '1');
      } catch {
        // Storage blocked: it just is not remembered.
      }
      return !o;
    });
  return [open, toggle];
}

const FoldButton = ({ open, toggle, name }: { open: boolean; toggle: () => void; name: string }) => (
  <button className="dg-fold-btn" data-fold={name} aria-expanded={open} title={open ? tr('접기', 'Fold away') : tr('펼치기', 'Show')} onClick={toggle}>
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden style={{ transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform 0.15s' }}>
      <path d="M2.5 4.5L6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </button>
);

/** A part of the panel with a title that folds it away (and back). */
export function Fold({ name, title, children }: { name: string; title: string; children: ReactNode }) {
  const [open, toggle] = useFold(name);
  return (
    <div className="dg-prop dg-group" data-fold-group={name}>
      <div className="dg-fold-head">
        <span className="dg-label">{title}</span>
        <FoldButton open={open} toggle={toggle} name={name} />
      </div>
      {open && children}
    </div>
  );
}

/** A slider with its name and value. */
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  unit = '',
  onChange,
  name,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (v: number) => void;
  name?: string;
}) {
  return (
    <label className="dg-slider" data-slider={name}>
      <span className="dg-label">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="dg-num">
        {Math.round(value * 10) / 10}
        {unit}
      </span>
    </label>
  );
}

/** Where a shadow falls, ready made (as PowerPoint's Outer and Perspective presets). */
const SHADOW_PRESETS: { ko: string; en: string; v: Partial<Shadow> }[] = [
  { ko: '오른쪽 아래', en: 'Bottom right', v: { angle: 45, distance: 5, blur: 6, size: 100 } },
  { ko: '아래', en: 'Bottom', v: { angle: 90, distance: 5, blur: 6, size: 100 } },
  { ko: '왼쪽 아래', en: 'Bottom left', v: { angle: 135, distance: 5, blur: 6, size: 100 } },
  { ko: '오른쪽', en: 'Right', v: { angle: 0, distance: 5, blur: 6, size: 100 } },
  { ko: '가운데 (퍼짐)', en: 'Centre (glow)', v: { angle: 0, distance: 0, blur: 14, size: 104 } },
  { ko: '위', en: 'Top', v: { angle: 270, distance: 5, blur: 6, size: 100 } },
];

export function ShadowEditor({ value, onChange }: { value: Shadow | undefined; onChange: (s: Shadow | undefined) => void }) {
  const [colour, setColour] = useState(false);
  const [open, toggle] = useFold('shadow');
  const sh = value ?? DEFAULT_SHADOW;
  const set = (p: Partial<Shadow>) => onChange({ ...sh, ...p });
  return (
    <div className="dg-prop dg-group" data-shadow-editor>
      <div className="dg-fold-head">
        <label className="dg-check">
          <input type="checkbox" checked={!!value} data-shadow-on onChange={(e) => onChange(e.target.checked ? { ...DEFAULT_SHADOW } : undefined)} />
          {tr('그림자', 'Shadow')}
        </label>
        {/* (Always there: the settings can be opened before the shadow is on; changing one turns it on.) */}
        <FoldButton open={open} toggle={toggle} name="shadow" />
      </div>
      {open && (
        <div className={value ? 'dg-shadow-body' : 'dg-shadow-body off'} data-shadow-body>
          <div className="dg-presets">
            {SHADOW_PRESETS.map((p) => (
              <button key={p.ko} title={tr(p.ko, p.en)} onClick={() => set(p.v)} data-shadow-preset={p.en}>
                <span className="dg-shadow-demo" style={{ boxShadow: `${Math.round(Math.cos(((p.v.angle ?? 0) * Math.PI) / 180) * (p.v.distance ?? 0))}px ${Math.round(Math.sin(((p.v.angle ?? 0) * Math.PI) / 180) * (p.v.distance ?? 0))}px ${p.v.blur}px rgba(0,0,0,.45)` }} />
              </button>
            ))}
          </div>
          <button className="dg-colour" onClick={() => setColour(!colour)}>
            <span className="dg-swatch" style={{ background: sh.color }} />
            <span>{tr('그림자 색', 'Shadow colour')}</span>
          </button>
          {colour && <ColorPicker value={sh.color} onChange={(c) => set({ color: c })} />}
          <Slider name="shadow-transparency" label={tr('투명도', 'Transparency')} value={Math.round((1 - sh.opacity) * 100)} min={0} max={100} unit="%" onChange={(v) => set({ opacity: 1 - v / 100 })} />
          <Slider name="shadow-size" label={tr('크기', 'Size')} value={sh.size} min={50} max={200} unit="%" onChange={(v) => set({ size: v })} />
          <Slider name="shadow-blur" label={tr('흐리게', 'Blur')} value={sh.blur} min={0} max={40} unit="px" onChange={(v) => set({ blur: v })} />
          <Slider name="shadow-angle" label={tr('각도', 'Angle')} value={sh.angle} min={0} max={359} unit="°" onChange={(v) => set({ angle: v })} />
          <Slider name="shadow-distance" label={tr('간격', 'Distance')} value={sh.distance} min={0} max={60} unit="px" onChange={(v) => set({ distance: v })} />
        </div>
      )}
    </div>
  );
}

const css = (g: Grad) =>
  `linear-gradient(to right, ${[...g.stops]
    .sort((a, b) => a.pos - b.pos)
    .map((st) => {
      const c = gradAt(g, st.pos);
      const n = parseInt(c.color.slice(1), 16);
      return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${st.opacity}) ${st.pos * 100}%`;
    })
    .join(', ')})`;

/**
 * A gradient: its kind (linear, radial, rectangular, path), angle or starting corner, and its stops
 * on a bar (click the bar to add one, drag one to move it; the picked one's colour, place,
 * see-through-ness and brightness below).
 */
export function GradEditor({ value, onChange }: { value: Grad; onChange: (g: Grad) => void }) {
  const [at, setAt] = useState(0);
  const [colour, setColour] = useState(false);
  const bar = useRef<HTMLDivElement>(null);
  const g = value;
  const i = Math.min(at, g.stops.length - 1);
  const st = g.stops[i];
  const setStop = (p: Partial<Grad['stops'][number]>) => onChange({ ...g, stops: g.stops.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const posAt = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  };
  const onBar = (e: ReactPointerEvent) => {
    if ((e.target as HTMLElement).closest('[data-stop]')) return;
    // A new stop where the bar was clicked, in the colour the gradient has there.
    const pos = posAt(e.clientX);
    const c = gradAt(g, pos);
    const stops = [...g.stops, { pos, color: c.color, opacity: c.opacity, bright: 0 }];
    onChange({ ...g, stops });
    setAt(stops.length - 1);
  };
  const dragStop = (e: ReactPointerEvent, j: number) => {
    e.preventDefault();
    e.stopPropagation();
    setAt(j);
    const move = (ev: PointerEvent) => {
      const pos = posAt(ev.clientX);
      latest = { ...latest, stops: latest.stops.map((x, k) => (k === j ? { ...x, pos } : x)) };
      onChange(latest);
    };
    let latest = g;
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  };
  return (
    <div className="dg-grad" data-grad-editor>
      <div className="dg-seg">
        {(['linear', 'radial', 'rect', 'path'] as const).map((t) => (
          <button key={t} className={g.type === t ? 'on' : ''} data-grad-type={t} onClick={() => onChange({ ...g, type: t })}>
            {{ linear: tr('선형', 'Linear'), radial: tr('방사형', 'Radial'), rect: tr('사각형', 'Rect'), path: tr('경로형', 'Path') }[t]}
          </button>
        ))}
      </div>
      {g.type === 'linear' && <Slider name="grad-angle" label={tr('각도', 'Angle')} value={g.angle} min={0} max={359} unit="°" onChange={(v) => onChange({ ...g, angle: v })} />}
      {(g.type === 'radial' || g.type === 'rect') && (
        <div className="dg-prop">
          <span className="dg-label">{tr('방향', 'Direction')}</span>
          <div className="dg-seg dg-dirs">
            {(['center', 'tl', 'tr', 'bl', 'br'] as const).map((f) => (
              <button key={f} className={g.from === f ? 'on' : ''} data-grad-from={f} onClick={() => onChange({ ...g, from: f })} title={{ center: tr('가운데에서', 'From the centre'), tl: tr('왼쪽 위에서', 'From top left'), tr: tr('오른쪽 위에서', 'From top right'), bl: tr('왼쪽 아래에서', 'From bottom left'), br: tr('오른쪽 아래에서', 'From bottom right') }[f]}>
                {{ center: '◎', tl: '◸', tr: '◹', bl: '◺', br: '◿' }[f]}
              </button>
            ))}
          </div>
        </div>
      )}
      <span className="dg-label">{tr('그라데이션 중지점 (막대를 눌러 추가)', 'Gradient stops (click the bar to add)')}</span>
      <div className="dg-stops" ref={bar} style={{ background: css(g) }} onPointerDown={onBar} data-grad-bar>
        {g.stops.map((x, j) => (
          <span key={j} data-stop={j} className={j === i ? 'dg-stop on' : 'dg-stop'} style={{ left: `${x.pos * 100}%`, background: gradAt(g, x.pos).color }} onPointerDown={(e) => dragStop(e, j)} />
        ))}
      </div>
      {st && (
        <>
          <div className="dg-row">
            <button className="dg-colour" onClick={() => setColour(!colour)} data-stop-colour>
              <span className="dg-swatch" style={{ background: st.color }} />
              <span>{tr('색', 'Colour')}</span>
            </button>
            <button className="dg-small" disabled={g.stops.length <= 2} data-stop-delete onClick={() => (onChange({ ...g, stops: g.stops.filter((_, j) => j !== i) }), setAt(0))}>
              {tr('중지점 삭제', 'Remove stop')}
            </button>
          </div>
          {colour && <ColorPicker value={st.color} onChange={(c) => setStop({ color: c })} />}
          <Slider name="stop-pos" label={tr('위치', 'Position')} value={Math.round(st.pos * 100)} min={0} max={100} unit="%" onChange={(v) => setStop({ pos: v / 100 })} />
          <Slider name="stop-transparency" label={tr('투명도', 'Transparency')} value={Math.round((1 - st.opacity) * 100)} min={0} max={100} unit="%" onChange={(v) => setStop({ opacity: 1 - v / 100 })} />
          <Slider name="stop-bright" label={tr('밝기', 'Brightness')} value={st.bright} min={-100} max={100} unit="%" onChange={(v) => setStop({ bright: v })} />
        </>
      )}
    </div>
  );
}
