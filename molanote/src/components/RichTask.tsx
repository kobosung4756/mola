import { forwardRef, useLayoutEffect, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { mathMatches } from './MathEditor';

/*
 * A to-do's text being typed in, shown with its marks applied: **bold**, `code`, ~~struck~~,
 * ==highlighted==, {#e03131|coloured} and {=#ffd8a8|highlighted in a colour}. The marks stay in the
 * text (that is what is saved) but are hidden while typing; formulas stay as $ … $.
 *
 * The box is a contentEditable element that behaves like the text box it replaces: it has
 * value, selectionStart, selectionEnd and setSelectionRange, all counted in the text with its marks.
 */

export type TaskBox = HTMLDivElement & {
  value: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
  setSelectionRange: (start: number, end: number) => void;
};

/** The marks a to-do's text may have; each shows its inside styled and its marks hidden. */
const MARKS =
  /\*\*(?=\S)([^*\n]+?)\*\*|`([^`\n]+)`|~~([^~\n]+?)~~|==([^=\n]+?)==|\{(#[0-9a-fA-F]{6})\|([^{}\n]+)\}|\{=(#[0-9a-fA-F]{6})\|([^{}\n]+)\}/g;
export { MARKS as TASK_MARKS, allMarks as allTaskMarks };

/** The opening and closing mark of a match of MARKS. */
function marksOf(m: RegExpMatchArray): [string, string] {
  if (m[1] !== undefined) return ['**', '**'];
  if (m[2] !== undefined) return ['`', '`'];
  if (m[3] !== undefined) return ['~~', '~~'];
  if (m[4] !== undefined) return ['==', '=='];
  if (m[5] !== undefined) return [`{${m[5]}|`, '}'];
  return [`{=${m[7]}|`, '}'];
}

/** Every mark of the text, those inside other marks too: where it starts and ends, and its two halves. */
export function allMarks(text: string, offset = 0, depth = 0): { at: number; end: number; open: string; close: string }[] {
  const out: { at: number; end: number; open: string; close: string }[] = [];
  if (depth > 4) return out;
  for (const m of text.matchAll(MARKS)) {
    const at = offset + (m.index ?? 0);
    const [open, close] = marksOf(m);
    out.push({ at, end: at + m[0].length, open, close });
    if (m[2] === undefined) out.push(...allMarks(m[0].slice(open.length, m[0].length - close.length), at + open.length, depth + 1));
  }
  return out;
}

/** Marks with nothing inside ({#e03131|}, ****, ====) left by a cut. */
const EMPTY_MARKS = /\{=?#[0-9a-fA-F]{6}\|\}|\*\*\*\*|~~~~|====/g;

/**
 * The text before `a` and after `b`, cut so that no mark is left open: every styled piece cut
 * through (and the ones around it) is closed on the left and opened again on the right, so a to-do
 * split with Enter keeps its colours and bold instead of leaving "{#1971c2|" on one line and "}" on the next.
 */
export function cutMarked(text: string, a: number, b: number): [string, string] {
  const marks = allMarks(text);
  // A cut inside a hidden mark moves out of it: before the piece (or to its inside, for the end of a pick).
  for (const k of marks) {
    if (a > k.at && a < k.at + k.open.length) a = k.at;
    else if (a > k.end - k.close.length && a < k.end) a = k.end - k.close.length;
    if (b > k.at && b < k.at + k.open.length) b = k.at + k.open.length;
    else if (b > k.end - k.close.length && b < k.end) b = k.end;
  }
  const around = (pos: number) => marks.filter((k) => k.at < pos && pos < k.end).sort((x, y) => x.at - y.at);
  let before = text.slice(0, a) + around(a).reverse().map((k) => k.close).join('');
  let after = around(b).map((k) => k.open).join('') + text.slice(b);
  for (let i = 0; i < 4; i++) {
    before = before.replace(EMPTY_MARKS, '');
    after = after.replace(EMPTY_MARKS, '');
  }
  return [before, after];
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/**
 * A zero-width space after a styled piece that ends the text: it holds the caret outside the
 * piece's hidden closing mark, so what is typed at the end of the line is plain. Never saved.
 */
const ZW = '\u200B';
const ZWS = /\u200B/g;
const mk = (s: string) => `<span class="mk">${esc(s)}</span>`;

/** The text with its marks applied; marks may hold others ({#e03131|**bold red**}, =={#1971c2|blue}==). */
function marked(text: string, depth = 0): string {
  if (depth > 4) return esc(text);
  const inner = (s: string) => marked(s, depth + 1);
  let out = '';
  let last = 0;
  for (const m of text.matchAll(MARKS)) {
    const at = m.index ?? 0;
    out += esc(text.slice(last, at));
    const whole = m[0];
    if (m[1] !== undefined) out += mk('**') + `<b>${inner(m[1])}</b>` + mk('**');
    else if (m[2] !== undefined) out += mk('`') + `<code>${esc(m[2])}</code>` + mk('`');
    else if (m[3] !== undefined) out += mk('~~') + `<s>${inner(m[3])}</s>` + mk('~~');
    else if (m[4] !== undefined) out += mk('==') + `<mark class="hl">${inner(m[4])}</mark>` + mk('==');
    else if (m[5] !== undefined) out += mk(`{${m[5]}|`) + `<span style="color:${m[5]}">${inner(m[6])}</span>` + mk('}');
    else out += mk(`{=${m[7]}|`) + `<mark class="hl" style="background:${m[7]}">${inner(m[8])}</mark>` + mk('}');
    last = at + whole.length;
  }
  return out + esc(text.slice(last));
}

/** The HTML a to-do's text is shown with while typed in (its text content is the text itself). */
export function taskHtml(text: string): string {
  let out = '';
  let last = 0;
  for (const f of mathMatches(text)) {
    out += marked(text.slice(last, f.start));
    // Formulas are typed as they are written.
    out += `<span class="tk-math">${esc(text.slice(f.start, f.end))}</span>`;
    last = f.end;
  }
  out += marked(text.slice(last));
  // A line break at the very end shows as a new line.
  if (text.endsWith('\n')) return out + '<br>';
  // Ending in a styled piece: room for the caret after it.
  return out.endsWith('</span>') && /<span class="mk">[^<]*<\/span>$/.test(out) ? out + ZW : out;
}

/** How far into the box's text a point (node, offset) is. */
function offsetOf(root: HTMLElement, node: Node, offset: number): number {
  const r = document.createRange();
  r.setStart(root, 0);
  try {
    r.setEnd(node, offset);
  } catch {
    return 0;
  }
  return r.toString().replace(ZWS, '').length;
}

/** The point n characters into the box's text, kept out of the hidden marks. */
function pointAt(root: HTMLElement, n: number): { node: Node; offset: number } {
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  for (let t = w.nextNode() as Text | null; t; t = w.nextNode() as Text | null) texts.push(t);
  let left = n;
  for (let i = 0; i < texts.length; i++) {
    const t = texts[i];
    const zw = t.data.startsWith(ZW) ? 1 : 0;
    const len = t.data.replace(ZWS, '').length;
    if (left > len) {
      left -= len;
      continue;
    }
    // At the very end of a styled piece that ends the text: after it, in the room kept for the caret.
    if (left === len && t.parentElement?.closest('.mk')) {
      const next = texts[i + 1];
      if (next && next.data.startsWith(ZW)) return { node: next, offset: 1 };
    }
    if (!t.parentElement?.closest('.mk')) return { node: t, offset: left + zw };
    // In a hidden mark: just past it (or before it, at its very start), where the caret can be.
    if (left === 0) {
      for (let j = i - 1; j >= 0; j--) if (!texts[j].parentElement?.closest('.mk')) return { node: texts[j], offset: texts[j].length };
    }
    for (let j = i + 1; j < texts.length; j++) if (!texts[j].parentElement?.closest('.mk')) return { node: texts[j], offset: 0 };
    return { node: root, offset: root.childNodes.length };
  }
  return { node: root, offset: root.childNodes.length };
}

type Props = {
  value: string;
  /** The text changed: typed (`typing`), or a step of its own (a paste, a style taken off). */
  onChange: (value: string, typing?: boolean) => void;
  className?: string;
  placeholder?: string;
  onKeyDown?: (e: ReactKeyboardEvent<TaskBox>) => void;
  onDoubleClick?: (e: ReactMouseEvent<TaskBox>) => void;
  /** The to-do's colour and highlight. */
  tint?: { color?: string; background?: string };
};

export const RichTask = forwardRef<TaskBox | null, Props>(function RichTask({ value, onChange, className, placeholder, onKeyDown, onDoubleClick, tint }, outer) {
  const ref = useRef<TaskBox | null>(null);
  const composing = useRef(false);
  const shown = useRef<string | null>(null);

  /** Shows the text with its marks applied, the caret kept where it was. */
  const draw = (text: string) => {
    const n = ref.current;
    if (!n) return;
    const html = taskHtml(text);
    shown.current = text;
    if (n.innerHTML === html) return;
    const focused = document.activeElement === n;
    const a = focused ? n.selectionStart : 0;
    const b = focused ? n.selectionEnd : 0;
    n.innerHTML = html;
    if (focused) n.setSelectionRange(a, b);
  };

  /** The box answers like a text box: value, selectionStart, selectionEnd, setSelectionRange. */
  const setup = (n: HTMLDivElement | null) => {
    if (!n || (n as TaskBox).setSelectionRange) return;
    Object.defineProperties(n, {
      value: {
        get: () => (n.textContent ?? '').replace(ZWS, ''),
        set: (v: string) => draw(v),
        configurable: true,
      },
      selectionStart: {
        get: () => {
          const sel = window.getSelection();
          if (!sel?.rangeCount || !n.contains(sel.anchorNode)) return (n.textContent ?? '').replace(ZWS, '').length;
          const r = sel.getRangeAt(0);
          return offsetOf(n, r.startContainer, r.startOffset);
        },
        configurable: true,
      },
      selectionEnd: {
        get: () => {
          const sel = window.getSelection();
          if (!sel?.rangeCount || !n.contains(sel.anchorNode)) return (n.textContent ?? '').replace(ZWS, '').length;
          const r = sel.getRangeAt(0);
          return offsetOf(n, r.endContainer, r.endOffset);
        },
        configurable: true,
      },
      setSelectionRange: {
        value: (start: number, end: number) => {
          const sel = window.getSelection();
          if (!sel) return;
          const a = pointAt(n, start);
          const b = end === start ? a : pointAt(n, end);
          const r = document.createRange();
          r.setStart(a.node, a.offset);
          r.setEnd(b.node, b.offset);
          sel.removeAllRanges();
          sel.addRange(r);
        },
        configurable: true,
      },
    });
  };

  useLayoutEffect(() => {
    if (composing.current) return;
    if (shown.current !== value || (ref.current && (ref.current.textContent ?? '').replace(ZWS, '') !== value)) draw(value);
  });

  return (
    <div
      ref={(n) => {
        setup(n);
        ref.current = n as TaskBox | null;
        if (typeof outer === 'function') outer(n as TaskBox | null);
        else if (outer) outer.current = n as TaskBox | null;
      }}
      className={className}
      data-task-box
      data-placeholder={placeholder}
      data-empty={value ? undefined : 'true'}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      spellCheck={false}
      style={tint}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
        const n = ref.current;
        if (!n) return;
        const v = (n.textContent ?? '').replace(ZWS, '');
        if (v !== value) onChange(v);
        else draw(v);
      }}
      onInput={() => {
        const n = ref.current;
        if (!n) return;
        const v = (n.textContent ?? '').replace(ZWS, '');
        // (The browser may leave a stray <br> once the box is emptied.)
        if (!v && n.innerHTML) n.innerHTML = '';
        if (v !== value) onChange(v);
      }}
      onPaste={(e) => {
        // Plain text only, at the caret.
        e.preventDefault();
        const n = ref.current;
        if (!n) return;
        const text = e.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n');
        const a = n.selectionStart;
        const b = n.selectionEnd;
        const v = value.slice(0, a) + text + value.slice(b);
        draw(v);
        n.setSelectionRange(a + text.length, a + text.length);
        onChange(v, false);
      }}
      onDrop={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        const k = e.key.toLowerCase();
        // At the end of the line, what is typed goes after a styled piece (outside the bold, the code…).
        // (Not a mark's own key: that one closes the piece, stepping over its hidden mark.)
        const n = ref.current;
        const sel = window.getSelection();
        if (n && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key.length === 1 || e.key === 'Process') && !'~=*`}'.includes(e.key) && sel?.rangeCount && sel.isCollapsed && n.contains(sel.anchorNode)) {
          const r = sel.getRangeAt(0);
          const rest = document.createRange();
          rest.setStart(r.endContainer, r.endOffset);
          rest.setEnd(n, n.childNodes.length);
          const after = rest.cloneContents();
          for (const m of Array.from(after.querySelectorAll('.mk'))) m.remove();
          if (!after.textContent?.replace(ZWS, '') && rest.toString().replace(ZWS, '')) n.setSelectionRange(value.length, value.length);
        }
        // Backspace right after a styled piece (bold, code, struck, highlighted, coloured): the
        // style comes off and its text stays. Another Backspace takes letters away as usual.
        if (n && e.key === 'Backspace' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && sel?.isCollapsed) {
          const at = n.selectionStart;
          for (const m of value.matchAll(MARKS)) {
            const start = m.index ?? 0;
            const end = start + m[0].length;
            const inner = m.slice(1).find((g, gi) => g !== undefined && !(gi === 4 || gi === 6)) ?? '';
            const closing = m[0].length - inner.length - m[0].indexOf(inner);
            if (at !== end && at !== end - closing) continue;
            if (mathMatches(value).some((f) => start >= f.start && start < f.end)) continue;
            e.preventDefault();
            const v = value.slice(0, start) + inner + value.slice(end);
            const caret = start + inner.length;
            draw(v);
            n.setSelectionRange(caret, caret);
            onChange(v, false);
            return;
          }
        }
        // Formatting the browser would add by itself (Ctrl+I, Ctrl+U): not in a to-do's text.
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (k === 'i' || k === 'u')) e.preventDefault();
        onKeyDown?.(e as ReactKeyboardEvent<TaskBox>);
      }}
      onDoubleClick={(e) => onDoubleClick?.(e as ReactMouseEvent<TaskBox>)}
    />
  );
});
