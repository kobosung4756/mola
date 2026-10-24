import { blockAddress, blockByAddress, blockByName, blockLinkHtml, blockNameOf, embedHtml, splitAddress, unresolvedLinkHtml } from '../blockLinks';
import { normalizeUrl } from '../actions';

/*
 * Links in a note, written as text: an outside link typed as [name](address) becomes one, and
 * Backspace right after a link (outside or [[ ]]) does not take it away at once: it opens it as
 * its text — [name](address) or [[name]] — to be changed. Backspace again at its end takes it away;
 * moving the caret out of it makes it a link again.
 */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** [name](address) typed: the outside link it stands for. */
export const MD_LINK = /\[([^[\]]+)\]\(([^()\s]+)\)$/;

/** A link (outside or to a block) right before the caret, or the one the caret is at the end of. */
function linkBefore(range: Range): HTMLAnchorElement | null {
  const n = range.startContainer;
  const off = range.startOffset;
  const isLink = (x: Node | null | undefined): x is HTMLAnchorElement => x instanceof HTMLAnchorElement && (x.classList.contains('block-link') || !!x.getAttribute('href'));
  // At the end of an outside link's own text.
  const inside = (n instanceof Element ? n : n.parentElement)?.closest('a');
  if (isLink(inside)) {
    const r = document.createRange();
    r.selectNodeContents(inside);
    r.setStart(range.startContainer, range.startOffset);
    if (!r.toString().length) return inside;
    return null;
  }
  // Otherwise the piece just before the caret, also when the link ends inside formatting (<i><a>…</a></i>).
  const empty = (x: Node | null) => !!x && x.nodeType === Node.TEXT_NODE && !(x as Text).data.length;
  const lastLink = (x: Node | null): HTMLAnchorElement | null => {
    while (x) {
      if (isLink(x)) return x;
      let last: Node | null = x.lastChild;
      while (last && empty(last)) last = last.previousSibling;
      x = last;
    }
    return null;
  };
  if (n.nodeType !== Node.TEXT_NODE && off > 0) return lastLink(n.childNodes[off - 1]);
  if (n.nodeType === Node.TEXT_NODE && off > 0) return null;
  let cur: Node | null = n;
  while (cur) {
    let prev: Node | null = cur.previousSibling;
    while (prev && empty(prev)) prev = prev.previousSibling;
    if (prev) return lastLink(prev);
    const up: HTMLElement | null = cur.parentElement;
    // Not past the start of the line.
    if (!up || up.isContentEditable === false || up.getAttribute('contenteditable') === 'true' || /^(DIV|P|LI|H1|H2|H3|BLOCKQUOTE|PRE|UL|OL)$/.test(up.tagName)) return null;
    cur = up;
  }
  return null;
}

/** Whether a link's text is its address (with or without https://, a trailing /). */
const sameAddress = (text: string, href: string) => {
  const bare = (u: string) => u.trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '').toLowerCase();
  return !!text.trim() && bare(text) === bare(href);
};

/** The text a link is opened up as. */
function linkText(a: HTMLAnchorElement) {
  const name = a.textContent ?? '';
  if (a.classList.contains('block-link')) {
    // [[alias|^address]] (and |80, a size kept for an embed): what the link shows, and the block's
    // own address — or, for one no block has, the address as it was written.
    const ref = a.dataset.ref;
    if (!ref) return `[[${name}]]`;
    const address = blockNameOf(ref) !== undefined ? blockAddress(ref) : `^${ref === 'missing' ? '' : ref}`;
    return `[[${name}|${address}${a.dataset.size ? `|${a.dataset.size}` : ''}]]`;
  }
  return `[${name}](${a.getAttribute('href') ?? ''})`;
}

