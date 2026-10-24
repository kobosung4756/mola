import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { mathAt, texToHtml } from './MathEditor';

/*
 * Suggestions while a formula is typed, as in LaTeX editors: after "\" and a letter or more, a list
 * of the commands that start so pops up at the caret. ↑ / ↓ go through it, Enter or Tab puts the
 * picked one in (a command with braces leaves the caret in the first pair), Esc closes it.
 * It works in the formula editor (Ctrl+M) and inside $ … $ / $$ … $$ typed in a note or a to-do.
 */

type Command = { name: string; insert: string; preview: string };

/** name, or [name, what goes in, how it is shown] for one with braces. */
const RAW: (string | [string, string, string])[] = [
  // Greek
  'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'zeta', 'eta', 'theta', 'vartheta', 'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi',
  'pi', 'varpi', 'rho', 'varrho', 'sigma', 'varsigma', 'tau', 'upsilon', 'phi', 'varphi', 'chi', 'psi', 'omega',
  'Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma', 'Upsilon', 'Phi', 'Psi', 'Omega',
  // structures
  ['frac', '\\frac{}{}', '\\frac{a}{b}'], ['dfrac', '\\dfrac{}{}', '\\dfrac{a}{b}'], ['tfrac', '\\tfrac{}{}', '\\tfrac{a}{b}'],
  ['sqrt', '\\sqrt{}', '\\sqrt{x}'], ['binom', '\\binom{}{}', '\\binom{n}{k}'],
  ['overline', '\\overline{}', '\\overline{x}'], ['underline', '\\underline{}', '\\underline{x}'],
  ['hat', '\\hat{}', '\\hat{x}'], ['widehat', '\\widehat{}', '\\widehat{xy}'], ['bar', '\\bar{}', '\\bar{x}'], ['tilde', '\\tilde{}', '\\tilde{x}'],
  ['widetilde', '\\widetilde{}', '\\widetilde{xy}'], ['vec', '\\vec{}', '\\vec{v}'], ['dot', '\\dot{}', '\\dot{x}'], ['ddot', '\\ddot{}', '\\ddot{x}'],
  ['overbrace', '\\overbrace{}', '\\overbrace{abc}'], ['underbrace', '\\underbrace{}', '\\underbrace{abc}'],
  ['mathbb', '\\mathbb{}', '\\mathbb{R}'], ['mathcal', '\\mathcal{}', '\\mathcal{L}'], ['mathbf', '\\mathbf{}', '\\mathbf{x}'],
  ['mathrm', '\\mathrm{}', '\\mathrm{d}'], ['mathit', '\\mathit{}', '\\mathit{x}'], ['mathsf', '\\mathsf{}', '\\mathsf{x}'], ['mathfrak', '\\mathfrak{}', '\\mathfrak{g}'],
  ['boldsymbol', '\\boldsymbol{}', '\\boldsymbol{\\theta}'], ['text', '\\text{}', '\\text{text}'], ['operatorname', '\\operatorname{}', '\\operatorname{f}'],
  ['left(', '\\left(  \\right)', '\\left( x \\right)'], ['left[', '\\left[  \\right]', '\\left[ x \\right]'], ['left\\{', '\\left\\{  \\right\\}', '\\left\\{ x \\right\\}'],
  ['begin{matrix}', '\\begin{matrix}  \\end{matrix}', '\\begin{matrix} a & b \\end{matrix}'],
  ['begin{pmatrix}', '\\begin{pmatrix}  \\end{pmatrix}', '\\begin{pmatrix} a & b \\end{pmatrix}'],
  ['begin{bmatrix}', '\\begin{bmatrix}  \\end{bmatrix}', '\\begin{bmatrix} a & b \\end{bmatrix}'],
  ['begin{cases}', '\\begin{cases}  \\end{cases}', '\\begin{cases} a & x>0 \\end{cases}'],
  ['begin{aligned}', '\\begin{aligned}  \\end{aligned}', '\\begin{aligned} a &= b \\end{aligned}'],
  // big operators and functions
  'sum', 'prod', 'coprod', 'int', 'iint', 'iiint', 'oint', 'bigcup', 'bigcap', 'bigoplus', 'bigotimes', 'lim', 'limsup', 'liminf', 'max', 'min', 'sup', 'inf',
  'argmax', 'argmin', 'det', 'dim', 'ker', 'deg', 'gcd', 'exp', 'log', 'ln', 'lg', 'sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'arcsin', 'arccos', 'arctan',
  'sinh', 'cosh', 'tanh', 'Pr',
  // relations
  'leq', 'geq', 'neq', 'le', 'ge', 'ne', 'approx', 'equiv', 'sim', 'simeq', 'cong', 'propto', 'll', 'gg', 'prec', 'succ', 'preceq', 'succeq',
  'subset', 'subseteq', 'supset', 'supseteq', 'in', 'notin', 'ni', 'mid', 'nmid', 'parallel', 'perp', 'vdash', 'models', 'doteq',
  // arrows
  'to', 'gets', 'mapsto', 'rightarrow', 'leftarrow', 'leftrightarrow', 'Rightarrow', 'Leftarrow', 'Leftrightarrow', 'longrightarrow', 'longleftarrow',
  'Longrightarrow', 'Longleftarrow', 'longmapsto', 'implies', 'impliedby', 'iff', 'uparrow', 'downarrow', 'updownarrow', 'Uparrow', 'Downarrow',
  'nearrow', 'searrow', 'swarrow', 'nwarrow', 'hookrightarrow', 'rightharpoonup', 'rightleftharpoons',
  // operators and the like
  'pm', 'mp', 'times', 'div', 'cdot', 'ast', 'star', 'circ', 'bullet', 'oplus', 'ominus', 'otimes', 'odot', 'cup', 'cap', 'setminus', 'wedge', 'vee',
  'land', 'lor', 'neg', 'lnot', 'forall', 'exists', 'nexists', 'emptyset', 'varnothing', 'infty', 'partial', 'nabla', 'Delta', 'hbar', 'ell', 'Re', 'Im',
  'aleph', 'wp', 'angle', 'triangle', 'square', 'prime', 'degree', 'checkmark', 'dagger',
  'cdots', 'ldots', 'vdots', 'ddots', 'dots',
  // brackets and spaces
  'langle', 'rangle', 'lfloor', 'rfloor', 'lceil', 'rceil', 'lvert', 'rvert', 'lVert', 'rVert', 'vert', 'Vert', 'left', 'right', 'big', 'Big', 'bigg', 'Bigg',
  'quad', 'qquad', 'displaystyle', 'textstyle', 'limits', 'nolimits', 'not', 'cancel',
];

