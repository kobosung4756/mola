import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { tr } from '../i18n';
import { PALETTE } from '../diagram';

/*
 * A colour picker: a row of ready colours, a spectrum to click or drag in (saturation and brightness,
 * with a hue strip under it), the colour's #hex, and an eyedropper that takes a colour from
 * anywhere on the screen (where the browser offers one: Chrome, Edge, Whale).
 */

type Hsv = { h: number; s: number; v: number };

function hexToHsv(hex: string): Hsv {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return { h: 210, s: 0.6, v: 0.85 };
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

function hsvToHex({ h, s, v }: Hsv): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  const to = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${to(f(5))}${to(f(3))}${to(f(1))}`;
}

type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> };

export function ColorPicker({ value, onChange, allowNone = false }: { value: string; onChange: (c: string) => void; allowNone?: boolean }) {
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value));
  const [hex, setHex] = useState(value === 'transparent' ? '' : value);
  const box = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (/^#[0-9a-f]{6}$/i.test(value)) {
      setHex(value);
      setHsv((old) => (hsvToHex(old).toLowerCase() === value.toLowerCase() ? old : hexToHsv(value)));
    }
  }, [value]);

  const put = (next: Hsv) => {
    setHsv(next);
    const c = hsvToHex(next);
    setHex(c);
    onChange(c);
  };
  /** Dragging in the spectrum (or the hue strip): the colour follows the pointer. */
  const drag = (e: ReactPointerEvent, el: HTMLDivElement | null, read: (fx: number, fy: number) => Hsv) => {
    if (!el) return;
    e.preventDefault();
    const at = (ev: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect();
      put(read(Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height))));
    };
    at(e);
    const move = (ev: PointerEvent) => at(ev);
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  };
  const Dropper = (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper;

  return (
    <div className="color-picker" data-color-picker onPointerDown={(e) => e.stopPropagation()}>
      <div className="cp-palette">
        {PALETTE.filter((c) => allowNone || c !== 'transparent').map((c) => (
          <button
            key={c}
            className={['cp-swatch', c === 'transparent' && 'none', c.toLowerCase() === value.toLowerCase() && 'on'].filter(Boolean).join(' ')}
            style={c === 'transparent' ? undefined : { background: c }}
            title={c === 'transparent' ? tr('없음', 'None') : c}
            data-color={c}
            onClick={() => {
              onChange(c);
              if (c !== 'transparent') {
                setHex(c);
                setHsv(hexToHsv(c));
              }
            }}
          />
        ))}
      </div>
      <div
        className="cp-spectrum"
        ref={box}
        data-spectrum
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h} 100% 50%))` }}
        onPointerDown={(e) => drag(e, box.current, (fx, fy) => ({ h: hsv.h, s: fx, v: 1 - fy }))}
      >
        <span className="cp-knob" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} />
      </div>
      <div className="cp-hue" ref={strip} data-hue onPointerDown={(e) => drag(e, strip.current, (fx) => ({ ...hsv, h: fx * 360 }))}>
        <span className="cp-knob" style={{ left: `${(hsv.h / 360) * 100}%`, top: '50%' }} />
      </div>
      <div className="cp-row">
        <span className="cp-now" style={{ background: value === 'transparent' ? undefined : value }} />
        <input
          className="cp-hex"
          value={hex}
          placeholder="#rrggbb"
          spellCheck={false}
          onChange={(e) => {
            const v = e.target.value.trim();
            setHex(v);
            const full = v.startsWith('#') ? v : '#' + v;
            if (/^#[0-9a-f]{6}$/i.test(full)) {
              setHsv(hexToHsv(full));
              onChange(full.toLowerCase());
            }
          }}
        />
        <button
          className="cp-dropper"
          disabled={!Dropper}
          data-eyedropper
          title={Dropper ? tr('스포이드: 화면의 색 가져오기', 'Eyedropper: take a colour from the screen') : tr('이 브라우저에서는 스포이드를 쓸 수 없습니다', 'No eyedropper in this browser')}
          onClick={async () => {
            if (!Dropper) return;
            try {
              const { sRGBHex } = await new Dropper().open();
              setHex(sRGBHex);
              setHsv(hexToHsv(sRGBHex));
              onChange(sRGBHex.toLowerCase());
            } catch {
              // Cancelled with Esc.
            }
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M14.5 4.5l5 5M17 2.5a2.1 2.1 0 013 3l-2 2-3-3zM15 6.5l-9.5 9.5-1 4 4-1L18 9.5" />
          </svg>
        </button>
      </div>
    </div>
  );
}
