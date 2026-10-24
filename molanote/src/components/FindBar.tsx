import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { tr } from '../i18n';
import { Icon } from './Icon';

/** A text box of a to-do: a textarea, or the to-do's own box (it answers like one). */
type Box = HTMLElement & { value: string; setSelectionRange: (a: number, b: number) => void };
type Hit = { range?: Range; box?: Box; start: number; end: number };

/** CSS highlights where the browser has them (they colour text without touching the note). */
const highlights = (globalThis as unknown as { CSS?: { highlights?: Map<string, unknown> } }).CSS?.highlights;
const Highlight = (globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;

/** Every place `q` is found in the text of the block being edited (a note's text, or a to-do list's items). */
function findIn(block: HTMLElement, q: string): Hit[] {
  const needle = q.toLowerCase();
  if (!needle) return [];
  const hits: Hit[] = [];
  const editor = block.querySelector<HTMLElement>('[contenteditable=true]:not([data-task-box])');
  if (editor) {
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, {
      // What embeds show is not the note's own text.
      acceptNode: (n) => (n.parentElement?.closest('.embed-show') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
      const text = n.data.toLowerCase();
      for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + needle.length)) {
        const range = document.createRange();
        range.setStart(n, at);
        range.setEnd(n, at + needle.length);
        hits.push({ range, start: at, end: at + needle.length });
      }
    }
    return hits;
  }
  for (const box of Array.from(block.querySelectorAll<Box>('textarea, [data-task-box]'))) {
    const text = box.value.toLowerCase();
    for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + needle.length)) hits.push({ box, start: at, end: at + needle.length });
  }
  return hits;
}

/**
 * Ctrl+F while a note or to-do list is edited: finds text inside that block. Every match is
 * marked, the current one more strongly; Enter / Shift+Enter go to the next / previous one;
 * Escape closes it with the caret on the current match.
 */
export function FindBar({ blockId, onClose }: { blockId: string; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [at, setAt] = useState(0);
  const [tick, setTick] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const block = () => document.querySelector<HTMLElement>(`.layer [data-el-id="${blockId}"], .unsorted-panel [data-el-id="${blockId}"]`);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  // The block's text may change while the bar is open.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 700);
    return () => clearInterval(t);
  }, []);

  const hits = useMemo(() => {
    const b = block();
    return b ? findIn(b, q) : [];
  }, [q, tick, blockId]); // eslint-disable-line react-hooks/exhaustive-deps
  const cur = hits.length ? Math.min(at, hits.length - 1) : -1;

  // Marks: all matches, and the current one.
  useEffect(() => {
    const b = block();
    for (const li of Array.from(document.querySelectorAll('.find-hit'))) li.classList.remove('find-hit');
    if (highlights && Highlight) {
      highlights.set('find-all', new Highlight(...hits.filter((h) => h.range).map((h) => h.range!)));
      highlights.set('find-now', new Highlight(...(cur >= 0 && hits[cur].range ? [hits[cur].range!] : [])));
    }
    const h = cur >= 0 ? hits[cur] : null;
    if (!b || !h) return;
    if (h.box) h.box.closest('li')?.classList.add('find-hit');
    // Into view inside the block's own scrolling area.
    const r = h.range ? h.range.getBoundingClientRect() : h.box!.getBoundingClientRect();
    const scroller = (h.range?.startContainer.parentElement ?? h.box)?.closest<HTMLElement>('.note-scroll, .tasks-scroll');
    if (scroller) {
      const sr = scroller.getBoundingClientRect();
      // (Screen pixels to the scroll area's own: the board may be zoomed.)
      const k = scroller.offsetHeight ? sr.height / scroller.offsetHeight || 1 : 1;
      if (r.top < sr.top || r.bottom > sr.bottom) scroller.scrollTop += (r.top - sr.top - sr.height / 2) / k;
    }
  }, [hits, cur]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(
    () => () => {
      highlights?.delete('find-all');
      highlights?.delete('find-now');
      for (const li of Array.from(document.querySelectorAll('.find-hit'))) li.classList.remove('find-hit');
    },
    [],
  );

  /** Closing: back to the block, with the current match picked. */
  const close = () => {
    const h = cur >= 0 ? hits[cur] : null;
    onClose();
    if (h?.range) {
      const editor = h.range.startContainer.parentElement?.closest<HTMLElement>('[contenteditable=true]');
      editor?.focus({ preventScroll: true });
      const sel = getSelection();
      sel?.removeAllRanges();
      sel?.addRange(h.range);
    } else if (h?.box) {
      h.box.focus({ preventScroll: true });
      h.box.setSelectionRange(h.start, h.end);
    }
  };

  return createPortal(
    <div className="find-bar" data-find-bar role="search">
      <Icon name="search" size={15} />
      <input
        ref={inputRef}
        value={q}
        placeholder={tr('이 블록에서 찾기', 'Find in this block')}
        onChange={(e) => {
          setQ(e.target.value);
          setAt(0);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.nativeEvent.isComposing) return;
          if (e.key === 'Enter') {
            e.preventDefault();
            if (hits.length) setAt((i) => (e.shiftKey ? (i - 1 + hits.length) % hits.length : (i + 1) % hits.length));
          } else if (e.key === 'Escape') {
            e.preventDefault();
            close();
          }
        }}
      />
      <span className="find-count" data-find-count>
        {q ? (hits.length ? `${cur + 1}/${hits.length}` : tr('없음', 'None')) : ''}
      </span>
      <button title={tr('이전 (Shift+Enter)', 'Previous (Shift+Enter)')} disabled={!hits.length} onClick={() => setAt((i) => (i - 1 + hits.length) % hits.length)}>
        ↑
      </button>
      <button title={tr('다음 (Enter)', 'Next (Enter)')} disabled={!hits.length} onClick={() => setAt((i) => (i + 1) % hits.length)}>
        ↓
      </button>
      <button title={tr('닫기 (Esc)', 'Close (Esc)')} onClick={close}>
        <Icon name="close" size={13} />
      </button>
    </div>,
    document.body,
  );
}
