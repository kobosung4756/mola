import { useEffect, useMemo, useRef, useState } from 'react';
import { closeLinkEdits } from './LinkEdit';
import type { ReactNode, SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { tr } from '../i18n';
import { BLOCK_LINK_TEXT } from '../blockLinks';

/** LaTeX as HTML, with mistakes shown in red instead of thrown. */
export function texToHtml(tex: string, display = false): string {
  return katex.renderToString(tex, { throwOnError: false, displayMode: display, output: 'htmlAndMathml' });
}

/** The left bar asks the to-do list being edited to format its current to-do: { id, kind, value }. */
export const TASK_FORMAT_EVENT = 'board-studio:task-format';
export type TaskFormat = { id: string; kind: 'bold' | 'code' | 'color' | 'bg'; value?: string };

/** The left bar's Formula button asks the note or to-do list being edited (detail: its id) to open the editor. */
export const OPEN_MATH_EVENT = 'board-studio:open-math';

/** Ctrl+M opens the formula editor (Ctrl+N+M too, where the browser lets a page see Ctrl+N). */
export function isMathShortcut(e: { ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; key: string }) {
  return (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'm';
}

/* ---------- Formulas inside a note: <span class="math" data-tex="…"> ---------- */

/** Draws every formula inside a note ($$…$$ ones as a centred block). */
export function renderMath(root: HTMLElement) {
  for (const span of Array.from(root.querySelectorAll<HTMLElement>('span.math[data-tex]'))) {
    const tex = span.dataset.tex ?? '';
    const display = span.dataset.display === 'true';
    const key = (display ? 'D:' : 'I:') + tex;
    if (span.dataset.drawn === key) continue;
    span.innerHTML = texToHtml(tex, display);
    span.classList.toggle('display', display);
    span.dataset.drawn = key;
    span.contentEditable = 'false';
  }
}

/** A note's HTML for saving: formulas keep only their LaTeX, not the drawn output. */
export function noteHtml(root: HTMLElement): string {
  // (Zero-width spaces only hold the caret outside a mark while typing.)
  if (!root.querySelector('span.math, .embed-show, span.link-edit')) return root.innerHTML.replace(/\u200B/g, '');
  const copy = root.cloneNode(true) as HTMLElement;
  // A link opened up for changing is kept as the link it stands for.
  closeLinkEdits(copy, false);
  // What an embed shows is drawn from its block each time; only its address is kept.
  for (const show of Array.from(copy.querySelectorAll('.embed-show'))) show.remove();
  for (const span of Array.from(copy.querySelectorAll<HTMLElement>('span.math'))) {
    span.textContent = span.dataset.tex ?? '';
    span.removeAttribute('data-drawn');
    span.removeAttribute('contenteditable');
  }
  return copy.innerHTML.replace(/\u200B/g, '');
}

export function mathSpan(tex: string, display = false): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = display ? 'math display' : 'math';
  span.dataset.tex = tex;
  if (display) span.dataset.display = 'true';
  span.textContent = tex;
  return span;
}

/* ---------- Formulas written as $…$ or $$…$$ (to-dos, and notes) ---------- */

/**
 * $$…$$ is a formula shown as its own centred block; $…$ sits in the line; \$ is a plain dollar
 * sign. Both may run over several lines. Lists saved with the older \( … \) marks still show
 * their formulas. The LaTeX is group 1 ($$), 2 ($) or 3 (\( \)).
 */
export const INLINE_MATH = /(?<!\\)\$\$([\s\S]*?\S[\s\S]*?)(?<!\\)\$\$|(?<!\\)\$([^$]*[^$\s\\][^$]*?)(?<!\\)\$|\\\((.+?)\\\)/g;

type MathMatch = { start: number; end: number; tex: string; display: boolean };

/** Every formula in plain text, in order. */
export function mathMatches(text: string): MathMatch[] {
  return [...text.matchAll(INLINE_MATH)].map((m) => ({
    start: m.index ?? 0,
    end: (m.index ?? 0) + m[0].length,
    tex: (m[1] ?? m[2] ?? m[3]).trim(),
    display: m[1] !== undefined,
  }));
}

/** Text as shown: \$ becomes $. */
export const unescapeDollars = (text: string) => text.replace(/\\\$/g, '$');

/** The formula around a caret position in plain text, if any. */
export function mathAt(text: string, pos: number): MathMatch | null {
  return mathMatches(text).find((m) => pos >= m.start && pos <= m.end) ?? null;
}

/** **bold** and `inline code` in a to-do's text (outside formulas). */
/** The marks of a to-do's text (as RichTask shows them while typing): bold, code, struck, highlighted, coloured. */
const INLINE_MARKS =
  /\*\*(?=\S)([^*\n]+?)\*\*|`([^`\n]+)`|~~([^~\n]+?)~~|==([^=\n]+?)==|\{(#[0-9a-fA-F]{6})\|([^{}\n]+)\}|\{=(#[0-9a-fA-F]{6})\|([^{}\n]+)\}/g;

function marked(text: string, key: number): ReactNode[] {
  // To-dos have no links: a [[name|id]] written before they were taken away shows as its name.
  const out: ReactNode[] = [];
  let from = 0;
  for (const m of text.matchAll(BLOCK_LINK_TEXT)) {
    const at = m.index ?? 0;
    if (at > from) out.push(...markedPlain(text.slice(from, at), `${key}-${from}`));
    out.push(m[2] ? m[1] || tr('블록', 'Block') : m[0]);
    from = at + m[0].length;
  }
  if (from < text.length) out.push(...markedPlain(text.slice(from), `${key}-${from}`));
  return out;
}

/** A to-do's text with its marks applied; marks may hold others ({#e03131|**bold red**}). */
function markedPlain(text: string, key: string, depth = 0): ReactNode[] {
  if (depth > 4) return [text];
  const inner = (s: string, at: number) => markedPlain(s, `${key}-${at}`, depth + 1);
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE_MARKS)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    out.push(
      m[1] !== undefined ? (
        <strong key={`${key}-${at}`}>{inner(m[1], at)}</strong>
      ) : m[2] !== undefined ? (
        <code key={`${key}-${at}`}>{m[2]}</code>
      ) : m[3] !== undefined ? (
        <s key={`${key}-${at}`}>{inner(m[3], at)}</s>
      ) : m[4] !== undefined ? (
        <mark key={`${key}-${at}`} className="hl">
          {inner(m[4], at)}
        </mark>
      ) : m[5] !== undefined ? (
        <span key={`${key}-${at}`} style={{ color: m[5] }}>
          {inner(m[6], at)}
        </span>
      ) : (
        <mark key={`${key}-${at}`} className="hl" style={{ background: m[7] }}>
          {inner(m[8], at)}
        </mark>
      ),
    );
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Plain text with its formulas drawn (and **bold** / `code` marks shown as such). */
export function MathText({ text }: { text: string }) {
  const parts = useMemo(() => {
    const out: { tex?: string; display?: boolean; text?: string }[] = [];
    let last = 0;
    for (const m of mathMatches(text)) {
      if (m.start > last) out.push({ text: unescapeDollars(text.slice(last, m.start)) });
      out.push({ tex: m.tex, display: m.display });
      last = m.end;
    }
    if (last < text.length) out.push({ text: unescapeDollars(text.slice(last)) });
    return out;
  }, [text]);
  return (
    <>
      {parts.map((p, i) =>
        p.tex !== undefined ? (
          <span key={i} className={p.display ? 'math display' : 'math'} dangerouslySetInnerHTML={{ __html: texToHtml(p.tex, p.display) }} />
        ) : (
          marked(p.text ?? '', i)
        ),
      )}
    </>
  );
}

/* ---------- A note's text as one string, so a formula can run over several lines ---------- */

const BLOCKS = new Set(['DIV', 'P', 'LI', 'H1', 'H2', 'H3', 'BLOCKQUOTE', 'UL', 'OL']);
/** Stands for code, a drawn formula and the like: never part of a formula. */
const OPAQUE = '￼';

type NoteText = { text: string; segs: { node: Text; start: number }[] };

/** The note's text, a line break between paragraphs, with where each text node sits in it. */
function readNote(root: HTMLElement): NoteText {
  let text = '';
  const segs: NoteText['segs'] = [];
  const lineBreak = () => {
    if (text && !text.endsWith('\n')) text += '\n';
  };
  const walk = (n: Node) => {
    for (const child of Array.from(n.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        segs.push({ node: child as Text, start: text.length });
        text += (child as Text).data;
      } else if (child instanceof HTMLElement) {
        if (child.tagName === 'BR') text += '\n';
        else if (child.matches('code, pre, span.math')) text += OPAQUE;
        else if (BLOCKS.has(child.tagName)) {
          lineBreak();
          walk(child);
          lineBreak();
        } else walk(child);
      }
    }
  };
  walk(root);
  return { text, segs };
}

/** A position in the note's text as a point in the page (a text node and an offset in it). */
function pointAt(nt: NoteText, pos: number): { node: Text; offset: number } | null {
  let best: { node: Text; offset: number } | null = null;
  for (const s of nt.segs) {
    if (pos >= s.start && pos <= s.start + s.node.length) return { node: s.node, offset: pos - s.start };
    if (s.start <= pos) best = { node: s.node, offset: s.node.length };
  }
  return best;
}

/** Formulas of a note (not ones that would swallow code or a drawn formula). */
function noteMatches(nt: NoteText) {
  return mathMatches(nt.text).filter((m) => !nt.text.slice(m.start, m.end).includes(OPAQUE));
}

/** The page range a formula covers, from its first $ to its last. */
function rangeOf(nt: NoteText, m: MathMatch): Range | null {
  const a = pointAt(nt, m.start);
  const b = pointAt(nt, m.end);
  if (!a || !b) return null;
  const r = document.createRange();
  r.setStart(a.node, a.offset);
  r.setEnd(b.node, b.offset);
  return r;
}

/**
 * Turns $…$ and $$…$$ in a note into drawn formulas, also when one runs over several lines.
 * Returns whether anything changed.
 */
export function dollarsToMath(root: HTMLElement): boolean {
  const nt = readNote(root);
  const found = noteMatches(nt);
  // From the last one back, so the earlier positions still hold.
  for (const m of [...found].reverse()) {
    const r = rangeOf(nt, m);
    if (!r) continue;
    r.deleteContents();
    r.insertNode(mathSpan(m.tex, m.display));
  }
  if (found.length) root.normalize();
  return found.length > 0;
}

/** While a note is edited its formulas are plain $…$ / $$…$$ text, like in a to-do. */
export function spansToDollars(root: HTMLElement) {
  for (const span of Array.from(root.querySelectorAll<HTMLElement>('span.math'))) {
    const mark = span.dataset.display === 'true' ? '$$' : '$';
    span.replaceWith(mark + (span.dataset.tex ?? '') + mark);
  }
  root.normalize();
}

/** The formula in an edited note around a point, with the page range it covers. */
export function noteMathAt(root: HTMLElement, node: Node | null, offset: number): { tex: string; display: boolean; range: Range } | null {
  if (!node || node.nodeType !== Node.TEXT_NODE) return null;
  const nt = readNote(root);
  const seg = nt.segs.find((s) => s.node === node);
  if (!seg) return null;
  const pos = seg.start + offset;
  const m = noteMatches(nt).find((x) => pos >= x.start && pos <= x.end);
  const range = m && rangeOf(nt, m);
  return m && range ? { tex: m.tex, display: m.display, range } : null;
}

/** Where the caret goes to open the n-th formula of an edited note (just inside its opening $). */
export function nthNoteMath(root: HTMLElement, n: number): { node: Text; offset: number } | null {
  const nt = readNote(root);
  const m = noteMatches(nt)[n];
  return m ? pointAt(nt, m.start + (m.display ? 2 : 1)) : null;
}

export function placeCaret(node: Node, offset: number) {
  const r = document.createRange();
  r.setStart(node, Math.min(offset, node.nodeType === Node.TEXT_NODE ? (node as Text).length : node.childNodes.length));
  r.collapse(true);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(r);
}

/** A shown (not edited) note: formulas drawn and \$ shown as $. */
export function renderNoteView(root: HTMLElement) {
  dollarsToMath(root);
  for (const { node } of readNote(root).segs) if (node.data.includes('\\$')) node.data = unescapeDollars(node.data);
  renderMath(root);
}

/* ---------- The editor ---------- */

/**
 * Formula editor in the middle of the screen: LaTeX typed in the lower half, drawn in the upper half.
 * Esc asks what to do (insert, delete, cancel); Shift+Esc inserts right away.
 */
export function MathEditor({
  initial,
  onInsert,
  onDelete,
  onClose,
}: {
  initial: string;
  onInsert: (tex: string) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [tex, setTex] = useState(initial);
  const [asking, setAsking] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const insertRef = useRef<HTMLButtonElement>(null);
  const preview = useMemo(() => (tex.trim() ? texToHtml(tex, true) : ''), [tex]);

  const insert = () => (tex.trim() ? onInsert(tex.trim()) : onDelete());

  useEffect(() => {
    if (asking) insertRef.current?.focus();
    else {
      const n = inputRef.current;
      n?.focus();
      n?.setSelectionRange(n.value.length, n.value.length);
    }
  }, [asking]);

  useEffect(() => {
    // Keys stay in the editor while it is open (no board shortcuts underneath).
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (e.shiftKey) insert();
        else setAsking((a) => !a);
        return;
      }
      if (asking) {
        // I / D / C pick a button (also on a Korean keyboard); arrows move between them, Enter presses one.
        const k = e.key.toLowerCase();
        let handled = true;
        if (k === 'i' || k === 'ㅑ') insert();
        else if (k === 'd' || k === 'ㅇ') onDelete();
        else if (k === 'c' || k === 'ㅊ') onClose();
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          const btns = Array.from(document.querySelectorAll<HTMLButtonElement>('.math-ask button'));
          const i = btns.indexOf(document.activeElement as HTMLButtonElement);
          btns[(i + (e.key === 'ArrowRight' ? 1 : btns.length - 1)) % btns.length]?.focus();
        } else handled = false;
        if (handled) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    };
    addEventListener('keydown', key, true);
    return () => removeEventListener('keydown', key, true);
  });

  // React passes events from a portal up to the note or to-do that opened it (and on to the board,
  // which would end editing), so they stop here.
  const stop = (e: SyntheticEvent) => e.stopPropagation();
  return createPortal(
    <div
      className="math-backdrop"
      onPointerDown={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) setAsking(true);
      }}
      onPointerUp={stop}
      onMouseDown={stop}
      onClick={stop}
      onDoubleClick={stop}
      onContextMenu={stop}
      onKeyDown={stop}
      onKeyUp={stop}
      onInput={stop}
      onChange={stop}
      onPaste={stop}
      onCopy={stop}
      onCut={stop}
      onWheel={stop}
    >
      <div className="math-editor" role="dialog" aria-label={tr('수식 편집기', 'Formula editor')}>
        <div className="math-preview" aria-live="polite">
          {preview ? <div dangerouslySetInnerHTML={{ __html: preview }} /> : <span className="math-empty">{tr('수식 미리보기', 'Formula preview')}</span>}
        </div>
        <div className="math-input-wrap">
          <textarea
            ref={inputRef}
            className="math-input"
            value={tex}
            spellCheck={false}
            placeholder={tr('LaTeX로 입력하세요. 예: \\frac{a}{b}, x^2, \\sqrt{x}, \\sum_{i=1}^{n} i', 'Type LaTeX, e.g. \\frac{a}{b}, x^2, \\sqrt{x}, \\sum_{i=1}^{n} i')}
            onChange={(e) => setTex(e.target.value)}
            readOnly={asking}
          />
          <div className="math-hint">{tr('Esc 닫기 메뉴 · Shift+Esc 바로 넣기', 'Esc: close menu · Shift+Esc: insert now')}</div>
        </div>
        {asking && (
          <div className="math-ask" role="group" aria-label={tr('수식 편집 끝내기', 'Finish editing formula')}>
            <button ref={insertRef} className="primary" onClick={insert}>
              {tr('넣기', 'Insert')} <kbd>I</kbd>
            </button>
            <button className="danger" onClick={onDelete}>
              {tr('삭제', 'Delete')} <kbd>D</kbd>
            </button>
            <button onClick={onClose}>
              {tr('취소', 'Cancel')} <kbd>C</kbd>
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
