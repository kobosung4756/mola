/**
 * Notion-style typing shortcuts for notes. At the start of a line:
 *
 *   # ␣  ## ␣  ### ␣   heading 1 / 2 / 3        > ␣         toggle list
 *   1. ␣               numbered list             # > ␣ …     heading toggle 1 / 2 / 3
 *   - ␣                bulleted list             " ␣         quote
 *   [] ␣               to-do (checkbox) list     ---         divider
 *   ```                code block
 *
 * Also: Backspace at the start of a heading, quote, code block or toggle turns it back into plain
 * text; Enter in a toggle's title goes into the toggle; in a code block Enter is a new line and
 * Ctrl+Enter (or ↓ at its end) leaves it. Inside a toggle, Enter on an empty last line or Shift+Tab
 * takes the line (and the ones after it) out of the toggle; Tab on the line under a toggle puts it in.
 */

const BLOCK_SEL = 'div, p, h1, h2, h3, blockquote, li, pre';

/** The editable line the caret is in: its block element, or the note itself for its first loose line. */
function caretBlock(root: HTMLElement): { block: HTMLElement; range: Range } | null {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer)) return null;
  const start = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
  let block = start?.closest<HTMLElement>(BLOCK_SEL) ?? null;
  if (!block || !root.contains(block) || block === root) block = root;
  return { block, range };
}

/** The text from the start of the caret's line up to the caret, and the range covering it. */
function textBeforeCaret(root: HTMLElement): { text: string; range: Range; block: HTMLElement } | null {
  const at = caretBlock(root);
  if (!at) return null;
  const r = document.createRange();
  if (at.block === root) {
    // A loose line straight in the note: it starts after the last <br> or block before the caret.
    let startNode: Node | null = at.range.startContainer;
    while (startNode && startNode.parentNode !== root) startNode = startNode.parentNode;
    let prev = startNode?.previousSibling ?? null;
    while (prev && !(prev instanceof HTMLElement && (prev.tagName === 'BR' || prev.matches(BLOCK_SEL)))) prev = prev.previousSibling;
    if (prev) r.setStartAfter(prev);
    else r.setStart(root, 0);
  } else r.setStart(at.block, 0);
  r.setEnd(at.range.startContainer, at.range.startOffset);
  return { text: r.toString(), range: r, block: at.block };
}

function placeAt(node: Node, offset = 0) {
  const r = document.createRange();
  r.setStart(node, offset);
  r.collapse(true);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(r);
}

/**
 * The caret's line as an element of its own: its block, or (for a loose line straight in the note,
 * like the first one) a new <div> wrapped around it.
 */
function currentLine(root: HTMLElement): HTMLElement | null {
  const at = caretBlock(root);
  if (!at) return null;
  if (at.block !== root) return at.block;
  let node: Node | null = at.range.startContainer;
  if (node === root) node = root.childNodes[at.range.startOffset] ?? root.childNodes[at.range.startOffset - 1] ?? null;
  while (node && node.parentNode !== root) node = node.parentNode;
  const isEdge = (n: Node | null) => n instanceof HTMLElement && (n.tagName === 'BR' || n.matches(BLOCK_SEL));
  const div = document.createElement('div');
  if (!node || isEdge(node)) {
    // An empty spot: a fresh line there.
    if (node instanceof HTMLElement && node.tagName === 'BR') node.replaceWith(div);
    else root.insertBefore(div, node);
  } else {
    let first: Node = node;
    while (first.previousSibling && !isEdge(first.previousSibling)) first = first.previousSibling;
    let last: Node = node;
    while (last.nextSibling && !isEdge(last.nextSibling)) last = last.nextSibling;
    const after = last.nextSibling;
    root.insertBefore(div, first);
    let n: Node | null = first;
    while (n) {
      const next: Node | null = n === last ? null : n.nextSibling;
      div.append(n);
      n = next;
    }
    // The <br> that ended the loose line is not needed once the line is a block.
    if (after instanceof HTMLElement && after.tagName === 'BR') after.remove();
  }
  return div;
}

function emptyLine() {
  const d = document.createElement('div');
  d.append(document.createElement('br'));
  return d;
}

/** Moves a line's content into `el` (a <br> if it had none) and puts `el` where the line was. */
function rebuild(line: HTMLElement, el: HTMLElement, into: HTMLElement = el) {
  into.append(...Array.from(line.childNodes));
  if (!into.textContent && !into.querySelector('br')) into.append(document.createElement('br'));
  line.replaceWith(el);
  placeAt(into, 0);
}

