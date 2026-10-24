import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { COLORS } from '../types';
import { tr } from '../i18n';
import { Icon } from './Icon';

/** A tag's name and colour, with a button to confirm (Enter confirms, Escape cancels). */
export function TagForm({
  name,
  color,
  saveLabel = tr('저장', 'Save'),
  onSave,
  onCancel,
}: {
  name: string;
  color: string;
  saveLabel?: string;
  onSave: (name: string, color: string) => void;
  onCancel: () => void;
}) {
  const [n, setN] = useState(name);
  const [c, setC] = useState(color);
  const save = () => {
    if (n.trim()) onSave(n.trim(), c);
  };
  return (
    <div className="tag-form" data-tag-form onPointerDown={(e) => e.stopPropagation()}>
      <input
        className="ctx-input"
        value={n}
        autoFocus
        placeholder={tr('태그 이름', 'Tag name')}
        aria-label={tr('태그 이름', 'Tag name')}
        onChange={(e) => setN(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            save();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
      />
      <div className="ctx-colors">
        {Object.entries(COLORS).map(([key, hex]) => (
          <button
            key={key}
            className={c === key ? 'dot on' : 'dot'}
            data-color={key}
            style={{ background: hex }}
            aria-label={key}
            onClick={(e) => {
              e.preventDefault();
              setC(key);
            }}
          />
        ))}
      </div>
      <div className="tag-form-actions">
        <button className="ctx-wide" onClick={(e) => (e.preventDefault(), onCancel())}>
          {tr('취소', 'Cancel')}
        </button>
        <button className="ctx-wide ctx-create" data-tag-save disabled={!n.trim()} onClick={(e) => (e.preventDefault(), save())}>
          {saveLabel}
        </button>
      </div>
    </div>
  );
}

/**
 * A small bubble beside something (a tag on a block: below it; a row of the tag list: to its right),
 * closed by Escape or a click elsewhere.
 */
export function TagBubble({
  anchor,
  side = 'below',
  title,
  onClose,
  children,
  data,
}: {
  anchor: HTMLElement;
  side?: 'below' | 'right';
  title: string;
  onClose: () => void;
  children: ReactNode;
  data?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const a = anchor.getBoundingClientRect();
    const w = ref.current?.offsetWidth ?? 250;
    const h = ref.current?.offsetHeight ?? 180;
    if (side === 'right') {
      // Beside the whole tag list, level with the row.
      const box = anchor.closest('.ctx-flyout')?.getBoundingClientRect() ?? a;
      setPos({ left: Math.min(box.right + 10, innerWidth - w - 8), top: Math.max(8, Math.min(a.top - 10, innerHeight - h - 8)) });
    } else {
      const below = a.bottom + 8 + h < innerHeight;
      setPos({ left: Math.max(8, Math.min(a.left, innerWidth - w - 8)), top: below ? a.bottom + 8 : Math.max(8, a.top - h - 8) });
    }
  }, [anchor, side]);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    addEventListener('pointerdown', down, true);
    addEventListener('keydown', key, true);
    return () => {
      removeEventListener('pointerdown', down, true);
      removeEventListener('keydown', key, true);
    };
  }, [anchor, onClose]);
  return createPortal(
    <div
      ref={ref}
      className={`tag-popup side-${side}`}
      data-tag-popup={data ?? ''}
      onPointerDown={(e) => e.stopPropagation()}
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? undefined : 'hidden' }}
    >
      <div className="ctx-fly-title">{title}</div>
      {children}
    </div>,
    document.body,
  );
}

/**
 * A tag pressed on a block: take it off this block, or put a new tag on it. (Renaming and
 * recolouring a tag is done in the left panel's tag list, as it changes it on every block.)
 */
export function TagChipBubble({
  anchor,
  name,
  onRemove,
  onCreate,
  onClose,
}: {
  anchor: HTMLElement;
  name: string;
  onRemove: () => void;
  onCreate: (name: string, color: string) => void;
  onClose: () => void;
}) {
  return (
    <TagBubble anchor={anchor} title={name} onClose={onClose} data="chip">
      <button className="ctx-wide tag-remove" data-tag-remove onClick={() => (onRemove(), onClose())}>
        <Icon name="close" size={13} /> {tr('이 블록에서 태그 빼기', 'Remove from this block')}
      </button>
      <div className="ctx-fly-sub">{tr('새 태그 붙이기', 'Add a new tag')}</div>
      <TagForm
        name=""
        color="blue"
        saveLabel={tr('만들어 붙이기', 'Create and add')}
        onCancel={onClose}
        onSave={(n, c) => {
          onCreate(n, c);
          onClose();
        }}
      />
    </TagBubble>
  );
}