/** Backspace in a note: opens the link before the caret for changing, or takes away one opened. */
export function linkBackspace(e: KeyboardEvent, root: HTMLElement): boolean {
  if (e.key !== 'Backspace' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.isComposing) return false;
  const sel = window.getSelection();
  if (!sel?.rangeCount || !sel.isCollapsed) return false;
  const range = sel.getRangeAt(0);
  // In a link opened up, at its end: the whole link goes.
  const open = (range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement)?.closest<HTMLElement>('span.link-edit');
  if (open && root.contains(open)) {
    const rest = document.createRange();
    rest.selectNodeContents(open);
    rest.setStart(range.startContainer, range.startOffset);
    if (rest.toString().length) return false; // inside it: letters are taken one by one
    // Without its own look first: the browser would carry it (blue, small, monospace) into what is typed next.
    open.classList.add('going');
    const all = document.createRange();
    all.selectNode(open);
    sel.removeAllRanges();
    sel.addRange(all);
    document.execCommand('delete');
    return true;
  }
  const a = linkBefore(range);
  if (!a || !root.contains(a)) return false;
  // A link that shows its own address (as a pasted web address does): nothing to open up; the
  // link comes off and the address stays as text (Ctrl+Z puts the link back).
  if (!a.classList.contains('block-link') && sameAddress(a.textContent ?? '', a.getAttribute('href') ?? '')) {
    const all = document.createRange();
    all.selectNodeContents(a);
    sel.removeAllRanges();
    sel.addRange(all);
    document.execCommand('unlink');
    sel.collapseToEnd();
    return true;
  }
  const mark = 'e' + Math.random().toString(36).slice(2);
  const data = a.classList.contains('block-link')
    ? a.dataset.ref
      ? ` data-ref="${esc(a.dataset.ref)}"`
      : ` data-new="${esc(a.dataset.new ?? a.textContent ?? '')}"`
    : ` data-href="${esc(a.getAttribute('href') ?? '')}"`;
  const all = document.createRange();
  all.selectNode(a);
  sel.removeAllRanges();
  sel.addRange(all);
  document.execCommand('insertHTML', false, `<span class="link-edit" data-tmp="${mark}"${data}>${esc(linkText(a))}</span>`);
  const span = root.querySelector<HTMLElement>(`[data-tmp="${mark}"]`);
  if (span) {
    span.removeAttribute('data-tmp');
    const r = document.createRange();
    r.selectNodeContents(span);
    r.collapse(false);
    sel.removeAllRanges();
    sel.addRange(r);
  }
  return true;
}

/** What a link opened up (span.link-edit) stands for again: a link, or plain text when no longer one. */
function closedHtml(span: HTMLElement): string {
  const text = (span.textContent ?? '').trim();
  // ! in front: the link becomes an embed of the block (its size kept).
  const embed = /^!\[\[([^[\]]*)\]\]$/.exec(text);
  if ((span.dataset.ref || span.dataset.new !== undefined) && embed) {
    const { address, alias, size } = splitAddress(embed[1]);
    const to = address !== undefined ? blockByAddress(address) : span.dataset.ref && blockNameOf(span.dataset.ref) !== undefined ? span.dataset.ref : undefined;
    const n = size ? Number(size) : undefined;
    return embedHtml(to ?? (address || 'missing'), alias || (to ? blockNameOf(to) : '') || '…', n && n >= 5 && n <= 400 ? n : undefined) + '<div><br></div>';
  }
  const block = /^\[\[([^[\]]*)\]\]$/.exec(text);
  if ((span.dataset.ref || span.dataset.new !== undefined) && block) {
    const { address, alias, size } = splitAddress(block[1]);
    if (span.dataset.ref || address !== undefined) {
      // [[alias|^address]]: the block is found by its address alone. An address changed into one
      // no block has (or taken away) leaves the link pointing nowhere: it shows as not found.
      if (address !== undefined) {
        const to = blockByAddress(address);
        if (to) return blockLinkHtml(to, alias || blockNameOf(to) || '…', size);
        return blockLinkHtml(address || 'missing', alias || '…', size);
      }
      // No address left: a block of that name, if there is one; otherwise not found.
      const named = alias ? blockByName(alias) : undefined;
      return blockLinkHtml(named ?? 'missing', alias || '…', size);
    }
    return unresolvedLinkHtml(alias || span.dataset.new || '…');
  }
  const out = MD_LINK.exec(text);
  if (out && out.index === 0) return `<a href="${esc(normalizeUrl(out[2]))}">${esc(out[1])}</a>`;
  return esc(span.textContent ?? '');
}

/** A link opened up and taken away, then brought back by Ctrl+Z: it looks opened up again. */
export function reviveLinkEdits(root: HTMLElement) {
  for (const span of Array.from(root.querySelectorAll('span.link-edit.going'))) span.classList.remove('going');
}

