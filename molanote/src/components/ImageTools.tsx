import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { Commit, El, Stroke } from '../types';
import { uid, update } from '../model';
import { getBlob, putBlob } from '../db';
import { distToStroke, inkWidth, INK_COLORS, pushPoint, strokeD, HIGHLIGHT_FACTOR, HIGHLIGHT_OPACITY } from '../draw';
import { useBlobUrl } from './Avatar';
import { Icon } from './Icon';
import { InkLayer } from './Ink';
import { tr } from '../i18n';

type Tool = 'pen' | 'highlighter' | 'eraser';
const SIZES = [3, 6, 12];

/** Keeps the dialog's own shortcuts away from the board behind it. */
function useDialogKeys(handlers: Record<string, () => void>) {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const name = e.key === 'Escape' ? 'escape' : mod && e.key === 'Enter' ? 'save' : mod && k === 'z' ? (e.shiftKey ? 'redo' : 'undo') : mod && k === 'y' ? 'redo' : '';
      e.stopPropagation();
      if (name && ref.current[name]) {
        e.preventDefault();
        ref.current[name]();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
}

/**
 * Draw on an image with a pen, a highlighter or an eraser, with its own undo and redo.
 * The ink is saved over the image; the image itself is not changed.
 */
export function DrawImageDialog({ el, commit, onClose }: { el: El; commit: Commit; onClose: () => void }) {
  const url = useBlobUrl(el.content.blobKey);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const height = el.content.drawH ?? (nat ? (1000 * nat.h) / nat.w : 1000);
  const [strokes, setStrokes] = useState<Stroke[]>(el.content.strokes ?? []);
  const [past, setPast] = useState<Stroke[][]>([]);
  const [future, setFuture] = useState<Stroke[][]>([]);
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState(INK_COLORS[1]);
  const [size, setSize] = useState(SIZES[1]);
  const [live, setLive] = useState<number[] | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const change = (next: Stroke[]) => {
    setPast((p) => [...p, strokes]);
    setFuture([]);
    setStrokes(next);
  };
  const undo = () => {
    if (!past.length) return;
    setFuture((f) => [strokes, ...f]);
    setStrokes(past[past.length - 1]);
    setPast((p) => p.slice(0, -1));
  };
  const redo = () => {
    if (!future.length) return;
    setPast((p) => [...p, strokes]);
    setStrokes(future[0]);
    setFuture((f) => f.slice(1));
  };
  const save = () => {
    commit((m) => update(m, el.id, { content: { strokes: strokes.length ? strokes : undefined, drawH: height } }));
    onClose();
  };
  // Ctrl+Enter saves, as the Save button does.
  useDialogKeys({ undo, redo, escape: onClose, save });

  const local = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * 1000, y: ((e.clientY - r.top) / r.height) * height };
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const p = local(e);
    if (tool === 'eraser') {
      let current = strokes;
      let touched = false;
      const rub = (x: number, y: number) => {
        const left = current.filter((s) => distToStroke(s.points, x, y) > 10 + inkWidth(s) / 2);
        if (left.length === current.length) return;
        if (!touched) setPast((h) => [...h, current]);
        touched = true;
        setFuture([]);
        current = left;
        setStrokes(left);
      };
      rub(p.x, p.y);
      const move = (ev: PointerEvent) => {
        const q = local(ev);
        rub(q.x, q.y);
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
    pushPoint(points, p.x, p.y, 0);
    setLive([...points]);
    const move = (ev: PointerEvent) => {
      const q = local(ev);
      pushPoint(points, q.x, q.y, 1.5);
      setLive([...points]);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setLive(null);
      change([...strokes, { id: uid(), tool, color, size, points }]);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="gate-backdrop soft">
      <div className="image-tool" role="dialog" aria-modal="true" aria-label={tr('이미지에 그리기', 'Draw on image')}>
        <div className="image-tool-head">
          <strong>{tr('그리기', 'Draw')}</strong>
          <div className="ink-tools" role="toolbar">
            {(['highlighter', 'pen', 'eraser'] as const).map((t) => (
              <button
                key={t}
                className={tool === t ? 'on' : ''}
                data-ink-tool={t}
                title={t === 'pen' ? tr('펜', 'Pen') : t === 'highlighter' ? tr('형광펜', 'Highlighter') : tr('지우개', 'Eraser')}
                onClick={() => {
                  setTool(t);
                  if (t === 'highlighter' && color === INK_COLORS[0]) setColor('#ffe066');
                }}
              >
                <Icon name={t} size={19} />
              </button>
            ))}
            <span className="ink-sep" />
            {INK_COLORS.map((c) => (
              <button
                key={c}
                className={color === c ? 'ink-dot on' : 'ink-dot'}
                style={{ background: c }}
                title={c}
                data-ink-color={c}
                onClick={() => setColor(c)}
              />
            ))}
            <span className="ink-sep" />
            {SIZES.map((s) => (
              <button key={s} className={size === s ? 'ink-size on' : 'ink-size'} title={tr(`굵기 ${s}`, `Size ${s}`)} onClick={() => setSize(s)}>
                <span style={{ width: s + 2, height: s + 2 }} />
              </button>
            ))}
            <span className="ink-sep" />
            <button onClick={undo} disabled={!past.length} title={tr('실행 취소 (Ctrl+Z)', 'Undo (Ctrl+Z)')} data-ink-action="undo">
              <Icon name="undo" size={19} />
            </button>
            <button onClick={redo} disabled={!future.length} title={tr('다시 실행 (Ctrl+Shift+Z)', 'Redo (Ctrl+Shift+Z)')} data-ink-action="redo">
              <Icon name="redo" size={19} />
            </button>
          </div>
        </div>
        <div className="image-tool-stage">
          <div className="image-tool-frame">
            {url && (
              <img
                src={url}
                alt=""
                draggable={false}
                onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
              />
            )}
            {nat && (
              <svg
                ref={svgRef}
                className={`ink-surface tool-${tool}`}
                viewBox={`0 0 1000 ${height}`}
                preserveAspectRatio="none"
                onPointerDown={onPointerDown}
              >
                <InkLayerInner strokes={strokes} />
                {live && (
                  <path
                    d={strokeD(live)}
                    fill="none"
                    stroke={color}
                    strokeWidth={tool === 'highlighter' ? size * HIGHLIGHT_FACTOR : size}
                    strokeOpacity={tool === 'highlighter' ? HIGHLIGHT_OPACITY : 1}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}
              </svg>
            )}
          </div>
        </div>
        <div className="image-tool-foot">
          <span className="muted small">{tr(`${strokes.length}개 획`, `${strokes.length} strokes`)}</span>
          <button className="gate-secondary" onClick={onClose}>
            {tr('취소', 'Cancel')}
          </button>
          <button className="gate-primary" onClick={save}>
            {tr('저장', 'Save')} <kbd className="tool-kbd">Ctrl+Enter</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}

/** Strokes drawn inside an existing <svg> (the editor's drawing surface). */
function InkLayerInner({ strokes }: { strokes: Stroke[] }) {
  return (
    <>
      {strokes.map((s) => (
        <path
          key={s.id}
          d={strokeD(s.points)}
          fill="none"
          stroke={s.color}
          strokeWidth={s.tool === 'highlighter' ? s.size * HIGHLIGHT_FACTOR : s.size}
          strokeOpacity={s.tool === 'highlighter' ? HIGHLIGHT_OPACITY : 1}
          strokeLinecap="round"
          strokeLinejoin="round"
          data-tool={s.tool}
        />
      ))}
    </>
  );
}

type Rect = { x: number; y: number; w: number; h: number };
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

async function decode(blob: Blob): Promise<CanvasImageSource & { width: number; height: number }> {
  try {
    return await createImageBitmap(blob);
  } catch {
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return Object.assign(img, { width: img.naturalWidth, height: img.naturalHeight });
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/**
 * Crop an image: drag to draw the area to keep, drag inside it to move it, or drag a corner to
 * resize it. Applying replaces the stored image with the cropped one; ink on it is kept in place.
 */
export function CropImageDialog({ el, commit, onClose }: { el: El; commit: Commit; onClose: () => void }) {
  const url = useBlobUrl(el.content.blobKey);
  const [rect, setRect] = useState<Rect>({ x: 0, y: 0, w: 1, h: 1 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  // Ctrl+Enter crops, as the Apply button does.
  useDialogKeys({ escape: onClose, save: () => void applyRef.current() });

  const frac = (e: { clientX: number; clientY: number }) => {
    const r = frameRef.current!.getBoundingClientRect();
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) };
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const start = frac(e);
    const r0 = rect;
    const handle = (e.target as HTMLElement).dataset.handle;
    // While the whole image is selected a drag draws a new area; afterwards a drag inside moves it.
    const whole = r0.x <= 0 && r0.y <= 0 && r0.w >= 1 && r0.h >= 1;
    const inside = !whole && start.x > r0.x && start.x < r0.x + r0.w && start.y > r0.y && start.y < r0.y + r0.h;
    const min = 0.03;
    const move = (ev: PointerEvent) => {
      const p = frac(ev);
      if (handle) {
        // Resize from the dragged corner; the opposite corner stays put.
        const ax = handle.includes('w') ? r0.x + r0.w : r0.x;
        const ay = handle.includes('n') ? r0.y + r0.h : r0.y;
        setRect({
          x: Math.min(ax, p.x),
          y: Math.min(ay, p.y),
          w: Math.max(min, Math.abs(p.x - ax)),
          h: Math.max(min, Math.abs(p.y - ay)),
        });
      } else if (inside) {
        const dx = p.x - start.x;
        const dy = p.y - start.y;
        setRect({ ...r0, x: Math.min(1 - r0.w, Math.max(0, r0.x + dx)), y: Math.min(1 - r0.h, Math.max(0, r0.y + dy)) });
      } else {
        setRect({
          x: Math.min(start.x, p.x),
          y: Math.min(start.y, p.y),
          w: Math.max(min, Math.abs(p.x - start.x)),
          h: Math.max(min, Math.abs(p.y - start.y)),
        });
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const applyRef = useRef<() => Promise<void> | void>(() => {});
  const apply = async () => {
    const key = el.content.blobKey;
    if (!key) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await getBlob(key);
      if (!blob) throw new Error(tr('이미지를 찾을 수 없습니다', 'Image not found'));
      const img = await decode(blob);
      const sx = Math.round(rect.x * img.width);
      const sy = Math.round(rect.y * img.height);
      const sw = Math.max(1, Math.round(rect.w * img.width));
      const sh = Math.max(1, Math.round(rect.h * img.height));
      const canvas = document.createElement('canvas');
      canvas.width = sw;
      canvas.height = sh;
      canvas.getContext('2d')!.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      const type = ['image/png', 'image/jpeg', 'image/webp'].includes(blob.type) ? blob.type : 'image/png';
      const out = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error(tr('자르기 실패', 'Crop failed')))), type, 0.92));
      const newKey = await putBlob(out);
      const h0 = el.content.drawH ?? (1000 * img.height) / img.width;
      const h1 = (1000 * sh) / sw;
      const strokes = el.content.strokes?.map((s) => ({
        ...s,
        size: s.size / rect.w,
        points: s.points.map((v, i) => (i % 2 ? ((v / h0 - rect.y) / rect.h) * h1 : ((v / 1000 - rect.x) / rect.w) * 1000)),
      }));
      commit((m) => update(m, el.id, { content: { blobKey: newKey, strokes, drawH: strokes ? h1 : undefined } }));
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  applyRef.current = apply;
  const full = rect.x === 0 && rect.y === 0 && rect.w === 1 && rect.h === 1;
  return (
    <div className="gate-backdrop soft">
      <div className="image-tool" role="dialog" aria-modal="true" aria-label={tr('이미지 자르기', 'Crop image')}>
        <div className="image-tool-head">
          <strong>{tr('Edit · 자르기', 'Edit · Crop')}</strong>
          <span className="muted small">{tr('남길 영역을 끌어서 고르세요. 안쪽을 끌면 옮기고, 모서리를 끌면 크기가 바뀝니다.', 'Drag to select the area to keep. Drag inside to move, drag corners to resize.')}</span>
        </div>
        <div className="image-tool-stage">
          <div className="image-tool-frame crop-frame" ref={frameRef} onPointerDown={onPointerDown}>
            {url && <img src={url} alt="" draggable={false} />}
            {el.content.strokes?.length ? (
              <InkLayer className="image-ink" strokes={el.content.strokes} width={1000} height={el.content.drawH ?? 1000} />
            ) : null}
            <div
              className="crop-rect"
              style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` }}
            >
              {(['nw', 'ne', 'sw', 'se'] as const).map((h) => (
                <span key={h} className={`crop-handle ${h}`} data-handle={h} />
              ))}
            </div>
          </div>
        </div>
        <div className="image-tool-foot">
          {error && <span className="gate-error">{error}</span>}
          <button className="gate-secondary" onClick={() => setRect({ x: 0, y: 0, w: 1, h: 1 })} disabled={full}>
            {tr('전체 선택', 'Select all')}
          </button>
          <button className="gate-secondary" onClick={onClose}>
            {tr('취소', 'Cancel')}
          </button>
          <button className="gate-primary" onClick={apply} disabled={busy || full}>
            {busy ? tr('자르는 중…', 'Cropping…') : tr('자르기', 'Crop')}
          </button>
        </div>
      </div>
    </div>
  );
}
