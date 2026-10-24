import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import { OPEN_MATH_EVENT } from './MathEditor';
import { applyBlock, listItemTo, sublistsFollow } from './NoteMarkdown';
import type { NoteBlock } from './NoteMarkdown';
import { caretAfterLink, looksLikeUrl } from './LinkEdit';
import { normalizeUrl } from '../actions';
import { tr } from '../i18n';

export const TEXT_COLORS = ['#22252a', '#e03131', '#f08c00', '#2f9e44', '#1971c2', '#7048e8', '#c2255c', '#868e96'];
export const HIGHLIGHTS = ['#fff3a3', '#ffd8a8', '#ffc9c9', '#d3f9d8', '#d0ebff', '#e5dbff', '#f1f3f5'];

/** Event a note editor sends on Ctrl+H so the left bar opens its outside-link bubble. */
export const OPEN_LINK_EVENT = 'board-open-link';

/**
 * Wraps the selected text in <code>, or unwraps it when the selection or caret is inside inline
 * code (Ctrl+E). The result stays selected, so pressing Ctrl+E again toggles it back.
 */
export function toggleInlineCode(editor: HTMLElement) {
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  const start = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
  const code = start?.closest('code');
  const selectAll = (node: Node) => {
    const r = document.createRange();
    r.selectNodeContents(node);
    sel.removeAllRanges();
    sel.addRange(r);
  };
  if (code && editor.contains(code)) {
    const text = document.createTextNode(code.textContent ?? '');
    code.replaceWith(text);
    selectAll(text);
  } else {
    if (range.collapsed) return;
    const wrap = document.createElement('code');
    wrap.textContent = range.toString();
    range.deleteContents();
    range.insertNode(wrap);
    selectAll(wrap);
  }
  editor.dispatchEvent(new Event('input', { bubbles: true }));
}


/**
 * Ctrl+H: an outside link on the text picked. A web address on the clipboard goes on it at once;
 * otherwise (or with nothing picked) the left bar's outside-link bubble opens to paste one.
 */
function outsideLink(editor: HTMLElement) {
  const sel = window.getSelection();
  const range = sel?.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
  const open = () => window.dispatchEvent(new CustomEvent(OPEN_LINK_EVENT));
  if (!range || range.collapsed || !editor.contains(range.commonAncestorContainer) || !navigator.clipboard?.readText) return open();
  navigator.clipboard
    .readText()
    .then((text) => {
      const url = text.trim();
      if (!looksLikeUrl(url)) return open();
      editor.focus({ preventScroll: true });
      sel?.removeAllRanges();
      sel?.addRange(range);
      document.execCommand('createLink', false, normalizeUrl(url));
      // The caret right after the link (so Backspace opens it, and typing goes on outside it).
      caretAfterLink(editor);
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    })
    .catch(open);
}

/**
 * Keyboard shortcuts of a note editor that the browser does not provide by itself.
 * Returns true when the key was handled.
 */
export function noteShortcut(e: KeyboardEvent | ReactKeyboardEvent, editor: HTMLElement): boolean {
  const mod = e.ctrlKey || e.metaKey;
  if (!mod) return false;
  const k = e.key.toLowerCase();
  const block = (tag: string) => document.execCommand('formatBlock', false, tag);
  if (!e.shiftKey && !e.altKey && k === 'e') toggleInlineCode(editor);
  else if (!e.shiftKey && !e.altKey && (k === 'h' || e.code === 'KeyH')) outsideLink(editor);
  // Ctrl+K puts a copied block link (handled before this); with none copied it does nothing (not the browser's search).
  else if (!e.shiftKey && !e.altKey && k === 'k') return e.preventDefault(), true;
  else if (e.altKey && e.code === 'Digit1') block('h1');
  else if (e.altKey && e.code === 'Digit2') block('h2');
  else if (e.altKey && e.code === 'Digit3') block('h3');
  else if (e.altKey && e.code === 'Digit0') block('div');
  else if (e.shiftKey && e.code === 'Digit8') listItemTo(editor, 'ul') || (document.execCommand('insertUnorderedList'), sublistsFollow(editor));
  else if (e.shiftKey && e.code === 'Digit7') listItemTo(editor, 'ol') || (document.execCommand('insertOrderedList'), sublistsFollow(editor));
  else if (e.shiftKey && e.code === 'Digit9') block('blockquote');
  else return false;
  e.preventDefault();
  return true;
}