/**
 * Links opened up that the caret has left become links again: in the note, through the editor
 * (so Ctrl+Z steps back through it, with nothing left over twice), or in a copy being saved.
 */
let closing = false;
export function closeLinkEdits(root: HTMLElement, keepCaret = true, place?: 'before' | 'after') {
  const sel = window.getSelection();
  const at = keepCaret && sel?.rangeCount ? sel.getRangeAt(0).startContainer : null;
  for (const span of Array.from(root.querySelectorAll<HTMLElement>('span.link-edit'))) {
    if (!place && at && span.contains(at)) continue;
    if (!keepCaret || !root.isContentEditable || !sel) {
      const t = document.createElement('template');
      t.innerHTML = closedHtml(span);
      span.replaceWith(t.content);
      continue;
    }
    if (closing) return;
    closing = true;
    try {
      const caret = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
      const mark = 'c' + Math.random().toString(36).slice(2);
      const html = closedHtml(span).replace(/^<(a|div) /, `<$1 data-tmp="${mark}" `);
      const all = document.createRange();
      all.selectNode(span);
      sel.removeAllRanges();
      sel.addRange(all);
      document.execCommand('insertHTML', false, html);
      const made = root.querySelector<HTMLElement>(`[data-tmp="${mark}"]`);
      made?.removeAttribute('data-tmp');
      // The caret back where it went (or just before / after the link, for Shift+Tab / Tab).
      const r = document.createRange();
      if (place && made) {
        if (place === 'before') r.setStartBefore(made);
        else r.setStartAfter(made);
      } else if (caret && caret.startContainer.isConnected) r.setStart(caret.startContainer, caret.startOffset);
      else if (made) r.setStartAfter(made);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
    } finally {
      closing = false;
    }
  }
}

/**
 * Tab / Shift+Tab (or Enter) in a link opened up: done with it, the caret just after / before the
 * link, to write on. In an embed's address: the caret on the line after / before the embed.
 */
export function linkEditTab(e: KeyboardEvent, root: HTMLElement): boolean {
  // Enter confirms too, carrying on to the right (as Tab does).
  const enter = e.key === 'Enter' && !e.shiftKey && !e.isComposing;
  if ((e.key !== 'Tab' && !enter) || e.ctrlKey || e.metaKey || e.altKey) return false;
  const sel = window.getSelection();
  if (!sel?.rangeCount) return false;
  const from = sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode?.parentElement;
  const open = from?.closest<HTMLElement>('span.link-edit');
  if (open && root.contains(open)) {
    closeLinkEdits(root, true, e.shiftKey ? 'before' : 'after');
    return true;
  }
  const addr = from?.closest<HTMLElement>('.embed-addr');
  const embed = addr?.parentElement;
  if (addr && embed?.classList.contains('embed') && root.contains(embed)) {
    let line = (e.shiftKey ? embed.previousElementSibling : embed.nextElementSibling) as HTMLElement | null;
    if (!line || line.classList.contains('embed')) {
      line = document.createElement('div');
      line.append(document.createElement('br'));
      if (e.shiftKey) embed.before(line);
      else embed.after(line);
    }
    const r = document.createRange();
    r.selectNodeContents(line);
    r.collapse(!!e.shiftKey ? false : true);
    sel.removeAllRanges();
    sel.addRange(r);
    return true;
  }
  return false;
}

