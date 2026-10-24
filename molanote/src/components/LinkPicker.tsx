import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { El, ElMap } from '../types';
import { ROOT_ID } from '../types';
import { elTitle } from '../model';
import { findBlocks, NEW_NOTE_NAME, scopeCommands, scopeName, searchScope, SEARCH_KINDS, setPickedAlias } from '../blockLinks';
import { topBoards } from '../recent';
import { ImageThumb, usePointerPick } from './ImageThumb';
import type { Picked, SearchScope } from '../blockLinks';
import { tr } from '../i18n';
import { Icon } from './Icon';

const TYPE_ICON: Partial<Record<El['type'], string>> = {
  CARD: 'note',
  TASK_LIST: 'todo',
  BOARD: 'board',
  IMAGE: 'image',
  TABLE: 'table',
  COLUMN: 'column',
  LINK: 'link',
  FILE: 'file',
  COLOR_SWATCH: 'swatch',
  SKETCH: 'pen',
  DIAGRAM: 'diagram',
};

/**
 * Picks the block a [[ ]] link goes to: a search box at the top middle of the screen (like a web
 * search page), the same search as the search panel (\note, \todo… and a space narrow it).
 * ↑↓ move, Enter takes the highlighted one, Escape closes it without a link.
 */
export function LinkPicker({ els, onPick, boards, onClose }: { els: ElMap; onPick: (p: Picked) => void; boards?: boolean; onClose?: () => void }) {
  const [q, setQ] = useState('');
  // Ctrl+O: only boards, to go to one.
  const [scope, setScope] = useState<SearchScope>(boards ? 'BOARD' : null);
  const [at, setAt] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  const typingCommand = !scope && q.startsWith('\\');
  const commands = typingCommand ? scopeCommands(q.slice(1)) : [];
  // [[name|alias]]: what is typed after a | is what the link shows (not searched for).
  const bar = boards ? -1 : q.indexOf('|');
  const query = bar >= 0 ? q.slice(0, bar) : q;
  const alias = bar >= 0 ? q.slice(bar + 1).trim() : '';
  // Ctrl+O with nothing typed: the boards gone to most, first.
  const often = useMemo(() => (boards && !query.trim() ? topBoards(els) : []), [boards, els, query]);
  const found = useMemo(() => {
    if (typingCommand) return [];
    const all = findBlocks(els, query, scope);
    if (!often.length) return all.slice(0, 40);
    const first = new Set(often.map((b) => b.id));
    return [...often, ...all.filter((b) => !first.has(b.id))].slice(0, 40);
  }, [els, query, scope, typingCommand, often]);
  // After the blocks found: a row for a link to a new note of the name typed (not when going to a board).
  const count = typingCommand ? commands.length : found.length + (boards ? 0 : 1);
  const name = () => query.trim() || NEW_NOTE_NAME();
  const unresolved = () => (boards ? onClose?.() : onPick({ name: name() }));

  useEffect(() => setAt(0), [query, scope]);
  const hover = usePointerPick(setAt);
  /** The row picked, for an image's thumbnail beside it. */
  const [row, setRow] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => setRow(listRef.current?.querySelector<HTMLElement>('.lp-item.on') ?? null), [at, found]);
  useEffect(() => {
    listRef.current?.querySelector('.lp-item.on')?.scrollIntoView({ block: 'nearest' });
  }, [at]);

  const onType = (value: string) => {
    const m = /^\\(\S+)\s(.*)$/s.exec(value);
    const sc = m && searchScope(m[1]);
    if (m && sc) {
      setScope(sc);
      setQ(m[2]);
      return;
    }
    setQ(value);
  };

  const choose = (i: number) => {
    if (typingCommand) {
      const c = commands[i];
      if (c) onType(`\\${c.word} `);
      return;
    }
    const el = found[i];
    setPickedAlias(alias);
    if (el) onPick(el);
    else if (!boards) unresolved();
  };

  /** Where the block is, all the way from Home: 홈 › 보드 › 그 안의 보드 › 컬럼 (or › Unsorted). */
  const where = (el: El) => {
    const parts: string[] = [];
    let child: El = el;
    let cur = els[el.loc.parentId];
    for (let guard = 0; cur && guard < 100; guard++) {
      if (child.loc.section === 'INBOX') parts.unshift('Unsorted');
      if (cur.type === 'BOARD') parts.unshift(cur.id === ROOT_ID ? tr('홈', 'Home') : cur.content.title || tr('제목 없는 보드', 'Untitled board'));
      else if (cur.type === 'COLUMN') parts.unshift(cur.content.title || tr('컬럼', 'Column'));
      if (cur.id === ROOT_ID) break;
      child = cur;
      cur = els[cur.loc.parentId];
    }
    return parts.join(' › ') || tr('홈', 'Home');
  };

  return createPortal(
    <div className="lp-backdrop" onPointerDown={(e) => e.target === e.currentTarget && unresolved()}>
      <div className="lp" role="dialog" aria-label={boards ? tr('보드로 이동', 'Go to a board') : tr('블록 링크', 'Link to a block')} data-link-picker={boards ? 'boards' : ''}>
        <div className="lp-box">
          <Icon name="search" size={18} />
          {scope && !boards && (
            <button className="search-chip" data-search-scope={scope} onClick={() => setScope(null)} title={tr('범위 지우기', 'Clear scope')}>
              {scopeName(scope)} <span aria-hidden="true">×</span>
            </button>
          )}
          <input
            ref={inputRef}
            value={q}
            placeholder={
              boards
                ? tr('이동할 보드 찾기', 'Find a board to go to')
                : scope
                  ? tr('이 범위에서 링크할 블록 찾기 (| 뒤에 표시할 이름)', 'Find a block here (| then the name to show)')
                  : tr('링크할 블록 찾기 (\\로 범위, | 뒤에 표시할 이름)', 'Find a block to link (\\ for scope, | then the name to show)')
            }
            onChange={(e) => onType(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.nativeEvent.isComposing) return;
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setAt((i) => Math.min(count - 1, i + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setAt((i) => Math.max(0, i - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                choose(at);
              } else if (e.key === 'Escape') {
                // Closed without a pick: an unresolved link (a new note when it is pressed).
                e.preventDefault();
                unresolved();
              } else if (e.key === 'Backspace' && !q && scope && !boards) setScope(null);
            }}
          />
          <kbd className="lp-key">Esc</kbd>
        </div>
        {alias && (
          <div className="lp-alias" data-link-alias>
            {tr('링크에 보일 이름', 'The link will say')}: <b>{alias}</b>
          </div>
        )}
        <div className="lp-list" ref={listRef}>
          {typingCommand &&
            commands.map((c, i) => (
              <button key={c.word} className={i === at ? 'lp-item on' : 'lp-item'} onPointerMove={hover(i)} onClick={() => choose(i)}>
                <code>\{c.word}</code> <span className="muted small">{c.name}</span>
              </button>
            ))}
          {!typingCommand &&
            found.map((el, i) => [
              often.length > 0 && i === 0 && (
                <div key="often" className="lp-head" data-often-head>
                  {tr('자주 방문한 보드', 'Boards you go to often')}
                </div>
              ),
              often.length > 0 && i === often.length && (
                <div key="all" className="lp-head">
                  {tr('모든 보드', 'All boards')}
                </div>
              ),
              <button key={el.id} className={i === at ? 'lp-item on' : 'lp-item'} data-pick-id={el.id} data-often={i < often.length ? 'true' : undefined} onPointerMove={hover(i)} onClick={() => choose(i)}>
                <span className="lp-icon">
                  <Icon name={TYPE_ICON[el.type] ?? 'note'} size={15} />
                </span>
                <span className="lp-text">
                  <span className="lp-title">
                    {(el.linkOf || el.boardRef) && (
                      <span className={el.boardRef ? 'copy-mark shortcut' : 'copy-mark'} data-copy-mark title={el.boardRef ? tr('보드 바로가기', 'Board shortcut') : tr('링크된 복사본', 'Linked copy')}>
                        <Icon name={el.boardRef ? 'external' : 'exchange'} size={11} />
                      </span>
                    )}
                    {elTitle(el) || SEARCH_KINDS.find((k) => k.type === el.type)?.name}
                  </span>
                  <span className="muted small lp-where" data-pick-where title={where(el)}>
                    {where(el)}
                  </span>
                </span>
              </button>,
            ])}
          {!typingCommand && !boards && (
            <button className={at === found.length ? 'lp-item on lp-new' : 'lp-item lp-new'} data-pick-new onPointerMove={hover(found.length)} onClick={unresolved}>
              <span className="lp-icon">
                <Icon name="plus" size={15} />
              </span>
              <span className="lp-text">
                <span className="lp-title">{tr(`새 노트로 링크: ${name()}`, `Link to a new note: ${name()}`)}</span>
                <span className="muted small">{tr('누르면 그 이름의 노트가 만들어집니다', 'Pressing the link makes a note of that name')}</span>
              </span>
            </button>
          )}
        </div>
      </div>
      <ImageThumb el={found[at] ?? null} anchor={row} side="right" />
    </div>,
    document.body,
  );
}
