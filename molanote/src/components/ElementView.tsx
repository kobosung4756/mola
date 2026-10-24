import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type {
  ClipboardEvent as ReactClipboardEvent,
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from 'react';
import type { El, ElMap } from '../types';
import { BOARD_ICONS, COLORS } from '../types';
import {
  attachedOf,
  canResizeHeight,
  canvasItems,
  DEFAULT_WIDTH,
  isHidden,
  labelDefsOf,
  MIN_WIDTH,
  RESIZABLE,
  toggleReaction,
  uid,
  update,
  createLabel,
  toggleLabel,
  elTitle,
  plainTaskText,
} from '../model';
import { detectPaper, fetchArxivMeta, fetchPaperPdf } from '../papers';
import { fetchLinkPreview } from '../previews';
import {
  cellKey,
  clearRange,
  colName,
  displayCell,
  inRange,
  NEW_COL_WIDTH,
  normalize as normalizeCells,
  parseTsv,
  pasteCells,
  fillEnd,
  fillShift,
  fillValues,
  MAX_COLS,
  MAX_ROWS,
  formulaRanges,
  rangeName,
  rangeOf,
  refSlot,
  setCell as setCellValue,
  shiftFormula,
  Sheet,
  toTsv,
} from '../table';
import type { CellFormat, CellRange, FillDir } from '../table';

import { editStart, useBoard } from '../context';
import { blockAddress, blockByAddress, blockLinkHtml, copiedBlockLink, embedHtml, embedScale, isPickedBlock, linkLabel, pickBlock, pickedLabel, splitAddress, takePickedAlias, unresolvedLinkHtml } from '../blockLinks';
import { sanitize, textToHtml } from '../sanitize';
import { formatBytes, hostOf, normalizeUrl } from '../actions';
import { blobUrl, cachedBlobUrl, putBlob } from '../db';
import { Avatar, useBlobUrl } from './Avatar';
import { Icon } from './Icon';
import { TagChipBubble } from './TagEdit';
import { InkLayer } from './Ink';
import { noteShortcut, TEXT_COLORS } from './TextBar';
import { applyHit, applyHitToHtml, markdownKey, noteHit } from './NoteMarkdown';
import { sketchDataUrl } from '../draw';
import { hyphenateIn } from '../hyphenate';
import { SLIDE_UP_EVENT } from '../context';
import { allTaskMarks, cutMarked, RichTask } from './RichTask';
import { DiagramView } from './DiagramView';
import { HIGHLIGHT_COLOR } from './LinkEdit';
import type { TaskBox } from './RichTask';
import { bangToEmbed, closeLinkEdits, forgetPastedLink, inlineMarkAtCaret, linkBackspace, linkEditTab, markdownLinkAtCaret, pasteUrl, pickedMarkKey, reviveLinkEdits, unlinkPasted } from './LinkEdit';
import {
  mathMatches,
  isMathShortcut,
  mathAt,
  MathEditor,
  MathText,
  noteHtml,
  noteMathAt,
  nthNoteMath,
  placeCaret,
  OPEN_MATH_EVENT,
  TASK_FORMAT_EVENT,
  renderNoteView,
  spansToDollars,
} from './MathEditor';
import { tr } from '../i18n';

/** The PDF engine is large, so it loads only when a paper card is first shown. */
const PaperViewer = lazy(() => import('./PaperViewer').then((m) => ({ default: m.PaperViewer })));

type Placement = 'canvas' | 'attached' | 'ghost';

export function ElementView({ el, placement, style }: { el: El; placement: Placement; style?: CSSProperties }) {
  const ctx = useBoard();
  const ref = useRef<HTMLDivElement>(null);
  const selected = ctx.selection.has(el.id);
  const editing = ctx.editingId === el.id && placement !== 'ghost';
  const dragging = !!ctx.drag?.ids.has(el.id) && placement !== 'ghost';
  const target = ctx.dropTarget;
  const dropOver =
    placement !== 'ghost' && !!target && (target.kind === 'board' || target.kind === 'column') && target.id === el.id;

  useEffect(() => {
    // Notes place their own caret; tables pick a cell (or an empty title) themselves.
    if (!editing || el.type === 'CARD' || el.type === 'TABLE' || el.type === 'TASK_LIST') return;
    const input = ref.current?.querySelector<HTMLInputElement>('input:not([type=checkbox]):not([type=color])');
    input?.focus();
    input?.select();
    // Focus only when editing starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const cls = [
    'el',
    `el-${el.type.toLowerCase()}`,
    placement === 'canvas' ? 'on-canvas' : placement,
    selected && 'selected',
    editing && 'editing',
    dragging && (ctx.drag?.mode === 'canvas' ? 'dragging' : 'drag-source'),
    dropOver && 'drop-over',
    ctx.connectFrom === el.id && 'connect-source',
    ctx.lineTargetId === el.id && placement !== 'ghost' && 'line-target',
    placement === 'canvas' && el.height && canResizeHeight(el) && 'fixed-h',
    el.color && 'has-color',
    el.type === 'CARD' && el.content.clear && 'is-clear',
    el.locked && placement === 'canvas' && 'locked',
  ]
    .filter(Boolean)
    .join(' ');

  const s: CSSProperties & Record<string, string | number | undefined> = { ...style };
  if (el.color) s['--accent'] = COLORS[el.color];
  if (placement === 'canvas') {
    s.left = el.loc.x;
    s.top = el.loc.y;
    s.width = el.width;
    // A to-do list never scrolls: its height is a minimum and it grows with its tasks.
    if (el.height && canResizeHeight(el)) s.height = el.height;
    if (dragging && ctx.drag) s.transform = `translate(${ctx.drag.dx}px, ${ctx.drag.dy}px)`;
  }

  return (
    <div
      ref={ref}
      className={cls}
      style={s}
      data-el-id={placement === 'ghost' ? undefined : el.id}
      data-board-card={el.type === 'BOARD' && placement !== 'ghost' ? el.id : undefined}
      data-drop-column={el.type === 'COLUMN' && placement !== 'ghost' ? el.id : undefined}
    >
      <Body el={el} editing={editing} placement={placement} />
      {/* Under the block: its comments and reactions (its tags are inside it, at the bottom left). */}
      {placement !== 'ghost' && (
        <div className="block-below">
          <BlockFooter el={el} />
        </div>
      )}
      {placement !== 'ghost' && !editing && (
        <div className="line-handle" title={tr('끌어서 다른 요소와 연결 (클릭하면 연결선 모드)', 'Drag to connect to another element (click for line mode)')} data-line-handle={el.id}>
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
            <path d="M4 12 L9.6 6.4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M12.5 3.5 L11.6 9.1 L6.9 4.4 Z" fill="currentColor" stroke="currentColor" strokeWidth="0.8" strokeLinejoin="round" />
          </svg>
        </div>
      )}
      {placement === 'canvas' && (!editing || el.type === 'CARD' || el.type === 'TASK_LIST') && !el.locked && RESIZABLE.has(el.type) && <ResizeHandle el={el} />}
      {placement === 'canvas' && el.locked && (
        <span className="lock-badge" title={tr('위치 잠김 (오른쪽 클릭 > Unlock position)', 'Position locked (right-click > Unlock position)')}>
          <Icon name="lock" size={12} />
        </span>
      )}
      {placement !== 'ghost' && <LinkBadge el={el} />}
    </div>
  );
}

/**
 * The badge of a linked copy (it follows the block it was copied from; pressing it shows that block)
 * or of a board shortcut (it opens the board it points to).
 */
function LinkBadge({ el }: { el: El }) {
  const { els, goToOriginal, openBoard } = useBoard();
  const shortcut = el.type === 'BOARD' && !!el.boardRef;
  const linked = !!el.linkOf && !!els[el.linkOf];
  if (!shortcut && !linked) return null;
  const tip = shortcut
    ? tr('바로가기: 누르면 원본 보드를 엽니다 (안의 내용은 원본 보드에 있습니다)', 'Shortcut: opens the original board (its contents live there)')
    : tr('링크된 복사본: 원본을 고치면 함께 바뀝니다. 누르면 원본으로 갑니다. (이 복사본을 고치면 링크가 풀립니다)', 'Linked copy: follows its original. Press to go to the original. (Editing this copy unlinks it)');
  return (
    <button
      className={['link-badge', shortcut && 'shortcut', el.locked && 'beside-lock'].filter(Boolean).join(' ')}
      data-link-badge={el.id}
      title={tip}
      aria-label={shortcut ? tr('원본 보드 열기', 'Open the original board') : tr('원본으로 가기', 'Go to the original')}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        if (shortcut) openBoard(el.id);
        else goToOriginal(el.id);
      }}
    >
      <Icon name={shortcut ? 'external' : 'exchange'} size={12} />
    </button>
  );
}

function Body({ el, editing, placement }: { el: El; editing: boolean; placement: Placement }) {
  switch (el.type) {
    case 'CARD':
      return <CardBody el={el} editing={editing} />;
    case 'TASK_LIST':
      return <TaskListBody el={el} editing={editing} />;
    case 'IMAGE':
      return <ImageBody el={el} editing={editing} />;
    case 'LINK':
      return <LinkBody el={el} editing={editing} />;
    case 'FILE':
      return <FileBody el={el} />;
    case 'COLOR_SWATCH':
      return <SwatchBody el={el} editing={editing} />;
    case 'BOARD':
      return <BoardBody el={el} editing={editing} />;
    case 'TABLE':
      return <TableBody el={el} editing={editing} />;
    case 'SKETCH':
      return <SketchBody el={el} editing={editing} />;
    case 'DIAGRAM':
      return <DiagramBody el={el} editing={editing} />;
    case 'COLUMN':
      return <ColumnBody el={el} editing={editing} placement={placement} />;
    default:
      return null;
  }
}

function useEdit(el: El) {
  const { commit } = useBoard();
  return (content: El['content']) => commit((m) => update(m, el.id, { content }), 'edit:' + el.id);
}

function onEnterFinish(e: ReactKeyboardEvent, finish: () => void) {
  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
    e.preventDefault();
    finish();
  }
}

/* ---------- Typing pairs and links to blocks, in notes and to-dos ---------- */

/** In a note: the characters just before and after the caret (in the same text). */
function noteCaret() {
  const sel = getSelection();
  if (!sel?.rangeCount || !sel.isCollapsed) return null;
  const r = sel.getRangeAt(0);
  const n = r.startContainer;
  const t = n.nodeType === Node.TEXT_NODE ? (n as Text).data : '';
  return { sel, prev: t[r.startOffset - 1], prev2: t[r.startOffset - 2], next: t[r.startOffset] };
}
const stepCaret = (sel: Selection, by: number) => {
  for (let i = 0; i < Math.abs(by); i++) sel.modify('move', by < 0 ? 'backward' : 'forward', 'character');
};

/** Brackets that pair up as they are typed, and what closes each. */
const PAIRS: Record<string, string> = { '[': ']', '(': ')', '{': '}' };
const CLOSERS = new Set(Object.values(PAIRS));
/** A pair opens only before nothing, a space or a closing mark (not right before a word). */
const pairsHere = (next?: string) => !next || /[\s)\]}.,;:!?'"]/.test(next);
/** What picked text is put in when ( [ { or $ is typed over it. */
const WRAP_PAIRS: Record<string, string> = { '(': ')', '[': ']', '{': '}', $: '$' };

/**
 * Picked text in a note, then ( [ { or $: the text is put in the pair instead of typed over, and
 * stays picked (with its styles). A picked $formula$ wrapped in $ again becomes the centred $$formula$$.
 */
function wrapPicked(e: ReactKeyboardEvent): boolean {
  const close = WRAP_PAIRS[e.key];
  const sel = getSelection();
  if (!close || !sel?.rangeCount || sel.isCollapsed) return false;
  const r = sel.getRangeAt(0);
  const host = (r.commonAncestorContainer instanceof Element ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement)?.closest('[contenteditable="true"]');
  if (!host || (r.commonAncestorContainer instanceof Element ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement)?.closest('code, pre, .embed-addr')) return false;
  e.preventDefault();
  // Within one line: in one step (one Ctrl+Z), the picked text with its styles put back between the marks.
  const blockOf = (n: Node) => (n instanceof Element ? n : n.parentElement)?.closest('div, p, li, h1, h2, h3, blockquote, pre, .toggle-head');
  if (blockOf(r.startContainer) === blockOf(r.endContainer)) {
    const text = r.toString();
    // The styles the picked text sits in (bold, a colour …) go round it again.
    let inside: Node = r.cloneContents();
    const block = blockOf(r.startContainer);
    for (let n: Node | null = r.commonAncestorContainer; n && n !== block && n !== host; n = n.parentNode) {
      if (!(n instanceof HTMLElement)) continue;
      const wrap = n.cloneNode(false) as HTMLElement;
      wrap.append(inside);
      inside = wrap;
    }
    const box = document.createElement('div');
    box.append(inside);
    const escText = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    document.execCommand('insertHTML', false, escText(e.key) + box.innerHTML + escText(close));
    // Picked again: back over the closing mark, then over the text.
    const s2 = getSelection();
    if (s2?.rangeCount) {
      for (let i = 0; i < close.length; i++) s2.modify('move', 'backward', 'character');
      for (let i = 0; i < Array.from(text).length; i++) s2.modify('extend', 'backward', 'character');
    }
    return true;
  }
  const start = r.cloneRange();
  start.collapse(true);
  const end = r.cloneRange();
  end.collapse(false);
  sel.removeAllRanges();
  sel.addRange(end);
  document.execCommand('insertText', false, close);
  // (A range ending where the closing mark went in stays in front of it.)
  const back = document.createRange();
  back.setStart(sel.getRangeAt(0).startContainer, sel.getRangeAt(0).startOffset);
  sel.removeAllRanges();
  sel.addRange(start);
  document.execCommand('insertText', false, e.key);
  const from = sel.getRangeAt(0);
  const pick = document.createRange();
  pick.setStart(from.startContainer, from.startOffset);
  // The end of the picked text: just before the closing mark.
  try {
    pick.setEnd(back.startContainer, Math.max(0, back.startOffset - close.length));
  } catch {
    pick.collapse(true);
  }
  sel.removeAllRanges();
  sel.addRange(pick);
  return true;
}

/**
 * A key in a note that pairs up: $ makes $|$ (and $$|$$ in an empty pair; \$ stays a dollar),
 * ( [ { make (|) [|] {|}, [[ makes [[|]] and opens the link picker, a closing mark just steps
 * over the one there, and Backspace in an empty pair takes both away. A ")" closing
 * [name](address) makes it an outside link. Returns true when it was taken care of.
 */
function notePairKey(e: ReactKeyboardEvent, onLink: (embed: boolean) => void, editor?: HTMLElement | null): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey || e.nativeEvent.isComposing) return false;
  if (wrapPicked(e)) return true;
  if (e.key === 'Backspace' && !e.shiftKey) {
    const c = noteCaret();
    // (Only a real pair: an opening mark with its own closing mark right after the caret.)
    if (!c || !c.prev || !c.next || !((PAIRS[c.prev] && PAIRS[c.prev] === c.next) || (c.prev === '$' && c.next === '$'))) return false;
    e.preventDefault();
    document.execCommand('delete');
    document.execCommand('forwardDelete');
    return true;
  }
  if (e.key === '~' || e.key === '=') {
    // ~~ and == pair up (~~|~~, ==|==); closing ones step over, and ~~text~~ / ==text== take effect.
    const c = noteCaret();
    if (!c) return false;
    const at = c.sel.anchorNode;
    if ((at instanceof Element ? at : at?.parentElement)?.closest('code, pre, .embed-addr, span.link-edit')) return false;
    if (c.next === e.key) {
      e.preventDefault();
      stepCaret(c.sel, 1);
      if (editor) inlineMarkAtCaret(editor);
      return true;
    }
    if (c.prev === e.key) {
      e.preventDefault();
      document.execCommand('insertText', false, e.key.repeat(3));
      stepCaret(c.sel, -2);
      return true;
    }
    return false;
  }
  if (e.key !== '$' && !PAIRS[e.key] && !CLOSERS.has(e.key)) return false;
  const c = noteCaret();
  if (!c) return false;
  if (e.key === '$') {
    if (c.prev === '\\') return false;
    e.preventDefault();
    if (c.prev === '$' && c.next === '$') {
      document.execCommand('insertText', false, '$$');
      stepCaret(c.sel, -1);
    } else if (c.next === '$') stepCaret(c.sel, 1);
    else {
      document.execCommand('insertText', false, '$$');
      stepCaret(c.sel, -1);
    }
    return true;
  }
  if (e.key === '[' && c.prev === '[') {
    e.preventDefault();
    // [ already made [|]: a second [ makes [[|]]; a [ typed before pairing came in gets its ]] too.
    if (c.next === ']') {
      document.execCommand('insertText', false, '[]');
      stepCaret(c.sel, -1);
    } else {
      document.execCommand('insertText', false, '[]]');
      stepCaret(c.sel, -2);
    }
    // ![[ : an embed (the block's content shown in the note), not a link.
    onLink(c.prev2 === '!');
    return true;
  }
  if (PAIRS[e.key]) {
    if (!pairsHere(c.next)) return false;
    e.preventDefault();
    document.execCommand('insertText', false, e.key + PAIRS[e.key]);
    stepCaret(c.sel, -1);
    return true;
  }
  // A closing mark: steps over the one there (or is typed), and a ")" may finish [name](address).
  e.preventDefault();
  if (c.next === e.key) stepCaret(c.sel, 1);
  else document.execCommand('insertText', false, e.key);
  if (e.key === ')' && editor) markdownLinkAtCaret(editor);
  return true;
}

/**
 * [[ ]] in a note: the picker opens; the block picked replaces the brackets with a link to it.
 * Closed without a pick, the brackets stay with the caret between them.
 */
async function linkInNote(editor: HTMLElement, done: () => void, embed = false) {
  const sel = getSelection();
  const saved = sel?.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
  const picked = await pickBlock();
  editor.focus({ preventScroll: true });
  const s2 = getSelection();
  if (saved && s2) {
    s2.removeAllRanges();
    s2.addRange(saved);
  }
  if (!s2) return;
  const c = noteCaret();
  if (embed && !isPickedBlock(picked)) return; // ![[ ]] with nothing picked stays as typed
  if (c && c.prev === '[' && c.next === ']') {
    for (let i = 0; i < (embed ? 3 : 2); i++) s2.modify('extend', 'backward', 'character');
    document.execCommand('delete');
    for (let i = 0; i < 2; i++) s2.modify('extend', 'forward', 'character');
    document.execCommand('delete');
  }
  if (embed && isPickedBlock(picked)) {
    // A number after the | is the embed's size (![[name|70]]).
    const size = Number(takePickedAlias().trim());
    document.execCommand('insertHTML', false, embedHtml(picked.id, linkLabel(picked), size >= 5 && size <= 400 ? Math.round(size) : undefined) + '<div><br></div>');
    done();
    return;
  }
  insertLinkAtCaret(editor, isPickedBlock(picked) ? blockLinkHtml(picked.id, pickedLabel(picked)) : unresolvedLinkHtml(picked.name));
  done();
}

/**
 * Puts a link at the caret, then the caret right after it (after the space that follows): the
 * browser would leave it before a piece that cannot be edited, and typing would go in front.
 */