type Option =
  | 'style'
  | 'highlight'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strike'
  | 'code'
  | 'link'
  | 'h1'
  | 'h2'
  | 'paragraph'
  | 'bullets'
  | 'numbers'
  | 'quote'
  | 'h3'
  | 'checklist'
  | 'toggle'
  | 'codeBlock'
  | 'divider'
  | 'shortcuts'
  | 'math';

interface OptionDef {
  o: Option;
  name: string;
  keys: string;
  icon: IconName;
  /** Shown under the icon; the others show their name only in the hover bubble. */
  label?: boolean;
  flyout?: boolean;
  command?: [string, string?];
  /** Command state that marks the button as on. */
  state?: string;
  /** A second shortcut, typed at the start of a line (e.g. #+Space), shown beside the first. */
  md?: string;
  /** A block built like its typing shortcut builds it. */
  block?: NoteBlock;
}

const GROUPS: OptionDef[][] = [
  [{ o: 'style', name: tr('글자 색상', 'Text color'), keys: '', icon: 'textColor', label: true, flyout: true }],
  [
    { o: 'bold', name: tr('굵게', 'Bold'), keys: 'Ctrl+B', icon: 'bold', command: ['bold'], state: 'bold' },
    { o: 'italic', name: tr('기울임', 'Italic'), keys: 'Ctrl+I', icon: 'italic', command: ['italic'], state: 'italic' },
    { o: 'underline', name: tr('밑줄', 'Underline'), keys: 'Ctrl+U', icon: 'underline', command: ['underline'], state: 'underline' },
    { o: 'strike', name: tr('취소선', 'Strikethrough'), keys: '~~글자~~', icon: 'strike', command: ['strikeThrough'], state: 'strikeThrough' },
    { o: 'highlight', name: tr('형광펜', 'Highlight'), keys: '==글자==', icon: 'highlighter', flyout: true },
    { o: 'code', name: tr('인라인 코드', 'Inline code'), keys: 'Ctrl+E', icon: 'code' },
    { o: 'link', name: tr('외부 링크', 'Outside link'), keys: 'Ctrl+H', icon: 'link', flyout: true },
    { o: 'math', name: tr('수식', 'Formula'), keys: 'Ctrl+M', md: '$…$', icon: 'math' },
  ],
  [
    { o: 'h1', name: tr('제목 1', 'Heading 1'), keys: 'Ctrl+Alt+1', md: '#+Space', icon: 'h1', command: ['formatBlock', 'h1'] },
    { o: 'h2', name: tr('제목 2', 'Heading 2'), keys: 'Ctrl+Alt+2', md: '##+Space', icon: 'h2', command: ['formatBlock', 'h2'] },
    { o: 'h3', name: tr('제목 3', 'Heading 3'), keys: 'Ctrl+Alt+3', md: '###+Space', icon: 'h3', command: ['formatBlock', 'h3'] },
    { o: 'paragraph', name: tr('본문', 'Body text'), keys: 'Ctrl+Alt+0', md: 'Backspace', icon: 'paragraph', command: ['formatBlock', 'div'] },
    { o: 'bullets', name: tr('글머리 기호 목록', 'Bulleted list'), keys: 'Ctrl+Shift+8', md: '-+Space', icon: 'listBullet', command: ['insertUnorderedList'], state: 'insertUnorderedList' },
    { o: 'numbers', name: tr('번호 목록', 'Numbered list'), keys: 'Ctrl+Shift+7', md: '1.+Space', icon: 'listNumber', command: ['insertOrderedList'], state: 'insertOrderedList' },
    { o: 'checklist', name: tr('할 일 목록', 'To-do list'), keys: '[]+Space', icon: 'checklist', block: 'checklist' },
    { o: 'toggle', name: tr('토글 목록', 'Toggle list'), keys: '>+Space', md: '#>+Space', icon: 'toggle', block: 'toggle' },
    { o: 'quote', name: tr('인용', 'Quote'), keys: 'Ctrl+Shift+9', md: '"+Space', icon: 'quote', command: ['formatBlock', 'blockquote'] },
    { o: 'codeBlock', name: tr('코드 블록', 'Code block'), keys: '```', icon: 'codeBlock', block: 'code' },
    { o: 'divider', name: tr('구분선', 'Divider'), keys: '---', icon: 'divider', block: 'divider' },
  ],
];
const ALL = GROUPS.flat();
/** At the foot of the bar, apart from the tools: every shortcut of the note editor. */
const SHORTCUTS_DEF: OptionDef = { o: 'shortcuts', name: tr('단축키 모음', 'Shortcuts'), keys: '', icon: 'keyboard', flyout: true };