const asBlock = (tag: string) => (root: HTMLElement) => {
  const line = currentLine(root);
  if (line) rebuild(line, document.createElement(tag));
};

const asList = (tag: 'ol' | 'ul', checklist = false) => (root: HTMLElement) => {
  const line = currentLine(root);
  if (!line) return;
  const list = document.createElement(tag);
  const li = document.createElement('li');
  if (checklist) {
    list.className = 'checklist';
    li.dataset.checked = 'false';
  }
  list.append(li);
  rebuild(line, list, li);
  // The line's own sub-items, left just below it when its list item was taken off (Backspace):
  // they come back under it, in the new kind of list.
  const next = list.nextElementSibling;
  if (next && /^(UL|OL)$/.test(next.tagName)) {
    while (next.firstElementChild && /^(UL|OL)$/.test(next.firstElementChild.tagName)) list.append(next.firstElementChild);
    if (!next.childElementCount) next.remove();
  }
  retagSublists(list);
  placeAt(li, 0);
};

/** A list made into another kind (bullets, numbers, to-dos), its items and attributes kept. */
function retagged(list: HTMLElement, tag: string, checklist: boolean): HTMLElement {
  const n = document.createElement(tag);
  for (const a of Array.from(list.attributes)) if (a.name !== 'class' && !(a.name === 'start' && tag !== 'ol')) n.setAttribute(a.name, a.value);
  const rest = list.className.replace(/\bchecklist\b/, '').trim();
  n.className = [checklist ? 'checklist' : '', rest].filter(Boolean).join(' ');
  if (!n.className) n.removeAttribute('class');
  n.append(...Array.from(list.childNodes));
  for (const li of Array.from(n.children) as HTMLElement[]) {
    if (li.tagName !== 'LI') continue;
    if (checklist) li.dataset.checked ??= 'false';
    else delete li.dataset.checked;
  }
  return n;
}

/** Every list inside `list` (its sub-lists, at any depth) made the same kind as it. */
function retagSublists(list: HTMLElement) {
  const tag = list.tagName.toLowerCase();
  const checklist = list.classList.contains('checklist');
  for (const sub of Array.from(list.querySelectorAll<HTMLElement>('ul, ol')).reverse()) {
    if (sub.tagName.toLowerCase() === tag && sub.classList.contains('checklist') === checklist) continue;
    sub.replaceWith(retagged(sub, tag, checklist));
  }
}

/**
 * After the editor's own list commands (Ctrl+Shift+7 / 8, the left bar) changed the kind of the
 * item the caret is in: its sub-items (the lists right below it) become the same kind.
 */
