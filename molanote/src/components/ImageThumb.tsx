import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { El } from '../types';
import { blobUrl, cachedBlobUrl } from '../db';
import { sketchDataUrl } from '../draw';
import { COLORS } from '../types';
import { DiagramView } from './DiagramView';

/**
 * A picture's thumbnail beside the search result picked (by the arrow keys or the mouse): every
 * image is called "Image" in a list, so this shows which one it is.
 */
export function ImageThumb({ el, anchor, side }: { el: El | null; anchor: HTMLElement | null; side: 'left' | 'right' }) {
  // A drawing is drawn from its strokes; a picture is loaded from its file.
  const sketch = el?.type === 'SKETCH' ? sketchDataUrl(el, el.content.bg ? COLORS[el.content.bg] : '#fff') : undefined;
  const key =
    el?.type === 'IMAGE' ? el.content.blobKey : sketch ? 'sketch:' + el!.id + ':' + (el!.updatedAt ?? 0) : el?.type === 'DIAGRAM' ? 'diagram:' + el.id + ':' + (el.updatedAt ?? 0) : undefined;
  const [src, setSrc] = useState<string | undefined>(key && !sketch ? (cachedBlobUrl(key) ?? undefined) : sketch);
  const [at, setAt] = useState<{ top: number; left?: number; right?: number } | null>(null);

  useEffect(() => {
    if (!key) {
      setSrc(undefined);
      return;
    }
    if (sketch) {
      setSrc(sketch);
      return;
    }
    if (key.startsWith('diagram:')) return;
    const cached = cachedBlobUrl(key) ?? undefined;
    setSrc(cached);
    let live = true;
    if (!cached) blobUrl(key).then((u) => live && u && setSrc(u));
    return () => {
      live = false;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    if (!anchor || !key) {
      setAt(null);
      return;
    }
    const r = anchor.getBoundingClientRect();
    const top = Math.max(8, Math.min(window.innerHeight - 200, r.top + r.height / 2 - 90));
    setAt(side === 'right' ? { top, left: r.right + 12 } : { top, right: window.innerWidth - r.left + 12 });
  }, [anchor, key, side]);

  // A diagram is drawn as it is (no file to load).
  if (el?.type === 'DIAGRAM' && at)
    return createPortal(
      <div className="image-thumb diagram-thumb" data-image-thumb={el.id} style={{ top: at.top, left: at.left, right: at.right }} aria-hidden="true">
        <DiagramView d={el.content.diagram} />
      </div>,
      document.body,
    );
  if (!key || !at || !src) return null;
  return createPortal(
    <div className="image-thumb" data-image-thumb={el!.id} style={{ top: at.top, left: at.left, right: at.right }} aria-hidden="true">
      <img src={src} alt="" draggable={false} />
    </div>,
    document.body,
  );
}

/**
 * The row under the pointer becomes the picked one only when the pointer really moves: a list
 * scrolled by the arrow keys slides rows under a still pointer, and that must not pick them.
 */
export function usePointerPick(pick: (i: number) => void) {
  const last = useRef('');
  return (i: number) => (e: { clientX: number; clientY: number }) => {
    const at = `${e.clientX},${e.clientY}`;
    if (at === last.current) return;
    last.current = at;
    pick(i);
  };
}