function insertLinkAtCaret(editor: HTMLElement, html: string) {
  const mark = 'l' + Math.random().toString(36).slice(2);
  document.execCommand('insertHTML', false, html.replace('<a ', `<a data-tmp="${mark}" `) + '&nbsp;');
  const a = editor.querySelector<HTMLElement>(`[data-tmp="${mark}"]`);
  if (!a) return;
  a.removeAttribute('data-tmp');
  const sel = getSelection();
  if (!sel) return;
  const r = document.createRange();
  const next = a.nextSibling;
  if (next && next.nodeType === Node.TEXT_NODE && (next as Text).data.length) r.setStart(next, 1);
  else r.setStartAfter(a);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

/** Ctrl+K in a note with a block link copied (Ctrl+L): the link goes at the caret (the picked text, if any, is its name). */
function pasteBlockLink(e: ReactKeyboardEvent): boolean {
  if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'k') return false;
  const link = copiedBlockLink();
  if (!link) return false;
  e.preventDefault();
  const picked = getSelection()?.toString().trim();
  insertLinkAtCaret(e.currentTarget as HTMLElement, blockLinkHtml(link.id, picked || link.label));
  return true;
}

/**
 * Draws what each embed (div.embed) in a note shows, after its address: an embedded note's text
 * with a quote bar at its left, a to-do list's items, an image at the size the address asks for
 * (![[name|70]]: 70% of the image), or the block's name. Embeds inside an embedded note are only
 * named, so a note never shows itself over and over.
 */
function showEmbeds(root: HTMLElement, els: ElMap, editing: boolean): number {
  /** The widest embedded image, for the note to be at least that wide. */
  let widest = 0;
  for (const box of Array.from(root.querySelectorAll<HTMLElement>(':scope .embed[data-ref]'))) {
    if (box.parentElement?.closest('.embed-show')) continue;
    const id = box.dataset.ref ?? '';
    const addr = box.querySelector('.embed-addr')?.textContent ?? '';
    const target = els[id];
    const scale = embedScale(addr);
    const key = `${id}:${target?.updatedAt ?? 0}:${scale}:${editing}`;
    let show = box.querySelector<HTMLElement>(':scope > .embed-show');
    if (show && show.dataset.key === key) continue;
    if (!show) {
      show = document.createElement('div');
      show.className = 'embed-show';
      show.contentEditable = 'false';
      box.appendChild(show);
    }
    show.dataset.key = key;
    box.classList.toggle('editing', editing);
    show.innerHTML = '';
    if (!target || isHidden(els, id)) {
      box.classList.add('missing');
      show.textContent = !target
        ? tr('찾을 수 없습니다 · 주소(^…)를 확인하세요', "Can't find it · check its address (^…)")
        : tr('임베드한 블록이 휴지통에 있습니다', 'The embedded block is in the trash');
      continue;
    }
    box.classList.remove('missing');
    box.dataset.kind = target.type === 'IMAGE' || target.type === 'SKETCH' ? 'image' : 'text';
    if (target.type === 'SKETCH') {
      // A drawing shows as a picture of its strokes, sized like an image (|70: 70%).
      const img = document.createElement('img');
      img.alt = elTitle(target) || tr('그리기', 'Drawing');
      img.style.width = `${Math.round((target.width || 280) * (scale / 100))}px`;
      img.draggable = false;
      img.src = sketchDataUrl(target, target.content.bg ? COLORS[target.content.bg] : undefined);
      show.appendChild(img);
      continue;
    }
    if (target.type === 'IMAGE' && target.content.blobKey) {
      const img = document.createElement('img');
      img.alt = target.content.caption ?? '';
      const w = Math.round((target.width || 280) * (scale / 100));
      img.style.width = `${w}px`;
      img.draggable = false;
      show.appendChild(img);
      const cached = cachedBlobUrl(target.content.blobKey);
      if (cached) img.src = cached;
      else blobUrl(target.content.blobKey).then((u) => u && (img.src = u));
    } else if (target.type === 'CARD') {
      const text = document.createElement('div');
      text.className = 'embed-text rich';
      if (target.content.showTitle && target.content.title) {
        const h = document.createElement('div');
        h.className = 'embed-title';
        h.textContent = target.content.title;
        text.appendChild(h);
      }
      const body = document.createElement('div');
      body.innerHTML = sanitize(target.content.html ?? '');
      // An embed inside it: just its name.
      for (const inner of Array.from(body.querySelectorAll('.embed'))) {
        const span = document.createElement('span');
        span.className = 'embed-name';
        span.textContent = inner.textContent ?? '';
        inner.replaceWith(span);
      }
      text.appendChild(body);
      renderNoteView(body);
      show.appendChild(text);
    } else if (target.type === 'TASK_LIST') {
      const text = document.createElement('div');
      text.className = 'embed-text';
      if (target.content.title) {
        const h = document.createElement('div');
        h.className = 'embed-title';
        h.textContent = target.content.title;
        text.appendChild(h);
      }
      for (const t of target.content.tasks ?? []) {
        const row = document.createElement('div');
        row.className = t.done ? 'embed-task done' : 'embed-task';
        row.textContent = `${t.done ? '☑' : '☐'} ${plainTaskText(t.text).replace(/\[\[([^[\]|]*)(?:\|[\w-]+)?\]\]/g, '$1')}`;
        text.appendChild(row);
      }
      show.appendChild(text);
    } else {
      const text = document.createElement('div');
      text.className = 'embed-text';
      text.textContent = elTitle(target) || tr('블록', 'Block');
      show.appendChild(text);
    }
  }
  for (const img of Array.from(root.querySelectorAll<HTMLImageElement>('.embed[data-kind=image] > .embed-show img'))) widest = Math.max(widest, parseFloat(img.style.width) || 0);
  return widest;
}

/*
 * A block growing with what is typed in it grows only as far as the bottom of the screen; past
 * that its text scrolls inside it, so the whole block never spreads off screen.
 */
const SCREEN_MARGIN = 12;
/** The other blocks on the board (not the one given, nor what is inside it). */
function otherBlocks(block: Element): DOMRect[] {
  const layer = block.closest('.layer');
  if (!layer) return [];
  return Array.from(layer.querySelectorAll(':scope > [data-el-id], :scope > .el-stack > [data-el-id]'))
    .filter((n) => n !== block && !n.contains(block) && !block.contains(n))
    .map((n) => n.getBoundingClientRect());
}
/**
 * How far down (screen px) a block may reach: the bottom of the screen, or just above the next
 * block below it — a growing block does not spread over another.
 */
function bottomLimit(block: Element): number {
  const canvas = block.closest('.canvas');
  let limit = canvas ? canvas.getBoundingClientRect().bottom - SCREEN_MARGIN : Infinity;
  const b = block.getBoundingClientRect();
  // (A block starting lower down counts even once this one has grown over its top edge.)
  for (const r of otherBlocks(block)) if (r.left < b.right - 1 && r.right > b.left + 1 && r.top > b.top + 4) limit = Math.min(limit, r.top - SCREEN_MARGIN);
  return limit;
}
/**
 * A block being typed in has reached the bottom of the screen (not another block): the board
 * slides up so it can go on growing in comfort, as long as its top stays in sight.
 */
