import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** "설명 (Ctrl+Z)": the text and the shortcut, which is shown in a key cap. */
const SHORTCUT = /^(.*?)\s*\(((?:Ctrl|Shift|Alt|Cmd|Esc|Enter|Delete|Tab|F\d{1,2}|[A-Z0-9])(?:[+ /][^()]*)?)\)$/;

type Tip = { text: string; keys?: string; side: 'right' | 'below' | 'above'; x: number; y: number };

/**
 * Moves an element's title into data-tip, so the browser never shows its own grey box. Controls
 * that have no text of their own keep the description as their accessible name.
 */
function takeTitle(el: Element) {
  const text = el.getAttribute('title');
  if (text === null) return;
  el.removeAttribute('title');
  el.setAttribute('data-tip', text);
  if (text && !el.hasAttribute('aria-label') && !el.textContent?.trim()) el.setAttribute('aria-label', text);
}

/**
 * Black hover bubbles for everything with a title (or data-tip). Every title in the page is turned
 * into data-tip as soon as it appears, so only these bubbles ever show. A shortcut in brackets at
 * the end of the text, or in data-keys, is shown as a key cap.
 */
export function Tooltips() {
  const [tip, setTip] = useState<Tip | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [nudge, setNudge] = useState(0);

  useEffect(() => {
    // Titles already on the page, and every one React (or anything else) adds later.
    document.querySelectorAll('[title]').forEach(takeTitle);
    const watch = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'attributes') takeTitle(r.target as Element);
        else
          for (const n of Array.from(r.addedNodes)) {
            if (!(n instanceof Element)) continue;
            takeTitle(n);
            n.querySelectorAll('[title]').forEach(takeTitle);
          }
      }
    });
    watch.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['title'] });

    let timer = 0;
    let current: Element | null = null;
    const hide = () => {
      clearTimeout(timer);
      current = null;
      setTip(null);
    };
    const over = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const target = e.target as Element | null;
      // A title that slipped in between two checks is taken now, before the browser can show it.
      target?.closest?.('[title]') && takeTitle(target.closest('[title]')!);
      const el = target?.closest?.('[data-tip]') ?? null;
      if (el === current) return;
      hide();
      if (!el) return;
      current = el;
      timer = window.setTimeout(() => {
        if (!current?.isConnected) return;
        const text = current.getAttribute('data-tip') ?? '';
        if (!text.trim()) return;
        const keysAttr = current.getAttribute('data-keys');
        const r = current.getBoundingClientRect();
        const m = keysAttr ? null : text.match(SHORTCUT);
        const side: Tip['side'] = r.right < 160 ? 'right' : r.bottom + 48 > innerHeight ? 'above' : 'below';
        setTip({
          text: m ? m[1] : text,
          keys: keysAttr ?? m?.[2],
          side,
          x: side === 'right' ? r.right + 10 : r.left + r.width / 2,
          y: side === 'right' ? r.top + r.height / 2 : side === 'below' ? r.bottom + 9 : r.top - 9,
        });
      }, 280);
    };
    const out = (e: PointerEvent) => {
      if (!e.relatedTarget) hide();
    };
    addEventListener('pointerover', over, true);
    addEventListener('pointerout', out, true);
    addEventListener('pointerdown', hide, true);
    addEventListener('wheel', hide, true);
    addEventListener('keydown', hide, true);
    addEventListener('blur', hide);
    return () => {
      watch.disconnect();
      hide();
      removeEventListener('pointerover', over, true);
      removeEventListener('pointerout', out, true);
      removeEventListener('pointerdown', hide, true);
      removeEventListener('wheel', hide, true);
      removeEventListener('keydown', hide, true);
      removeEventListener('blur', hide);
    };
  }, []);

  /* Keeps a centred bubble inside the window. */
  useLayoutEffect(() => {
    const n = ref.current;
    if (!tip || !n || tip.side === 'right') {
      if (nudge) setNudge(0);
      return;
    }
    const w = n.offsetWidth;
    const left = tip.x - w / 2;
    const next = left < 8 ? 8 - left : left + w > innerWidth - 8 ? innerWidth - 8 - (left + w) : 0;
    if (next !== nudge) setNudge(next);
  }, [tip]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!tip) return null;
  return createPortal(
    <div
      ref={ref}
      className={`hover-tip ${tip.side}`}
      role="tooltip"
      style={{ left: tip.x + nudge, top: tip.y, ['--arrow-shift' as string]: `${-nudge}px` }}
    >
      <span>{tip.text}</span>
      {tip.keys && <kbd>{tip.keys}</kbd>}
    </div>,
    document.body,
  );
}