/** Every shortcut of the note editor, shown by the 단축키 button. */
export const SHORTCUT_HELP: { title: string; rows: [string, string][] }[] = [
  {
    title: tr('줄 맨 앞에서 입력', 'Type at line start'),
    rows: [
      ['#+Space', tr('제목 1', 'Heading 1')],
      ['##+Space', tr('제목 2', 'Heading 2')],
      ['###+Space', tr('제목 3', 'Heading 3')],
      ['1.+Space', tr('번호 목록', 'Numbered list')],
      ['-+Space', tr('글머리 기호 목록', 'Bulleted list')],
      ['[]+Space', tr('할 일 목록', 'To-do list')],
      ['>+Space', tr('토글 목록', 'Toggle list')],
      ['#>+Space', tr('제목 토글 1 (##> 2, ###> 3)', 'Toggle heading 1 (##> 2, ###> 3)')],
      ['"+Space', tr('인용', 'Quote')],
      ['---', tr('구분선', 'Divider')],
      ['```', tr('코드 블록', 'Code block')],
      ['$…$', tr('수식 (줄 안) · $를 치면 짝으로', 'Formula (inline) · $ comes in pairs')],
      ['$$…$$', tr('수식 (가운데)', 'Formula (centered)')],
      ['[[', tr('다른 블록으로 가는 링크', 'Link to another block')],
      ['[이름](주소)', tr('외부 링크 (닫는 ")"를 치면 링크가 됨)', 'Outside link (made when the ")" is typed)')],
      ['( / [ / {', tr('괄호 짝 자동 완성 (빈 짝에서 Backspace: 둘 다 지움)', 'Brackets pair up (Backspace in an empty pair: both go)')],
      ['Backspace', tr('링크 바로 뒤: 이름·주소로 열어 고치기 · 한 번 더: 링크 지우기', 'Right after a link: open it as name and address · again: remove it')],
    ],
  },
  {
    title: tr('서식', 'Formatting'),
    rows: [
      ['Ctrl+B', tr('굵게', 'Bold')],
      ['Ctrl+I', tr('기울임', 'Italic')],
      ['Ctrl+U', tr('밑줄', 'Underline')],
      ['~~글자~~', tr('취소선 (~~ 짝 자동 완성 · 고른 글자에서 ~~ 또는 --)', 'Strikethrough (~~ pairs up · on picked text: ~~ or --)')],
      ['==글자==', tr('형광펜 (== 짝 자동 완성 · 고른 글자에서 ==)', 'Highlight (== pairs up · on picked text: ==)')],
      ['Ctrl+E', tr('인라인 코드', 'Inline code')],
      ['Ctrl+H', tr('외부 링크 (클립보드의 주소를 고른 글자에 걸기, 없으면 붙여넣는 창)', 'Outside link (the address on the clipboard on the text picked, or a box to paste one)')],
      ['Ctrl+M', tr('수식 편집기', 'Formula editor')],
      ['\\ + 글자', tr('수식 안에서 LaTeX 명령 추천 (↑↓ 고르기, Enter·Tab 넣기, Esc 닫기)', 'LaTeX command suggestions in a formula (↑↓ pick, Enter / Tab put in, Esc close)')],
      ['Ctrl+M+K / Ctrl+M+B / Ctrl+M+R', tr('글자 색: 검정 / 파랑 / 빨강 (Ctrl을 누른 채, 할 일에서도)', 'Text colour: black / blue / red (Ctrl held; in to-dos too)')],
      ['Ctrl+Alt+1', tr('제목 1', 'Heading 1')],
      ['Ctrl+Alt+2', tr('제목 2', 'Heading 2')],
      ['Ctrl+Alt+3', tr('제목 3', 'Heading 3')],
      ['Ctrl+Alt+0', tr('본문', 'Body text')],
      ['Ctrl+Shift+8', tr('글머리 기호 목록', 'Bulleted list')],
      ['Ctrl+Shift+7', tr('번호 목록', 'Numbered list')],
      ['Ctrl+Shift+9', tr('인용', 'Quote')],
    ],
  },
  {
    title: tr('토글과 블록', 'Toggles and blocks'),
    rows: [
      ['Enter', tr('토글 제목에서: 토글 안으로', 'On toggle title: into the toggle')],
      ['Enter', tr('토글의 빈 마지막 줄에서: 밖으로', 'On empty last line of toggle: out')],
      ['Tab', tr('들여쓰기 (글머리 목록은 한 단계 안으로, 글머리 모양이 바뀜 · 토글 바로 아래 줄은 토글 안으로)', 'Indent (a list item one level in, with another bullet · the line below a toggle goes into it)')],
      ['Shift+Tab', tr('내어쓰기 (토글 안이면 이 줄부터 토글 밖으로)', 'Outdent (in a toggle: from this line out of it)')],
      ['Backspace', tr('맨 앞에서: 보통 글로', 'At line start: to body text')],
      ['Ctrl+Enter', tr('코드 블록 밖으로', 'Exit code block')],
    ],
  },
  {
    title: tr('그 밖에', 'Other'),
    rows: [
      ['F2', tr('제목(Title) 칸으로', 'Go to Title field')],
      ['Esc', tr('편집 끝내기', 'Finish editing')],
      ['Ctrl+Z', tr('실행 취소', 'Undo')],
      ['Ctrl+Shift+Z', tr('다시 실행', 'Redo')],
    ],
  },
];
/** Height of the thin "more" card and its gap, as in the tool column. */
const MORE_H = 30;
/** Height the 단축키 list takes at most (it scrolls inside if the window is shorter). */
const SHORTCUTS_FLY_H = 640;