export function sublistsFollow(root: HTMLElement) {
  const sel = window.getSelection();
  const node = sel?.anchorNode;
  const li = (node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>('li');
  const list = li?.parentElement as HTMLElement | null | undefined;
  if (!li || !list || !root.contains(list) || !/^(UL|OL)$/.test(list.tagName)) return;
  const tag = list.tagName.toLowerCase();
  const checklist = list.classList.contains('checklist');
  const subs: HTMLElement[] = Array.from(li.querySelectorAll<HTMLElement>(':scope > ul, :scope > ol'));
  for (let n = li.nextElementSibling; n && /^(UL|OL)$/.test(n.tagName); n = n.nextElementSibling) subs.push(n as HTMLElement);
  // The item ended its list (the command split it out): its sub-items are at the start of the next one.
  if (!li.nextElementSibling) {
    const next = list.nextElementSibling;
    if (next && /^(UL|OL)$/.test(next.tagName)) {
      while (next.firstElementChild && /^(UL|OL)$/.test(next.firstElementChild.tagName)) {
        const sub = next.firstElementChild as HTMLElement;
        list.append(sub);
        subs.push(sub);
      }
      if (!next.childElementCount) next.remove();
    }
  }
  let changed = false;
  for (const sub of subs) {
    if (sub.tagName.toLowerCase() !== tag || sub.classList.contains('checklist') !== checklist) {
      const n = retagged(sub, tag, checklist);
      sub.replaceWith(n);
      retagSublists(n);
      changed = true;
    } else retagSublists(sub);
  }
  if (changed) root.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * "1. ", "- ", "* " or "[] " at the start of a list item: that item (with its sub-items) becomes
 * that kind of list, the list split around it (Ctrl+Z puts it back).
 */
function itemToKind(root: HTMLElement, li: HTMLElement, tag: 'ol' | 'ul', checklist: boolean): boolean {
  const list = li.parentElement as HTMLElement | null;
  if (!list || !/^(UL|OL)$/.test(list.tagName)) return false;
  const items = Array.from(list.children);
  const i = items.indexOf(li);
  let j = i + 1;
  while (j < items.length && /^(UL|OL)$/.test(items[j].tagName)) j++;
  const part = (from: Element[]) => {
    const l = list.cloneNode(false) as HTMLElement;
    l.append(...from.map((n) => n.cloneNode(true)));
    return l;
  };
  const made = retagged(part(items.slice(i, j)), tag, checklist);
  retagSublists(made);
  const put: Node[] = [];
  if (i > 0) put.push(part(items.slice(0, i)));
  put.push(made);
  if (j < items.length) {
    const after = part(items.slice(j));
    const before = items.slice(0, j).filter((n) => n.tagName === 'LI').length;
    if (list.tagName === 'OL') after.setAttribute('start', String((Number(list.getAttribute('start')) || 1) + before));
    put.push(after);
  }
  unformat(root, list, put, made.firstElementChild ?? made, li, 0);
  return true;
}

/**
 * Ctrl+Shift+7 / 8 (or the left bar) with the caret in a list item of another kind: that item and
 * its sub-items become the new kind (as typing "1. " at its start does). False when there is
 * nothing to do here (no item, a selection over several, or the same kind: the editor's own command then).
 */
export function listItemTo(root: HTMLElement, tag: 'ol' | 'ul'): boolean {
  const sel = window.getSelection();
  if (!sel?.rangeCount) return false;
  const r = sel.getRangeAt(0);
  const from = (r.startContainer instanceof Element ? r.startContainer : r.startContainer.parentElement)?.closest<HTMLElement>('li');
  const to = (r.endContainer instanceof Element ? r.endContainer : r.endContainer.parentElement)?.closest<HTMLElement>('li');
  if (!from || from !== to || !root.contains(from)) return false;
  const list = from.parentElement as HTMLElement;
  if (list.tagName.toLowerCase() === tag && !list.classList.contains('checklist')) return false;
  const offset = caretOffset(from, r);
  if (!itemToKind(root, from, tag, false)) return false;
  const made = unformats.get(root)?.caretPut;
  if (made) placeText(made, offset);
  root.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}

/** List markers typed at the start of a list item: the kind of list each makes. */
const ITEM_MARKERS: Record<string, ['ol' | 'ul', boolean]> = { '1.': ['ol', false], '-': ['ul', false], '*': ['ul', false], '[]': ['ul', true], '[ ]': ['ul', true] };

/** A toggle list: a title line with ▶ and the lines folded under it. Level 1–3 makes the title a heading. */
function makeToggle(root: HTMLElement, level: number) {
  const line = currentLine(root);
  if (!line) return;
  const toggle = document.createElement('div');
  toggle.className = 'toggle';
  toggle.dataset.open = 'true';
  if (level) toggle.dataset.level = String(level);
  const head = document.createElement('div');
  head.className = 'toggle-head';
  const body = document.createElement('div');
  body.className = 'toggle-body';
  body.append(emptyLine());
  toggle.append(head, body);
  rebuild(line, toggle, head);
}

function makeDivider(root: HTMLElement) {
  const line = currentLine(root);
  if (!line) return;
  const after = emptyLine();
  line.replaceWith(document.createElement('hr'), after);
  placeAt(after, 0);
}

/** Line-start markers typed before a space, longest first. */
const SPACE_MARKERS: [string, (root: HTMLElement) => void][] = [
  ['###>', (root) => makeToggle(root, 3)],
  ['### >', (root) => makeToggle(root, 3)],
  ['##>', (root) => makeToggle(root, 2)],
  ['## >', (root) => makeToggle(root, 2)],
  ['#>', (root) => makeToggle(root, 1)],
  ['# >', (root) => makeToggle(root, 1)],
  ['###', asBlock('h3')],
  ['##', asBlock('h2')],
  ['#', asBlock('h1')],
  ['1.', asList('ol')],
  ['-', asList('ul')],
  ['*', asList('ul')],
  ['[]', asList('ul', true)],
  ['[ ]', asList('ul', true)],
  ['>', (root) => makeToggle(root, 0)],
  ['"', asBlock('blockquote')],
];

/**
 * Taking a format off (Backspace at the start of a heading, quote, code block, toggle or list item)
 * is kept here, per note, so Ctrl+Z puts it back and Ctrl+Shift+Z / Ctrl+Y takes it off again.
 * (The browser's own undo cannot be trusted with these: it brings back half a toggle, or none.)
 * The nodes that were taken out are kept as they were, so the browser's undo of what was typed
 * in them before still works once they are back.
 */
type Unformat = { old: HTMLElement; put: Node[]; caretOld: Node; caretPut: Node; offset: number; before: string; after: string; undone: boolean };
const unformats = new WeakMap<HTMLElement, Unformat>();

function swapIn(from: Node[], to: Node[]) {
  from[0].parentNode?.insertBefore(to.length > 1 ? fragmentOf(to) : to[0], from[0]);
  for (const n of from) n.parentNode?.removeChild(n);
}
function fragmentOf(nodes: Node[]) {
  const f = document.createDocumentFragment();
  f.append(...nodes);
  return f;
}

/** Puts `put` in place of `old` (kept for Ctrl+Z); the caret goes `offset` characters into `caret`. */
function unformat(root: HTMLElement, old: HTMLElement, put: Node[], caret: Node, caretOld: Node = old, offset = 0) {
  const before = root.innerHTML;
  swapIn([old], put);
  placeText(caret, offset);
  unformats.set(root, { old, put, caretOld, caretPut: caret, offset, before, after: root.innerHTML, undone: false });
}

/** The caret `n` characters into `node`'s text. */
function placeText(node: Node, n: number) {
  if (n <= 0 || node.nodeType === Node.TEXT_NODE) return placeAt(node, node.nodeType === Node.TEXT_NODE ? Math.min(n, (node as Text).length) : 0);
  const w = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  let last: Text | null = null;
  for (let t = w.nextNode() as Text | null; t; t = w.nextNode() as Text | null) {
    if (n <= t.length) return placeAt(t, n);
    n -= t.length;
    last = t;
  }
  if (last) placeAt(last, last.length);
  else placeAt(node, 0);
}

/** How many characters into `node` the caret is. */
function caretOffset(node: Node, caret: Range) {
  const r = document.createRange();
  r.setStart(node, 0);
  r.setEnd(caret.startContainer, caret.startOffset);
  return r.toString().length;
}

/**
 * An embed's address is one piece: Backspace or Delete in it takes the whole embed away (Ctrl+Z
 * brings it back). Only the size after the | (![[name|70]]) is changed a character at a time.
 * Backspace at the start of the line below an embed goes to the end of its address first.
 */
function embedKey(e: KeyboardEvent, root: HTMLElement): boolean {
  if ((e.key !== 'Backspace' && e.key !== 'Delete') || e.ctrlKey || e.shiftKey) return false;
  const sel = window.getSelection();
  if (!sel?.rangeCount) return false;
  const range = sel.getRangeAt(0);
  const from = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
  const addr = from?.closest<HTMLElement>('.embed-addr');
  const embed = addr?.parentElement;
  if (addr && embed?.classList.contains('embed') && root.contains(embed)) {
    const text = addr.textContent ?? '';
    const off = caretOffset(addr, range);
    const i = e.key === 'Backspace' ? off - 1 : off;
    // Inside the brackets (the name, the ^address, the size): one character at a time. Taking
    // away a bracket (![[ or ]]) takes the whole embed away.
    if (range.collapsed && range.endContainer === range.startContainer && i >= 3 && i < text.length - 2) return false;
    const line = emptyLine();
    unformat(root, embed, [line], line, addr, 0);
    return true;
  }
  if (e.key !== 'Backspace' || !range.collapsed) return false;
  const at = caretBlock(root);
  const prev = at?.block.previousElementSibling as HTMLElement | null | undefined;
  if (at && prev?.classList.contains('embed') && isAtStart(at.block, at.range)) {
    const a = prev.querySelector<HTMLElement>(':scope > .embed-addr');
    if (a) {
      placeText(a, (a.textContent ?? '').length);
      return true;
    }
  }
  return false;
}

/** A list is in a list (indented with Tab), not straight in the note. */
const isNested = (list: Element | null) => /^(UL|OL|LI)$/.test(list?.parentElement?.tagName ?? '') || !!list?.parentElement?.closest('li');

/**
 * An item of a list straight in the note becomes a plain line, the list split around it
 * (Ctrl+Z puts it back); the caret goes `offset` characters into the line.
 */
function itemToLine(root: HTMLElement, li: HTMLElement, offset: number): boolean {
  const list = li.parentElement as HTMLElement | null;
  if (!list || !/^(UL|OL)$/.test(list.tagName) || isNested(list)) return false;
  const items = Array.from(list.children);
  const i = items.indexOf(li);
  const part = (from: Element[]) => {
    const l = list.cloneNode(false) as HTMLElement;
    l.append(...from.map((n) => n.cloneNode(true)));
    return l;
  };
  const line = lineOf(li);
  const put: Node[] = [];
  if (i > 0) put.push(part(items.slice(0, i)));
  put.push(line);
  if (i < items.length - 1) {
    const after = part(items.slice(i + 1));
    // A numbered list goes on counting from where it was.
    const before = items.slice(0, i + 1).filter((n) => n.tagName === 'LI').length;
    if (list.tagName === 'OL') after.setAttribute('start', String((Number(list.getAttribute('start')) || 1) + before));
    put.push(after);
  }
  unformat(root, list, put, line, li, offset);
  return true;
}

/** The deepest a line can be indented with Tab. */
const MAX_INDENT = 8;

/** Tab / Shift+Tab on a line that is not in a list: one step in or out (Ctrl+Z undoes it). */
function indentLine(root: HTMLElement, out: boolean): boolean {
  const found = currentLine(root);
  // A toggle's title: the whole toggle moves.
  const line = found?.classList.contains('toggle-head') ? (found.parentElement as HTMLElement) : found;
  if (!line || line === root) return false;
  const level = Number(line.dataset.indent) || 0;
  const next = Math.max(0, Math.min(MAX_INDENT, level + (out ? -1 : 1)));
  if (next === level) return true;
  const at = caretBlock(root);
  const offset = at ? caretOffset(line, at.range) : 0;
  const copy = line.cloneNode(true) as HTMLElement;
  if (next) copy.dataset.indent = String(next);
  else delete copy.dataset.indent;
  unformat(root, line, [copy], copy, line, offset);
  return true;
}

/**
 * Tab / Shift+Tab in a list: the item goes one level in (under the item above it, with the next
 * kind of bullet) or out. Done with the editor's own commands, so Ctrl+Z undoes it.
 */
function indentItem(root: HTMLElement, item: HTMLElement, out: boolean) {
  const list = item.parentElement as HTMLElement;
  // Out of a list that is not indented: a plain line.
  if (out && !isNested(list)) {
    const at = caretBlock(root);
    itemToLine(root, item, at ? caretOffset(item, at.range) : 0);
    return;
  }
  const checklist = !!list.closest('ul.checklist');
  const checked = item.dataset.checked;
  if (!out) {
    // The first item of a list has nothing to go under.
    if (!item.previousElementSibling) return;
    document.execCommand('indent');
  } else document.execCommand('outdent');
  // The editor's commands do not know about to-do lists: the new list is one too, the item keeps its tick.
  const now = item.isConnected ? item : null;
  const parent = now?.parentElement;
  if (now && checklist && parent && /^(UL|OL)$/.test(parent.tagName) && !parent.classList.contains('checklist')) parent.classList.add('checklist');
  if (now && checked && !now.dataset.checked && now.closest('ul.checklist')) now.dataset.checked = checked;
}

/** Ctrl+Z / redo of the last format taken off, when the note is just as that left it. */
function undoUnformat(e: KeyboardEvent, root: HTMLElement): boolean {
  if (!e.ctrlKey || e.altKey) return false;
  const z = e.code === 'KeyZ' || e.key.toLowerCase() === 'z';
  const y = e.code === 'KeyY' || e.key.toLowerCase() === 'y';
  if (!z && !y) return false;
  const u = unformats.get(root);
  if (!u) return false;
  const redo = y || e.shiftKey;
  if (!redo && !u.undone && root.innerHTML === u.after) {
    swapIn(u.put, [u.old]);
    placeAt(u.caretOld, 0);
    u.undone = true;
    return true;
  }
  if (redo && u.undone && root.innerHTML === u.before) {
    swapIn([u.old], u.put);
    placeAt(u.caretPut, 0);
    u.undone = false;
    return true;
  }
  return false;
}

/** A line holding a copy of what `from` holds (an empty one keeps a <br> to be a line). */
function lineOf(from: Node, tag = 'div') {
  const line = document.createElement(tag);
  line.append(...Array.from(from.cloneNode(true).childNodes));
  if (!line.textContent && !line.querySelector('br, img, .embed')) line.append(document.createElement('br'));
  return line;
}

/** The first text (or the element itself) of `n`, for the caret. */
const startOf = (n: Node): Node => {
  const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
  for (let t = w.nextNode(); t; t = w.nextNode()) if ((t as Text).data) return t;
  return n;
};

/** A heading, quote or code block back to a plain line. */
function toPlain(root: HTMLElement, block: HTMLElement) {
  const line = lineOf(block);
  unformat(root, block, [line], startOf(line), startOf(block));
}

/** Handles a key in the note editor. Returns true when it did something (the key is then used up). */
export function markdownKey(e: KeyboardEvent, root: HTMLElement): boolean {
  if (e.isComposing || e.altKey || e.metaKey) return false;
  if (undoUnformat(e, root)) return true;
  if (embedKey(e, root)) return true;
  const at = caretBlock(root);
  if (!at) return false;
  const pre = at.block.closest('pre');
  const head = (at.range.startContainer instanceof Element ? at.range.startContainer : at.range.startContainer.parentElement)?.closest<HTMLElement>('.toggle-head');

  // ----- Inside a code block -----
  if (pre && root.contains(pre)) {
    const atEnd = isAtEnd(pre, at.range);
    if ((e.key === 'Enter' && e.ctrlKey) || (e.key === 'ArrowDown' && atEnd && !e.shiftKey && !e.ctrlKey)) {
      // Leaves the code block for a plain line below it.
      let next = pre.nextElementSibling as HTMLElement | null;
      if (!next || e.key === 'Enter') {
        next = emptyLine();
        pre.after(next);
      }
      placeAt(next, 0);
      return true;
    }
    if (e.key === 'Enter' && !e.ctrlKey) {
      document.execCommand('insertLineBreak');
      return true;
    }
    if (e.key === 'Backspace' && !e.ctrlKey && isAtStart(pre, at.range)) {
      toPlain(root, pre);
      return true;
    }
    return false;
  }

  // ----- A toggle's title -----
  if (head && root.contains(head)) {
    const toggle = head.parentElement as HTMLElement;
    const body = toggle.querySelector<HTMLElement>(':scope > .toggle-body');
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && body) {
      toggle.dataset.open = 'true';
      let first = body.firstElementChild as HTMLElement | null;
      if (!first || first.textContent) {
        first = emptyLine();
        body.prepend(first);
      }
      placeAt(first, 0);
      return true;
    }
    if (e.key === 'Backspace' && !e.ctrlKey && isAtStart(head, at.range)) {
      // Back to plain lines: the title and then what was folded under it (Ctrl+Z brings the toggle back).
      const line = lineOf(head);
      const rest = body ? Array.from(body.childNodes).map((n) => n.cloneNode(true)) : [];
      unformat(root, toggle, [line, ...rest], startOf(line), startOf(head));
      return true;
    }
  }

  // ----- Tab / Shift+Tab in a list: the item one level in (another bullet) or out -----
  const tabItem = e.key === 'Tab' && !e.ctrlKey ? at.block.closest<HTMLElement>('li') : null;
  if (tabItem && root.contains(tabItem)) {
    indentItem(root, tabItem, e.shiftKey);
    return true;
  }

  // ----- Toggle bodies: out with Enter on an empty last line or Shift+Tab, in with Tab -----
  if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey)) {
    const moved = indentKey(root, e.key === 'Tab' ? (e.shiftKey ? 'out' : 'in') : 'enter');
    if (moved) return true;
  }

  // ----- Tab / Shift+Tab on any other line: indent it one step, or take one step back -----
  if (e.key === 'Tab' && !e.ctrlKey) {
    indentLine(root, e.shiftKey);
    return true;
  }

  // ----- Backspace at the start of a heading or quote: plain text again -----
  if (e.key === 'Backspace' && !e.ctrlKey && /^(H1|H2|H3|BLOCKQUOTE)$/.test(at.block.tagName) && isAtStart(at.block, at.range)) {
    toPlain(root, at.block);
    return true;
  }

  // ----- Backspace at the start of a list item: that item becomes a plain line (the list splits around it) -----
  const li = at.block.closest('li');
  if (e.key === 'Backspace' && !e.ctrlKey && !e.shiftKey && li && root.contains(li) && at.range.collapsed && isAtStart(li, at.range) && !li.querySelector('ul, ol')) {
    const list = li.parentElement as HTMLElement;
    if (list && isNested(list)) {
      // An indented item: one level out.
      document.execCommand('outdent');
      return true;
    }
    if (itemToLine(root, li, 0)) return true;
  }

  // ----- Enter on an empty indented item: one level out (as Shift+Tab) -----
  if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && li && root.contains(li) && !li.textContent && isNested(li.parentElement)) {
    document.execCommand('outdent');
    return true;
  }

  // ----- Enter in a to-do list: the new item starts unchecked -----
  if (e.key === 'Enter' && !e.shiftKey && at.block.closest('ul.checklist')) {
    requestAnimationFrame(() => {
      const li = caretBlock(root)?.block.closest<HTMLElement>('ul.checklist > li');
      if (li && !li.textContent) li.dataset.checked = 'false';
      root.dispatchEvent(new Event('input', { bubbles: true }));
    });
    return false;
  }

  // ----- A list marker at the start of a list item: the item becomes that kind of list -----
  if (e.key === ' ' && !e.ctrlKey && li && root.contains(li)) {
    const before = textBeforeCaret(root);
    const kind = before && ITEM_MARKERS[before.text.replace(/\u00a0/g, ' ')];
    if (before && kind) {
      const list = li.parentElement as HTMLElement;
      const same = list.tagName.toLowerCase() === kind[0] && list.classList.contains('checklist') === kind[1];
      if (!same) {
        before.range.deleteContents();
        if (itemToKind(root, li, kind[0], kind[1])) return true;
      }
    }
  }

  // ----- Markers at the start of a line -----
  if (e.ctrlKey || at.block.closest('li, .toggle-head')) return false;
  const before = textBeforeCaret(root);
  if (!before) return false;
  const text = before.text.replace(/ /g, ' ');
  if (e.key === ' ') {
    // "# " has already made a heading by the time ">" comes: "> " in a heading makes it a heading toggle.
    const heading = /^H([123])$/.exec(before.block.tagName);
    if (heading && text === '>') {
      before.range.deleteContents();
      makeToggle(root, Number(heading[1]));
      return true;
    }
    const hit = SPACE_MARKERS.find(([m]) => text === m);
    if (!hit) return false;
    before.range.deleteContents();
    hit[1](root);
    return true;
  }
  if (e.key === '-' && text === '--' && isLineEmptyAfter(before.block, at.range)) {
    before.range.deleteContents();
    makeDivider(root);
    return true;
  }
  if (e.key === '`' && text === '``') {
    before.range.deleteContents();
    asBlock('pre')(root);
    return true;
  }
  return false;
}