let slidAt = 0;
function slideForRoom(block: Element) {
  const canvas = block.closest('.canvas');
  if (!canvas || Date.now() - slidAt < 900) return;
  // (Checks that keep the view still, as for the gliding to new blocks, turn it off.)
  if ((window as unknown as { __molanoteOldPlacement?: boolean }).__molanoteOldPlacement) return;
  const c = canvas.getBoundingClientRect();
  const b = block.getBoundingClientRect();
  const screenBottom = c.bottom - SCREEN_MARGIN;
  // Only when the screen's bottom (not a block below) is what stops it, and it is near there.
  // (A block still partly off screen is being brought into view another way.)
  if (bottomLimit(block) < screenBottom - 1 || screenBottom - b.bottom > 40 || b.bottom > screenBottom + 2 || b.right > c.right || b.left < c.left) return;
  // Up by a third of the screen, but its top not past the top of the board's area.
  const by = Math.min(Math.round(c.height / 3), Math.round(b.top - c.top - 60));
  if (by < 40) return;
  slidAt = Date.now();
  dispatchEvent(new CustomEvent(SLIDE_UP_EVENT, { detail: by }));
}
/** How many screen pixels one of an element's own pixels takes (the board's zoom). */
export function scaleOf(n: HTMLElement): number {
  return n.offsetHeight ? n.getBoundingClientRect().height / n.offsetHeight || 1 : 1;
}
/** The formulas a note holds (as written in it), to tell new or changed ones. */
export const formulasOf = (html: string) => (html.match(/\$\$[\s\S]+?\$\$|\$[^$\n]+\$|data-tex="[^"]*"/g) ?? []).join('\u0000');
/** The width the text of a note has inside its padding. */
function textWidth(view: HTMLElement): number {
  const cs = getComputedStyle(view);
  return view.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
}
/** The width of the widest formula drawn in a note's text (board units). */
function widestFormula(view: HTMLElement): number {
  let widest = 0;
  for (const k of Array.from(view.querySelectorAll<HTMLElement>('.katex-display > .katex, span.math > .katex, .math .katex'))) widest = Math.max(widest, k.scrollWidth);
  return widest;
}
/** How much more a block can grow downward: to the bottom of the screen, not over a block below (board units). */
function roomBelow(block: Element | null, zoom: number): number {
  if (!block || !block.closest('.canvas')) return Infinity;
  return Math.max(0, (bottomLimit(block) - block.getBoundingClientRect().bottom) / zoom);
}
/** A block without a set height, being typed in: its scrolling part stops at the bottom of the screen. */
function holdAtScreen(scroller: HTMLElement, zoom: number) {
  const canvas = scroller.closest('.canvas');
  if (!canvas) return;
  // What the block has below its scrolling part (the "+ Add item" row, its tags…) stays in sight too.
  const block = scroller.closest('[data-el-id]');
  const below = block ? Math.max(0, block.getBoundingClientRect().bottom - scroller.getBoundingClientRect().bottom) : 0;
  const most = ((block ? bottomLimit(block) : canvas.getBoundingClientRect().bottom - SCREEN_MARGIN) - below - scroller.getBoundingClientRect().top) / zoom;
  if (scroller.scrollHeight > most + 1) {
    scroller.style.maxHeight = `${Math.max(48, Math.floor(most))}px`;
    scroller.classList.add('held');
    if (block) slideForRoom(block);
  } else if (scroller.classList.contains('held') && !scroller.dataset.entryHold) {
    scroller.style.maxHeight = '';
    scroller.classList.remove('held');
  }
}

/** Whether the caret is on the first (or last) wrapped line, where up (or down) leaves the box. */
function caretOnEdge(n: HTMLElement & { selectionStart: number; selectionEnd: number; value: string }, edge: 'first' | 'last') {
  if (n.selectionStart !== n.selectionEnd) return false;
  const line = parseFloat(getComputedStyle(n).lineHeight) || 20;
  if (n.scrollHeight <= line * 1.5) return true;
  return edge === 'first' ? n.selectionStart === 0 : n.selectionEnd === n.value.length;
}

/* ---------- Note card ---------- */

const TEXT_BLOCKS = new Set(['DIV', 'P', 'LI', 'H1', 'H2', 'H3', 'BLOCKQUOTE', 'PRE']);
/** Plain text of note HTML, one line per paragraph, with `backticks` around inline code. */
function noteText(n: Node): string {
  if (n.nodeType === Node.TEXT_NODE) return (n as Text).data;
  const el = n as Element;
  if (el.tagName === 'BR') return '\n';
  if (el.tagName === 'HR') return '---\n';
  let out = Array.from(el.childNodes).map(noteText).join('');
  if (el.tagName === 'PRE') out = '```\n' + out.replace(/\n$/, '') + '\n```';
  if (el.tagName === 'LI' && el.parentElement?.classList.contains('checklist')) out = (el.getAttribute('data-checked') === 'true' ? '[x] ' : '[ ] ') + out;
  if (el.tagName === 'CODE' && el.parentElement?.tagName !== 'PRE') out = '`' + out + '`';
  if (TEXT_BLOCKS.has(el.tagName) && !out.endsWith('\n')) out += '\n';
  return out;
}

/**
 * Copies the selected part of a note as HTML (so inline code, bold, links and lists stay what they
 * are when pasted into Slack, Docs or mail) and as plain text with `code` marks. Formulas copy as $…$ (or $$…$$).
 */
function copyNoteSelection(e: ReactClipboardEvent, root: HTMLElement): boolean {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return false;
  const box = document.createElement('div');
  box.append(range.cloneContents());
  // A piece picked from inside one code span is still code.
  const common = range.commonAncestorContainer;
  const inCode = (common instanceof Element ? common : common.parentElement)?.closest('code');
  if (inCode && root.contains(inCode)) {
    const code = document.createElement('code');
    code.append(...Array.from(box.childNodes));
    box.append(code);
  }
  for (const m of Array.from(box.querySelectorAll<HTMLElement>('span.math'))) {
    const mark = m.dataset.display === 'true' ? '$$' : '$';
    m.replaceWith(mark + (m.dataset.tex ?? '') + mark);
  }
  const html = sanitize(box.innerHTML);
  const clean = document.createElement('div');
  clean.innerHTML = html;
  e.preventDefault();
  e.clipboardData.setData('text/html', html);
  e.clipboardData.setData('text/plain', noteText(clean).replace(/\n+$/, ''));
  return true;
}


function CardBody({ el, editing }: { el: El; editing: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const edit = useEdit(el);
  /**
   * Formula being written. While a note is edited its formulas are plain $…$ / $$…$$ text (as in a
   * to-do): an existing one is the page range it covers (it may run over several lines); a new one
   * goes where the caret was.
   */
  const [mathEdit, setMathEdit] = useState<{ tex: string; display?: boolean; target?: Range; range?: Range } | null>(null);
  /** Which formula a double-click on the shown note landed on, so editing opens it straight away. */
  const mathHint = useRef<number | null>(null);

  const { els, commit, zoom } = useBoard();
  // Editing ends: a note held at the bottom of the screen shows all of itself again.
  useEffect(() => {
    if (editing) return;
    for (const sc of Array.from(document.querySelectorAll<HTMLElement>(`[data-el-id="${el.id}"] .note-scroll.held`))) {
      sc.style.maxHeight = '';
      sc.classList.remove('held');
    }
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps
  /** A note narrower than an image embedded in it widens to show the whole image. */
  // Only for an embed just put in or made bigger: a note made narrower by hand stays so, its images shrink with it.
  const embedSig = useRef<string | null>(null);
  const fitEmbeds = (widest: number, from?: HTMLElement | null) => {
    const sig = from ? Array.from(from.querySelectorAll<HTMLElement>('.embed[data-ref] > .embed-addr')).map((a) => `${a.parentElement!.dataset.ref}:${embedScale(a.textContent ?? '')}`).join(',') : '';
    const first = embedSig.current === null;
    const changed = sig !== embedSig.current;
    embedSig.current = sig;
    if (first || !changed) return;
    const need = Math.ceil(widest + 26);
    if (widest > 0 && need > el.width) commit((m) => update(m, el.id, { width: need }), 'embed-fit:' + el.id);
  };
  /**
   * A formula cannot wrap: one wider than the note makes the note wider (and a note with a set
   * height taller), as far as the blocks around it allow; what is still too wide scrolls sideways.
   */
  const fitMath = (view: HTMLElement) => {
    // Once for the formulas a note holds (written, pasted, or brought in from Unsorted or
    // elsewhere): fitted on the board, the note keeps what it was fitted for (content.mathFit), so a
    // note made narrower by hand afterwards stays so. (Unsorted is too narrow to fit anything in.)
    const sig = formulasOf(el.content.html ?? '');
    if (el.content.mathFit === sig || !view.closest('.layer') || !view.querySelector('.katex')) return;
    // A formula does not wrap: the note grows as wide as the widest one (no scrolling sideways).
    // Measured again once the formula fonts have come in (until then formulas look narrower),
    // and a moment later; each time only ever wider.
    const fit = () => {
      if (!view.isConnected || !view.querySelector('.katex')) return;
      const block = view.closest('[data-el-id]');
      if (!block) return;
      const over = Math.ceil(widestFormula(view) - textWidth(view) + 2);
      const scroller = view.closest<HTMLElement>('.note-scroll');
      const down = scroller ? scroller.scrollHeight - scroller.clientHeight : 0;
      const room = roomBelow(block, zoom);
      if (over <= 1 && down <= 1) return;
      commit((m) => {
        const cur = m[el.id];
        if (!cur) return;
        update(m, el.id, {
          ...(over > 1 ? { width: cur.width + over } : {}),
          ...(cur.height && down > 1 ? { height: cur.height + Math.ceil(Math.min(down, room)) } : {}),
          content: { mathFit: sig },
        });
      }, 'math-fit:' + el.id);
    };
    fit();
    requestAnimationFrame(() => requestAnimationFrame(fit));
    document.fonts?.ready.then(() => requestAnimationFrame(fit)).catch(() => {});
    setTimeout(fit, 600);
  };
  /**
   * An embed whose brackets were cut away goes with it. Otherwise the embed shows the block its
   * address (^…) points at; an address no block has, or none, shows that it cannot be found.
   */
  const dropBrokenEmbeds = (node: HTMLElement) => {
    for (const b of Array.from(node.querySelectorAll<HTMLElement>('.embed[data-ref]'))) {
      if (b.parentElement?.closest('.embed-show')) continue;
      const a = b.querySelector(':scope > .embed-addr');
      const m = /^!\[\[([^\]]*)\]\]$/.exec((a?.textContent ?? '').trim());
      if (!a || !m) {
        b.remove();
        continue;
      }
      const { address } = splitAddress(m[1]);
      const to = address ? blockByAddress(address) : undefined;
      const ref = to ?? (address || 'missing');
      if (b.dataset.ref !== ref) b.dataset.ref = ref;
    }
  };
  /** Embeds written before blocks had addresses get theirs (![[name]] → ![[name|^address]]). */
  const addressEmbeds = (node: HTMLElement) => {
    for (const a of Array.from(node.querySelectorAll<HTMLElement>('.embed[data-ref] > .embed-addr'))) {
      if (a.parentElement?.parentElement?.closest('.embed-show')) continue;
      const ref = a.parentElement!.dataset.ref ?? '';
      const m = /^!\[\[([^\]]*)\]\]$/.exec((a.textContent ?? '').trim());
      if (!m || !els[ref] || splitAddress(m[1]).address !== undefined) continue;
      const { alias, size } = splitAddress(m[1]);
      a.textContent = `![[${alias}|${blockAddress(ref)}${size ? `|${size}` : ''}]]`;
    }
  };
  /** When an embedded block changes, the note shows it anew. */
  const embedKey = (el.content.html ?? '').includes('class="embed"')
    ? Array.from((el.content.html ?? '').matchAll(/class="embed" data-ref="([\w-]+)"/g), (m) => `${m[1]}:${els[m[1]]?.updatedAt ?? 0}:${isHidden(els, m[1])}`).join(',')
    : '';

  // Once per shown HTML: drawing turns \$ into $, which a second pass would read as a formula.
  useLayoutEffect(() => {
    if (!editing && viewRef.current) {
      renderNoteView(viewRef.current);
      fitEmbeds(showEmbeds(viewRef.current, els, false), viewRef.current);
      hyphenateIn(viewRef.current);
      fitMath(viewRef.current);
    }
  }, [editing, el.content.html, embedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // A link opened up for changing becomes a link again once the caret leaves it.
  useEffect(() => {
    if (!editing) return;
    const onSel = () => {
      const node = ref.current;
      if (node?.querySelector('span.link-edit')) closeLinkEdits(node);
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, [editing]);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!editing || !node) return;
    node.innerHTML = sanitize(el.content.html ?? '');
    spansToDollars(node);
    addressEmbeds(node);
    // Embeds while editing: the address on top (it can be changed, e.g. |70), what it shows below.
    fitEmbeds(showEmbeds(node, els, true), node);
    const hinted = mathHint.current === null ? null : nthNoteMath(node, mathHint.current);
    mathHint.current = null;
    if (hinted) {
      node.focus();
      placeCaret(hinted.node, hinted.offset);
      openMath();
      return;
    }
    // A freshly shown, empty title gets the cursor; otherwise continue the text.
    if (el.content.showTitle && !el.content.title && titleRef.current) {
      titleRef.current.focus();
      return;
    }
    node.focus();
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    // Load the stored HTML only when editing starts; the DOM owns it while typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const sync = () => {
    if (!ref.current) return;
    edit({ html: noteHtml(ref.current) });
    // A note with a set height that no longer holds its text (a pasted address, a new line) grows,
    // as far as the bottom of the screen; one without stops there too. Past that its text scrolls.
    const scroller = ref.current.closest<HTMLElement>('.note-scroll');
    if (scroller && el.height) {
      const over = scroller.scrollHeight - scroller.clientHeight;
      const blockEl = scroller.closest('[data-el-id]');
      const grow = Math.min(over, roomBelow(blockEl, zoom));
      if (grow > 1) commit((m) => update(m, el.id, { height: Math.ceil((m[el.id].height ?? el.height ?? 0) + grow) }), 'note-fit:' + el.id);
      if (over > grow + 1 && blockEl) slideForRoom(blockEl);
    } else if (scroller) holdAtScreen(scroller, zoom);
  };

  /** Opens the editor on the formula at the caret, or for a new one there. */
  const openMath = () => {
    const sel = window.getSelection();
    const inNote = !!sel?.rangeCount && !!ref.current?.contains(sel.getRangeAt(0).startContainer);
    const range = inNote ? sel!.getRangeAt(0).cloneRange() : undefined;
    const hit = inNote && ref.current ? noteMathAt(ref.current, sel!.anchorNode, sel!.anchorOffset) : null;
    setMathEdit(hit ? { tex: hit.tex, display: hit.display, target: hit.range, range } : { tex: range?.toString() ?? '', range });
  };
  /** Back to the note with the caret where it was (or at a given spot). */
  const closeMath = (at?: { node: Node; offset: number }) => {
    const node = ref.current;
    const range = mathEdit?.range;
    setMathEdit(null);
    if (!node) return;
    node.focus();
    if (at?.node.isConnected) placeCaret(at.node, at.offset);
    else if (range) {
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
    }
  };
  useEffect(() => {
    if (!editing) return;
    const open = (e: Event) => {
      if ((e as CustomEvent<string>).detail === el.id) openMath();
    };
    window.addEventListener(OPEN_MATH_EVENT, open);
    return () => window.removeEventListener(OPEN_MATH_EVENT, open);
  });

  const insertMath = (tex: string) => {
    const node = ref.current;
    if (!node || !mathEdit) return;
    // A $$…$$ formula stays one; a new one or a $…$ one sits in the line.
    const mark = mathEdit.display ? '$$' : '$';
    const piece = mark + tex + mark;
    let r = mathEdit.target?.startContainer.isConnected ? mathEdit.target : mathEdit.range;
    if (!r) {
      r = document.createRange();
      r.selectNodeContents(node);
      r.collapse(false);
    }
    r.deleteContents();
    const text = document.createTextNode(piece);
    r.insertNode(text);
    sync();
    closeMath({ node: text, offset: piece.length });
  };
  const deleteMath = () => {
    const t = mathEdit?.target;
    if (!t?.startContainer.isConnected) {
      // A new formula that was never put in: nothing to take out.
      closeMath();
      return;
    }
    t.deleteContents();
    sync();
    closeMath({ node: t.startContainer, offset: t.startOffset });
  };

  if (editing) {
    return (
      <>
        <div className="card">
          {el.content.showTitle && (
            <input
              ref={titleRef}
              className="card-title-input"
              value={el.content.title ?? ''}
              placeholder={tr('제목', 'Title')}
              onChange={(e) => edit({ title: e.target.value })}
              onKeyDown={(e) => onEnterFinish(e, () => ref.current?.focus())}
            />
          )}
          <ColumnScroll bodyClass="note-scroll">
          <div
            ref={ref}
            className="card-text rich"
            contentEditable
            suppressContentEditableWarning
            onInput={() => {
              // An embed's address changed (its size, |70): it shows that at once.
              if (ref.current) reviveLinkEdits(ref.current);
              if (ref.current?.querySelector('.embed')) {
                dropBrokenEmbeds(ref.current);
                fitEmbeds(showEmbeds(ref.current, els, true), ref.current);
              }
              sync();
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Backspace') forgetPastedLink();
              if (pickedMarkKey(e.nativeEvent)) {
                // Picked text with ~~ / -- (struck through) or == (highlighted), not typed over.
                sync();
              } else if (ref.current && unlinkPasted(e.nativeEvent, ref.current)) {
                // Backspace right after a pasted web address: only the link comes off.
                e.preventDefault();
                sync();
              } else if (notePairKey(e, (embed) => ref.current && linkInNote(ref.current, () => (fitEmbeds(showEmbeds(ref.current!, els, true), ref.current), sync()), embed), ref.current)) {
                sync();
              } else if (ref.current && linkBackspace(e.nativeEvent, ref.current)) {
                // Backspace after a link: it opens as [name](address) / [[name]] first.
                e.preventDefault();
                sync();
              } else if (ref.current && linkEditTab(e.nativeEvent, ref.current)) {
                // Tab / Shift+Tab: done with a link opened up (or an embed's address); out to its right / left.
                e.preventDefault();
                sync();
              } else if (ref.current && bangToEmbed(e.nativeEvent, ref.current)) {
                // ! just before a link: an embed of its block.
                e.preventDefault();
                fitEmbeds(showEmbeds(ref.current, els, true), ref.current);
                sync();
              } else if (pasteBlockLink(e)) {
                sync();
              } else if (isMathShortcut(e)) {
                e.preventDefault();
                openMath();
              } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
                // First half of Ctrl+N+M (when the browser passes Ctrl+N on at all).
                e.preventDefault();
              } else if (ref.current && markdownKey(e.nativeEvent, ref.current)) {
                // A typing shortcut (# heading, - list, [] to-do, > toggle, ``` code…).
                e.preventDefault();
                sync();
              } else if (ref.current && noteShortcut(e, ref.current)) sync();
            }}
            onMouseDown={(e) => {
              forgetPastedLink();
              // A to-do checkbox or a toggle's ▶: ticked / opened without moving the caret.
              const hit = ref.current && noteHit(ref.current, e.target, e.clientX);
              if (!hit || !ref.current) return;
              e.preventDefault();
              applyHit(ref.current, hit);
              sync();
            }}
            onDoubleClick={() => {
              // Double-clicking inside $ … $ opens that formula in the editor.
              const sel = window.getSelection();
              if (sel && ref.current && noteMathAt(ref.current, sel.anchorNode, sel.anchorOffset)) openMath();
            }}
            onCopy={(e) => {
              if (ref.current) copyNoteSelection(e, ref.current);
            }}
            onCut={(e) => {
              if (ref.current && copyNoteSelection(e, ref.current)) {
                document.execCommand('delete');
                sync();
              }
            }}
            onPaste={(e) => {
              e.preventDefault();
              const text = e.clipboardData.getData('text/plain');
              // A web address becomes a link (on the text picked, if any).
              if (!(ref.current && pasteUrl(ref.current, text))) document.execCommand('insertHTML', false, textToHtml(text));
              sync();
            }}
          />
          </ColumnScroll>
          <LabelRow el={el} />
        </div>
        {mathEdit && <MathEditor initial={mathEdit.tex} onInsert={insertMath} onDelete={deleteMath} onClose={() => closeMath()} />}
      </>
    );
  }
  const html = el.content.html ?? '';
  return (
    <div className="card">
      {el.content.showTitle && (
        <div className={el.content.title ? 'card-title' : 'card-title placeholder'}>{el.content.title || tr('제목', 'Title')}</div>
      )}
      <ColumnScroll bodyClass="note-scroll">
      {html.replace(/<[^>]*>|&nbsp;|\s/g, '') ? (
        <div
          ref={viewRef}
          className="card-text rich"
          onPointerDown={(e) => {
            // Checkboxes and ▶ work on the board too, without opening the note for editing.
            const hit = viewRef.current && noteHit(viewRef.current, e.target, e.clientX);
            if (!hit) return;
            e.stopPropagation();
            edit({ html: applyHitToHtml(el.content.html ?? '', hit) });
          }}
          onDoubleClickCapture={(e) => {
            const math = (e.target as HTMLElement).closest('span.math');
            mathHint.current = math ? Array.from(viewRef.current?.querySelectorAll('span.math') ?? []).indexOf(math) : null;
          }}
          dangerouslySetInnerHTML={{ __html: sanitize(html) }}
        />
      ) : (
        <div className="card-text placeholder">{tr('더블클릭해서 입력', 'Double-click to type')}</div>
      )}
      </ColumnScroll>
      <LabelRow el={el} />
    </div>
  );
}

/* ---------- To-do list ---------- */

function TaskListBody({ el, editing }: { el: El; editing: boolean }) {
  const { commit } = useBoard();
  const edit = useEdit(el);
  const tasks = el.content.tasks ?? [];
  const showTitle = el.content.showTitle !== false;
  const { zoom } = useBoard();
  const listRef = useRef<HTMLUListElement>(null);
  // Long English words in the shown to-dos break with a hyphen.
  useLayoutEffect(() => {
    for (const t of Array.from(listRef.current?.querySelectorAll<HTMLElement>('span.task-text') ?? [])) hyphenateIn(t);
  });
  // A list with a set height that no longer holds its to-dos (a new one, a line break) grows to fit them.
  // Only when what it holds changes: a list made shorter by hand keeps that height and scrolls.
  const fitText = useRef<string | null>(null);
  /** The empty to-do added on entering with Enter: the list does not grow for it (it scrolls). */
  const noFit = useRef(false);
  useLayoutEffect(() => {
    const text = tasks.map((t) => t.text).join('\n') + '|' + tasks.length;
    const changed = fitText.current !== null && fitText.current !== text;
    fitText.current = text;
    if (changed && noFit.current) {
      noFit.current = false;
      return;
    }
    if (!changed) return;
    const scroller = listRef.current?.closest<HTMLElement>('.tasks-scroll');
    if (!scroller) return;
    if (!el.height) {
      // Typed in after entering: the list may grow again, but only to the bottom of the screen.
      if (editing) {
        delete scroller.dataset.entryHold;
        holdAtScreen(scroller, zoom);
      }
      return;
    }
    const over = scroller.scrollHeight - scroller.clientHeight;
    const blockEl = cardRef.current?.closest('[data-el-id]') ?? null;
    const grow = Math.min(over, roomBelow(blockEl, zoom));
    if (grow > 1) commit((m) => update(m, el.id, { height: Math.ceil((m[el.id].height ?? el.height ?? 0) + grow) }), 'todo-fit:' + el.id);
    if (over > grow + 1 && blockEl && editing) slideForRoom(blockEl);
  });
  /*
   * Opening the list for editing keeps the block as big as it was (the new empty to-do of Enter,
   * the "+ Add item" row): the to-dos scroll inside it instead, until editing ends.
   */
  const viewH = useRef(0);
  useLayoutEffect(() => {
    if (!editing && cardRef.current) viewH.current = cardRef.current.offsetHeight;
  });
  useLayoutEffect(() => {
    const scroller = listRef.current?.closest<HTMLElement>('.tasks-scroll');
    if (!scroller) return;
    const release = () => {
      scroller.style.maxHeight = '';
      scroller.classList.remove('held');
      delete scroller.dataset.entryHold;
    };
    if (!editing || el.height) {
      release();
      return;
    }
    const over = (cardRef.current?.offsetHeight ?? 0) - viewH.current;
    if (viewH.current && over > 0) {
      scroller.style.maxHeight = `${Math.max(24, scroller.clientHeight - over)}px`;
      scroller.classList.add('held');
      scroller.dataset.entryHold = 'true';
    } else holdAtScreen(scroller, zoom);
    return release;
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Task being dragged by its grip: how far it moved and where it would land. */
  const [taskDrag, setTaskDrag] = useState<{ id: string; dy: number; index: number } | null>(null);

  const removeTask = (id: string) =>
    commit((m) => {
      const left = (m[el.id].content.tasks ?? []).filter((t) => t.id !== id);
      update(m, el.id, { content: { tasks: left.length ? left : [{ id: uid(), text: '', done: false }] } });
    });

  /** Drag a task by its grip (≡) to a new place in the list. */
  const startTaskDrag = (e: ReactPointerEvent, id: string) => {
    e.stopPropagation();
    e.preventDefault();
    const startY = e.clientY;
    const from = tasks.findIndex((t) => t.id === id);
    let state = { id, dy: 0, index: from };
    const targetIndex = (clientY: number) => {
      const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>(':scope > li[data-task-id]') ?? []).filter(
        (r) => r.dataset.taskId !== id,
      );
      const i = rows.findIndex((r) => {
        const b = r.getBoundingClientRect();
        return clientY < b.top + b.height / 2;
      });
      return i < 0 ? rows.length : i;
    };
    const move = (ev: PointerEvent) => {
      state = { id, dy: (ev.clientY - startY) / zoom, index: targetIndex(ev.clientY) };
      setTaskDrag(state);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setTaskDrag(null);
      if (state.index === from) return;
      commit((m) => {
        const list = [...(m[el.id].content.tasks ?? [])];
        const [moved] = list.splice(list.findIndex((t) => t.id === id), 1);
        if (!moved) return;
        list.splice(state.index, 0, moved);
        update(m, el.id, { content: { tasks: list } });
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const inputs = useRef<(TaskBox | null)[]>([]);
  const [focusIdx, setFocusIdx] = useState<number | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  /** What a double-click landed on, so editing starts there (a task, or the title). */
  const dblHint = useRef<{ task?: string; title?: boolean; math?: number } | null>(null);

  /*
   * Editing starts in the double-clicked task or title. Enter goes to a new to-do at the end (or the
   * last one, when it is still empty). Otherwise it starts in the title (or the first task).
   */
  useEffect(() => {
    if (!editing) return;
    const hint = dblHint.current;
    dblHint.current = null;
    const byEnter = editStart.id === el.id && editStart.by === 'enter';
    if (editStart.id === el.id) editStart.id = editStart.by = null;
    const root = cardRef.current;
    if (!root) return;
    if (byEnter && !hint) {
      const last = tasks[tasks.length - 1];
      if (last && !last.text.trim()) setFocusIdx(tasks.length - 1);
      else {
        noFit.current = true;
        setTasks([...tasks, { id: uid(), text: '', done: false }]);
        setFocusIdx(tasks.length);
      }
      return;
    }
    const taskBox = hint?.task ? root.querySelector<TaskBox>(`li[data-task-id="${hint.task}"] [data-task-box]`) : null;
    if (taskBox) {
      taskBox.focus();
      const hit = hint?.math === undefined ? undefined : mathMatches(taskBox.value)[hint.math];
      // A double-clicked formula opens in the formula editor right away.
      const n = hit ? hit.start + 1 : taskBox.value.length;
      taskBox.setSelectionRange(n, n);
      if (hit) openTaskMath(tasks.findIndex((x) => x.id === hint?.task), taskBox);
      return;
    }
    const title = root.querySelector<HTMLInputElement>('input.tl-title');
    if (title) {
      title.focus();
      if (hint?.title) title.setSelectionRange(title.value.length, title.value.length);
      else title.select();
      return;
    }
    root.querySelector<TaskBox>('[data-task-box]')?.focus();
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Where the caret goes in the task that gets the focus next (unset: wherever the browser puts it). */
  const caretAt = useRef<number | null>(null);
  useEffect(() => {
    if (focusIdx === null) return;
    const box = inputs.current[focusIdx];
    box?.focus({ preventScroll: true });
    if (box && caretAt.current !== null) box.setSelectionRange(caretAt.current, caretAt.current);
    caretAt.current = null;
    setFocusIdx(null);
    // Scrolled into view inside the list (not the board moved), once the list is laid out.
    const show = () => {
      const scroller = box?.closest<HTMLElement>('.tasks-scroll');
      if (!box || !scroller) return;
      const sr = scroller.getBoundingClientRect();
      const br = box.getBoundingClientRect();
      // (Screen pixels to the list's own: the board may be zoomed.)
      const k = scaleOf(scroller);
      if (br.bottom > sr.bottom) scroller.scrollTop += (br.bottom - sr.bottom) / k + 6;
      else if (br.top < sr.top) scroller.scrollTop -= (sr.top - br.top) / k + 6;
    };
    show();
    requestAnimationFrame(() => requestAnimationFrame(show));
  }, [focusIdx]);

  /** The tasks as they are now (the link picker answers after the list may have changed). */
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  /*
   * Ctrl+Z / Ctrl+Shift+Z while a to-do is typed in: back and forth through what changed in the
   * list (letters typed in a row count as one step; a colour, a highlight, bold… each a step).
   */
  type Snap = { tasks: typeof tasks; focus: number; caret: number };
  const hist = useRef<{ past: Snap[]; future: Snap[]; last: number; typing: boolean }>({ past: [], future: [], last: 0, typing: false });
  const snapNow = (): Snap => {
    const i = currentTask();
    const b = inputs.current[i];
    return { tasks: tasksRef.current, focus: i, caret: b && document.activeElement === b ? b.selectionStart : (tasksRef.current[i]?.text.length ?? 0) };
  };
  const setTasks = (next: typeof tasks, typing = false) => {
    const h = hist.current;
    const now = Date.now();
    if (!(typing && h.typing && now - h.last < 1200)) {
      h.past.push(snapNow());
      if (h.past.length > 300) h.past.shift();
    }
    h.last = now;
    h.typing = typing;
    h.future = [];
    edit({ tasks: next });
  };
  const stepHistory = (back: boolean) => {
    const h = hist.current;
    const s = (back ? h.past : h.future).pop();
    if (!s) return;
    (back ? h.future : h.past).push(snapNow());
    h.typing = false;
    edit({ tasks: s.tasks });
    caretAt.current = s.caret;
    setFocusIdx(Math.min(s.focus, s.tasks.length - 1));
  };

  /** Formula being written in a to-do, kept in its text as $ … $: where it goes (or which one it replaces). */
  const [mathEdit, setMathEdit] = useState<{ index: number; start: number; end: number; tex: string; existing: boolean; display?: boolean } | null>(null);
  const finishMath = (text: string | null, caret: number) => {
    if (!mathEdit) return;
    const { index } = mathEdit;
    if (text !== null) setTasks(tasks.map((x, j) => (j === index ? { ...x, text } : x)));
    setMathEdit(null);
    caretAt.current = caret;
    setFocusIdx(index);
  };
  /** Opens the editor on the formula at the caret of task i, or for a new one there. */
  const openTaskMath = (i: number, box: TaskBox) => {
    const text = tasks[i]?.text ?? '';
    const hit = mathAt(text, box.selectionStart);
    setMathEdit(
      hit
        ? { index: i, start: hit.start, end: hit.end, tex: hit.tex, existing: true, display: hit.display }
        : { index: i, start: box.selectionStart, end: box.selectionEnd, tex: text.slice(box.selectionStart, box.selectionEnd), existing: false },
    );
  };
  /** The to-do typed in last and what was picked in it (kept while the left bar is used). */
  const lastPick = useRef<{ i: number; a: number; b: number } | null>(null);
  useEffect(() => {
    if (!editing) return;
    const note = () => {
      const i = inputs.current.slice(0, tasksRef.current.length).findIndex((b) => b && b === document.activeElement);
      const box = inputs.current[i];
      if (i >= 0 && box) lastPick.current = { i, a: box.selectionStart, b: box.selectionEnd };
    };
    document.addEventListener('selectionchange', note);
    return () => document.removeEventListener('selectionchange', note);
  }, [editing]);
  /** The to-do being typed in (or the one typed in last, or the last one), for the left bar's formatting. */
  const currentTask = () => {
    const boxes = inputs.current.slice(0, tasks.length);
    const i = boxes.findIndex((b) => b && b === document.activeElement);
    if (i >= 0) return i;
    const last = lastPick.current;
    return last && last.i < tasks.length ? last.i : tasks.length - 1;
  };
  /** What is picked in to-do i: from its box when typed in, else as it was when the left bar was used. */
  const pickedIn = (i: number) => {
    const box = inputs.current[i];
    if (box && document.activeElement === box) return { a: box.selectionStart, b: box.selectionEnd };
    const last = lastPick.current;
    return last && last.i === i ? { a: last.a, b: last.b } : { a: 0, b: 0 };
  };
  /** A closing ~~ / == stepped over at the first key: the second one typed is not added. */
  const closeSwallow = useRef<{ key: string; at: number } | null>(null);
  /** Picked text and a first ~ / - / =: waiting for the second one. */
  const taskMarkWait = useRef<{ key: string; t: number } | null>(null);
  /**
   * The picked text to show again once to-do i is drawn with its new text (a frame later is not
   * enough: the list may be drawn after it, which would leave the caret at the start of the piece).
   */
  const pickAfter = useRef<{ i: number; text: string; from: number; to: number } | null>(null);
  const pickWhenDrawn = (i: number, text: string, from: number, to: number) => {
    pickAfter.current = { i, text, from, to };
  };
  useLayoutEffect(() => {
    const p = pickAfter.current;
    const bx = p && inputs.current[p.i];
    if (!p || !bx || bx.value !== p.text) return;
    pickAfter.current = null;
    bx.focus();
    bx.setSelectionRange(p.from, p.to);
  });
  /** Wraps the selected text of to-do i in a mark (**, `), or puts an empty pair at the caret. */
  const wrapTask = (i: number, mark: string) => {
    const box = inputs.current[i];
    const t = tasks[i];
    if (!box || !t) return;
    let { a, b } = pickedIn(i);
    // Bold (or a highlight, a strike) with nothing picked: the whole to-do.
    if (a === b && mark !== '`') {
      a = 0;
      b = t.text.length;
      if (t.text.startsWith(mark) && t.text.endsWith(mark) && t.text.length >= mark.length * 2) {
        setTasks(tasks.map((x, j) => (j === i ? { ...x, text: x.text.slice(mark.length, x.text.length - mark.length) } : x)));
        return;
      }
    }
    const picked = t.text.slice(a, b);
    // Already wrapped: the marks come off again.
    if (t.text.slice(a - mark.length, a) === mark && t.text.slice(b, b + mark.length) === mark) {
      const text = t.text.slice(0, a - mark.length) + picked + t.text.slice(b + mark.length);
      setTasks(tasks.map((x, j) => (j === i ? { ...x, text } : x)));
      pickWhenDrawn(i, text, a - mark.length, b - mark.length);
      return;
    }
    // The pick may run out of a styled piece (part of a coloured word and some plain text after it):
    // each part is wrapped on its own, between the hidden halves of the pieces it runs through, so
    // the marks nest instead of crossing ({#e03131|ab**c}d** would show its marks).
    const cuts: [number, number][] = [];
    for (const m of allTaskMarks(t.text)) {
      if (m.at >= a && m.end <= b) continue;
      for (const [x, y] of [[m.at, m.at + m.open.length], [m.end - m.close.length, m.end]]) if (x < b && y > a) cuts.push([x, y]);
    }
    cuts.sort((x, y) => x[0] - y[0]);
    const parts: [number, number][] = [];
    let from = a;
    for (const [x, y] of cuts) {
      if (x > from) parts.push([from, Math.min(x, b)]);
      from = Math.max(from, y);
    }
    if (from < b) parts.push([from, b]);
    let text = t.text;
    let shift = 0;
    let first = -1;
    let last = -1;
    for (const [x, y] of parts) {
      text = text.slice(0, x + shift) + mark + text.slice(x + shift, y + shift) + mark + text.slice(y + shift);
      if (first < 0) first = x + shift + mark.length;
      last = y + shift + mark.length;
      shift += mark.length * 2;
    }
    if (first < 0) return;
    setTasks(tasks.map((x, j) => (j === i ? { ...x, text } : x)));
    pickWhenDrawn(i, text, first, last);
  };
  /**
   * A colour or a highlight from the left bar (or Ctrl+M+K/B/R): on the picked text only
   * ({#e03131|text}, {=#ffd8a8|text}, ==text==), or on the whole to-do when nothing is picked. The text
   * is read as letters each with its own colour, so a colour put on text that has one already (all
   * of it, a part of it, or across several pieces) replaces it instead of nesting marks, which would
   * show as { } in the box. The same one again on all the picked text (or plain text colour) takes it off.
   */
  const colourTask = (i: number, kind: 'color' | 'bg', value?: string) => {
    const t = tasks[i];
    if (!t) return;
    const whole = () => setTasks(tasks.map((x, j) => (j === i ? { ...x, [kind]: value || undefined } : x)));
    const { a, b } = pickedIn(i);
    if (a === b) return whole();
    const src = t.text;
    const MARK = kind === 'color' ? /\{(#[0-9a-fA-F]{6})\|([^{}\n]+)\}/g : /\{=(#[0-9a-fA-F]{6})\|([^{}\n]+)\}|==([^=\n]+?)==/g;
    // The letters without this kind of mark, the colour of each, and where each place of the text falls among them.
    let plain = '';
    const tone: (string | undefined)[] = [];
    const at: number[] = [];
    const take = (from: number, to: number, c?: string) => {
      for (let k = from; k < to; k++) {
        at[k] = plain.length;
        plain += src[k];
        tone.push(c);
      }
    };
    let last = 0;
    for (const m of src.matchAll(MARK)) {
      const s0 = m.index ?? 0;
      take(last, s0);
      const body = m[2] ?? m[3];
      const close = m[3] !== undefined ? 2 : 1;
      const open = m[0].length - body.length - close;
      for (let k = s0; k < s0 + open; k++) at[k] = plain.length;
      take(s0 + open, s0 + open + body.length, m[3] !== undefined ? HIGHLIGHT_COLOR : m[1]);
      for (let k = s0 + open + body.length; k < s0 + m[0].length; k++) at[k] = plain.length;
      last = s0 + m[0].length;
    }
    take(last, src.length);
    at[src.length] = plain.length;
    let pf = at[Math.min(a, src.length)];
    let pt = at[Math.min(b, src.length)];
    // Ends of the pick inside another mark's hidden half (** of bold, say): moved to the text it holds.
    for (const m of allTaskMarks(plain)) {
      const cs = m.at + m.open.length;
      const ce = m.end - m.close.length;
      if (pf > m.at && pf < cs) pf = cs;
      else if (pf > ce && pf < m.end) pf = m.end;
      if (pt > m.at && pt < cs) pt = m.at;
      else if (pt > ce && pt < m.end) pt = ce;
    }
    if (pf >= pt) return whole();
    const want = !value || (kind === 'color' && value.toLowerCase() === TEXT_COLORS[0]) ? undefined : value.toLowerCase();
    const same = !!want && tone.slice(pf, pt).every((c) => c?.toLowerCase() === want);
    for (let k = pf; k < pt; k++) tone[k] = same ? undefined : want;
    const chars = Array.from({ length: plain.length }, (_, k) => plain[k]);
    const tones = tone.map((c) => c?.toLowerCase());
    const picked = chars.map((_, k) => k >= pf && k < pt);
    // A change of colour inside another mark (bold, code …) splits that mark there, so the marks
    // nest instead of crossing (**a{#e03131|b**c} would show its marks).
    for (let guard = 0; guard < 60; guard++) {
      let cut: { q: number; close: string; open: string } | null = null;
      for (const m of allTaskMarks(chars.join(''))) {
        for (let q = m.at + m.open.length + 1; q < m.end - m.close.length && !cut; q++) {
          if (tones[q - 1] !== tones[q]) cut = { q, close: m.close, open: m.open };
        }
        if (cut) break;
      }
      if (!cut) break;
      const { q, close, open } = cut;
      const add = [...close, ...open];
      chars.splice(q, 0, ...add);
      tones.splice(q, 0, ...[...close].map(() => tones[q - 1]), ...[...open].map(() => tones[q]));
      picked.splice(q, 0, ...add.map(() => false));
    }
    // Written back one run of a colour at a time.
    const openOf = (c: string) => (kind === 'color' ? `{${c}|` : c === HIGHLIGHT_COLOR.toLowerCase() ? '==' : `{=${c}|`);
    const closeOf = (c: string) => (kind === 'bg' && c === HIGHLIGHT_COLOR.toLowerCase() ? '==' : '}');
    let text = '';
    let from = -1;
    let to = -1;
    for (let k = 0; k < chars.length; ) {
      const c = tones[k];
      let e = k;
      while (e < chars.length && tones[e] === c) e++;
      if (c) text += openOf(c);
      for (let q = k; q < e; q++) {
        if (picked[q]) {
          if (from < 0) from = text.length;
          to = text.length + 1;
        }
        text += chars[q];
      }
      if (c) text += closeOf(c);
      k = e;
    }
    setTasks(tasks.map((x, j) => (j === i ? { ...x, text } : x)));
    pickWhenDrawn(i, text, Math.max(0, from), Math.max(0, to));
  };
  useEffect(() => {
    if (!editing) return;
    const format = (e: Event) => {
      const f = (e as CustomEvent<{ id: string; kind: string; value?: string }>).detail;
      if (f.id !== el.id) return;
      const i = currentTask();
      if (f.kind === 'bold') wrapTask(i, '**');
      else if (f.kind === 'code') wrapTask(i, '`');
      else colourTask(i, f.kind as 'color' | 'bg', f.value);
    };
    window.addEventListener(TASK_FORMAT_EVENT, format);
    return () => window.removeEventListener(TASK_FORMAT_EVENT, format);
  });
  useEffect(() => {
    if (!editing) return;
    const open = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== el.id) return;
      const boxes = inputs.current.slice(0, tasks.length);
      let i = boxes.findIndex((b) => b && b === document.activeElement);
      // Not typing in a to-do (the title, say): the formula goes at the end of the last one.
      if (i < 0) {
        i = tasks.length - 1;
        const b = boxes[i];
        b?.setSelectionRange(b.value.length, b.value.length);
      }
      const box = boxes[i];
      if (box) openTaskMath(i, box);
    };
    window.addEventListener(OPEN_MATH_EVENT, open);
    return () => window.removeEventListener(OPEN_MATH_EVENT, open);
  });
  const insertTaskMath = (tex: string) => {
    if (!mathEdit) return;
    const old = tasks[mathEdit.index]?.text ?? '';
    const mark = mathEdit.display ? '$$' : '$';
    const piece = mark + tex + mark;
    finishMath(old.slice(0, mathEdit.start) + piece + old.slice(mathEdit.end), mathEdit.start + piece.length);
  };
  const deleteTaskMath = () => {
    if (!mathEdit) return;
    const old = tasks[mathEdit.index]?.text ?? '';
    if (mathEdit.existing) finishMath(old.slice(0, mathEdit.start) + old.slice(mathEdit.end), mathEdit.start);
    else finishMath(null, mathEdit.start);
  };
  const toggle = (id: string) =>
    commit((m) => {
      const c = m[el.id].content;
      let next = (c.tasks ?? []).map((t) => (t.id === id ? { ...t, done: !t.done } : t));
      // Answered Yes before: a checked to-do goes at once.
      if (c.completePrompt === 'remove' && next.some((t) => t.id === id && t.done)) {
        next = next.filter((t) => t.id !== id);
        if (!next.length) next = [{ id: uid(), text: '', done: false }];
      }
      const firstCheck = !c.completePrompt && next.some((t) => t.id === id && t.done);
      update(m, el.id, { content: { tasks: next, ...(firstCheck ? { completePrompt: 'pending' as const } : {}) } });
    });
  /** Answer to the one-time question: Yes removes checked tasks (and keeps doing so), either answer stops asking. */
  const answerPrompt = (remove: boolean) =>
    commit((m) => {
      const c = m[el.id].content;
      const left = remove ? (c.tasks ?? []).filter((t) => !t.done) : (c.tasks ?? []);
      update(m, el.id, {
        content: { completePrompt: remove ? 'remove' : 'done', tasks: left.length ? left : [{ id: uid(), text: '', done: false }] },
      });
    });
  const askToDelete = el.content.completePrompt === 'pending' && tasks.some((t) => t.done);
  const done = tasks.filter((t) => t.done).length;

  return (
    <div
      className="card tasklist"
      ref={cardRef}
      onDoubleClickCapture={(e) => {
        if (editing) return;
        const t = e.target as HTMLElement;
        const row = t.closest<HTMLElement>('li[data-task-id]');
        const math = row && t.closest('span.math');
        const mathIdx = math ? Array.from(row.querySelectorAll('span.math')).indexOf(math) : -1;
        dblHint.current = row
          ? { task: row.dataset.taskId, ...(mathIdx >= 0 ? { math: mathIdx } : {}) }
          : t.closest('.tl-title')
            ? { title: true }
            : null;
      }}
    >
      {showTitle && (editing ? (
        <input
          className="tl-title"
          value={el.content.title ?? ''}
          placeholder="New To-do List"
          onChange={(e) => edit({ title: e.target.value })}
          onKeyDown={(e) => onEnterFinish(e, () => setFocusIdx(0))}
        />
      ) : el.content.title ? (
        <div className="tl-title">{el.content.title}</div>
      ) : (
        <div className="tl-title tl-default">New To-do List</div>
      ))}
      {tasks.length > 0 && (
        <div className="tl-progress" title={tr(`${done}/${tasks.length} 완료`, `${done}/${tasks.length} done`)}>
          <div style={{ width: `${(done / tasks.length) * 100}%` }} />
        </div>
      )}
      <ColumnScroll bodyClass="tasks-scroll">
      <ul className="tasks" ref={listRef}>
        {tasks.map((t, i) => {
          const dragging = taskDrag?.id === t.id;
          const others = tasks.filter((x) => x.id !== taskDrag?.id);
          const dropBefore = !!taskDrag && !dragging && others[taskDrag.index]?.id === t.id;
          return (
          <li
            key={t.id}
            data-task-id={t.id}
            className={[t.done && 'done', dragging && 'task-dragging', dropBefore && 'drop-before'].filter(Boolean).join(' ')}
            style={dragging ? { transform: `translateY(${taskDrag.dy}px)` } : undefined}
          >
            <input type="checkbox" checked={t.done} onChange={() => toggle(t.id)} />
            {editing ? (
              <RichTask
                ref={(n) => {
                  inputs.current[i] = n;
                }}
                className="task-text"
                value={t.text}
                tint={t.color || t.bg ? { color: t.color, background: t.bg } : undefined}
                placeholder={tr('할 일', 'To-do')}
                onChange={(v, typing = true) => setTasks(tasksRef.current.map((x) => (x.id === t.id ? { ...x, text: v } : x)), typing)}
                onDoubleClick={(e) => {
                  // Double-clicking inside $ … $ opens that formula.
                  if (mathAt(t.text, e.currentTarget.selectionStart)) openTaskMath(i, e.currentTarget);
                }}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return;
                  const box = e.currentTarget;
                  // What the box holds right now (keys typed fast come before the list is drawn again).
                  const live = box.value;
                  const pos = box.selectionStart;
                  const prev = live[pos - 1];
                  const next = live[pos];
                  // The box itself changes at once (so the next key typed lands at the new caret), then the list.
                  const put = (text: string, caret: number) => {
                    box.value = text;
                    box.setSelectionRange(caret, caret);
                    setTasks(tasksRef.current.map((x) => (x.id === t.id ? { ...x, text } : x)));
                  };
                  const plain = !e.ctrlKey && !e.metaKey && !e.altKey && box.selectionStart === box.selectionEnd;
                  const zk = e.key.toLowerCase();
                  if ((e.ctrlKey || e.metaKey) && !e.altKey && (zk === 'z' || zk === 'y')) {
                    // Undo / redo in the list: text, marks and styles.
                    e.preventDefault();
                    stepHistory(zk === 'z' && !e.shiftKey);
                  } else if (e.key === 'Enter' && e.shiftKey && !e.ctrlKey && !e.metaKey) {
                    // Shift+Enter: a line break inside this to-do.
                    e.preventDefault();
                    const [head, tail] = cutMarked(live, box.selectionStart, box.selectionEnd);
                    put(head + '\n' + tail, head.length + 1);
                  } else if (plain && e.key === '$' && prev !== '\\') {
                    // $ pairs up ($|$, then $$|$$); a closing $ steps over.
                    e.preventDefault();
                    if (next === '$' && prev !== '$') put(live, pos + 1);
                    else put(live.slice(0, pos) + '$$' + live.slice(pos), pos + 1);
                  } else if (plain && (e.key === '~' || e.key === '=') && closeSwallow.current?.key === e.key && closeSwallow.current.at === pos) {
                    // The second ~ / = of a closing pair already stepped over.
                    e.preventDefault();
                    closeSwallow.current = null;
                  } else if (plain && (e.key === '~' || e.key === '=') && next === e.key) {
                    // A closing ~~ or == is stepped over as one (its marks are hidden while typing).
                    e.preventDefault();
                    const two = live[pos + 1] === e.key;
                    put(live, pos + (two ? 2 : 1));
                    closeSwallow.current = two ? { key: e.key, at: pos + 2 } : null;
                  } else if (plain && (e.key === '~' || e.key === '=') && prev === e.key) {
                    // ~~ and == pair up: ~~|~~ (struck through), ==|== (highlighted).
                    e.preventDefault();
                    put(live.slice(0, pos) + e.key.repeat(3) + live.slice(pos), pos + 1);
                  } else if (!plain && !e.ctrlKey && !e.metaKey && !e.altKey && !e.nativeEvent.isComposing && (e.key === '(' || e.key === '[' || e.key === '{' || e.key === '$')) {
                    // Picked text, then ( [ { or $: put in the pair instead of typed over (a $formula$
                    // picked with its $ and wrapped in $ again becomes the centred $$formula$$).
                    e.preventDefault();
                    const a = box.selectionStart;
                    const b = box.selectionEnd;
                    const close = WRAP_PAIRS[e.key];
                    const text = live.slice(0, a) + e.key + live.slice(a, b) + close + live.slice(b);
                    box.value = text;
                    box.setSelectionRange(a + 1, b + 1);
                    setTasks(tasksRef.current.map((x) => (x.id === t.id ? { ...x, text } : x)));
                  } else if (!plain && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === '~' || e.key === '=' || e.key === '-')) {
                    // Picked text, then ~~ / -- or ==: wrapped in the marks instead of typed over.
                    e.preventDefault();
                    const w = taskMarkWait.current;
                    if (w && w.key === e.key && Date.now() - w.t < 2000) {
                      taskMarkWait.current = null;
                      wrapTask(i, e.key === '=' ? '==' : '~~');
                    } else taskMarkWait.current = { key: e.key, t: Date.now() };
                  } else if (plain && (e.key === '(' || e.key === '[' || e.key === '{') && (!next || /[\s)\]}.,;:!?'"]/.test(next))) {
                    // ( [ { pair up: (|) [|] {|}.
                    e.preventDefault();
                    const close = e.key === '(' ? ')' : e.key === '[' ? ']' : '}';
                    put(live.slice(0, pos) + e.key + close + live.slice(pos), pos + 1);
                  } else if (plain && (e.key === ']' || e.key === ')' || e.key === '}') && next === e.key) {
                    e.preventDefault();
                    put(live, pos + 1);
                  } else if (plain && e.key === 'Backspace' && prev && ((prev === '(' && next === ')') || (prev === '[' && next === ']') || (prev === '{' && next === '}') || (prev === '$' && next === '$'))) {
                    // Backspace in an empty pair takes both away.
                    e.preventDefault();
                    put(live.slice(0, pos - 1) + live.slice(pos + 1), pos - 1);
                  } else if (isMathShortcut(e)) {
                    // A formula at the caret opens for changing; otherwise a new one goes there.
                    e.preventDefault();
                    openTaskMath(i, box);
                  } else if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key.toLowerCase() === 'b' || e.key.toLowerCase() === 'e')) {
                    // Ctrl+B bold, Ctrl+E inline code, as in notes.
                    e.preventDefault();
                    wrapTask(i, e.key.toLowerCase() === 'b' ? '**' : '`');
                  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
                    e.preventDefault();
                  } else if (e.key === 'Enter' && !e.shiftKey) {
                    // Splits at the caret: the text after it moves into a new task below.
                    // (Shift+Enter is left to the text box: a line break inside this task.)
                    e.preventDefault();
                    const [before, after] = cutMarked(live, box.selectionStart, box.selectionEnd);
                    const next = tasks.map((x) => (x.id === t.id ? { ...x, text: before } : x));
                    next.splice(i + 1, 0, { id: uid(), text: after, done: false });
                    setTasks(next);
                    caretAt.current = 0;
                    setFocusIdx(i + 1);
                  } else if (e.key === 'Backspace' && i > 0 && live && box.selectionStart === 0 && box.selectionEnd === 0) {
                    // Backspace at the very start joins this task onto the one above.
                    e.preventDefault();
                    const prev = tasks[i - 1];
                    setTasks(tasks.filter((x) => x.id !== t.id).map((x) => (x.id === prev.id ? { ...x, text: prev.text + live } : x)));
                    caretAt.current = prev.text.length;
                    setFocusIdx(i - 1);
                  } else if (e.key === 'Backspace' && !live && tasks.length > 1) {
                    e.preventDefault();
                    setTasks(tasks.filter((x) => x.id !== t.id));
                    setFocusIdx(Math.max(0, i - 1));
                  } else if (e.key === 'ArrowUp' && i > 0 && caretOnEdge(e.currentTarget, 'first')) {
                    e.preventDefault();
                    setFocusIdx(i - 1);
                  } else if (e.key === 'ArrowDown' && i < tasks.length - 1 && caretOnEdge(e.currentTarget, 'last')) {
                    e.preventDefault();
                    setFocusIdx(i + 1);
                  }
                }}
              />
            ) : (
              <span className="task-text" style={t.color || t.bg ? { color: t.color, background: t.bg } : undefined}>
                {t.text ? <MathText text={t.text} /> : <em className="muted">{tr('빈 항목', 'Empty')}</em>}
              </span>
            )}
            <span className="task-actions">
              {t.done && (
                <button className="task-del" title={tr('이 할 일 지우기', 'Delete this to-do')} onClick={() => removeTask(t.id)}>
                  <Icon name="trash" size={15} />
                </button>
              )}
              <span className="task-grip" title={tr('끌어서 순서 바꾸기', 'Drag to reorder')} onPointerDown={(e) => startTaskDrag(e, t.id)}>
                <Icon name="grip" size={15} />
              </span>
            </span>
          </li>
          );
        })}
        {taskDrag && taskDrag.index >= tasks.length - 1 && <li className="task-drop-end" aria-hidden="true" />}
      </ul>
      </ColumnScroll>
      {mathEdit && (
        <MathEditor
          initial={mathEdit.tex}
          onInsert={insertTaskMath}
          onDelete={deleteTaskMath}
          onClose={() => finishMath(null, mathEdit.end)}
        />
      )}
      {editing && (
        <button
          className="link-btn"
          onClick={() => {
            setTasks([...tasks, { id: uid(), text: '', done: false }]);
            setFocusIdx(tasks.length);
          }}
        >
          {tr('+ 항목 추가', '+ Add item')}
        </button>
      )}
      {askToDelete && (
        <div className="tl-prompt" role="group" aria-label="Delete complete tasks?">
          <span>Delete complete tasks?</span>
          <button className="tl-yes" onClick={() => answerPrompt(true)}>
            Yes
          </button>
          <button className="tl-no" onClick={() => answerPrompt(false)}>
            No thanks
          </button>
        </div>
      )}
      <LabelRow el={el} />
    </div>
  );
}

/* ---------- Comment badge ---------- */

function CommentBadge({ el }: { el: El }) {
  const { openComments } = useBoard();
  const comments = el.content.comments ?? [];
  const last = comments[comments.length - 1];
  return (
    <button
      className="comment-badge"
      data-comment-badge={el.id}
      title={tr(`댓글 ${comments.length}개 보기`, `Show ${comments.length} comments`)}
      onClick={() => openComments(el.id)}
    >
      <Avatar author={last.author} size={18} />
      <span>{comments.length}</span>
    </button>
  );
}

/* ---------- Image ---------- */


function ImageBody({ el, editing }: { el: El; editing: boolean }) {
  const url = useBlobUrl(el.content.blobKey);
  const { setEditingId } = useBoard();
  return (
    <div className="card image-card">
      <div className="image-wrap">
        {url ? <img src={url} alt={el.content.caption ?? ''} draggable={false} /> : <div className="img-loading">{tr('불러오는 중…', 'Loading…')}</div>}
        {url && !!el.content.strokes?.length && (
          <InkLayer className="image-ink" strokes={el.content.strokes} width={1000} height={el.content.drawH ?? 1000} />
        )}
      </div>
      <Caption el={el} editing={editing} onDone={() => setEditingId(null)} />
      <LabelRow el={el} />
    </div>
  );
}

/** Caption under an image or table; shown when turned on (or when there is caption text). */
function Caption({ el, editing, onDone }: { el: El; editing: boolean; onDone: () => void }) {
  const edit = useEdit(el);
  const show = el.content.showCaption ?? !!el.content.caption;
  if (!show) return null;
  if (editing) {
    return (
      <input
        className="caption"
        value={el.content.caption ?? ''}
        placeholder={tr('캡션', 'Caption')}
        onChange={(e) => edit({ caption: e.target.value })}
        onKeyDown={(e) => onEnterFinish(e, onDone)}
      />
    );
  }
  return <div className={el.content.caption ? 'caption' : 'caption placeholder'}>{el.content.caption || tr('캡션', 'Caption')}</div>;
}

/* ---------- Drawing block ---------- */

/**
 * A drawing. Its title sits above it and its caption below it, outside the drawing itself, so the
 * strokes keep their place and size.
 */
function SketchBody({ el, editing }: { el: El; editing: boolean }) {
  const bg = el.content.bg ? COLORS[el.content.bg] : undefined;
  const edit = useEdit(el);
  const { setEditingId } = useBoard();
  const showCaption = el.content.showCaption ?? !!el.content.caption;
  const titleRef = useRef<HTMLInputElement>(null);
  const captionRef = useRef<HTMLInputElement>(null);
  // Editing starts in the empty one of the two (the caption when it was just put up), else the title.
  useEffect(() => {
    if (!editing) return;
    const t = setTimeout(() => {
      const want = showCaption && !el.content.caption ? captionRef.current : el.content.showTitle && !el.content.title ? titleRef.current : (titleRef.current ?? captionRef.current);
      want?.focus();
      want?.setSelectionRange(want.value.length, want.value.length);
    }, 0);
    return () => clearTimeout(t);
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={bg ? 'sketch has-bg' : 'sketch'} style={bg ? { background: bg } : undefined}>
      <InkLayer strokes={el.content.strokes ?? []} width={el.content.vw ?? el.width} height={el.content.vh ?? el.height ?? 1} />
      {el.content.showTitle &&
        (editing ? (
          <input
            ref={titleRef}
            className="sketch-title"
            value={el.content.title ?? ''}
            placeholder={tr('제목', 'Title')}
            onChange={(e) => edit({ title: e.target.value })}
            onKeyDown={(e) => onEnterFinish(e, () => setEditingId(null))}
          />
        ) : (
          <div className={el.content.title ? 'sketch-title' : 'sketch-title placeholder'}>{el.content.title || tr('제목', 'Title')}</div>
        ))}
      {showCaption &&
        (editing ? (
          <input
            ref={captionRef}
            className="caption sketch-caption"
            value={el.content.caption ?? ''}
            placeholder={tr('캡션', 'Caption')}
            onChange={(e) => edit({ caption: e.target.value })}
            onKeyDown={(e) => onEnterFinish(e, () => setEditingId(null))}
          />
        ) : (
          <div className={el.content.caption ? 'caption sketch-caption' : 'caption sketch-caption placeholder'}>{el.content.caption || tr('캡션', 'Caption')}</div>
        ))}
    </div>
  );
}

/**
 * A block diagram on the board, with its caption under it. A double-click on the drawing opens its
 * editor; on the caption (or the Caption option, F2) the caption is typed in place.
 */
function DiagramBody({ el, editing }: { el: El; editing: boolean }) {
  const edit = useEdit(el);
  const { setEditingId } = useBoard();
  const showCaption = el.content.showCaption ?? !!el.content.caption;
  const captionRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!editing) return;
    const t = setTimeout(() => {
      const c = captionRef.current;
      c?.focus();
      c?.setSelectionRange(c.value.length, c.value.length);
    }, 0);
    return () => clearTimeout(t);
  }, [editing]);
  return (
    <div className="diagram-block" title={tr('더블클릭이나 Enter: 블록선도 편집', 'Double-click or Enter: edit the diagram')}>
      <DiagramView d={el.content.diagram} />
      {showCaption &&
        (editing ? (
          <input
            ref={captionRef}
            className="caption dg-caption"
            value={el.content.caption ?? ''}
            placeholder={tr('캡션', 'Caption')}
            onChange={(e) => edit({ caption: e.target.value })}
            onKeyDown={(e) => onEnterFinish(e, () => setEditingId(null))}
          />
        ) : (
          <div
            className={el.content.caption ? 'caption dg-caption' : 'caption dg-caption placeholder'}
            onDoubleClickCapture={() => {
              editStart.id = el.id;
              editStart.by = 'caption';
            }}
          >
            {el.content.caption || tr('캡션', 'Caption')}
          </div>
        ))}
    </div>
  );
}

/* ---------- Table ---------- */

/** The last cells copied from a table: pasting that same text moves its formulas like a spreadsheet does. */
let lastCellCopy: { text: string; r0: number; c0: number } | null = null;

/**
 * Spreadsheet-style table. Click selects a cell; arrows, Enter (down), Tab (right) and Shift+Tab
 * (left) move; typing replaces the cell, F2 or a double-click edits it; Delete clears it; a cell
 * starting with = is a formula. One input sits over the selected cell and does all the typing, so
 * Korean and other IME input works from the first key.
 */
function TableBody({ el, editing }: { el: El; editing: boolean }) {
  const { commit, setEditingId, tableCell, setTableCell, selection, zoom } = useBoard();
  const edit = useEdit(el);
  const cells = useMemo(() => normalizeCells(el.content.cells?.length ? el.content.cells : [['', '', '']]), [el.content.cells]);
  const rows = cells.length;
  const cols = cells[0].length;
  const formats = el.content.cellFmt;
  const sheet = useMemo(() => new Sheet(cells), [cells]);
  // Cells are only picked while the table is being edited (double-click); one click just selects the block.
  const active = editing && tableCell && tableCell.id === el.id && selection.has(el.id) ? tableCell : null;
  const blockRef = useRef<HTMLDivElement>(null);
  const [cellEdit, setCellEdit] = useState<{ r: number; c: number; mode: 'enter' | 'edit'; draft: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  /** Outline around a dragged range of cells. */
  const [rangeBox, setRangeBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  /** Where the column and row borders are, for the resize handles. */
  const [edges, setEdges] = useState<{ cols: number[]; rows: number[]; w: number; h: number; above: number } | null>(null);
  const colW = el.content.colW;
  const rowH = el.content.rowH;
  const selected = selection.has(el.id);
  /** The title or caption is being typed in: no cell is picked and the index is hidden. */
  const [textFocus, setTextFocus] = useState(false);
  /** A double-click on the title or caption: editing starts there, not in a cell. */
  const startIn = useRef<'title' | 'caption' | null>(null);

  useLayoutEffect(() => {
    const table = scrollRef.current?.querySelector('table');
    if (!editing || !selected || !table) {
      if (edges) setEdges(null);
      return;
    }
    const first = Array.from(table.querySelectorAll<HTMLElement>('tr:first-child > *'));
    const trs = Array.from(table.querySelectorAll<HTMLElement>('tr'));
    const next = {
      cols: first.map((c) => c.offsetLeft + c.offsetWidth),
      rows: trs.map((r) => r.offsetTop + r.offsetHeight),
      w: table.offsetWidth,
      h: table.offsetHeight,
      // The title above the cells: the column letters go above it, so they never cover it.
      above: scrollRef.current?.offsetTop ?? 0,
    };
    if (!edges || JSON.stringify(edges) !== JSON.stringify(next)) setEdges(next);
  });

  /** Drag a border to resize: column borders change widths, row borders change heights. */
  const startResize = (e: ReactPointerEvent, kind: 'col' | 'row', index: number) => {
    e.preventDefault();
    e.stopPropagation();
    const table = scrollRef.current?.querySelector('table');
    if (!table) return;
    const widths = Array.from(table.querySelectorAll<HTMLElement>('tr:first-child > *')).map((c) => c.offsetWidth);
    const heights = Array.from(table.querySelectorAll<HTMLElement>('tr')).map((r) => r.offsetHeight);
    const start = kind === 'col' ? e.clientX : e.clientY;
    const key = `table-resize:${el.id}:${Date.now()}`;
    const move = (ev: PointerEvent) => {
      const d = ((kind === 'col' ? ev.clientX : ev.clientY) - start) / zoom;
      commit((m) => {
        if (kind === 'col') {
          const next = [...widths];
          next[index] = Math.round(Math.max(36, widths[index] + d));
          update(m, el.id, { width: next.reduce((a, b) => a + b, 0), content: { colW: next } });
        } else {
          const next = [...heights];
          next[index] = Math.round(Math.max(24, heights[index] + d));
          update(m, el.id, { content: { rowH: next } });
        }
      }, key);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  useLayoutEffect(() => {
    if (!active) {
      if (box) setBox(null);
      if (rangeBox) setRangeBox(null);
      return;
    }
    const cell = scrollRef.current?.querySelector<HTMLElement>(`[data-r="${active.r}"][data-c="${active.c}"]`);
    if (!cell) return;
    const next = { left: cell.offsetLeft, top: cell.offsetTop, width: cell.offsetWidth, height: cell.offsetHeight };
    if (!box || box.left !== next.left || box.top !== next.top || box.width !== next.width || box.height !== next.height) setBox(next);
    const g = rangeOf(active);
    const a = scrollRef.current?.querySelector<HTMLElement>(`[data-r="${g.r0}"][data-c="${g.c0}"]`);
    const b = scrollRef.current?.querySelector<HTMLElement>(`[data-r="${g.r1}"][data-c="${g.c1}"]`);
    const rb =
      a && b && (g.r0 !== g.r1 || g.c0 !== g.c1)
        ? { left: a.offsetLeft, top: a.offsetTop, width: b.offsetLeft + b.offsetWidth - a.offsetLeft, height: b.offsetTop + b.offsetHeight - a.offsetTop }
        : null;
    if (JSON.stringify(rb) !== JSON.stringify(rangeBox)) setRangeBox(rb);
  });

  useEffect(() => {
    // The picked cell takes the keyboard, unless the title or caption is being typed in.
    const typingElsewhere = !!(document.activeElement as HTMLElement | null)?.matches?.('input.tl-title, input.caption');
    if (active && !typingElsewhere) inputRef.current?.focus({ preventScroll: true });
  }, [active?.r, active?.c, !!active, editing, !!box]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!active) setCellEdit(null);
  }, [!!active]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Editing starts in an empty title or caption that was just switched on, otherwise in a cell. */
  useEffect(() => {
    if (!editing || (tableCell && tableCell.id === el.id)) return;
    const root = blockRef.current;
    const title = root?.querySelector<HTMLInputElement>(':scope > input.tl-title');
    const caption = root?.querySelector<HTMLInputElement>(':scope > input.caption');
    const hinted = startIn.current;
    startIn.current = null;
    if (hinted === 'title' && title) title.focus();
    else if (hinted === 'caption' && caption) caption.focus();
    else if (title && !title.value) title.focus();
    else if (caption && !caption.value) caption.focus();
    else setTableCell({ id: el.id, r: 0, c: 0 });
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!editing && textFocus) setTextFocus(false);
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  /* F2 / double-click put the caret after the existing text. */
  useEffect(() => {
    if (cellEdit?.mode === 'edit' && inputRef.current) {
      const n = inputRef.current.value.length;
      inputRef.current.setSelectionRange(n, n);
    }
  }, [cellEdit?.mode, cellEdit?.r, cellEdit?.c]); // eslint-disable-line react-hooks/exhaustive-deps

  const raw = (r: number, c: number) => cells[r]?.[c] ?? '';
  const saveCell = (r: number, c: number, value: string) => {
    if (value === raw(r, c)) return;
    commit((m) => update(m, el.id, { content: { cells: setCellValue(m[el.id].content.cells ?? cells, r, c, value) } }));
  };
  const select = (r: number, c: number) => setTableCell({ id: el.id, r, c });
  /** Keeps the picked cell and moves the range's other corner to (r, c). */
  const extend = (r: number, c: number) => {
    if (!active) return;
    setTableCell(r === active.r && c === active.c ? { id: el.id, r, c } : { id: el.id, r: active.r, c: active.c, r2: r, c2: c });
  };

  /**
   * Clicking a column letter or row number picks the whole column or row; dragging along the
   * letters or numbers (or Shift+clicking one) picks several.
   */
  const pickLine = (e: ReactPointerEvent, kind: 'col' | 'row', at: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (cellEdit) {
      saveCell(cellEdit.r, cellEdit.c, cellEdit.draft);
      setCellEdit(null);
    }
    const from = e.shiftKey && active ? (kind === 'col' ? active.c : active.r) : at;
    const put = (to: number) => {
      const a = Math.min(from, to);
      const b = Math.max(from, to);
      setTableCell(kind === 'col' ? { id: el.id, r: 0, c: a, r2: rows - 1, c2: b } : { id: el.id, r: a, c: 0, r2: b, c2: cols - 1 });
    };
    put(at);
    requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    const strip = e.currentTarget.parentElement;
    const move = (ev: PointerEvent) => {
      const n = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('[data-index-at]');
      if (n && strip?.contains(n)) put(Number(n.dataset.indexAt));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /**
   * Fills from the picked cells in one direction up to row or column `to` (see fillValues), adding
   * rows or columns when that lies past the edge of the table. One undo step.
   */
  const fillTo = (dir: FillDir, to: number) => {
    if (!active) return;
    const g = rangeOf(active);
    const count = dir === 'down' ? to - g.r1 : dir === 'up' ? g.r0 - to : dir === 'right' ? to - g.c1 : g.c0 - to;
    if (count <= 0) return;
    const shift = fillShift(dir);
    commit((m) => {
      const cur = m[el.id];
      let next = normalizeCells(cur.content.cells ?? cells);
      const oldCols = next[0].length;
      const vertical = dir === 'down' || dir === 'up';
      const lanes = vertical ? [g.c0, g.c1] : [g.r0, g.r1];
      for (let lane = lanes[0]; lane <= lanes[1]; lane++) {
        // The picked cells of this column (or row), nearest to the fill first.
        const span = vertical ? [g.r0, g.r1] : [g.c0, g.c1];
        const src: string[] = [];
        for (let i = span[0]; i <= span[1]; i++) src.push((vertical ? next[i]?.[lane] : next[lane]?.[i]) ?? '');
        if (dir === 'up' || dir === 'left') src.reverse();
        if (src.every((v) => v === '')) continue;
        fillValues(src, count, shift).forEach((v, k) => {
          const at = dir === 'down' ? g.r1 + 1 + k : dir === 'up' ? g.r0 - 1 - k : dir === 'right' ? g.c1 + 1 + k : g.c0 - 1 - k;
          next = vertical ? setCellValue(next, at, lane, v) : setCellValue(next, lane, at, v);
        });
      }
      const newCols = next[0].length;
      // New columns: fixed widths get the usual width; shared widths grow the block with them.
      const width = newCols > oldCols && !cur.content.colW ? Math.round(((cur.width ?? 360) * newCols) / oldCols) : undefined;
      update(m, el.id, { ...(width ? { width } : {}), content: { cells: next } });
    });
    const sel =
      dir === 'down' ? { r2: to, c2: g.c1, r: g.r0, c: g.c0 }
      : dir === 'up' ? { r: g.r1, c: g.c0, r2: to, c2: g.c1 }
      : dir === 'right' ? { r: g.r0, c: g.c0, r2: g.r1, c2: to }
      : { r: g.r0, c: g.c1, r2: g.r1, c2: to };
    setTableCell({ id: el.id, ...sel });
    requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
  };
  /** Double-clicking the fill handle fills down as far as the column beside goes (see fillEnd). */
  const fillDown = () => {
    if (!active) return;
    fillTo('down', fillEnd(cells, rangeOf(active)));
  };

  /** While the fill handle is dragged: where the fill would go, outlined. */
  const [fillDrag, setFillDrag] = useState<{ dir: FillDir; to: number } | null>(null);
  /**
   * Dragging the fill handle fills as far as it is pulled: down, up, right or left (whichever way it
   * went furthest), and past the edge of the table it adds rows or columns.
   */
  const startFillDrag = (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!active || e.button !== 0) return;
    const g = rangeOf(active);
    const table = scrollRef.current?.querySelector('table');
    if (!table) return;
    const sx = e.clientX;
    const sy = e.clientY;
    let state: { dir: FillDir; to: number } | null = null;
    /** The row and column under a point; past the table's edge, counted on in last-row / last-column steps. */
    const cellAt = (x: number, y: number) => {
      const tb = table.getBoundingClientRect();
      const trs = Array.from(table.querySelectorAll('tr'));
      const firsts = Array.from(trs[0]?.children ?? []);
      const lastRow = trs[trs.length - 1].getBoundingClientRect();
      const lastCol = firsts[firsts.length - 1].getBoundingClientRect();
      let r = trs.findIndex((tr) => y < tr.getBoundingClientRect().bottom);
      if (r < 0) r = Math.min(MAX_ROWS - 1, rows - 1 + Math.ceil((y - tb.bottom) / Math.max(12, lastRow.height)));
      let c = firsts.findIndex((td) => x < td.getBoundingClientRect().right);
      if (c < 0) c = Math.min(MAX_COLS - 1, cols - 1 + Math.ceil((x - tb.right) / Math.max(24, lastCol.width)));
      return { r: Math.max(0, r), c: Math.max(0, c) };
    };
    const move = (ev: PointerEvent) => {
      if (!state && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
      const { r, c } = cellAt(ev.clientX, ev.clientY);
      const down = r - g.r1;
      const up = g.r0 - r;
      const right = c - g.c1;
      const left = g.c0 - c;
      const best = Math.max(down, up, right, left);
      state =
        best <= 0 ? null
        : best === down ? { dir: 'down', to: r }
        : best === up ? { dir: 'up', to: r }
        : best === right ? { dir: 'right', to: c }
        : { dir: 'left', to: c };
      setFillDrag(state);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setFillDrag(null);
      if (state) fillTo(state.dir, state.to);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  /** The outline of the cells a fill drag would fill (it may reach past the table's edge). */
  const fillPreview = (() => {
    const scroll = scrollRef.current;
    const table = scroll?.querySelector('table');
    if (!fillDrag || !active || !table) return null;
    const g = rangeOf(active);
    const trs = Array.from(table.querySelectorAll<HTMLElement>('tr'));
    const firsts = Array.from(trs[0]?.children ?? []) as HTMLElement[];
    const rowEdge = (r: number) => {
      const last = trs[trs.length - 1];
      if (r < trs.length) return { top: trs[r].offsetTop, bottom: trs[r].offsetTop + trs[r].offsetHeight };
      const top = last.offsetTop + last.offsetHeight * (r - trs.length + 1);
      return { top, bottom: top + last.offsetHeight };
    };
    const colEdge = (c: number) => {
      const last = firsts[firsts.length - 1];
      if (c < firsts.length) return { left: firsts[c].offsetLeft, right: firsts[c].offsetLeft + firsts[c].offsetWidth };
      const left = last.offsetLeft + last.offsetWidth * (c - firsts.length + 1);
      return { left, right: left + last.offsetWidth };
    };
    const { dir, to } = fillDrag;
    const r0 = dir === 'down' ? g.r1 + 1 : dir === 'up' ? to : g.r0;
    const r1 = dir === 'down' ? to : dir === 'up' ? g.r0 - 1 : g.r1;
    const c0 = dir === 'right' ? g.c1 + 1 : dir === 'left' ? to : g.c0;
    const c1 = dir === 'right' ? to : dir === 'left' ? g.c0 - 1 : g.c1;
    const top = rowEdge(r0).top + table.offsetTop;
    const left = colEdge(c0).left + table.offsetLeft;
    return { left, top, width: colEdge(c1).right + table.offsetLeft - left, height: rowEdge(r1).bottom + table.offsetTop - top };
  })();

  type Move = 'up' | 'down' | 'left' | 'right' | 'enter' | 'shiftEnter' | 'tab' | 'shiftTab';
  const move = (dir: Move) => {
    if (!active) return;
    let { r, c } = active;
    let grow = false;
    if (dir === 'up' || dir === 'shiftEnter') r = Math.max(0, r - 1);
    else if (dir === 'down') r = Math.min(rows - 1, r + 1);
    else if (dir === 'left') c = Math.max(0, c - 1);
    else if (dir === 'right') c = Math.min(cols - 1, c + 1);
    else if (dir === 'enter') {
      if (r === rows - 1) grow = true;
      r += 1;
    } else if (dir === 'tab') {
      if (c < cols - 1) c += 1;
      else {
        c = 0;
        if (r === rows - 1) grow = true;
        r += 1;
      }
    } else if (dir === 'shiftTab') {
      if (c > 0) c -= 1;
      else if (r > 0) {
        r -= 1;
        c = cols - 1;
      }
    }
    // Moving past the last row adds a row, like typing on in a spreadsheet.
    if (grow)
      commit((m) => {
        const cur = normalizeCells(m[el.id].content.cells ?? cells);
        update(m, el.id, { content: { cells: [...cur, Array(cur[0].length).fill('')] } });
      });
    select(r, c);
  };
  const arrow: Record<string, Move> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (!active || e.nativeEvent.isComposing) return;
    const k = e.key;
    const stop = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (cellEdit) {
      const finish = (dir: Move) => {
        stop();
        saveCell(cellEdit.r, cellEdit.c, cellEdit.draft);
        setCellEdit(null);
        move(dir);
      };
      const ps = cellEdit.mode === 'enter' && arrow[k] ? pickState() : null;
      if (k === 'Escape') {
        stop();
        setCellEdit(null);
      } else if (ps) {
        // In a formula, arrows point at a cell (Shift+arrows stretch it into a range).
        stop();
        const from = ps.replace ?? { r: cellEdit.r, c: cellEdit.c, ar: cellEdit.r, ac: cellEdit.c };
        const dr = k === 'ArrowUp' ? -1 : k === 'ArrowDown' ? 1 : 0;
        const dc = k === 'ArrowLeft' ? -1 : k === 'ArrowRight' ? 1 : 0;
        const r = Math.max(0, Math.min(rows - 1, from.r + dr));
        const c = Math.max(0, Math.min(cols - 1, from.c + dc));
        const keep = e.shiftKey && ps.replace;
        putRef(keep ? from.ar : r, keep ? from.ac : c, r, c, ps.replace ?? { start: ps.caret!, end: ps.caret! });
      } else if (k === 'Enter') finish(e.shiftKey ? 'shiftEnter' : 'enter');
      else if (k === 'Tab') finish(e.shiftKey ? 'shiftTab' : 'tab');
      else if (cellEdit.mode === 'enter' && arrow[k]) finish(arrow[k]);
      else e.stopPropagation();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && ['c', 'x', 'v'].includes(k.toLowerCase())) {
      // Copy, cut and paste work on the picked cells (see onCopy / onPaste), not on the whole block.
      e.stopPropagation();
      return;
    }
    if (arrow[k] && e.shiftKey) {
      // Shift+arrow grows or shrinks the range from the picked cell.
      stop();
      const r2 = active.r2 ?? active.r;
      const c2 = active.c2 ?? active.c;
      const dr = k === 'ArrowUp' ? -1 : k === 'ArrowDown' ? 1 : 0;
      const dc = k === 'ArrowLeft' ? -1 : k === 'ArrowRight' ? 1 : 0;
      extend(Math.max(0, Math.min(rows - 1, r2 + dr)), Math.max(0, Math.min(cols - 1, c2 + dc)));
    } else if (arrow[k]) {
      stop();
      move(arrow[k]);
    } else if (k === 'Enter') {
      stop();
      move(e.shiftKey ? 'shiftEnter' : 'enter');
    } else if (k === 'Tab') {
      stop();
      move(e.shiftKey ? 'shiftTab' : 'tab');
    } else if (k === 'F2') {
      stop();
      setCellEdit({ r: active.r, c: active.c, mode: 'edit', draft: raw(active.r, active.c) });
    } else if (k === 'Delete' || k === 'Backspace') {
      stop();
      const g = rangeOf(active);
      if (g.r0 === g.r1 && g.c0 === g.c1) saveCell(active.r, active.c, '');
      else commit((m) => update(m, el.id, { content: { cells: clearRange(normalizeCells(m[el.id].content.cells ?? cells), g) } }));
    }
  };

  /** The picked cells as tab-separated text, formulas included. */
  const copyCells = (e: ReactClipboardEvent) => {
    if (!active || cellEdit) return false;
    const g = rangeOf(active);
    const rowsOut: string[][] = [];
    for (let r = g.r0; r <= g.r1; r++) {
      const row: string[] = [];
      for (let c = g.c0; c <= g.c1; c++) row.push(raw(r, c));
      rowsOut.push(row);
    }
    const text = toTsv(rowsOut);
    e.preventDefault();
    e.clipboardData.setData('text/plain', text);
    lastCellCopy = { text, r0: g.r0, c0: g.c0 };
    return true;
  };
  /**
   * Several copied cells go one value per cell from the top-left picked cell, as far as the table
   * reaches. Formulas copied from a table move their references along, like a spreadsheet.
   */
  const pasteGrid = (e: ReactClipboardEvent) => {
    if (!active || cellEdit) return;
    const text = e.clipboardData.getData('text/plain');
    const ours = lastCellCopy && lastCellCopy.text === text.replace(/\r\n?/g, '\n') ? lastCellCopy : null;
    // A single value from elsewhere is typed into the cell as usual.
    if (!ours && !/[\t\n]/.test(text.replace(/\r?\n$/, ''))) return;
    e.preventDefault();
    const g = rangeOf(active);
    const data = parseTsv(text).map((row) => row.map((v) => (ours ? shiftFormula(v, g.r0 - ours.r0, g.c0 - ours.c0) : v)));
    const done = pasteCells(cells, g.r0, g.c0, data);
    commit((m) => update(m, el.id, { content: { cells: pasteCells(normalizeCells(m[el.id].content.cells ?? cells), g.r0, g.c0, data).cells } }));
    const p = done.range;
    setTableCell(p.r0 === p.r1 && p.c0 === p.c1 ? { id: el.id, r: p.r0, c: p.c0 } : { id: el.id, r: p.r0, c: p.c0, r2: p.r1, c2: p.c1 });
  };

  /**
   * A reference put into the formula by clicking cells (or arrows): where it sits in the text, the
   * cell the pick started from and the one it reaches. Clicking again replaces it, like a spreadsheet.
   */
  const pick = useRef<{ start: number; end: number; ar: number; ac: number; r: number; c: number } | null>(null);
  const draftRef = useRef('');
  draftRef.current = cellEdit?.draft ?? '';
  const caretNext = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (caretNext.current === null || !inputRef.current) return;
    inputRef.current.setSelectionRange(caretNext.current, caretNext.current);
    caretNext.current = null;
  });
  /** Whether a click or arrow now points at cells for the formula, and whether it replaces the last pick. */
  const pickState = () => {
    if (!cellEdit || !cellEdit.draft.startsWith('=')) return null;
    const n = inputRef.current;
    const caret = n && n.selectionStart === n.selectionEnd ? n.selectionStart : null;
    if (caret === null) return null;
    const p = pick.current;
    if (p && caret === p.end && draftRef.current.slice(p.start, p.end) === rangeName(rangeOf({ r: p.ar, c: p.ac, r2: p.r, c2: p.c }))) return { replace: p };
    pick.current = null;
    return refSlot(cellEdit.draft, caret) ? { replace: null, caret } : null;
  };
  const putRef = (ar: number, ac: number, r: number, c: number, at: { start: number; end: number }) => {
    const text = rangeName(rangeOf({ r: ar, c: ac, r2: r, c2: c }));
    const d = draftRef.current;
    const draft = d.slice(0, at.start) + text + d.slice(at.end);
    pick.current = { start: at.start, end: at.start + text.length, ar, ac, r, c };
    draftRef.current = draft;
    caretNext.current = at.start + text.length;
    setCellEdit((ce) => (ce ? { ...ce, draft, mode: 'enter' } : ce));
  };

  const onPointerDownCell = (e: ReactPointerEvent, r: number, c: number) => {
    if (e.button !== 0 || !editing) return;
    const ps = cellEdit && (cellEdit.r !== r || cellEdit.c !== c) ? pickState() : null;
    if (ps) {
      // Typing a formula: the clicked cell (or dragged range) goes into it instead of being picked.
      e.preventDefault();
      const at = ps.replace ?? { start: ps.caret!, end: ps.caret! };
      const anchor = e.shiftKey && ps.replace ? { r: ps.replace.ar, c: ps.replace.ac } : { r, c };
      putRef(anchor.r, anchor.c, r, c, at);
      requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
      let last = `${r}:${c}`;
      const move = (ev: PointerEvent) => {
        const n = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('[data-r][data-c]');
        if (!n || !scrollRef.current?.contains(n) || !pick.current) return;
        const rr = Number(n.dataset.r);
        const cc = Number(n.dataset.c);
        if (`${rr}:${cc}` === last) return;
        last = `${rr}:${cc}`;
        putRef(anchor.r, anchor.c, rr, cc, pick.current);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      return;
    }
    if (cellEdit && (cellEdit.r !== r || cellEdit.c !== c)) {
      saveCell(cellEdit.r, cellEdit.c, cellEdit.draft);
      setCellEdit(null);
    }
    requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    if (e.shiftKey && active) {
      extend(r, c);
      return;
    }
    select(r, c);
    // Dragging over more cells picks a range, like a spreadsheet.
    const anchor = { r, c };
    let last = `${r}:${c}`;
    const move = (ev: PointerEvent) => {
      const n = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('[data-r][data-c]');
      if (!n || !scrollRef.current?.contains(n)) return;
      const rr = Number(n.dataset.r);
      const cc = Number(n.dataset.c);
      if (`${rr}:${cc}` === last) return;
      last = `${rr}:${cc}`;
      setTableCell(rr === anchor.r && cc === anchor.c ? { id: el.id, ...anchor } : { id: el.id, ...anchor, r2: rr, c2: cc });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const range = active ? rangeOf(active) : null;
  const multi = !!range && (range.r0 !== range.r1 || range.c0 !== range.c1);
  const refRanges: CellRange[] = cellEdit ? formulaRanges(cellEdit.draft) : [];

  const ref = !active
    ? ''
    : multi && range
      ? `${colName(range.c0)}${range.r0 + 1}:${colName(range.c1)}${range.r1 + 1}`
      : `${colName(active.c)}${active.r + 1}`;
  const shownRaw = active ? (cellEdit && cellEdit.r === active.r && cellEdit.c === active.c ? cellEdit.draft : raw(active.r, active.c)) : '';

  const indexOn = editing && selected && !!edges && !textFocus;

  return (
    <div
      className="table-block"
      ref={blockRef}
      onDoubleClickCapture={(e) => {
        const t = e.target as HTMLElement;
        if (!editing) startIn.current = t.closest('.tl-title') ? 'title' : t.closest('.caption') ? 'caption' : null;
      }}
      onFocus={(e) => {
        if (!(e.target as HTMLElement).matches('input.tl-title, input.caption')) return;
        setTextFocus(true);
        // Typing in the title or caption: no cell stays picked.
        if (tableCell?.id === el.id) setTableCell(null);
      }}
      onBlur={(e) => {
        if ((e.target as HTMLElement).matches('input.tl-title, input.caption')) setTextFocus(false);
      }}
    >
      {el.content.showTitle &&
        (editing ? (
          <input className="tl-title" value={el.content.title ?? ''} placeholder={tr('제목', 'Title')} onChange={(e) => edit({ title: e.target.value })} />
        ) : (
          <div className={el.content.title ? 'tl-title' : 'tl-title tl-default'}>{el.content.title || tr('제목', 'Title')}</div>
        ))}
      <div className="table-scroll" ref={scrollRef}>
        {indexOn && edges && (
          <>
            {/* Column letters and row numbers, shown only while the table is selected. */}
            <div className="sheet-index sheet-cols" style={{ width: edges.w, bottom: `calc(100% + ${6 + edges.above}px)` }} aria-hidden="true">
              {edges.cols.map((x, c) => (
                <span
                  key={c}
                  data-index-at={c}
                  data-col-index={c}
                  title={tr(`${colName(c)}열 전체 선택 (끌거나 Shift+클릭: 여러 열)`, `Select column ${colName(c)} (drag or Shift+click: several columns)`)}
                  className={multi && range && c >= range.c0 && c <= range.c1 ? 'on' : undefined}
                  style={{ width: x - (c ? edges.cols[c - 1] : 0) }}
                  onPointerDown={(e) => pickLine(e, 'col', c)}
                >
                  {colName(c)}
                </span>
              ))}
            </div>
            <div className="sheet-index sheet-rows" style={{ height: edges.h }} aria-hidden="true">
              {edges.rows.map((y, r) => (
                <span
                  key={r}
                  data-index-at={r}
                  data-row-index={r}
                  title={tr(`${r + 1}행 전체 선택 (끌거나 Shift+클릭: 여러 행)`, `Select row ${r + 1} (drag or Shift+click: several rows)`)}
                  className={multi && range && r >= range.r0 && r <= range.r1 ? 'on' : undefined}
                  style={{ height: y - (r ? edges.rows[r - 1] : 0) }}
                  onPointerDown={(e) => pickLine(e, 'row', r)}
                >
                  {r + 1}
                </span>
              ))}
            </div>
          </>
        )}
        <table
          className={colW ? 'grid sized' : 'grid'}
          style={colW ? { width: cells[0].reduce((sum, _, c) => sum + (colW[c] || NEW_COL_WIDTH), 0) } : undefined}
        >
          {colW && (
            <colgroup>
              {cells[0].map((_, c) => (
                <col key={c} style={{ width: colW[c] || NEW_COL_WIDTH }} />
              ))}
            </colgroup>
          )}
          <tbody>
            {cells.map((row, r) => (
              <tr key={r} style={rowH?.[r] ? { height: rowH[r] } : undefined}>
                {row.map((_, c) => {
                  const Cell = r === 0 ? 'th' : 'td';
                  const v = sheet.value(r, c);
                  const isActive = !!active && active.r === r && active.c === c;
                  const cls = [
                    typeof v === 'number' && 'num',
                    typeof v === 'string' && v.startsWith('#') && raw(r, c).startsWith('=') && 'err',
                    isActive && 'active',
                    multi && range && inRange(range, r, c) && 'in-range',
                    refRanges.some((g) => inRange(g, r, c)) && 'ref-hl',
                  ]
                    .filter(Boolean)
                    .join(' ');
                  const f = formats?.[cellKey(r, c)];
                  return (
                    <Cell
                      key={c}
                      data-r={r}
                      data-c={c}
                      className={cls || undefined}
                      style={cellStyle(f)}
                      onMouseDown={(e) => {
                        if (editing) e.preventDefault();
                      }}
                      onPointerDown={(e) => onPointerDownCell(e, r, c)}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        if (!editing) {
                          // First double-click opens the table for editing at this cell.
                          setEditingId(el.id);
                          select(r, c);
                          return;
                        }
                        select(r, c);
                        setCellEdit({ r, c, mode: 'edit', draft: raw(r, c) });
                        requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
                      }}
                    >
                      {displayCell(sheet, r, c, f, raw(r, c))}
                    </Cell>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {edges &&
          edges.cols.map((x, c) => (
            <div
              key={'c' + c}
              className="col-resizer"
              data-col-resizer={c}
              style={{ left: x - 4, height: edges.h }}
              title={tr('끌어서 열 너비 조절', 'Drag to resize column')}
              onPointerDown={(e) => startResize(e, 'col', c)}
            />
          ))}
        {edges &&
          edges.rows.map((y, r) => (
            <div
              key={'r' + r}
              className="row-resizer"
              data-row-resizer={r}
              style={{ top: y - 4, width: edges.w }}
              title={tr('끌어서 행 높이 조절', 'Drag to resize row')}
              onPointerDown={(e) => startResize(e, 'row', r)}
            />
          ))}
        {rangeBox && <div className="range-box" style={rangeBox} aria-hidden="true" />}
        {fillPreview && <div className="fill-preview" data-fill-preview style={fillPreview} aria-hidden="true" />}
        {active && !cellEdit && (rangeBox ?? box) && (
          <div
            className="fill-handle"
            data-fill-handle
            title={tr('끌어서 채우기 or 더블클릭', 'Drag to fill or double-click')}
            style={{ left: (rangeBox ?? box)!.left + (rangeBox ?? box)!.width - 4, top: (rangeBox ?? box)!.top + (rangeBox ?? box)!.height - 4 }}
            onPointerDown={startFillDrag}
            onDoubleClick={(e) => {
              e.stopPropagation();
              fillDown();
            }}
          />
        )}
        {active && box && (
          <input
            ref={inputRef}
            className={cellEdit ? 'cell-input editing' : 'cell-input'}
            data-idle={cellEdit ? undefined : 'true'}
            aria-label={tr(`${ref} 셀`, `Cell ${ref}`)}
            style={box}
            value={cellEdit ? cellEdit.draft : ''}
            onChange={(e) => {
              const v = e.target.value;
              pick.current = null;
              setCellEdit((ce) => (ce ? { ...ce, draft: v } : { r: active.r, c: active.c, mode: 'enter', draft: v }));
            }}
            onKeyDown={onKeyDown}
            onCopy={copyCells}
            onCut={(e) => {
              if (!copyCells(e) || !active) return;
              const g = rangeOf(active);
              commit((m) => update(m, el.id, { content: { cells: clearRange(normalizeCells(m[el.id].content.cells ?? cells), g) } }));
            }}
            onPaste={pasteGrid}
            onDoubleClick={(e) => {
              // The input covers the selected cell, so a double-click on that cell lands here.
              e.stopPropagation();
              if (!cellEdit) setCellEdit({ r: active.r, c: active.c, mode: 'edit', draft: raw(active.r, active.c) });
            }}
            onBlur={() => {
              if (cellEdit) {
                saveCell(cellEdit.r, cellEdit.c, cellEdit.draft);
                setCellEdit(null);
              }
            }}
          />
        )}
      </div>
      <Caption el={el} editing={editing} onDone={() => setEditingId(null)} />
      {/* Hidden while the fill handle is dragged, so the outline below the table shows. */}
      {active && !fillDrag && (
        <div className="sheet-bar" data-sheet-bar>
          <span className="sheet-ref">{ref}</span>
          <span className="sheet-raw" title={shownRaw}>
            {shownRaw}
          </span>
        </div>
      )}
      <LabelRow el={el} />
    </div>
  );
}

/** Alignment and fill of one cell. */
function cellStyle(f?: CellFormat): CSSProperties | undefined {
  if (!f || (!f.h && !f.v && !f.bg)) return undefined;
  return {
    textAlign: f.h,
    verticalAlign: f.v,
    backgroundColor: f.bg && COLORS[f.bg] ? `color-mix(in srgb, ${COLORS[f.bg]} 30%, white)` : undefined,
  };
}

/* ---------- Labels above a block ---------- */

/**
 * A block's tags, at the bottom left inside it. Pressing one selects the block and opens a bubble:
 * take the tag off this block, or put a new one on it.
 */
function LabelRow({ el }: { el: El }) {
  const { els, commit, select, selection } = useBoard();
  const [open, setOpen] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const defs = labelDefsOf(els);
  const chips = [
    ...(el.content.tag?.text ? [{ id: 'tag', name: el.content.tag.text, color: el.content.tag.color }] : []),
    ...(el.content.labels ?? []).map((id) => defs.find((d) => d.id === id)).filter((d): d is NonNullable<typeof d> => !!d),
  ];
  if (!chips.length) return null;
  const editing = open && chips.find((c) => c.id === open.id);
  return (
    <div className="label-row">
      {chips.map((d) => (
        <button
          key={d.id}
          className="label-chip"
          data-label-id={d.id}
          data-tag-chip
          style={{ background: COLORS[d.color] ?? COLORS.gray }}
          title={tr('눌러서 빼거나 새 태그 붙이기 (이름·색은 왼쪽 막대의 태그에서)', 'Press to remove it or add a new tag (rename and recolour in the left bar’s Tag)')}
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            // The block is selected too, so the left bar shows its settings.
            if (!(selection.size === 1 && selection.has(el.id))) select([el.id]);
            setOpen({ id: d.id, anchor: e.currentTarget });
          }}
        >
          {d.name}
        </button>
      ))}
      {open && editing && (
        <TagChipBubble
          anchor={open.anchor}
          name={editing.name}
          onClose={() => setOpen(null)}
          onRemove={() =>
            commit((m) => {
              if (open.id === 'tag') update(m, el.id, { content: { tag: undefined } });
              else if (m[el.id].content.labels?.includes(open.id)) toggleLabel(m, el.id, open.id);
            })
          }
          onCreate={(name, color) =>
            commit((m) => {
              const id = createLabel(m, name, color);
              if (!m[el.id].content.labels?.includes(id)) toggleLabel(m, el.id, id);
            })
          }
        />
      )}
    </div>
  );
}

/* ---------- Footer: comments and reactions under a block ---------- */

function BlockFooter({ el }: { el: El }) {
  const { commit, meId } = useBoard();
  const comments = el.content.comments?.length ?? 0;
  const reactions = Object.entries(el.content.reactions ?? {});
  if (!comments && !reactions.length) return null;
  return (
    <div className="block-footer">
      {comments > 0 && <CommentBadge el={el} />}
      {reactions.map(([emoji, who]) => (
        <button
          key={emoji}
          className={who.includes(meId) ? 'reaction-chip mine' : 'reaction-chip'}
          data-reaction={emoji}
          title={who.includes(meId) ? tr('내 반응 취소', 'Remove my reaction') : tr('반응 남기기', 'React')}
          onClick={() => commit((m) => toggleReaction(m, el.id, emoji, meId))}
        >
          <span>{emoji}</span>
          <span>{who.length}</span>
        </button>
      ))}
    </div>
  );
}

/* ---------- Link (and paper reader) ---------- */

/** Paper downloads in progress, by element id, so re-renders do not start a second one. */
const paperJobs = new Map<string, Promise<void>>();
/** Last failure per element and URL, so a broken link is not retried on every render. */
const paperFailures = new Map<string, string>();

function usePaper(el: El, editing: boolean) {
  const { commit, freeSpot } = useBoard();
  const url = el.content.url ?? '';
  const src = useMemo(() => detectPaper(url), [url]);
  const failKey = el.id + '|' + url;
  const [loading, setLoading] = useState(() => paperJobs.has(el.id));
  const [error, setError] = useState<string | null>(() => paperFailures.get(failKey) ?? null);

  const start = useCallback(() => {
    if (!src || paperJobs.has(el.id)) return;
    paperFailures.delete(failKey);
    setError(null);
    setLoading(true);
    const job = (async () => {
      const [blob, meta] = await Promise.all([
        fetchPaperPdf(src),
        src.kind === 'arxiv' ? fetchArxivMeta(src.id) : Promise.resolve(null),
      ]);
      const blobKey = await putBlob(blob);
      commit((m) => {
        const cur = m[el.id];
        if (!cur || cur.content.url !== url) return;
        const width = cur.width < 420 ? 480 : cur.width;
        const height = cur.height ?? 640;
        // The card grows into a reader; slide it to the nearest spot where it covers nothing.
        let loc = cur.loc;
        if (cur.loc.section === 'CANVAS') {
          const spot = freeSpot(width, height, { x: cur.loc.x + width / 2, y: cur.loc.y + 40 }, el.id);
          loc = { ...cur.loc, x: Math.round(spot.x - width / 2), y: Math.round(spot.y - 40) };
        }
        update(m, el.id, {
          loc,
          width,
          height,
          content: {
            paper: {
              blobKey,
              source: src.pdfUrl,
              arxivId: src.kind === 'arxiv' ? src.id : undefined,
              ...meta,
              fetchedAt: Date.now(),
            },
          },
        });
      });
    })();
    paperJobs.set(el.id, job);
    job
      .then(
        () => setLoading(false),
        (e: Error) => {
          paperFailures.set(failKey, e.message);
          setError(e.message);
          setLoading(false);
        },
      )
      .finally(() => paperJobs.delete(el.id));
  }, [src, el.id, url, failKey, commit, freeSpot]);

  useEffect(() => {
    if (src && !el.content.paper && !editing && !paperFailures.has(failKey)) start();
  }, [src, el.content.paper, editing, failKey, start]);

  return { src, loading, error, start };
}

function LinkBody({ el, editing }: { el: El; editing: boolean }) {
  const edit = useEdit(el);
  const { setEditingId } = useBoard();
  const url = el.content.url ?? '';
  const host = url ? hostOf(url) : '';
  const paperState = usePaper(el, editing);
  usePreview(el, editing, !!paperState.src);

  /** Saves the URL and drops a stored paper that belongs to a different link. */
  const saveUrl = (raw: string) => {
    const next = normalizeUrl(raw);
    const paper = el.content.paper;
    const stale = paper && detectPaper(next)?.pdfUrl !== paper.source;
    const previewStale = next !== (el.content.url ?? '');
    edit({ url: next, ...(stale ? { paper: undefined } : {}), ...(previewStale ? { preview: undefined } : {}) });
  };

  if (editing) {
    return (
      <div className="card link-card editing">
        <input
          value={url}
          placeholder={tr('URL 붙여넣기 (arXiv·PDF 링크는 본문을 불러옵니다)', 'Paste a URL (arXiv/PDF links load the full text)')}
          onChange={(e) => edit({ url: e.target.value })}
          onBlur={(e) => saveUrl(e.target.value)}
          onKeyDown={(e) =>
            onEnterFinish(e, () => {
              saveUrl(url);
              setEditingId(null);
            })
          }
        />
        <input
          value={el.content.title ?? ''}
          placeholder={tr('제목 (선택)', 'Title (optional)')}
          onChange={(e) => edit({ title: e.target.value })}
          onKeyDown={(e) => onEnterFinish(e, () => setEditingId(null))}
        />
      </div>
    );
  }
  if (!url) return <div className="card link-card placeholder">{tr('더블클릭해서 URL 입력', 'Double-click to enter a URL')}</div>;
  if (el.content.paper) return <PaperCard el={el} />;
  if (el.content.preview?.imageKey) return <PreviewCard el={el} />;
  return (
    <div className="card link-wrap">
      <div className="link-card">
        <div className="link-icon">{(host[0] ?? '?').toUpperCase()}</div>
        <div className="link-main">
          <div className="link-title">{el.content.title || el.content.preview?.title || host}</div>
          <div className="link-url">{url}</div>
        </div>
        <a className="link-open" href={url} target="_blank" rel="noopener noreferrer" title={tr('새 탭에서 열기', 'Open in new tab')}>
          <Icon name="external" size={15} />
        </a>
      </div>
      {paperState.src && (
        <div className={paperState.error ? 'paper-status error' : 'paper-status'}>
          {paperState.loading && <span>{tr('논문 불러오는 중…', 'Loading paper…')}</span>}
          {!paperState.loading && paperState.error && (
            <span title={paperState.error}>{tr('불러오지 못했습니다: ', 'Could not load: ')}{paperState.error}</span>
          )}
          {!paperState.loading && (
            <button className="link-btn" onClick={paperState.start}>
              {paperState.error ? tr('다시 시도', 'Retry') : tr('논문 불러오기', 'Load paper')}
            </button>
          )}
        </div>
      )}
      <LabelRow el={el} />
    </div>
  );
}

/** Preview downloads in progress, by element id. */
const previewJobs = new Set<string>();
/** Links whose preview failed in this session, so they are not retried on every render. */
const previewFailures = new Set<string>();

/**
 * For ordinary links (not papers): fetches a thumbnail and title once, e.g. a YouTube video's
 * thumbnail or a page's Open Graph image, and stores the picture with the board.
 */
function usePreview(el: El, editing: boolean, isPaper: boolean) {
  const { commit } = useBoard();
  const url = el.content.url ?? '';
  const failKey = el.id + '|' + url;
  useEffect(() => {
    if (!url || isPaper || editing || el.content.preview || previewJobs.has(el.id) || previewFailures.has(failKey)) return;
    if (!/^https?:\/\//i.test(url)) return;
    previewJobs.add(el.id);
    (async () => {
      try {
        const { preview, image } = await fetchLinkPreview(url);
        const imageKey = image ? await putBlob(image) : undefined;
        commit((m) => {
          const cur = m[el.id];
          if (!cur || cur.content.url !== url) return;
          update(m, el.id, {
            width: imageKey && cur.width < 300 ? 320 : cur.width,
            content: { preview: { ...preview, imageKey } },
          });
        });
      } catch {
        previewFailures.add(failKey);
      } finally {
        previewJobs.delete(el.id);
      }
    })();
  }, [url, isPaper, editing, el.content.preview, el.id, failKey, commit]);
}

/** Link card with a thumbnail on top: YouTube videos get a play button that opens the video. */
function PreviewCard({ el }: { el: El }) {
  const preview = el.content.preview!;
  const url = el.content.url ?? '';
  const img = useBlobUrl(preview.imageKey);
  const host = hostOf(url);
  const open = () => window.open(url, '_blank', 'noopener,noreferrer');
  return (
    <div className="card link-preview" data-preview-kind={preview.kind}>
      <div className={preview.kind === 'youtube' ? 'preview-media video' : 'preview-media'}>
        {img ? <img src={img} alt="" draggable={false} /> : <div className="img-loading">{tr('불러오는 중…', 'Loading…')}</div>}
        {preview.kind === 'youtube' && (
          <button className="preview-play" onClick={open} title={tr('YouTube에서 보기', 'Watch on YouTube')}>
            <Icon name="play" size={22} />
          </button>
        )}
      </div>
      <div className="link-card">
        <div className="link-main">
          <div className="link-title" title={el.content.title || preview.title || url}>
            {el.content.title || preview.title || host}
          </div>
          <div className="link-url">{preview.site || host}</div>
        </div>
        <a className="link-open" href={url} target="_blank" rel="noopener noreferrer" title={tr('새 탭에서 열기', 'Open in new tab')}>
          <Icon name="external" size={15} />
        </a>
      </div>
    </div>
  );
}

function PaperCard({ el }: { el: El }) {
  const { commit, zoom } = useBoard();
  const paper = el.content.paper!;
  const url = el.content.url ?? '';
  const pdfUrl = useBlobUrl(paper.blobKey);
  const [showAbstract, setShowAbstract] = useState(false);
  const authors = paper.authors ?? [];
  const byline = [
    authors.length > 3 ? tr(`${authors.slice(0, 3).join(', ')} 외 ${authors.length - 3}명`, `${authors.slice(0, 3).join(', ')} +${authors.length - 3} more`) : authors.join(', '),
    paper.published,
    paper.pages ? tr(`${paper.pages}쪽`, `${paper.pages} pages`) : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const baseName = paper.arxivId ? `arXiv-${paper.arxivId}` : el.content.title || hostOf(url);
  const fileName = baseName.replace(/[\\/:*?"<>|]/g, '_') + '.pdf';
  return (
    <div className="card paper-card">
      <div className="paper-head">
        <div className="paper-badge">{paper.arxivId ? 'arXiv' : 'PDF'}</div>
        <div className="paper-meta">
          <div className="paper-title" title={paper.title || el.content.title || url}>
            {el.content.title || paper.title || hostOf(url)}
          </div>
          {byline && <div className="paper-byline">{byline}</div>}
        </div>
        <div className="paper-actions">
          {paper.abstract && (
            <button className={showAbstract ? 'on' : ''} onClick={() => setShowAbstract(!showAbstract)} title={tr('초록 보기', 'Show abstract')}>
              {tr('초록', 'Abstract')}
            </button>
          )}
          {pdfUrl && (
            <a href={pdfUrl} download={fileName} title={tr('PDF 내려받기', 'Download PDF')}>
              <Icon name="download" size={15} />
            </a>
          )}
          <a href={url} target="_blank" rel="noopener noreferrer" title={tr('원본 페이지 열기', 'Open original page')}>
            <Icon name="external" size={15} />
          </a>
        </div>
      </div>
      {showAbstract && <div className="paper-abstract">{paper.abstract}</div>}
      <Suspense fallback={<div className="paper-scroll"><div className="paper-loading">{tr('PDF 뷰어 불러오는 중…', 'Loading PDF viewer…')}</div></div>}>
      <PaperViewer
        blobKey={paper.blobKey}
        zoom={zoom}
        onPages={(n) => {
          if (paper.pages !== n) commit((m) => update(m, el.id, { content: { paper: { ...paper, pages: n } } }));
        }}
      />
      </Suspense>
    </div>
  );
}

/* ---------- File ---------- */

function FileBody({ el }: { el: El }) {
  const url = useBlobUrl(el.content.blobKey);
  const name = el.content.fileName ?? tr('파일', 'File');
  const ext = name.includes('.') ? name.split('.').pop()!.slice(0, 4).toUpperCase() : 'FILE';
  return (
    <div className="card file-card">
      <div className="file-ext">{ext}</div>
      <div className="link-main">
        <div className="link-title" title={name}>
          {name}
        </div>
        <div className="link-url">{formatBytes(el.content.fileSize)}</div>
      </div>
      {url && (
        <a className="link-open" href={url} download={name} title={tr('내려받기', 'Download')}>
          <Icon name="download" size={15} />
        </a>
      )}
      <LabelRow el={el} />
    </div>
  );
}

/* ---------- Colour swatch ---------- */

function SwatchBody({ el, editing }: { el: El; editing: boolean }) {
  const edit = useEdit(el);
  const { setEditingId } = useBoard();
  const hex = el.content.hex ?? '#cccccc';
  return (
    <div className="card swatch">
      <div className="swatch-color" style={{ background: hex }}>
        {editing && <input type="color" value={hex} onChange={(e) => edit({ hex: e.target.value })} />}
      </div>
      {editing ? (
        <input
          className="swatch-name"
          value={el.content.name ?? ''}
          placeholder={tr('이름', 'Name')}
          onChange={(e) => edit({ name: e.target.value })}
          onKeyDown={(e) => onEnterFinish(e, () => setEditingId(null))}
        />
      ) : (
        <div className="swatch-meta">
          {el.content.name && <div className="swatch-name">{el.content.name}</div>}
          <div className="muted">{hex.toUpperCase()}</div>
        </div>
      )}
      <LabelRow el={el} />
    </div>
  );
}

/* ---------- Board ---------- */

function BoardBody({ el, editing }: { el: El; editing: boolean }) {
  const { els, setEditingId } = useBoard();
  const edit = useEdit(el);
  // A shortcut shows how much the board it points to holds.
  const count = canvasItems(els, el.boardRef && els[el.boardRef] ? el.boardRef : el.id).filter((e) => !isHidden(els, e.id)).length;
  return (
    <div className="board-card">
      <div className="board-icon">{el.content.icon || BOARD_ICONS[0]}</div>
      {editing ? (
        <input
          className="board-title"
          value={el.content.title ?? ''}
          placeholder={tr('보드 이름', 'Board name')}
          onChange={(e) => edit({ title: e.target.value })}
          onKeyDown={(e) => onEnterFinish(e, () => setEditingId(null))}
        />
      ) : (
        <>
          <div className="board-title">{el.content.title || tr('제목 없는 보드', 'Untitled board')}</div>
          <div className="muted small">{tr(`${count}개 항목`, `${count} items`)}</div>
        </>
      )}
    </div>
  );
}

/* ---------- Column ---------- */

function ColumnBody({ el, editing, placement }: { el: El; editing: boolean; placement: Placement }) {
  const { els, dropTarget, drag, setEditingId } = useBoard();
  const edit = useEdit(el);
  const kids = attachedOf(els, el.id);
  const indicatorAt = dropTarget?.kind === 'column' && dropTarget.id === el.id ? dropTarget.index : -1;
  const rows: ReactNode[] = [];
  let n = 0;
  for (const k of kids) {
    const isDragged = !!drag?.ids.has(k.id);
    if (!isDragged && n === indicatorAt) rows.push(<div key="drop" className="drop-line" />);
    rows.push(<ElementView key={k.id} el={k} placement={placement === 'ghost' ? 'ghost' : 'attached'} />);
    if (!isDragged) n++;
  }
  if (indicatorAt >= n) rows.push(<div key="drop" className="drop-line" />);

  return (
    <div className="column">
      <div className="column-header">
        {editing ? (
          <input
            value={el.content.title ?? ''}
            placeholder={tr('컬럼 제목', 'Column title')}
            onChange={(e) => edit({ title: e.target.value })}
            onKeyDown={(e) => onEnterFinish(e, () => setEditingId(null))}
          />
        ) : (
          <span className={el.content.title ? '' : 'muted'}>{el.content.title || tr('제목 없음', 'Untitled')}</span>
        )}
        <span className="count">{kids.length}</span>
      </div>
      <ColumnScroll>
        {kids.length === 0 && indicatorAt < 0 && <div className="column-empty">{tr('카드를 여기로 끌어다 놓으세요', 'Drop cards here')}</div>}
        {rows}
      </ColumnScroll>
      <LabelRow el={el} />
    </div>
  );
}

/** How long the scroll bar stays after the column was last scrolled or the pointer left it. */
const SCROLLBAR_LINGER_MS = 1200;

/**
 * A column's cards, or a to-do list's tasks. With a set height they scroll inside it: a slim
 * scroll bar shows while the pointer is over it (or just after scrolling) and fades away otherwise,
 * and a soft gradient at the bottom (and top) says there is more out of sight.
 */
function ColumnScroll({ children, bodyClass = 'column-body' }: { children: ReactNode; bodyClass?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // `off`: where the scrolling area starts inside the frame (it may reach out past the cards).
  const [m, setM] = useState({ top: 0, view: 0, full: 0, off: 0 });
  const [awake, setAwake] = useState(false);
  const sleep = useRef<number | undefined>(undefined);

  /** Whether the list was scrolled to its end (then growing text keeps it there). */
  const atEnd = useRef(true);
  const lastFull = useRef(0);
  const read = useCallback(() => {
    const n = ref.current;
    if (!n) return;
    // Something being typed at the end grew (a new line, a wrapped line): follow it down.
    const grew = n.scrollHeight > lastFull.current;
    if (grew && atEnd.current && n.scrollHeight > n.clientHeight && n.contains(document.activeElement)) n.scrollTop = n.scrollHeight;
    lastFull.current = n.scrollHeight;
    atEnd.current = n.scrollTop + n.clientHeight >= n.scrollHeight - 4;
    const next = { top: n.scrollTop, view: n.clientHeight, full: n.scrollHeight, off: n.offsetTop };
    setM((cur) => (cur.top === next.top && cur.view === next.view && cur.full === next.full && cur.off === next.off ? cur : next));
  }, []);
  const wake = (linger: boolean) => {
    window.clearTimeout(sleep.current);
    setAwake(true);
    if (linger) sleep.current = window.setTimeout(() => setAwake(false), SCROLLBAR_LINGER_MS);
  };
  useLayoutEffect(read);
  useEffect(() => {
    const n = ref.current;
    if (!n || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(n);
    for (const c of Array.from(n.children)) ro.observe(c);
    // Cards inside a column grow too while one is typed in.
    for (const c of Array.from(n.querySelectorAll(':scope > [data-el-id], :scope > ul > li'))) ro.observe(c);
    return () => ro.disconnect();
  });
  useEffect(() => () => window.clearTimeout(sleep.current), []);

  const scrollable = m.full > m.view + 1;
  const thumbH = scrollable ? Math.max(24, (m.view / m.full) * m.view) : 0;
  const thumbTop = scrollable ? (m.top / (m.full - m.view)) * (m.view - thumbH) : 0;

  /** Dragging the thumb scrolls the column. */
  const dragThumb = (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const n = ref.current;
    if (!n) return;
    const y0 = e.clientY;
    const top0 = n.scrollTop;
    const ratio = (m.full - m.view) / Math.max(1, m.view - thumbH);
    const move = (ev: PointerEvent) => {
      n.scrollTop = top0 + (ev.clientY - y0) * ratio;
      wake(false);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      wake(true);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div
      className={['column-scroll', scrollable && 'scrollable', awake && 'awake', scrollable && m.top > 1 && 'cut-top', scrollable && m.top + m.view < m.full - 1 && 'cut-bottom'].filter(Boolean).join(' ')}
      onPointerEnter={() => wake(false)}
      onPointerLeave={() => wake(true)}
    >
      <div
        ref={ref}
        className={bodyClass}
        data-column-scroll={scrollable ? 'true' : undefined}
        onScroll={() => {
          read();
          wake(true);
        }}
        onInput={() =>
          // What is being typed stays in view: when it grows past the bottom, the list follows.
          requestAnimationFrame(() => {
            const n = ref.current;
            const at = document.activeElement as HTMLElement | null;
            if (!n || !at || !n.contains(at)) return;
            const sel = window.getSelection();
            const caret = at instanceof HTMLTextAreaElement || at instanceof HTMLInputElement || !sel?.rangeCount ? null : sel.getRangeAt(0).getBoundingClientRect();
            const bottom = caret && caret.height ? caret.bottom : at.getBoundingClientRect().bottom;
            const over = bottom - n.getBoundingClientRect().bottom;
            if (over > 0) n.scrollTop += over / scaleOf(n) + 4;
          })
        }
      >
        {children}
      </div>
      {scrollable && m.top > 1 && <div className="column-fade top" aria-hidden="true" />}
      {scrollable && m.top + m.view < m.full - 1 && <div className="column-fade bottom" data-more-below aria-hidden="true" />}
      {scrollable && (
        <div className="column-thumb" data-column-thumb style={{ top: m.off + thumbTop, height: thumbH }} onPointerDown={dragThumb} />
      )}
    </div>
  );
}

/* ---------- Resize ---------- */

/**
 * Bottom-right handle. Resizes every selected element together when this one is selected,
 * fixes the height of notes, to-dos and swatches, keeps the aspect ratio with Shift,
 * cancels with Escape and restores the automatic size on double-click.
 */
function ResizeHandle({ el }: { el: El }) {
  const { commit, zoom, selection, els } = useBoard();

  const targetsFor = () =>
    (selection.has(el.id) && selection.size > 1 ? [...selection] : [el.id]).filter(
      (id) => els[id] && els[id].loc.section === 'CANVAS' && !els[id].locked && RESIZABLE.has(els[id].type),
    );

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const ids = targetsFor();
    const start = new Map(
      ids.map((id) => {
        const node = document.querySelector<HTMLElement>(`.layer > [data-el-id="${id}"], .layer > .el-stack > [data-el-id="${id}"]`);
        const h = node ? node.getBoundingClientRect().height / zoom : 100;
        const table = els[id].type === 'TABLE' ? node?.querySelector<HTMLElement>('table.grid') : null;
        const sheet = table
          ? {
              cols: Array.from(table.querySelectorAll<HTMLElement>('tr:first-child > *')).map((c) => c.offsetWidth),
              rows: Array.from(table.querySelectorAll<HTMLElement>('tr')).map((r) => r.offsetHeight),
              h: table.offsetHeight,
              colW: els[id].content.colW,
              rowH: els[id].content.rowH,
            }
          : undefined;
        return [id, { w: els[id].width, h, fixed: els[id].height, sheet }] as const;
      }),
    );
    const sx = e.clientX;
    const sy = e.clientY;
    const key = 'resize:' + el.id + ':' + Date.now();
    let moved = false;
    let touchedHeight = false;
    let last = { x: sx, y: sy, shift: e.shiftKey };

    const apply = () => {
      const dx = (last.x - sx) / zoom;
      const dy = (last.y - sy) / zoom;
      if (Math.abs(dy) > 4) touchedHeight = true;
      commit((m) => {
        for (const id of ids) {
          const s0 = start.get(id)!;
          const type = m[id].type;
          const minW = MIN_WIDTH[type] ?? 100;
          const canH = canResizeHeight(m[id]);
          if (s0.sheet) {
            const t = s0.sheet;
            const tw = t.cols.reduce((a, b) => a + b, 0);
            let kx = Math.max(0.1, (tw + dx) / tw);
            let ky = Math.max(0.1, (t.h + dy) / t.h);
            if (last.shift) kx = ky = Math.max(kx, ky);
            const colW = t.cols.map((c) => Math.max(36, Math.round(c * kx)));
            const rowH = touchedHeight || last.shift ? t.rows.map((r) => Math.max(24, Math.round(r * ky))) : t.rowH;
            update(m, id, { width: colW.reduce((a, b) => a + b, 0), content: { colW, rowH } });
            continue;
          }
          let w = s0.w + dx;
          let h = s0.h + dy;
          if (last.shift && canH) {
            const k = Math.max(w / s0.w, h / s0.h);
            w = s0.w * k;
            h = s0.h * k;
          }
          const patch: { width: number; height?: number } = {
            width: Math.round(Math.min(900, Math.max(minW, w))),
          };
          if (canH && (touchedHeight || s0.fixed !== undefined)) patch.height = Math.round(Math.min(2000, Math.max(40, h)));
          update(m, id, patch);
          // A note sized by hand keeps that size: its formulas are not fitted again until they change.
          if (type === 'CARD') update(m, id, { content: { mathFit: formulasOf(m[id].content.html ?? '') } });
        }
      }, key);
    };
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 2) return;
      moved = true;
      last = { x: ev.clientX, y: ev.clientY, shift: ev.shiftKey };
      apply();
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Shift' && moved) {
        last = { ...last, shift: ev.type === 'keydown' };
        apply();
      }
      if (ev.key === 'Escape' && ev.type === 'keydown') {
        ev.stopPropagation();
        if (moved)
          commit((m) => {
            for (const id of ids) {
              const s0 = start.get(id)!;
              update(m, id, { width: s0.w, height: s0.fixed });
              if (s0.sheet) update(m, id, { content: { colW: s0.sheet.colW, rowH: s0.sheet.rowH } });
            }
          }, key);
        stop();
      }
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
  };

  /**
   * The height at which a column or to-do list shows all it holds, at its current width: its frame
   * plus everything inside its scroll area.
   */
  const fitHeight = (id: string) => {
    const node = document.querySelector<HTMLElement>(`.layer > [data-el-id="${id}"], .layer > .el-stack > [data-el-id="${id}"]`);
    const body = node?.querySelector<HTMLElement>('.column-body, .tasks-scroll');
    if (!node || !body) return null;
    const cs = getComputedStyle(body);
    const kids = Array.from(body.children) as HTMLElement[];
    const content = kids.length
      ? Math.max(...kids.map((k) => k.offsetTop + k.offsetHeight)) - body.offsetTop + parseFloat(cs.paddingBottom)
      : parseFloat(cs.minHeight) || 0;
    return Math.ceil(node.offsetHeight - body.clientHeight + content);
  };

  const onDoubleClick = (e: ReactMouseEvent) => {
    e.stopPropagation();
    const ids = targetsFor();
    // Columns and to-do lists keep their width and take just the height that shows everything.
    const fits = Object.fromEntries(
      ids.filter((id) => els[id].type === 'COLUMN' || els[id].type === 'TASK_LIST').map((id) => [id, fitHeight(id)] as const),
    );
    const mathWidths: Record<string, number> = {};
    for (const id of ids) {
      if (els[id].type !== 'CARD') continue;
      const node = document.querySelector<HTMLElement>(`.layer > [data-el-id="${id}"], .layer > .el-stack > [data-el-id="${id}"], [data-el-id="${id}"]`);
      const view = node?.querySelector<HTMLElement>('.card-text');
      if (!node || !view || !view.querySelector('.katex')) continue;
      const pad = node.offsetWidth - textWidth(view);
      mathWidths[id] = Math.max(DEFAULT_WIDTH.CARD ?? 240, Math.ceil(widestFormula(view) + pad + 4));
    }
    commit((m) => {
      for (const id of ids) {
        if (id in fits) {
          update(m, id, { height: fits[id] ?? undefined });
          continue;
        }
        if (m[id].type === 'CARD') {
          // A note grows (or shrinks) to show all of its text; one with formulas also takes the
          // width that shows the widest of them whole (never narrower than a new note).
          update(m, id, mathWidths[id] ? { width: mathWidths[id], height: undefined } : { height: undefined });
          continue;
        }
        update(m, id, { width: DEFAULT_WIDTH[m[id].type], height: undefined });
        if (m[id].type === 'TABLE') update(m, id, { content: { colW: undefined, rowH: undefined } });
      }
    });
  };

  return (
    <div
      className="resize-handle"
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      title={
        el.type === 'COLUMN' || el.type === 'TASK_LIST'
          ? tr('끌어서 크기 조절 · Esc: 취소 · 더블클릭: 내용이 다 보이는 높이', 'Drag to resize · Esc: cancel · Double-click: fit height to content')
          : tr('끌어서 크기 조절 · Shift: 비율 유지 · Esc: 취소 · 더블클릭: 원래 크기', 'Drag to resize · Shift: keep ratio · Esc: cancel · Double-click: original size')
      }
    />
  );
}
