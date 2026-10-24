import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { El, ElMap } from '../types';
import { ROOT_ID } from '../types';
import { isHidden } from '../model';
import { Icon } from './Icon';
import { tr } from '../i18n';

/** Boards grouped by the board they sit in (also through columns), skipping the trash. */
export function boardChildren(m: ElMap): Map<string, El[]> {
  const out = new Map<string, El[]>();
  for (const b of Object.values(m)) {
    if (b.type !== 'BOARD' || b.id === ROOT_ID || isHidden(m, b.id)) continue;
    let cur = m[b.loc.parentId];
    let guard = 0;
    while (cur && cur.type !== 'BOARD' && guard++ < 1000) cur = m[cur.loc.parentId];
    if (!cur) continue;
    const list = out.get(cur.id) ?? [];
    list.push(b);
    out.set(cur.id, list);
  }
  for (const list of out.values()) list.sort((a, b) => (a.content.title || '').localeCompare(b.content.title || '', 'ko'));
  return out;
}

/**
 * The boards under one breadcrumb, in a small menu below its ›. A board with boards inside shows
 * them in a menu that opens to its right when the pointer rests on it, and so on further down.
 * Clicking a board opens it.
 */
export function BoardTree({
  els,
  rootId,
  currentId,
  anchor,
  onOpen,
  onClose,
}: {
  els: ElMap;
  rootId: string;
  currentId: string;
  anchor: HTMLElement;
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  /** The boards whose menus are open, from the first menu out, with where each was pointed at. */
  const [chain, setChain] = useState<{ id: string; left: number; right: number; top: number }[]>([]);
  const kids = useMemo(() => boardChildren(els), [els]);

  useLayoutEffect(() => {
    const a = anchor.getBoundingClientRect();
    const w = (ref.current?.firstElementChild as HTMLElement | null)?.offsetWidth ?? 260;
    setPos({ left: Math.max(8, Math.min(a.left - 8, innerWidth - w - 8)), top: a.bottom + 6 });
  }, [anchor]);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.contains(t)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      // The last menu that opened to the side closes first.
      if (chain.length) setChain((c) => c.slice(0, -1));
      else onClose();
    };
    addEventListener('pointerdown', down, true);
    addEventListener('keydown', key, true);
    return () => {
      removeEventListener('pointerdown', down, true);
      removeEventListener('keydown', key, true);
    };
  }, [anchor, onClose, chain.length]);

  // A side menu that would run off the right edge opens to the left of its board instead.
  useLayoutEffect(() => {
    const menus = ref.current?.querySelectorAll<HTMLElement>('.board-tree.side') ?? [];
    menus.forEach((m, i) => {
      const at = chain[i];
      if (!at) return;
      const w = m.offsetWidth;
      const h = m.offsetHeight;
      const left = at.right + w + 8 > innerWidth ? Math.max(8, at.left - w - 4) : at.right + 4;
      m.style.left = `${left}px`;
      m.style.top = `${Math.max(8, Math.min(at.top - 7, innerHeight - h - 8))}px`;
      m.style.visibility = '';
    });
  }, [chain]);

  const name = (b: El) => b.content.title || tr('제목 없는 보드', 'Untitled board');

  /** One menu: the boards in `parentId`; resting on one with boards inside opens the next menu. */
  const menu = (parentId: string, level: number) => {
    const list = kids.get(parentId) ?? [];
    return (
      <ul className="tree-list">
        {list.map((b) => {
          const inner = kids.get(b.id)?.length ?? 0;
          const open = chain[level]?.id === b.id;
          return (
            <li key={b.id}>
              <button
                className={['tree-item', b.id === currentId && 'current', open && 'open'].filter(Boolean).join(' ')}
                data-tree-board={b.id}
                aria-haspopup={inner ? 'menu' : undefined}
                aria-expanded={inner ? open : undefined}
                onPointerEnter={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  setChain((c) => (inner ? [...c.slice(0, level), { id: b.id, left: r.left, right: r.right, top: r.top }] : c.slice(0, level)));
                }}
                onClick={() => onOpen(b.id)}
              >
                <span className="tree-icon">{b.content.icon || '📋'}</span>
                {b.boardRef && (
                  <span className="copy-mark shortcut" data-copy-mark title={tr('보드 바로가기: 원본 보드를 엽니다', 'Board shortcut: opens the original board')}>
                    <Icon name="external" size={11} />
                  </span>
                )}
                <span className="tree-name">{name(b)}</span>
                {inner > 0 && (
                  <>
                    <span className="tree-count">{inner}</span>
                    <span className="tree-more" aria-hidden>
                      ›
                    </span>
                  </>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    );
  };

  const rootName = rootId === ROOT_ID ? tr('홈', 'Home') : els[rootId]?.content.title || tr('제목 없는 보드', 'Untitled board');
  const hasAny = (kids.get(rootId)?.length ?? 0) > 0;
  return createPortal(
    <div ref={ref} className="board-tree-layer">
      <div className="board-tree" style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? undefined : 'hidden' }}>
        <div className="board-tree-head">
          {rootId === ROOT_ID ? <Icon name="home" size={14} /> : <span>{els[rootId]?.content.icon}</span>}
          <span>{tr(`${rootName} 아래 보드`, `Boards under ${rootName}`)}</span>
        </div>
        {hasAny ? menu(rootId, 0) : <div className="board-tree-empty">{tr('하위 보드가 없습니다.', 'No sub-boards.')}</div>}
      </div>
      {chain.map((c, i) => (
        <div
          key={c.id}
          className="board-tree side"
          data-tree-side={c.id}
          role="menu"
          aria-label={name(els[c.id])}
          style={{ left: c.right + 4, top: c.top - 7, visibility: 'hidden' }}
        >
          {menu(c.id, i + 1)}
        </div>
      ))}
    </div>,
    document.body,
  );
}