function isAtStart(block: HTMLElement, caret: Range) {
  const r = document.createRange();
  r.setStart(block, 0);
  r.setEnd(caret.startContainer, caret.startOffset);
  return r.toString() === '';
}

function isAtEnd(block: HTMLElement, caret: Range) {
  const r = document.createRange();
  r.setStart(caret.startContainer, caret.startOffset);
  r.setEnd(block, block.childNodes.length);
  return r.toString().replace(/\n$/, '') === '';
}

function isLineEmptyAfter(block: HTMLElement, caret: Range) {
  if (block.tagName === 'DIV' || block.tagName === 'P') return isAtEnd(block, caret);
  return true;
}

/* ---------- The left bar's buttons for these blocks ---------- */

export type NoteBlock = 'h3' | 'checklist' | 'toggle' | 'code' | 'divider';

/** Makes the caret's line one of the blocks (as typing its shortcut would). A heading becomes a heading toggle. */
export function applyBlock(root: HTMLElement, kind: NoteBlock) {
  if (kind === 'h3') return asBlock('h3')(root);
  if (kind === 'checklist') return asList('ul', true)(root);
  if (kind === 'code') return asBlock('pre')(root);
  if (kind === 'toggle') {
    const heading = /^H([123])$/.exec(caretBlock(root)?.block.tagName ?? '');
    return makeToggle(root, heading ? Number(heading[1]) : 0);
  }
  const line = currentLine(root);
  if (!line) return;
  if (!line.textContent) return makeDivider(root);
  // A line with text keeps it; the divider goes under it, then a fresh line.
  const after = emptyLine();
  line.after(document.createElement('hr'), after);
  placeAt(after, 0);
}

