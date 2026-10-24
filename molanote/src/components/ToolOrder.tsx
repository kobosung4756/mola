import { useEffect, useRef, useState } from 'react';
import { tr } from '../i18n';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

export type ToolInfo = { key: string; label: string; icon: string };

/**
 * A popup for putting the left bar's tools in your own order (opened from the settings):
 * drag a row by its grip (or use the arrows) and the bar follows at once.
 */
export function ToolOrder({
  tools,
  onChange,
  onReset,
  onClose,
}: {
  /** Tools in their current order. */
  tools: ToolInfo[];
  onChange: (keys: string[]) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const keys = tools.map((t) => t.key);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      onClose();
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
  }, [onClose]);

  const moveTo = (key: string, to: number) => {
    const from = keys.indexOf(key);
    if (from < 0 || to < 0 || to >= keys.length || from === to) return;
    const next = [...keys];
    next.splice(from, 1);
    next.splice(to, 0, key);
    onChange(next);
  };

  /** Drag a row: it takes the place of the row under the pointer. */
  const startDrag = (e: ReactPointerEvent, key: string) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setDragKey(key);
    let order = keys;
    const move = (ev: PointerEvent) => {
      const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-order-key]') ?? []);
      let to = rows.length - 1;
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i].getBoundingClientRect();
        if (ev.clientY < r.top + r.height / 2) {
          to = i;
          break;
        }
      }
      const from = order.indexOf(key);
      if (to === from) return;
      const next = [...order];
      next.splice(from, 1);
      next.splice(to, 0, key);
      order = next;
      onChange(next);
    };
    const up = () => {
      setDragKey(null);
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  };

  return createPortal(
    <div className="tool-order-backdrop">
    <div ref={panelRef} className="tool-order" role="dialog" aria-modal="true" aria-label={tr('도구 순서', 'Tool order')}>
      <div className="ctx-fly-title">{tr('도구 순서', 'Tool order')}</div>
      <div className="tool-order-hint">{tr('끌거나 ↑↓로 왼쪽 막대의 순서를 바꾸세요.', 'Drag or use ↑↓ to reorder the left bar.')}</div>
      <div ref={listRef} className="tool-order-list">
        {tools.map((t, i) => (
          <div key={t.key} className={dragKey === t.key ? 'tool-order-row dragging' : 'tool-order-row'} data-order-key={t.key}>
            <span className="tool-order-grip" title={tr('끌어서 순서 바꾸기', 'Drag to reorder')} onPointerDown={(e) => startDrag(e, t.key)}>
              <Icon name="grip" size={16} />
            </span>
            <Icon name={t.icon} size={18} />
            <span className="tool-order-name">{t.label}</span>
            <button title={tr('위로', 'Up')} aria-label={`${t.label} ${tr('위로', 'up')}`} disabled={i === 0} onClick={() => moveTo(t.key, i - 1)}>
              ↑
            </button>
            <button title={tr('아래로', 'Down')} aria-label={`${t.label} ${tr('아래로', 'down')}`} disabled={i === tools.length - 1} onClick={() => moveTo(t.key, i + 1)}>
              ↓
            </button>
          </div>
        ))}
      </div>
      <div className="tool-order-actions">
        <button className="ctx-wide" onClick={onReset}>
          {tr('기본 순서로', 'Reset')}
        </button>
        <button className="ctx-wide ctx-create" data-order-done onClick={onClose}>
          {tr('완료', 'Done')}
        </button>
      </div>
    </div>
    </div>,
    document.body,
  );
}