/** ! typed just before a link to a block: the link becomes an embed of the block (its size kept). */
export function bangToEmbed(e: KeyboardEvent, root: HTMLElement): boolean {
  if (e.key !== '!' || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return false;
  const sel = window.getSelection();
  if (!sel?.rangeCount || !sel.isCollapsed) return false;
  const r = sel.getRangeAt(0);
  let next: Node | null = null;
  if (r.startContainer.nodeType === Node.TEXT_NODE) {
    const t = r.startContainer as Text;
    if (r.startOffset < t.length) return false;
    next = t.nextSibling;
  } else next = r.startContainer.childNodes[r.startOffset] ?? null;
  while (next && next.nodeType === Node.TEXT_NODE && !(next as Text).data.length) next = next.nextSibling;
  if (!(next instanceof HTMLAnchorElement) || !next.classList.contains('block-link') || !next.dataset.ref || !root.contains(next)) return false;
  const a = next;
  const ref = a.dataset.ref!;
  const size = a.dataset.size ? Number(a.dataset.size) : undefined;
  const all = document.createRange();
  all.selectNode(a);
  sel.removeAllRanges();
  sel.addRange(all);
  document.execCommand('insertHTML', false, embedHtml(ref, a.textContent || blockNameOf(ref) || '…', size && size >= 5 && size <= 400 ? size : undefined) + '<div><br></div>');
  return true;
}

/**
 * [name](address) just typed (the ")" closing it): it becomes an outside link. Not in a link
 * opened up for changing (that one closes when the caret leaves it).
 */
export function markdownLinkAtCaret(root: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel?.rangeCount || !sel.isCollapsed) return false;
  const r = sel.getRangeAt(0);
  const n = r.startContainer;
  if (n.nodeType !== Node.TEXT_NODE || !root.contains(n)) return false;
  if (n.parentElement?.closest('span.link-edit, code, pre, a')) return false;
  const before = (n as Text).data.slice(0, r.startOffset);
  const m = MD_LINK.exec(before);
  if (!m) return false;
  const span = document.createRange();
  span.setStart(n, r.startOffset - m[0].length);
  span.setEnd(n, r.startOffset);
  sel.removeAllRanges();
  sel.addRange(span);
  const mark = 'm' + Math.random().toString(36).slice(2);
  document.execCommand('insertHTML', false, `<a data-tmp="${mark}" href="${esc(normalizeUrl(m[2]))}">${esc(m[1])}</a>`);
  const a = root.querySelector<HTMLElement>(`[data-tmp="${mark}"]`);
  if (a) {
    a.removeAttribute('data-tmp');
    // The caret after the link, outside it (what is typed next is not part of the link).
    const after = document.createRange();
    after.setStartAfter(a);
    after.collapse(true);
    sel.removeAllRanges();
    sel.addRange(after);
  }
  return true;
}

/** After a link is put on the text picked (Ctrl+H, the outside-link bubble): the caret right after it, not the text picked. */
export function caretAfterLink(root: HTMLElement): HTMLAnchorElement | null {
  const sel = window.getSelection();
  if (!sel?.rangeCount) return null;
  const range = sel.getRangeAt(0);
  const end = range.endContainer instanceof Element ? range.endContainer : range.endContainer.parentElement;
  let a = end?.closest<HTMLAnchorElement>('a[href]') ?? null;
  if (!a || !root.contains(a)) a = Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href]')).filter((x) => range.intersectsNode(x)).pop() ?? null;
  if (!a) return null;
  const r = document.createRange();
  r.setStartAfter(a);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
  return a;
}

/** A web address (as copied from a browser's address bar, or typed). */
export const looksLikeUrl = (t: string) => /^(https?:\/\/|www\.|mailto:)\S+$/i.test(t) || /^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(t);

/**
 * The link just made from a pasted web address: Backspace right after it takes the link off (the
 * address stays as text; Ctrl+Z puts the link back). Any other key or a click forgets it.
 */
let pasted: HTMLAnchorElement | null = null;
export const forgetPastedLink = () => {
  pasted = null;
};

/** A web address pasted in a note: a link (on the text picked, or the address itself as its text). */
export function pasteUrl(root: HTMLElement, text: string): boolean {
  const url = text.trim();
  if (!url || /\s/.test(url) || !looksLikeUrl(url)) return false;
  const sel = window.getSelection();
  if (!sel?.rangeCount) return false;
  const href = normalizeUrl(url);
  if (!sel.isCollapsed) document.execCommand('createLink', false, href);
  else {
    const mark = 'p' + Math.random().toString(36).slice(2);
    document.execCommand('insertHTML', false, `<a data-tmp="${mark}" href="${esc(href)}">${esc(url)}</a>`);
    root.querySelector(`[data-tmp="${mark}"]`)?.removeAttribute('data-tmp');
  }
  pasted = caretAfterLink(root);
  return true;
}

/** Backspace right after a link just made from a paste: the link comes off, the address stays. */
export function unlinkPasted(e: KeyboardEvent, root: HTMLElement): boolean {
  if (e.key !== 'Backspace' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || !pasted) return false;
  const a = pasted;
  pasted = null;
  const sel = window.getSelection();
  if (!sel?.rangeCount || !sel.isCollapsed || !a.isConnected || !root.contains(a) || linkBefore(sel.getRangeAt(0)) !== a) return false;
  const r = document.createRange();
  r.selectNodeContents(a);
  sel.removeAllRanges();
  sel.addRange(r);
  document.execCommand('unlink');
  sel.collapseToEnd();
  return true;
}