/* ---------- In and out of toggles ---------- */

/** The caret's line as a direct child of a toggle's body or of the note. */
function lineIn(root: HTMLElement): HTMLElement | null {
  const line = currentLine(root);
  if (!line || line.closest('li, pre, .toggle-head')) return null;
  let el: HTMLElement | null = line;
  while (el && el.parentElement !== root && !el.parentElement?.classList.contains('toggle-body')) el = el.parentElement;
  return el && el !== root ? el : null;
}

/** Runs a DOM move and puts the caret back where it was. */
function keepingCaret(fn: () => void) {
  const sel = window.getSelection();
  const r = sel?.rangeCount ? sel.getRangeAt(0) : null;
  const node = r?.startContainer;
  const offset = r?.startOffset ?? 0;
  fn();
  if (node?.isConnected) placeAt(node, offset);
}

/**
 * 'out' (Shift+Tab): the line and every line after it in the toggle move out, under the toggle.
 * 'enter' (Enter): the same, but only for an empty last line of the toggle.
 * 'in' (Tab): a line right under a toggle moves in, as the toggle's last line.
 */
function indentKey(root: HTMLElement, how: 'out' | 'in' | 'enter'): boolean {
  const line = lineIn(root);
  if (!line) return false;
  const body = line.parentElement;
  if (how !== 'in') {
    if (!body?.classList.contains('toggle-body')) return false;
    if (how === 'enter' && (line.textContent || line.nextElementSibling)) return false;
    const toggle = body.parentElement as HTMLElement;
    keepingCaret(() => {
      const rest: Element[] = [];
      for (let n: Element | null = line; n; n = n.nextElementSibling) rest.push(n);
      toggle.after(...rest);
      if (!body.firstElementChild) body.append(emptyLine());
    });
    if (how === 'enter') placeAt(line, 0);
    return true;
  }
  const prev = line.previousElementSibling as HTMLElement | null;
  const target = prev?.classList.contains('toggle') ? prev.querySelector<HTMLElement>(':scope > .toggle-body') : null;
  if (!prev || !target) return false;
  keepingCaret(() => {
    // A toggle holding only an empty line takes the moving line in its place.
    const only = target.lastElementChild;
    if (only && !only.textContent && target.children.length === 1) only.remove();
    target.append(line);
    prev.dataset.open = 'true';
  });
  return true;
}