const COMMANDS: Command[] = (() => {
  const seen = new Set<string>();
  const out: Command[] = [];
  for (const r of RAW) {
    const c: Command = typeof r === 'string' ? { name: r, insert: `\\${r}`, preview: `\\${r}` } : { name: r[0], insert: r[1], preview: r[2] };
    if (seen.has(c.name)) continue;
    seen.add(c.name);
    out.push(c);
  }
  return out;
})();

/** The commands starting with what was typed: same case first, then any case; shorter first. */
function matching(prefix: string): Command[] {
  const low = prefix.toLowerCase();
  const exact = COMMANDS.filter((c) => c.name.startsWith(prefix));
  const loose = COMMANDS.filter((c) => !c.name.startsWith(prefix) && c.name.toLowerCase().startsWith(low));
  const byLength = (a: Command, b: Command) => a.name.length - b.name.length;
  return [...exact.sort(byLength), ...loose.sort(byLength)].filter((c) => c.name !== prefix || c.insert !== `\\${prefix}`).slice(0, 40);
}

/** Where the typing is: the box, what was typed after "\", and the caret's place on screen. */
type Spot = { box: HTMLElement; prefix: string; at: DOMRect };

/** The caret's place in a text box, measured on a copy of it. */
function textareaCaret(t: HTMLTextAreaElement): DOMRect {
  const cs = getComputedStyle(t);
  const copy = document.createElement('div');
  for (const p of ['font', 'letterSpacing', 'padding', 'border', 'boxSizing', 'whiteSpace', 'wordWrap', 'lineHeight', 'width', 'tabSize'] as const)
    (copy.style as unknown as Record<string, string>)[p] = (cs as unknown as Record<string, string>)[p];
  copy.style.position = 'fixed';
  copy.style.visibility = 'hidden';
  copy.style.whiteSpace = 'pre-wrap';
  copy.style.overflowWrap = 'break-word';
  copy.textContent = t.value.slice(0, t.selectionStart);
  const mark = document.createElement('span');
  mark.textContent = '​';
  copy.append(mark);
  document.body.append(copy);
  const box = t.getBoundingClientRect();
  const m = mark.getBoundingClientRect();
  const c = copy.getBoundingClientRect();
  copy.remove();
  return new DOMRect(box.left + (m.left - c.left), box.top + (m.top - c.top) - t.scrollTop, 1, m.height);
}

