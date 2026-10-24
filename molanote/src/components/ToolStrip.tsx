import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { tr } from '../i18n';

export type StripItem = { key: string; node: ReactNode; active?: boolean };

/** Height of the thin "more" card plus its breathing room; kept in step with App.css. */
const MORE_H = 26;

/**
 * The left tool column. Tools that don't fit the window height move into a
 * "more" flyout instead of making the column scroll.
 */
export function ToolStrip({ items, footer, inert }: { items: StripItem[]; footer: ReactNode; inert?: boolean }) {
  const paneRef = useRef<HTMLDivElement>(null);
  const footRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const flyRef = useRef<HTMLDivElement>(null);
  const heights = useRef<Record<string, number>>({});
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const [fit, setFit] = useState(items.length);
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const keys = items.map((i) => i.key).join('|');

  useLayoutEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;
    const measure = () => {
      // Shown slots keep their measured height; hidden ones reuse the last one seen.
      pane.querySelectorAll<HTMLElement>(':scope > .tool-slot').forEach((n) => {
        if (n.offsetHeight) heights.current[n.dataset.slot!] = n.offsetHeight;
      });
      const cs = getComputedStyle(pane);
      const gap = parseFloat(cs.rowGap) || 0;
      const spacer = 8;
      const avail =
        pane.clientHeight -
        parseFloat(cs.paddingTop) -
        parseFloat(cs.paddingBottom) -
        (footRef.current?.offsetHeight ?? 0) -
        spacer -
        gap;
      const hs = itemsRef.current.map((i) => heights.current[i.key] ?? 64);
      const total = hs.reduce((sum, h) => sum + h + gap, 0);
      if (total <= avail) {
        setFit(hs.length);
        return;
      }
      let used = MORE_H + gap;
      let k = 0;
      while (k < hs.length && used + hs[k] + gap <= avail) used += hs[k++] + gap;
      setFit(k);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(pane);
    return () => ro.disconnect();
  }, [keys]);

  const hidden = items.slice(fit);
  const isOpen = open && hidden.length > 0;

  // Place the flyout beside the "more" card, kept inside the window.
  useLayoutEffect(() => {
    if (!isOpen) {
      setPos(null);
      return;
    }
    const b = moreRef.current?.getBoundingClientRect();
    const f = flyRef.current?.getBoundingClientRect();
    if (!b || !f) return;
    const top = Math.max(8, Math.min(b.top - 8, innerHeight - f.height - 8));
    setPos({ left: b.right + 10, top });
  }, [isOpen, hidden.length]);

  useEffect(() => {
    if (!isOpen) return;
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (flyRef.current?.contains(t) || moreRef.current?.contains(t)) return;
      setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    addEventListener('pointerdown', down, true);
    addEventListener('keydown', key, true);
    return () => {
      removeEventListener('pointerdown', down, true);
      removeEventListener('keydown', key, true);
    };
  }, [isOpen]);

  const hiddenActive = hidden.some((i) => i.active);
  const cols = Math.max(1, Math.ceil(hidden.length / 5));

  return (
    <>
      <div ref={paneRef} className="toolbar-pane tools-pane" data-fit={fit} inert={inert}>
        {items.slice(0, fit).map((i) => (
          <div key={i.key} className="tool-slot" data-slot={i.key}>
            {i.node}
          </div>
        ))}
        {hidden.length > 0 && (
          <button
            ref={moreRef}
            className={'tool-more' + (isOpen || hiddenActive ? ' on' : '')}
            onClick={() => setOpen(!isOpen)}
            title={tr(`도구 더보기 (${hidden.length}개)`, `More tools (${hidden.length})`)}
            aria-expanded={isOpen}
          >
            <Icon name="more" size={16} />
          </button>
        )}
        <div className="toolbar-spacer" />
        <div ref={footRef} className="tool-foot">
          {footer}
        </div>
      </div>
      {isOpen &&
        createPortal(
          <div
            ref={flyRef}
            className={'tool-more-fly' + (dragging ? ' dragging' : '')}
            style={{
              left: pos?.left ?? 0,
              top: pos?.top ?? 0,
              visibility: pos ? undefined : 'hidden',
              gridTemplateColumns: `repeat(${cols}, auto)`,
            }}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest('.tool')) setOpen(false);
            }}
            onDragStart={() => setDragging(true)}
            onDragEnd={() => {
              setDragging(false);
              setOpen(false);
            }}
          >
            {hidden.map((i) => (
              <div key={i.key} className="tool-slot" data-slot={i.key}>
                {i.node}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