/* ---------- Checkboxes and ▶ (they react to a click on their left edge) ---------- */

export type NoteToggleHit = { kind: 'check' | 'toggle'; index: number };

/** Whether a click at x landed on a to-do checkbox or a toggle's ▶, and which one (counted in the note). */
export function noteHit(root: HTMLElement, target: EventTarget | null, clientX: number): NoteToggleHit | null {
  const t = target as HTMLElement | null;
  const li = t?.closest<HTMLElement>('ul.checklist > li');
  if (li && root.contains(li) && clientX - li.getBoundingClientRect().left < 22) {
    return { kind: 'check', index: Array.from(root.querySelectorAll('ul.checklist > li')).indexOf(li) };
  }
  const head = t?.closest<HTMLElement>('.toggle-head');
  if (head && root.contains(head) && clientX - head.getBoundingClientRect().left < 20) {
    return { kind: 'toggle', index: Array.from(root.querySelectorAll('.toggle-head')).indexOf(head) };
  }
  return null;
}

/** Ticks a checkbox or opens / folds a toggle in a note's own DOM. */
export function applyHit(root: ParentNode, hit: NoteToggleHit) {
  if (hit.kind === 'check') {
    const li = root.querySelectorAll<HTMLElement>('ul.checklist > li')[hit.index];
    if (li) li.dataset.checked = li.dataset.checked === 'true' ? 'false' : 'true';
  } else {
    const toggle = root.querySelectorAll<HTMLElement>('.toggle-head')[hit.index]?.parentElement;
    if (toggle) toggle.dataset.open = toggle.dataset.open === 'false' ? 'true' : 'false';
  }
}

/** The same click applied to a note's saved HTML (for a note that is only shown, not edited). */
export function applyHitToHtml(html: string, hit: NoteToggleHit): string {
  const box = document.createElement('div');
  box.innerHTML = html;
  applyHit(box, hit);
  return box.innerHTML;
}