/**
 * Left-bar text tools while a note is being edited. Inline styles apply to the selected text;
 * headings, lists and quotes to the current paragraph. Hovering a tool shows its name and shortcut.
 */
export function TextBar({ editorId, onPin }: { editorId: string; onPin: (pinned: boolean) => void }) {
  const [flyout, setFlyout] = useState<{ o: Option; top: number; left: number } | null>(null);
  const [tip, setTip] = useState<{ def: OptionDef; top: number; left: number } | null>(null);
  const [url, setUrl] = useState('');
  const saved = useRef<Range | null>(null);
  const [, refresh] = useState(0);
  const barRef = useRef<HTMLDivElement>(null);
  const footRef = useRef<HTMLDivElement>(null);
  /** Where each tool's bottom edge sits in the bar when everything is shown (stays put as tools hide). */
  const bottoms = useRef<Record<string, number>>({});
  const [fit, setFit] = useState(ALL.length);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const moreFlyRef = useRef<HTMLDivElement>(null);
  const [morePos, setMorePos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const bar = barRef.current;
    const pane = bar?.parentElement;
    if (!bar || !pane) return;
    const measure = () => {
      const top0 = bar.getBoundingClientRect().top;
      const foot = footRef.current?.offsetHeight ?? 0;
      bar.querySelectorAll<HTMLElement>(':scope > .text-group [data-text-option]').forEach((b) => {
        bottoms.current[b.dataset.textOption!] = b.getBoundingClientRect().bottom - top0;
      });
      const cs = getComputedStyle(pane);
      const avail = pane.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - foot;
      const bottom = (i: number) => bottoms.current[ALL[i].o] ?? Infinity;
      if (bottom(ALL.length - 1) <= avail) return setFit(ALL.length);
      let k = 0;
      while (k < ALL.length && bottom(k) + MORE_H <= avail) k++;
      setFit(k);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(pane);
    return () => ro.disconnect();
  }, []);

  const hiddenTools = ALL.slice(fit);
  const moreShown = moreOpen && hiddenTools.length > 0;
  useLayoutEffect(() => {
    if (!moreShown) return setMorePos(null);
    const b = moreRef.current?.getBoundingClientRect();
    const f = moreFlyRef.current?.getBoundingClientRect();
    if (!b || !f) return;
    setMorePos({ left: b.right + 10, top: Math.max(8, Math.min(b.top - 8, innerHeight - f.height - 8)) });
  }, [moreShown, hiddenTools.length]);
  useEffect(() => {
    if (!moreShown) return;
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (moreFlyRef.current?.contains(t) || moreRef.current?.contains(t)) return;
      setMoreOpen(false);
    };
    // Escape closes the card only; the note stays in editing.
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      setMoreOpen(false);
      restore();
    };
    addEventListener('pointerdown', down, true);
    addEventListener('keydown', key, true);
    return () => {
      removeEventListener('pointerdown', down, true);
      removeEventListener('keydown', key, true);
    };
  }, [moreShown]); // eslint-disable-line react-hooks/exhaustive-deps

  const editor = () => document.querySelector<HTMLElement>(`[data-el-id="${editorId}"] .card-text.rich[contenteditable="true"]`);

  const remember = () => {
    const sel = document.getSelection();
    const ed = editor();
    if (ed && sel && sel.rangeCount && ed.contains(sel.anchorNode)) saved.current = sel.getRangeAt(0).cloneRange();
  };
  /** Puts the caret or selection back in the note (at the end if it was never there). */
  const restore = () => {
    const ed = editor();
    if (!ed) return null;
    ed.focus();
    const sel = document.getSelection();
    let range = saved.current;
    if (!range || !ed.contains(range.startContainer)) {
      range = document.createRange();
      range.selectNodeContents(ed);
      range.collapse(false);
    }
    sel?.removeAllRanges();
    sel?.addRange(range);
    return ed;
  };

  useEffect(() => {
    const onSel = () => {
      remember();
      refresh((n) => n + 1);
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openLinkAt = (button: Element | null) => {
    remember();
    const r = button?.getBoundingClientRect();
    setUrl('');
    setFlyout({ o: 'link', top: r?.top ?? 200, left: (r?.right ?? 80) + 8 });
  };

  useEffect(() => {
    const onOpen = () => openLinkAt(document.querySelector('.text-bar [data-text-option="link"]'));
    window.addEventListener(OPEN_LINK_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_LINK_EVENT, onOpen);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    onPin(!!flyout || moreShown);
    if (!flyout) return;
    const close = (e: Event) => {
      if (!(e.target as HTMLElement | null)?.closest?.('.ctx-flyout, .text-option')) setFlyout(null);
    };
    // Escape closes the bubble only; the note stays in editing with the same selection.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      setFlyout(null);
      restore();
    };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [flyout, onPin, moreShown]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onPin(false), [onPin]);

  const exec = (cmd: string, value?: string, css = false) => {
    const ed = restore();
    if (!ed) return;
    // A list item made another kind of list: it and its sub-items, not the browser's way.
    if ((cmd === 'insertOrderedList' || cmd === 'insertUnorderedList') && listItemTo(ed, cmd === 'insertOrderedList' ? 'ol' : 'ul')) {
      remember();
      return;
    }
    if (css) document.execCommand('styleWithCSS', false, 'true');
    document.execCommand(cmd, false, value);
    if (css) document.execCommand('styleWithCSS', false, 'false');
    // A list made another kind: its sub-items follow.
    if (cmd === 'insertOrderedList' || cmd === 'insertUnorderedList') sublistsFollow(ed);
    remember();
  };

  const isOn = (d: OptionDef) => {
    const ed = editor();
    const sel = document.getSelection();
    if (!ed || !sel?.anchorNode || !ed.contains(sel.anchorNode)) return false;
    try {
      if (d.state) return document.queryCommandState(d.state);
      if (d.o === 'h1' || d.o === 'h2' || d.o === 'h3' || d.o === 'quote') {
        const v = String(document.queryCommandValue('formatBlock')).toLowerCase();
        return v === (d.o === 'quote' ? 'blockquote' : d.o);
      }
      if (d.o === 'code') {
        const n = sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode.parentElement;
        return !!n?.closest('code');
      }
    } catch {
      return false;
    }
    return false;
  };

  const press = (d: OptionDef, e: ReactMouseEvent<HTMLButtonElement>) => {
    setTip(null);
    if (d.o === 'link') {
      if (flyout?.o === 'link') setFlyout(null);
      else openLinkAt(e.currentTarget);
      return;
    }
    if (d.flyout) {
      remember();
      const r = e.currentTarget.getBoundingClientRect();
      setFlyout((f) => (f?.o === d.o ? null : { o: d.o, top: r.top, left: r.right + 8 }));
      return;
    }
    setFlyout(null);
    if (d.o === 'math') {
      restore();
      window.dispatchEvent(new CustomEvent(OPEN_MATH_EVENT, { detail: editorId }));
      return;
    }
    if (d.block) {
      const ed = restore();
      if (ed) {
        applyBlock(ed, d.block);
        ed.dispatchEvent(new Event('input', { bubbles: true }));
      }
      remember();
      return;
    }
    if (d.o === 'code') {
      const ed = restore();
      if (ed) toggleInlineCode(ed);
      remember();
      return;
    }
    if (d.command) exec(d.command[0], d.command[1]);
  };

  const toolButton = (d: OptionDef, inMore = false) => (
    <button
      key={d.o}
      className={['tool', 'ctx-option', 'text-option', d.label ? 'labeled' : 'icon-only', isOn(d) && 'active', flyout?.o === d.o && 'open']
        .filter(Boolean)
        .join(' ')}
      data-text-option={d.o}
      aria-label={d.keys ? `${d.name} (${d.keys})` : d.name}
      onMouseDown={(e) => e.preventDefault()}
      onMouseEnter={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setTip({ def: d, top: r.top + r.height / 2, left: r.right + 8 });
      }}
      onMouseLeave={() => setTip(null)}
      onClick={(e) => {
        press(d, e);
        if (inMore && !d.flyout) setMoreOpen(false);
      }}
    >
      <span className="tool-icon">
        <Icon name={d.icon} size={d.label ? 22 : 19} />
      </span>
      {d.label && <span className="tool-label">{d.name}</span>}
    </button>
  );

  return (
    <div className="ctx-bar text-bar" ref={barRef}>
      {GROUPS.map((group, gi) => {
        const shown = group.filter((d) => ALL.indexOf(d) < fit);
        if (!shown.length) return null;
        return (
          <div key={gi} className={gi === 0 ? 'text-group first' : 'text-group'}>
            {shown.map((d) => toolButton(d))}
          </div>
        );
      })}
      {hiddenTools.length > 0 && (
        <button
          ref={moreRef}
          className={'tool-more' + (moreShown ? ' on' : '')}
          data-text-more
          aria-label={tr(`글자 도구 더보기 (${hiddenTools.length}개)`, `More text tools (${hiddenTools.length})`)}
          aria-expanded={moreShown}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            remember();
            setTip(null);
            setMoreOpen(!moreShown);
          }}
        >
          <Icon name="more" size={16} />
        </button>
      )}
      <div className="text-bar-foot" ref={footRef}>
        {toolButton(SHORTCUTS_DEF)}
      </div>
      {moreShown &&
        createPortal(
          <div
            ref={moreFlyRef}
            className="tool-more-fly text-more-fly"
            data-text-more-fly
            style={{
              left: morePos?.left ?? 0,
              top: morePos?.top ?? 0,
              visibility: morePos ? undefined : 'hidden',
              gridTemplateColumns: `repeat(${Math.max(1, Math.ceil(hiddenTools.length / 6))}, auto)`,
            }}
          >
            {hiddenTools.map((d) => toolButton(d, true))}
          </div>,
          document.body,
        )}
      {tip &&
        !flyout &&
        createPortal(
          <div className="tip-bubble" role="tooltip" style={{ top: tip.top, left: tip.left }}>
            <span>{tip.def.name}</span>
            {tip.def.keys && <kbd>{tip.def.keys}</kbd>}
            {tip.def.md && <kbd>{tip.def.md}</kbd>}
          </div>,
          document.body,
        )}
      {flyout &&
        createPortal(
          <div
            className="ctx-flyout text-flyout"
            data-flyout={flyout.o}
            style={{
              // The list opens upward from the button at the foot, kept inside the window.
              top: flyout.o === 'shortcuts' ? Math.max(8, window.innerHeight - 8 - SHORTCUTS_FLY_H) : Math.min(flyout.top, window.innerHeight - 260),
              left: flyout.left,
            }}
          >
            {flyout.o === 'shortcuts' ? (
              <div className="shortcut-help" data-shortcut-help>
                {SHORTCUT_HELP.map((g) => (
                  <section key={g.title}>
                    <div className="ctx-fly-sub">{g.title}</div>
                    <dl>
                      {g.rows.map(([k, v]) => (
                        <div key={k + v} className="shortcut-row">
                          <dt>
                            <kbd>{k}</kbd>
                          </dt>
                          <dd>{v}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                ))}
              </div>
            ) : flyout.o === 'style' || flyout.o === 'highlight' ? (
              <>
                {flyout.o === 'style' && <div className="ctx-fly-title">{tr('글자 색상', 'Text color')}</div>}
                {flyout.o === 'style' && (
                <>
                <div className="ctx-colors">
                  {TEXT_COLORS.map((c) => (
                    <button
                      key={c}
                      className="dot"
                      style={{ background: c }}
                      title={c}
                      data-text-color={c}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => exec('foreColor', c, true)}
                    />
                  ))}
                </div>
                </>
                )}
                {flyout.o === 'highlight' && (
                <>
                <div className="ctx-fly-title">{tr('형광펜', 'Highlight')}</div>
                <div className="ctx-colors">
                  <button
                    className="dot none"
                    title={tr('형광펜 없음', 'No highlight')}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => exec('hiliteColor', 'transparent', true)}
                  />
                  {HIGHLIGHTS.map((c) => (
                    <button
                      key={c}
                      className="dot"
                      style={{ background: c }}
                      title={c}
                      data-highlight={c}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => exec('hiliteColor', c, true)}
                    />
                  ))}
                </div>
                </>
                )}
              </>
            ) : (
              <>
                <div className="ctx-fly-title">{tr('외부 링크', 'Outside link')}</div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!url.trim()) return;
                    exec('createLink', normalizeUrl(url));
                    const ed = editor();
                    if (ed) {
                      caretAfterLink(ed);
                      remember();
                    }
                    setFlyout(null);
                  }}
                >
                  <input
                    className="ctx-input"
                    autoFocus
                    placeholder={tr('URL 붙여넣기', 'Paste URL')}
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                  />
                  <button className="ctx-wide" type="submit" disabled={!url.trim()}>
                    {tr('외부 링크 걸기', 'Add outside link')}
                  </button>
                </form>
              </>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

/** Kept for callers that check whether text is selected in a note editor. */
export function selectionEditor(): HTMLElement | null {
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const host = (sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode?.parentElement)?.closest<HTMLElement>(
    '.card-text.rich[contenteditable="true"]',
  );
  return host && host.contains(sel.focusNode) ? host : null;
}

export { ALL as TEXT_TOOLS };