/** The caret's place in an editable element. */
function rangeCaret(): DOMRect | null {
  const sel = getSelection();
  if (!sel?.rangeCount) return null;
  const r = sel.getRangeAt(0).cloneRange();
  const rects = r.getClientRects();
  if (rects.length) return rects[rects.length - 1];
  const b = r.getBoundingClientRect();
  return b.width || b.height ? b : null;
}

/** "\abc" just before the caret, inside a formula (or anywhere in the formula editor). */
function spotNow(): Spot | null {
  const a = document.activeElement as HTMLElement | null;
  if (!a) return null;
  if (a instanceof HTMLTextAreaElement && a.classList.contains('math-input')) {
    if (a.selectionStart !== a.selectionEnd) return null;
    const m = /\\([A-Za-z]+)$/.exec(a.value.slice(0, a.selectionStart));
    return m ? { box: a, prefix: m[1], at: textareaCaret(a) } : null;
  }
  // Typing in a shape of the diagram editor: inside $ … $.
  if (a instanceof HTMLTextAreaElement && a.classList.contains('dg-text-edit')) {
    if (a.selectionStart !== a.selectionEnd) return null;
    const m = /\\([A-Za-z]+)$/.exec(a.value.slice(0, a.selectionStart));
    // (In a formula: a closed $ … $, or a $ typed and not closed yet; \$ is a plain dollar.)
    const before = a.value.slice(0, a.selectionStart);
    const open = (before.replace(/\\\$/g, '').match(/\$/g) ?? []).length % 2 === 1;
    return m && (open || mathAt(a.value, a.selectionStart)) ? { box: a, prefix: m[1], at: textareaCaret(a) } : null;
  }
  const sel = getSelection();
  if (!sel?.rangeCount || !sel.isCollapsed) return null;
  const caret = sel.getRangeAt(0);
  // A to-do being typed in: its text with marks, counted as the box counts it.
  const task = a.closest<HTMLElement & { value: string; selectionStart: number }>('[data-task-box]');
  let text: string;
  let pos: number;
  if (task) {
    text = task.value;
    pos = task.selectionStart;
  } else {
    if (!a.isContentEditable) return null;
    // A note: the line the caret is in.
    const node = caret.startContainer;
    const line = (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>('div, p, li, h1, h2, h3, blockquote, pre, .toggle-head');
    if (!line || !a.contains(line)) return null;
    const before = document.createRange();
    before.setStart(line, 0);
    before.setEnd(caret.startContainer, caret.startOffset);
    pos = before.toString().length;
    text = line.textContent ?? '';
  }
  const m = /\\([A-Za-z]+)$/.exec(text.slice(0, pos));
  if (!m || !mathAt(text, pos)) return null;
  const at = rangeCaret();
  return at ? { box: a, prefix: m[1], at } : null;
}

/** Puts the command in place of "\abc" (the caret then in its first pair of braces, if it has one). */
function apply(spot: Spot, c: Command) {
  const back = c.insert.includes('{}') ? c.insert.length - c.insert.indexOf('{}') - 1 : c.insert.includes('  \\') ? c.insert.length - c.insert.indexOf('  \\') - 1 : 0;
  const cut = spot.prefix.length + 1;
  if (spot.box instanceof HTMLTextAreaElement) {
    const t = spot.box;
    const end = t.selectionStart;
    t.setSelectionRange(end - cut, end);
    document.execCommand('insertText', false, c.insert);
    const now = t.selectionStart - back;
    t.setSelectionRange(now, now);
    return;
  }
  const sel = getSelection();
  if (!sel) return;
  for (let i = 0; i < cut; i++) sel.modify('extend', 'backward', 'character');
  document.execCommand('insertText', false, c.insert);
  for (let i = 0; i < back; i++) sel.modify('move', 'backward', 'character');
}

/** The pop-up list; mounted once for the whole app. */
export function LatexSuggest() {
  const [spot, setSpot] = useState<Spot | null>(null);
  const [at, setAt] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const items = spot ? matching(spot.prefix) : [];
  const live = useRef({ spot, items, at });
  live.current = { spot, items, at };

  /** The command just put in: no list for it again until something else is typed. */
  const done = useRef<string | null>(null);

  useEffect(() => {
    const look = () => {
      const s = spotNow();
      if (s && done.current !== null && s.prefix !== done.current) done.current = null;
      setSpot((old) => {
        if (!s || !matching(s.prefix).length || s.prefix === done.current) return null;
        if (!old || old.prefix !== s.prefix || old.box !== s.box) setAt(0);
        return s;
      });
    };
    // After the editors have dealt with the key (pairs, marks): a moment later.
    const soon = () => requestAnimationFrame(look);
    const key = (e: KeyboardEvent) => {
      const { spot: sp, items: list, at: i } = live.current;
      if (!sp || !list.length || e.isComposing) return;
      // Typed fast, the list can still be up for text that no longer asks for it: checked again
      // now, so such a key (Esc, Enter …) does its own work.
      if (!['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(e.key)) return;
      const nowSpot = spotNow();
      if (!nowSpot || nowSpot.prefix !== sp.prefix || nowSpot.box !== sp.box) {
        setSpot(null);
        return;
      }
      const take = () => {
        e.preventDefault();
        e.stopImmediatePropagation();
      };
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        take();
        setAt((i + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length);
      } else if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        take();
        const c = list[i] ?? list[0];
        apply(sp, c);
        done.current = /^[A-Za-z]+$/.test(c.name) && !c.insert.includes('{') ? c.name : null;
        setSpot(null);
        soon();
      } else if (e.key === 'Escape') {
        take();
        setSpot(null);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) soon();
    };
    const away = () => setSpot(null);
    // Scrolling the list itself (the wheel, or ↑ ↓ keeping the picked one in sight) keeps it open.
    const scrolled = (e: Event) => {
      if (e.target instanceof Node && listRef.current?.contains(e.target)) return;
      setSpot(null);
    };
    addEventListener('keydown', key, true);
    addEventListener('keyup', up, true);
    document.addEventListener('input', soon, true);
    document.addEventListener('mouseup', soon, true);
    addEventListener('focusout', away, true);
    addEventListener('scroll', scrolled, true);
    return () => {
      removeEventListener('keydown', key, true);
      removeEventListener('keyup', up, true);
      document.removeEventListener('input', soon, true);
      document.removeEventListener('mouseup', soon, true);
      removeEventListener('focusout', away, true);
      removeEventListener('scroll', scrolled, true);
    };
  }, []);

  // The picked one stays in sight.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${at}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [at, spot]);

  if (!spot || !items.length) return null;
  const below = spot.at.bottom + 260 < innerHeight;
  const style = {
    left: Math.max(8, Math.min(innerWidth - 300, spot.at.left)),
    ...(below ? { top: spot.at.bottom + 4 } : { bottom: innerHeight - spot.at.top + 4 }),
  };
  return createPortal(
    <div className="latex-suggest" style={style} ref={listRef} role="listbox" data-latex-suggest onMouseDown={(e) => e.preventDefault()}>
      {items.map((c, i) => (
        <div
          key={c.name}
          data-i={i}
          role="option"
          aria-selected={i === at}
          className={i === at ? 'ls-item on' : 'ls-item'}
          onMouseMove={() => i !== at && setAt(i)}
          onClick={() => {
            apply(spot, c);
            done.current = /^[A-Za-z]+$/.test(c.name) && !c.insert.includes('{') ? c.name : null;
            setSpot(null);
          }}
        >
          <span className="ls-name">\{c.name}</span>
          <span className="ls-preview" dangerouslySetInnerHTML={{ __html: texToHtml(c.preview) }} />
        </div>
      ))}
    </div>,
    document.body,
  );
}