/** ~~text~~ or ==text== just closed: struck through, or highlighted. */
export const HIGHLIGHT_COLOR = '#fff3a3';
export function inlineMarkAtCaret(root: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel?.rangeCount || !sel.isCollapsed) return false;
  const r = sel.getRangeAt(0);
  const n = r.startContainer;
  if (n.nodeType !== Node.TEXT_NODE || !root.contains(n) || n.parentElement?.closest('code, pre, span.link-edit, .embed-addr')) return false;
  const before = (n as Text).data.slice(0, r.startOffset);
  const m = /(~~|==)([^~=\n]+?)\1$/.exec(before);
  if (!m || !m[2].trim()) return false;
  const span = document.createRange();
  span.setStart(n, r.startOffset - m[0].length);
  span.setEnd(n, r.startOffset);
  sel.removeAllRanges();
  sel.addRange(span);
  const mark = 'k' + Math.random().toString(36).slice(2);
  const inner = esc(m[2]);
  document.execCommand(
    'insertHTML',
    false,
    m[1] === '~~' ? `<strike data-tmp="${mark}">${inner}</strike>` : `<span data-tmp="${mark}" style="background-color: ${HIGHLIGHT_COLOR};">${inner}</span>`,
  );
  const made = root.querySelector<HTMLElement>(`[data-tmp="${mark}"]`);
  if (made) {
    made.removeAttribute('data-tmp');
    caretOutside(made);
  }
  return true;
}

/**
 * The caret just after an element, outside it: what is typed next is plain again. (The browser
 * would carry on inside the element, so a zero-width space holds the caret; it is not saved.)
 */
export function caretOutside(made: Node) {
  const sel = window.getSelection();
  if (!sel) return;
  let next = made.nextSibling;
  if (!(next && next.nodeType === Node.TEXT_NODE && (next as Text).data.startsWith(ZWSP))) {
    next = document.createTextNode(ZWSP);
    made.parentNode?.insertBefore(next, made.nextSibling);
  }
  const after = document.createRange();
  after.setStart(next, 1);
  after.collapse(true);
  sel.removeAllRanges();
  sel.addRange(after);
}
export const ZWSP = '\u200B';

/**
 * Text picked in a note, then ~~ (or --) or ==: struck through, or highlighted, instead of the
 * text being typed over. The first mark waits for the second; another key types it as usual.
 */
let waiting: { key: string; t: number } | null = null;
export function pickedMarkKey(e: KeyboardEvent): boolean {
  if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return false;
  const sel = window.getSelection();
  const picked = !!sel?.rangeCount && !sel.isCollapsed;
  const isMark = e.key === '~' || e.key === '=' || e.key === '-';
  if (!picked) {
    waiting = null;
    return false;
  }
  if (!isMark) {
    // Not a second mark: the first one is typed (over the picked text), then this key as usual.
    if (waiting && e.key.length === 1) document.execCommand('insertText', false, waiting.key);
    waiting = null;
    return false;
  }
  e.preventDefault();
  if (waiting && waiting.key === e.key && Date.now() - waiting.t < 2000) {
    waiting = null;
    if (e.key === '=') {
      // Already highlighted: == takes it off (as ~~ / -- on struck-through text takes that off).
      const now = String(document.queryCommandValue('backColor') || '').replace(/\s/g, '');
      const on = !!now && now !== 'rgba(0,0,0,0)' && now !== 'transparent' && now !== 'rgb(255,255,255)';
      document.execCommand('styleWithCSS', false, 'true');
      document.execCommand('hiliteColor', false, on ? 'transparent' : HIGHLIGHT_COLOR);
      document.execCommand('styleWithCSS', false, 'false');
    } else document.execCommand('strikeThrough');
    // Typing on after the picked text is plain.
    const end = sel!.getRangeAt(0);
    const host = (end.endContainer instanceof Element ? end.endContainer : end.endContainer.parentElement)?.closest('strike, s, span[style]');
    if (host) caretOutside(host);
    else sel!.collapseToEnd();
    return true;
  }
  waiting = { key: e.key, t: Date.now() };
  return true;
}
