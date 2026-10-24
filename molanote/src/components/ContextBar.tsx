import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Commit, El, ElementType, LabelDef, LineStyle, LineWeight, TableCell } from '../types';
import { BOARD_ICONS, COLORS, dashFor, LINE_WEIGHTS } from '../types';
import { createLabel, deleteLabel, editLabel, toggleLabel, toggleReaction, update } from '../model';
import { cellKey, cellsCutBy, isEmptyFormat, MAX_COLS, MAX_ROWS, naturalDecimals, normalize, rangeKeys, rangeOf, resizeTable, Sheet, CURRENCIES } from '../table';
import type { CellFormat, CellType } from '../table';
import { Icon } from './Icon';
import { TagBubble, TagForm } from './TagEdit';
import { OPEN_MATH_EVENT, TASK_FORMAT_EVENT } from './MathEditor';
import { editStart } from '../context';
import { HIGHLIGHTS, TEXT_COLORS } from './TextBar';
import { tr } from '../i18n';

type Option =
  | 'color'
  | 'reactions'
  | 'title'
  | 'comment'
  | 'caption'
  | 'rename'
  | 'icon'
  | 'label'
  | 'lineColor'
  | 'start'
  | 'end'
  | 'lineLabel'
  | 'dashed'
  | 'weight'
  | 'draw'
  | 'edit'
  | 'background'
  | 'comma'
  | 'decimals'
  | 'align'
  | 'cellColor'
  | 'cellType'
  | 'math'
  | 'taskStyle'
  | 'taskHighlight'
  | 'taskBold'
  | 'taskCode'
  | 'tableSize';

/** Settings the left bar offers for each kind of block, in order. */
export const CONTEXT_OPTIONS: Partial<Record<ElementType, Option[]>> = {
  TASK_LIST: ['color', 'label', 'title'],
  IMAGE: ['label', 'reactions', 'caption', 'comment', 'draw', 'edit'],
  SKETCH: ['background', 'label', 'reactions', 'title', 'comment', 'caption'],
  DIAGRAM: ['label', 'reactions', 'comment', 'caption'],
  CARD: ['color', 'label', 'reactions', 'title', 'comment'],
  COLUMN: ['color', 'label', 'rename'],
  BOARD: ['color', 'icon', 'rename'],
  TABLE: ['label', 'reactions', 'comment', 'title', 'caption', 'tableSize'],
  LINE: ['lineColor', 'start', 'end', 'lineLabel', 'dashed', 'weight'],
};

/** A table opened for editing (double-click) shows cell options instead. */
export const TABLE_EDIT_OPTIONS: Option[] = ['align', 'cellColor', 'cellType', 'comma', 'decimals'];
/** A to-do list being edited shows text options for the to-do being typed. */
export const TASK_EDIT_OPTIONS: Option[] = ['taskStyle', 'taskHighlight', 'taskBold', 'taskCode', 'math'];

const CELL_TYPES: { value: CellType; label: string; sample: string }[] = [
  { value: 'auto', label: tr('자동', 'Auto'), sample: '1234.5' },
  { value: 'currency', label: tr('통화', 'Currency'), sample: '₩1,235' },
  { value: 'percent', label: tr('퍼센트', 'Percentage'), sample: '12.5%' },
  { value: 'datetime', label: tr('날짜와 시간', 'Date & time'), sample: '2026-10-15 14:30' },
  { value: 'text', label: tr('글자', 'Text'), sample: '0012' },
];

const ALIGN_V: { value: 'top' | 'middle' | 'bottom'; label: string; icon: string }[] = [
  { value: 'top', label: tr('위', 'Top'), icon: 'alignTop' },
  { value: 'middle', label: tr('중앙', 'Middle'), icon: 'alignMiddle' },
  { value: 'bottom', label: tr('아래', 'Bottom'), icon: 'alignBottom' },
];

const ALIGN_H: { value: 'left' | 'center' | 'right'; label: string; icon: string }[] = [
  { value: 'left', label: tr('왼쪽', 'Left'), icon: 'alignLeft' },
  { value: 'center', label: tr('중앙', 'Center'), icon: 'alignCenter' },
  { value: 'right', label: tr('오른쪽', 'Right'), icon: 'alignRight' },
];

/** What each option does, for its hover bubble (a shortcut goes in brackets at the end). */
const TIPS: Record<Option, string> = {
  color: tr('블록 색 바꾸기', 'Change block color'),
  reactions: tr('이모지 반응 달기', 'Add emoji reaction'),
  title: tr('제목 보이기 / 숨기기 (F2)', 'Show / hide title (F2)'),
  comment: tr('댓글 달기', 'Add comment'),
  caption: tr('캡션 보이기 / 숨기기 (F2)', 'Show / hide caption (F2)'),
  rename: tr('이름 바꾸기 (F2)', 'Rename (F2)'),
  icon: tr('보드 아이콘 고르기', 'Choose board icon'),
  label: tr('태그 붙이기 · 만들기', 'Add · create tags'),
  lineColor: tr('선 색 바꾸기', 'Change line color'),
  start: tr('시작점 화살표 켜기 / 끄기', 'Toggle start arrow'),
  end: tr('끝점 화살표 켜기 / 끄기', 'Toggle end arrow'),
  lineLabel: tr('선 위에 라벨 쓰기 · 라벨 색·배경 (라벨이 있으면 눌러서 지우기, 선 더블클릭으로도 쓰기)', 'Line label · color, background (press again to remove it; or double-click the line)'),
  dashed: tr('선 모양: 실선, 파선, 점선', 'Line style: solid, dashed, dotted'),
  weight: tr('선 굵기', 'Line weight'),
  draw: tr('이미지 위에 펜으로 그리기 (D)', 'Draw on the image with a pen (D)'),
  edit: tr('이미지 자르기 · 회전 (E)', 'Crop · rotate image (E)'),
  background: tr('그리기 배경 색', 'Sketch background color'),
  comma: tr('천 단위 쉼표 켜기 / 끄기', 'Toggle thousands separator'),
  decimals: tr('소수 자릿수 늘리기 / 줄이기', 'Increase / decrease decimals'),
  align: tr('셀 안의 글 정렬 (위·중앙·아래, 왼쪽·중앙·오른쪽)', 'Align cell text (top·middle·bottom, left·center·right)'),
  cellColor: tr('셀 배경 색', 'Cell background color'),
  cellType: tr('셀 형식: 자동, 통화, 퍼센트, 날짜와 시간, 글자', 'Cell type: auto, currency, percentage, date & time, text'),
  math: tr('수식 넣기: LaTeX로 쓰고 미리보기 (Ctrl+M)', 'Insert formula: write LaTeX and preview (Ctrl+M)'),
  tableSize: tr('표 크기 바꾸기: 행 × 열 개수 입력', 'Resize table: enter rows × columns'),
  taskStyle: tr('글자 색상 (고른 글자, 없으면 이 할 일 전체)', 'Text color (the picked text, else the whole to-do)'),
  taskHighlight: tr('형광펜 (==글자== · 고른 글자에서 ==)', 'Highlight (==text== · on picked text: ==)'),
  taskBold: tr('굵게 (Ctrl+B)', 'Bold (Ctrl+B)'),
  taskCode: tr('인라인 코드 (Ctrl+E)', 'Inline code (Ctrl+E)'),
};

const META: Record<Option, { label: string; icon: string; flyout?: boolean; iconOnly?: boolean }> = {
  color: { label: tr('색', 'Color'), icon: 'swatch', flyout: true },
  reactions: { label: tr('반응', 'Reactions'), icon: 'smile', flyout: true },
  title: { label: tr('제목', 'Title'), icon: 'title' },
  comment: { label: tr('댓글', 'Comment'), icon: 'comment' },
  caption: { label: tr('캡션', 'Caption'), icon: 'caption' },
  rename: { label: tr('이름', 'Rename'), icon: 'rename' },
  icon: { label: tr('아이콘', 'Icon'), icon: 'smile', flyout: true },
  label: { label: tr('태그', 'Tag'), icon: 'tag', flyout: true },
  lineColor: { label: tr('색', 'Color'), icon: 'swatch', flyout: true },
  start: { label: tr('시작', 'Start'), icon: 'arrowStart' },
  end: { label: tr('끝', 'End'), icon: 'arrowEnd' },
  lineLabel: { label: tr('라벨', 'Label'), icon: 'lineLabel', flyout: true },
  dashed: { label: tr('선 모양', 'Dashed'), icon: 'dashed', flyout: true },
  weight: { label: tr('굵기', 'Weight'), icon: 'weight', flyout: true },
  draw: { label: tr('그리기', 'Draw'), icon: 'pen' },
  edit: { label: tr('편집', 'Edit'), icon: 'crop' },
  background: { label: tr('배경', 'Background'), icon: 'swatch', flyout: true },
  comma: { label: tr('쉼표', 'Comma'), icon: 'comma' },
  decimals: { label: tr('소수점', 'Decimals'), icon: 'decInc', flyout: true },
  align: { label: tr('정렬', 'Alignment'), icon: 'align', flyout: true },
  cellColor: { label: tr('셀 색', 'Cell color'), icon: 'fill', flyout: true },
  cellType: { label: tr('셀 형식', 'Cell type'), icon: 'cellType', flyout: true },
  math: { label: tr('수식', 'Formula'), icon: 'math' },
  tableSize: { label: tr('크기', 'Resize'), icon: 'tableSize', flyout: true },
  taskStyle: { label: tr('글자 색상', 'Text color'), icon: 'textColor', flyout: true },
  taskHighlight: { label: tr('형광펜', 'Highlight'), icon: 'highlighter', flyout: true, iconOnly: true },
  taskBold: { label: tr('굵게', 'Bold'), icon: 'bold', iconOnly: true },
  taskCode: { label: tr('인라인 코드', 'Inline code'), icon: 'code', iconOnly: true },
};

/** The first emoji in what was typed (one picture, with its skin tone or joined parts). */
function firstEmoji(text: string): string | null {
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment: (t: string) => Iterable<{ segment: string }> } }).Segmenter;
  const parts = Seg ? Array.from(new Seg(undefined, { granularity: 'grapheme' }).segment(text), (x) => x.segment) : Array.from(text);
  return parts.find((g) => /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(g)) ?? null;
}

/** Board icons put in by hand lately (in this browser), offered again in the icon bubble. */
const ICONS_KEY = 'molanote.boardIcons.v1';
function recentIcons(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(ICONS_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function rememberIcon(ic: string) {
  try {
    localStorage.setItem(ICONS_KEY, JSON.stringify([ic, ...recentIcons().filter((x) => x !== ic)].slice(0, 10)));
  } catch {
    // Storage may be blocked: the icon is still put on the board.
  }
}

export const REACTIONS = ['👍', '❤️', '😂', '🎉', '😮', '😢', '👀', '🔥', '✅', '💡'];

const DASHES: { value: LineStyle; label: string }[] = [
  { value: 'solid', label: tr('실선', 'Solid') },
  { value: 'dotted', label: tr('점선', 'Dotted') },
  { value: 'dash-short', label: tr('짧은 파선', 'Short dash') },
  { value: 'dashed', label: tr('파선', 'Dashed') },
  { value: 'dash-long', label: tr('긴 파선', 'Long dash') },
];

const WEIGHTS: { value: LineWeight; label: string }[] = [
  { value: 'thin', label: tr('얇게', 'Thin') },
  { value: 'normal', label: tr('보통', 'Normal') },
  { value: 'thick', label: tr('굵게', 'Thick') },
  { value: 'heavy', label: tr('아주 굵게', 'Extra thick') },
];

function LinePreview({ style, weight, color = '#5f5c57' }: { style: LineStyle; weight: LineWeight; color?: string }) {
  const w = LINE_WEIGHTS[weight];
  return (
    <svg width="56" height="14" viewBox="0 0 56 14" aria-hidden="true">
      <line
        x1="3"
        y1="7"
        x2="53"
        y2="7"
        stroke={color}
        strokeWidth={w}
        strokeDasharray={dashFor(style, w)}
        strokeLinecap={style === 'dotted' ? 'round' : 'butt'}
      />
    </svg>
  );
}

/**
 * The left bar's settings pane for the selected block. Toggles act at once; options with
 * choices open a small flyout beside the bar.
 */
export function ContextBar({
  el,
  meId,
  labelDefs,
  commit,
  onComment,
  onEdit,
  onImageTool,
  onLineLook,
  tableCell,
  editing = false,
  openOption,
  onOpened,
}: {
  /** Opens this option's bubble once the bar is in place (right-click › Add tag opens Tag). */
  openOption?: Option;
  onOpened?: () => void;
  el: El;
  /** The block is open for editing (for a table: cells are being edited). */
  editing?: boolean;
  meId: string;
  /** Every label of the account, offered as checkboxes on every block. */
  labelDefs: LabelDef[];
  commit: Commit;
  onComment: (id: string) => void;
  onEdit: (id: string) => void;
  /** Opens the image drawing editor or the crop editor. */
  onImageTool: (kind: 'draw' | 'crop', id: string) => void;
  /** Selected table cell; number formats apply to it (or to the whole table when none). */
  tableCell?: TableCell | null;
  /** A line's look after a change, remembered for the next line drawn. */
  onLineLook?: (look: { content: Pick<El['content'], 'lineStyle' | 'weight' | 'arrow' | 'arrowStart'>; color?: string }) => void;
}) {
  const [flyout, setFlyout] = useState<{ option: Option; top: number; left: number } | null>(null);
  // Asked from outside (right-click › Add tag): open that option's bubble once the bar has slid in.
  useEffect(() => {
    if (!openOption) return;
    const t = window.setTimeout(() => {
      const btn = document.querySelector<HTMLElement>(`.ctx-pane .ctx-option[data-option=${openOption}]`);
      if (btn) {
        const r = btn.getBoundingClientRect();
        setFlyout({ option: openOption, top: r.top, left: r.right + 8 });
      }
      onOpened?.();
    }, 320);
    return () => window.clearTimeout(t);
  }, [openOption]); // eslint-disable-line react-hooks/exhaustive-deps
  const flyoutRef = useRef<HTMLDivElement>(null);
  const [newLabel, setNewLabel] = useState('');
  /** The tag being renamed or recoloured in the list (its edit button). */
  const [editingTag, setEditingTag] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  /** The currency row of Cell type, whose units bubble is open. */
  const [unitsOpen, setUnitsOpen] = useState<HTMLElement | null>(null);
  const [newColor, setNewColor] = useState('blue');
  /** Rows × columns typed into the Resize bubble. */
  const [sizeDraft, setSizeDraft] = useState({ rows: '', cols: '' });
  const editingTable = el.type === 'TABLE' && editing;
  // A to-do list being edited can take formulas as well.
  const options = editingTable
    ? TABLE_EDIT_OPTIONS
    : editing && el.type === 'TASK_LIST'
      ? TASK_EDIT_OPTIONS
      : (CONTEXT_OPTIONS[el.type] ?? []);
  const c = el.content;

  useEffect(() => {
    if (!flyout) return;
    const close = (e: Event) => {
      const t = e.target as HTMLElement | null;
      // The tag-edit bubble beside the tag list belongs to it.
      if (!t?.closest?.('.ctx-flyout, .ctx-option, [data-tag-popup]')) setFlyout(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setFlyout(null);
      }
    };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [flyout]);

  const patch = (p: Parameters<typeof update>[2]) => {
    commit((m) => update(m, el.id, p));
    if (el.type === 'LINE' && onLineLook) {
      const next = { ...c, ...p.content };
      onLineLook({
        content: { lineStyle: next.lineStyle, weight: next.weight, arrow: next.arrow, arrowStart: next.arrowStart },
        color: 'color' in p ? p.color : el.color,
      });
    }
  };

  /** Cells a number-format option applies to: the selected cell, or every cell. */
  const formatTargets = () => {
    if (el.type !== 'TABLE') return [];
    if (tableCell && tableCell.id === el.id) return rangeKeys(rangeOf(tableCell));
    const cells = normalize(c.cells ?? [['']]);
    return cells.flatMap((row, r) => row.map((_, col) => cellKey(r, col)));
  };
  const setFormats = (fn: (f: CellFormat, key: string) => CellFormat) => {
    const next = { ...(c.cellFmt ?? {}) };
    for (const k of formatTargets()) {
      const f = fn(next[k] ?? {}, k);
      // Keep only what is set, so cleared cells drop out of the map.
      const clean = Object.fromEntries(Object.entries(f).filter(([key, v]) => v !== undefined && v !== false && !(key === 'type' && v === 'auto'))) as CellFormat;
      if (isEmptyFormat(clean)) delete next[k];
      else next[k] = clean;
    }
    patch({ content: { cellFmt: Object.keys(next).length ? next : undefined } });
  };
  /** The format of the first target cell, shown as the current choice in the bubbles. */
  const firstFmt = (): CellFormat => {
    const k = formatTargets()[0];
    return (k && c.cellFmt?.[k]) || {};
  };

  /** Creates a label for the whole account and puts it on this block. */
  const addLabel = () => {
    const name = newLabel.trim();
    if (!name) return;
    commit((m) => {
      const id = createLabel(m, name, newColor);
      toggleLabel(m, el.id, id);
    });
    setNewLabel('');
  };

  /** Decimal places a number cell shows: as set, or as many as the number has. */
  const decimalsOf = (f: CellFormat, k: string, sheet: Sheet) => {
    const [r, col] = k.split(':').map(Number);
    const v = sheet.value(r, col);
    return f.dec ?? (typeof v === 'number' ? naturalDecimals(v) : 0);
  };
  /** One more (+1) or one fewer (−1) decimal place in the target cells. */
  const stepDecimals = (d: 1 | -1) => {
    const sheet = new Sheet(normalize(c.cells ?? [['']]));
    setFormats((f, k) => ({ ...f, dec: Math.min(10, Math.max(0, decimalsOf(f, k, sheet) + d)) }));
  };

  // Table cell tools (alignment, cell colour, cell type, comma, decimals) are actions, not switches: never shown as on.
  const isOn = (o: Option): boolean => {
    switch (o) {
      case 'title':
        return el.type === 'TASK_LIST' ? c.showTitle !== false : !!c.showTitle;
      case 'caption':
        return c.showCaption ?? !!c.caption;
      case 'start':
        return !!c.arrowStart;
      case 'end':
        return !!c.arrow;
      case 'color':
      case 'lineColor':
        return !!el.color || !!c.clear;
      case 'background':
        return !!c.bg;
      case 'draw':
        // Opens the drawing window; not a switch that stays on.
        return false;
      case 'reactions':
        return !!c.reactions && Object.values(c.reactions).some((who) => who.includes(meId));
      case 'label':
        return !!c.labels?.length || !!c.tag?.text;
      case 'lineLabel':
        return !!c.label;
      case 'dashed':
        return !!c.lineStyle && c.lineStyle !== 'solid';
      default:
        return false;
    }
  };

  /** In the to-do edit bar only Text color keeps its name; the other options are icons (named in their bubble). */
  const iconOnly = (o: Option) => !!META[o].iconOnly || (o === 'math' && editing && el.type === 'TASK_LIST');
  const tableRows = normalize(c.cells ?? [['']]).length;
  const tableCols = normalize(c.cells ?? [['']])[0].length;
  /** Makes the table rows × cols (asking first if filled cells would be cut off). */
  const applySize = () => {
    const rows = Math.round(Number(sizeDraft.rows));
    const cols = Math.round(Number(sizeDraft.cols));
    if (!(rows >= 1 && rows <= MAX_ROWS && cols >= 1 && cols <= MAX_COLS)) return;
    if (rows === tableRows && cols === tableCols) return setFlyout(null);
    const cut = cellsCutBy(c.cells ?? [['']], rows, cols);
    if (cut && !confirm(tr(`표를 ${rows} × ${cols}로 줄이면 값이 있는 셀 ${cut}개가 지워집니다. 계속할까요? (Ctrl+Z로 되돌릴 수 있습니다)`, `Shrinking the table to ${rows} × ${cols} will clear ${cut} filled cell(s). Continue? (Ctrl+Z to undo)`))) return;
    commit((m) => {
      const cur = m[el.id].content;
      const next = resizeTable({ cells: cur.cells ?? [['']], formats: cur.cellFmt, colW: cur.colW, rowH: cur.rowH }, rows, cols);
      const oldCols = normalize(cur.cells ?? [['']])[0].length;
      // Fixed column widths add up to the block's width; otherwise the columns share it, so it grows with them.
      const width = next.colW ? next.colW.reduce((a, b) => a + b, 0) : Math.round(((m[el.id].width ?? 360) * cols) / oldCols);
      update(m, el.id, { width, content: { cells: next.cells, cellFmt: next.formats, colW: next.colW, rowH: next.rowH } });
    });
    setFlyout(null);
  };

  const run = (o: Option, button: HTMLElement) => {
    if (o === 'tableSize') setSizeDraft({ rows: String(tableRows), cols: String(tableCols) });
    if (o === 'taskBold' || o === 'taskCode') {
      window.dispatchEvent(new CustomEvent(TASK_FORMAT_EVENT, { detail: { id: el.id, kind: o === 'taskBold' ? 'bold' : 'code' } }));
      return;
    }
    if (o === 'math') {
      window.dispatchEvent(new CustomEvent(OPEN_MATH_EVENT, { detail: el.id }));
      return;
    }
    if (o === 'lineLabel' && c.label) {
      // A line with a label: pressing 라벨 takes the label off (its colours stay for the next one).
      setFlyout(null);
      patch({ content: { label: undefined, labelT: undefined } });
      return;
    }
    if (META[o].flyout) {
      const r = button.getBoundingClientRect();
      setFlyout((f) => (f?.option === o ? null : { option: o, top: r.top, left: r.right + 8 }));
      return;
    }
    setFlyout(null);
    switch (o) {
      case 'title': {
        const on = !isOn('title');
        patch({ content: { showTitle: on } });
        if (on) onEdit(el.id);
        break;
      }
      case 'caption': {
        const on = !isOn('caption');
        patch({ content: { showCaption: on } });
        if (on) {
          editStart.id = el.id;
          editStart.by = 'caption';
          onEdit(el.id);
        }
        break;
      }
      case 'start':
        patch({ content: { arrowStart: !c.arrowStart } });
        break;
      case 'end':
        patch({ content: { arrow: !c.arrow } });
        break;
      case 'comment':
        onComment(el.id);
        break;
      case 'rename':
        onEdit(el.id);
        break;
      case 'draw':
        onImageTool('draw', el.id);
        break;
      case 'edit':
        onImageTool('crop', el.id);
        break;
      case 'comma': {
        const on = !isOn('comma');
        setFormats((f) => ({ ...f, comma: on || undefined }));
        break;
      }
    }
  };

  const palette = (current: string | undefined, choose: (name: string | undefined) => void, noneLabel = tr('없음', 'None')) => (
    <div className="ctx-colors">
      <button className={!current ? 'dot none on' : 'dot none'} title={noneLabel} onClick={() => choose(undefined)} />
      {Object.entries(COLORS).map(([name, hex]) => (
        <button
          key={name}
          className={current === name ? 'dot on' : 'dot'}
          style={{ background: hex }}
          title={name}
          data-color={name}
          onClick={() => choose(name)}
        />
      ))}
    </div>
  );

  const flyoutBody = () => {
    if (flyout?.option === 'taskStyle' || flyout?.option === 'taskHighlight') {
      const send = (kind: 'color' | 'bg', value?: string) =>
        window.dispatchEvent(new CustomEvent(TASK_FORMAT_EVENT, { detail: { id: el.id, kind, value } }));
      if (flyout.option === 'taskStyle')
        return (
          <>
            <div className="ctx-fly-title">{tr('글자 색상', 'Text color')}</div>
            <div className="ctx-colors">
              {TEXT_COLORS.map((col) => (
                <button key={col} className="dot" style={{ background: col }} title={col} data-task-color={col} onMouseDown={(e) => e.preventDefault()} onClick={() => send('color', col === TEXT_COLORS[0] ? undefined : col)} />
              ))}
            </div>
          </>
        );
      return (
        <>
          <div className="ctx-fly-title">{tr('형광펜', 'Highlight')}</div>
          <div className="ctx-colors">
            <button className="dot none" title={tr('형광펜 없음', 'No highlight')} onMouseDown={(e) => e.preventDefault()} onClick={() => send('bg')} />
            {HIGHLIGHTS.map((col) => (
              <button key={col} className="dot" style={{ background: col }} title={col} data-task-bg={col} onMouseDown={(e) => e.preventDefault()} onClick={() => send('bg', col)} />
            ))}
          </div>
        </>
      );
    }
    if (flyout?.option === 'tableSize') {
      const rows = Number(sizeDraft.rows);
      const cols = Number(sizeDraft.cols);
      const ok = Number.isInteger(rows) && rows >= 1 && rows <= MAX_ROWS && Number.isInteger(cols) && cols >= 1 && cols <= MAX_COLS;
      const field = (k: 'rows' | 'cols', label: string, max: number) => (
        <label className="size-field">
          <span>{label}</span>
          <input
            type="number"
            min={1}
            max={max}
            data-size={k}
            value={sizeDraft[k]}
            autoFocus={k === 'rows'}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setSizeDraft({ ...sizeDraft, [k]: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                applySize();
              }
            }}
          />
        </label>
      );
      return (
        <>
          <div className="ctx-fly-title">{tr('크기', 'Resize')}</div>
          <div className="size-row">
            {field('rows', tr('행', 'Rows'), MAX_ROWS)}
            <span className="size-x">×</span>
            {field('cols', tr('열', 'Columns'), MAX_COLS)}
          </div>
          <div className="ctx-fly-note">
            {tr(`지금 ${tableRows} × ${tableCols} · 행 1~${MAX_ROWS}, 열 1~${MAX_COLS}`, `Now ${tableRows} × ${tableCols} · rows 1–${MAX_ROWS}, columns 1–${MAX_COLS}`)}
          </div>
          <button className="ctx-wide ctx-create" data-size-apply disabled={!ok} onClick={applySize}>
            {tr('바꾸기', 'Apply')}
          </button>
        </>
      );
    }
    if (flyout?.option === 'decimals') {
      const k = formatTargets()[0];
      const shown = k ? decimalsOf(c.cellFmt?.[k] ?? {}, k, new Sheet(normalize(c.cells ?? [['']]))) : 0;
      return (
        <>
          <div className="ctx-fly-title">{tr('소수점', 'Decimals')}</div>
          <div className="dec-stepper">
            <button data-dec="less" title={tr('소수 자릿수 줄이기', 'Fewer decimals')} disabled={shown <= 0} onClick={() => stepDecimals(-1)}>
              −
            </button>
            <output aria-label={tr('소수 자릿수', 'Decimal places')}>{shown === 0 ? '0' : '0.' + '0'.repeat(shown)}</output>
            <button data-dec="more" title={tr('소수 자릿수 늘리기', 'More decimals')} disabled={shown >= 10} onClick={() => stepDecimals(1)}>
              +
            </button>
          </div>
        </>
      );
    }
    switch (flyout?.option) {
      case 'color':
        return (
          <>
            <div className="ctx-fly-title">{tr('색', 'Color')}</div>
            {palette(el.content.clear ? 'clear' : el.color, (color) => patch({ color, ...(el.type === 'CARD' ? { content: { clear: undefined } } : {}) }))}
            {el.type === 'CARD' && (
              <>
                <div className="ctx-fly-sub">{tr('배경', 'Background')}</div>
                <div className="ctx-colors">
                  <button
                    className={el.content.clear ? 'dot clear on' : 'dot clear'}
                    title={tr('투명 (카드 없이 글만)', 'Transparent (text only, no card)')}
                    data-color="clear"
                    onClick={() => patch({ color: undefined, content: { clear: el.content.clear ? undefined : true } })}
                  />
                </div>
              </>
            )}
          </>
        );
      case 'background':
        return (
          <>
            <div className="ctx-fly-title">{tr('배경', 'Background')}</div>
            {palette(c.bg, (bg) => patch({ content: { bg } }), tr('투명', 'Transparent'))}
          </>
        );
      case 'lineColor':
        return (
          <>
            <div className="ctx-fly-title">{tr('선 색', 'Line color')}</div>
            {palette(el.color, (color) => patch({ color }), tr('기본 색', 'Default color'))}
          </>
        );
      case 'align': {
        const cur = firstFmt();
        return (
          <>
            <div className="ctx-fly-title">{tr('정렬', 'Alignment')}</div>
            <div className="ctx-fly-sub">{tr('세로', 'Vertical')}</div>
            <div className="ctx-align">
              {ALIGN_V.map((a) => (
                <button
                  key={a.value}
                  className={(cur.v ?? 'middle') === a.value ? 'on' : ''}
                  data-align-v={a.value}
                  title={a.label}
                  onClick={() => setFormats((f) => ({ ...f, v: a.value === 'middle' ? undefined : a.value }))}
                >
                  <Icon name={a.icon} size={18} />
                  <span>{a.label}</span>
                </button>
              ))}
            </div>
            <div className="ctx-fly-sub">{tr('가로', 'Horizontal')}</div>
            <div className="ctx-align">
              {ALIGN_H.map((a) => (
                <button
                  key={a.value}
                  className={cur.h === a.value ? 'on' : ''}
                  data-align-h={a.value}
                  title={a.label}
                  onClick={() => setFormats((f) => ({ ...f, h: f.h === a.value ? undefined : a.value }))}
                >
                  <Icon name={a.icon} size={18} />
                  <span>{a.label}</span>
                </button>
              ))}
            </div>
          </>
        );
      }
      case 'cellColor':
        return (
          <>
            <div className="ctx-fly-title">{tr('셀 색', 'Cell color')}</div>
            {palette(firstFmt().bg, (bg) => setFormats((f) => ({ ...f, bg })), tr('채우기 없음', 'No fill'))}
          </>
        );
      case 'cellType': {
        const cur = firstFmt().type ?? 'auto';
        return (
          <>
            <div className="ctx-fly-title">{tr('셀 형식', 'Cell type')}</div>
            <div className="ctx-list">
              {CELL_TYPES.map((t) => (
                <button
                  key={t.value}
                  className={[cur === t.value && 'on', t.value === 'currency' && unitsOpen && 'open'].filter(Boolean).join(' ')}
                  data-cell-type={t.value}
                  aria-haspopup={t.value === 'currency' ? 'menu' : undefined}
                  onClick={(e) => {
                    setFormats((f) => ({ ...f, type: t.value }));
                    // Currency: its units open in a bubble beside the list.
                    setUnitsOpen(t.value === 'currency' ? (e.currentTarget as HTMLElement) : null);
                  }}
                >
                  <span className="ctx-type-name">{t.label}</span>
                  <span className="ctx-type-sample">
                    {t.value === 'currency' ? `${CURRENCIES[firstFmt().cur ?? 'KRW']?.sign ?? '₩'}1,235` : t.sample}
                  </span>
                  {t.value === 'currency' && <span className="ctx-type-more" aria-hidden>›</span>}
                </button>
              ))}
            </div>
            {unitsOpen && (
              <TagBubble anchor={unitsOpen} side="right" title={tr('통화 단위', 'Currency')} onClose={() => setUnitsOpen(null)} data="currency">
                <div className="ctx-list" data-currency-units>
                  {Object.entries(CURRENCIES).map(([code, u]) => (
                    <button
                      key={code}
                      className={(firstFmt().cur ?? 'KRW') === code ? 'on' : ''}
                      data-currency={code}
                      onClick={() => {
                        setFormats((f) => ({ ...f, type: 'currency', cur: code === 'KRW' ? undefined : code }));
                        setUnitsOpen(null);
                      }}
                    >
                      <span className="ctx-cur-sign">{u.sign}</span>
                      <span className="ctx-type-name">{tr(u.name[0], u.name[1])}</span>
                    </button>
                  ))}
                </div>
              </TagBubble>
            )}
          </>
        );
      }
      case 'icon': {
        // The icons offered, then the ones put in by hand lately (and this board's own, if it is one of those).
        const own = [...(c.icon && !BOARD_ICONS.includes(c.icon) ? [c.icon] : []), ...recentIcons()].filter((ic, i, all) => !BOARD_ICONS.includes(ic) && all.indexOf(ic) === i).slice(0, 10);
        const pickIcon = (ic: string) => {
          if (!BOARD_ICONS.includes(ic)) rememberIcon(ic);
          patch({ content: { icon: ic } });
        };
        return (
          <>
            <div className="ctx-fly-title">{tr('아이콘', 'Icon')}</div>
            <div className="ctx-emojis">
              {[...BOARD_ICONS, ...own].map((ic) => (
                <button key={ic} className={(c.icon || BOARD_ICONS[0]) === ic ? 'on' : ''} data-board-icon={ic} onClick={() => pickIcon(ic)}>
                  {ic}
                </button>
              ))}
            </div>
            <div className="ctx-fly-sub">{tr('다른 이모지', 'Another emoji')}</div>
            <input
              className="ctx-input"
              data-board-icon-input
              placeholder={tr('Win + . 으로 이모지 넣기', 'Win + . to put in an emoji')}
              title={tr('이 칸을 누르고 Win + . (마침표)를 누르면 Windows 이모지 창이 열립니다', 'Click here, then press Win + . (period) for the Windows emoji panel')}
              value=""
              onChange={(e) => {
                const ic = firstEmoji(e.target.value);
                if (ic) pickIcon(ic);
              }}
            />
          </>
        );
      }
      case 'reactions':
        return (
          <>
            <div className="ctx-fly-title">{tr('반응', 'Reactions')}</div>
            <div className="ctx-emojis">
              {REACTIONS.map((e) => (
                <button
                  key={e}
                  className={c.reactions?.[e]?.includes(meId) ? 'on' : ''}
                  data-emoji={e}
                  onClick={() => commit((m) => toggleReaction(m, el.id, e, meId))}
                >
                  {e}
                </button>
              ))}
            </div>
          </>
        );
      case 'label':
        return (
          <>
            <div className="ctx-fly-title">{tr('태그', 'Tags')}</div>
            {labelDefs.length === 0 ? (
              <div className="ctx-fly-note">{tr('아직 태그가 없습니다. 아래에서 만들면 모든 블록에서 고를 수 있습니다.', 'No tags yet. Create one below to use it on any block.')}</div>
            ) : (
              <div className="ctx-labels">
                {labelDefs.map((d) => (
                  <label key={d.id} className="ctx-label-item" data-label-id={d.id}>
                    <input
                      type="checkbox"
                      checked={!!c.labels?.includes(d.id)}
                      onChange={() => commit((m) => toggleLabel(m, el.id, d.id))}
                    />
                    <span className="label-chip" style={{ background: COLORS[d.color] ?? COLORS.gray }}>
                      {d.name}
                    </span>
                    <button
                      className="ctx-label-edit"
                      data-tag-edit={d.id}
                      title={tr('이 태그의 이름과 색 바꾸기', "Rename or recolour this tag")}
                      onClick={(e) => {
                        e.preventDefault();
                        setEditingTag({ id: d.id, anchor: e.currentTarget.closest('.ctx-label-item') as HTMLElement });
                      }}
                    >
                      <Icon name="pen" size={12} />
                    </button>
                    <button
                      className="ctx-label-del"
                      title={tr('이 태그를 모든 블록에서 지우기', 'Delete this tag from all blocks')}
                      onClick={(e) => {
                        e.preventDefault();
                        if (confirm(tr(`'${d.name}' 태그를 모든 블록에서 지울까요?`, `Delete the tag '${d.name}' from all blocks?`))) commit((m) => deleteLabel(m, d.id));
                      }}
                    >
                      <Icon name="close" size={12} />
                    </button>
                  </label>
                ))}
              </div>
            )}
            {editingTag && labelDefs.some((d) => d.id === editingTag.id) && (
              <TagBubble anchor={editingTag.anchor} side="right" title={tr('태그 편집', 'Edit tag')} onClose={() => setEditingTag(null)} data="edit">
                <TagForm
                  name={labelDefs.find((d) => d.id === editingTag.id)!.name}
                  color={labelDefs.find((d) => d.id === editingTag.id)!.color}
                  onCancel={() => setEditingTag(null)}
                  onSave={(name, color) => {
                    commit((m) => editLabel(m, editingTag.id, name, color));
                    setEditingTag(null);
                  }}
                />
              </TagBubble>
            )}
            <div className="ctx-fly-sub">{tr('새 태그', 'New tag')}</div>
            <input
              className="ctx-input"
              placeholder={tr('태그 이름', 'Tag name')}
              value={newLabel}
              autoFocus
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing && newLabel.trim()) {
                  e.preventDefault();
                  addLabel();
                }
              }}
            />
            <div className="ctx-colors">
              {Object.entries(COLORS).map(([name, hex]) => (
                <button
                  key={name}
                  className={newColor === name ? 'dot on' : 'dot'}
                  style={{ background: hex }}
                  title={name}
                  data-color={name}
                  onClick={() => setNewColor(name)}
                />
              ))}
            </div>
            <button className="ctx-wide ctx-create" disabled={!newLabel.trim()} onClick={addLabel}>
              {tr('태그 만들고 붙이기', 'Create and add tag')}
            </button>
          </>
        );
      case 'lineLabel':
        return (
          <>
            <div className="ctx-fly-title">{tr('라벨', 'Label')}</div>
            <button
              className="ctx-wide"
              onClick={() => {
                setFlyout(null);
                onEdit(el.id);
              }}
            >
              {c.label ? tr('라벨 고치기', 'Edit label') : tr('라벨 쓰기', 'Add label')}
            </button>
            <div className="ctx-fly-sub">{tr('테두리 색', 'Border color')}</div>
            <div className="ctx-colors" data-label-borders>
              <button className={!c.labelColor ? 'dot none on' : 'dot none'} title={tr('선 색', 'Line color')} onClick={() => patch({ content: { labelColor: undefined } })} />
              <button className={c.labelColor === 'clear' ? 'dot label-bg-clear on' : 'dot label-bg-clear'} title={tr('투명', 'Clear')} data-label-border="clear" onClick={() => patch({ content: { labelColor: 'clear' } })} />
              {Object.entries(COLORS).map(([name, hex]) => (
                <button key={name} className={c.labelColor === name ? 'dot on' : 'dot'} style={{ background: hex }} title={name} data-color={name} onClick={() => patch({ content: { labelColor: name } })} />
              ))}
            </div>
            <div className="ctx-fly-sub">{tr('배경 색', 'Background')}</div>
            <div className="ctx-colors" data-label-bgs>
              <button className={!c.labelBg ? 'dot label-bg-solid on' : 'dot label-bg-solid'} title={tr('흰색', 'White')} data-label-bg="solid" onClick={() => patch({ content: { labelBg: undefined } })} />
              <button className={c.labelBg === 'clear' ? 'dot label-bg-clear on' : 'dot label-bg-clear'} title={tr('투명', 'Clear')} data-label-bg="clear" onClick={() => patch({ content: { labelBg: 'clear' } })} />
              {Object.entries(COLORS).map(([name, hex]) => (
                <button
                  key={name}
                  className={c.labelBg === name ? 'dot on' : 'dot'}
                  style={{ background: `color-mix(in srgb, ${hex} 30%, white)` }}
                  title={name}
                  data-label-bg={name}
                  onClick={() => patch({ content: { labelBg: name } })}
                />
              ))}
            </div>
          </>
        );
      case 'dashed':
        return (
          <>
            <div className="ctx-fly-title">{tr('선 모양', 'Dashed')}</div>
            <div className="ctx-list">
              {DASHES.map((d) => (
                <button
                  key={d.value}
                  className={(c.lineStyle ?? 'solid') === d.value ? 'on' : ''}
                  data-dash={d.value}
                  onClick={() => patch({ content: { lineStyle: d.value } })}
                >
                  <LinePreview style={d.value} weight={c.weight ?? 'normal'} />
                  <span>{d.label}</span>
                </button>
              ))}
            </div>
          </>
        );
      case 'weight':
        return (
          <>
            <div className="ctx-fly-title">{tr('굵기', 'Weight')}</div>
            <div className="ctx-list">
              {WEIGHTS.map((w) => (
                <button
                  key={w.value}
                  className={(c.weight ?? 'normal') === w.value ? 'on' : ''}
                  data-weight={w.value}
                  onClick={() => patch({ content: { weight: w.value } })}
                >
                  <LinePreview style="solid" weight={w.value} />
                  <span>{w.label}</span>
                </button>
              ))}
            </div>
          </>
        );
      default:
        return null;
    }
  };

  return (
    <div className="ctx-bar" data-ctx-type={el.type}>
      {options.map((o) => (
        <button
          key={o}
          className={['tool', 'ctx-option', iconOnly(o) && 'icon-only', isOn(o) && 'active', flyout?.option === o && 'open'].filter(Boolean).join(' ')}
          aria-label={iconOnly(o) ? META[o].label : undefined}
          data-option={o}
          title={TIPS[o]}
          aria-pressed={META[o].flyout ? undefined : isOn(o)}
          aria-expanded={META[o].flyout ? flyout?.option === o : undefined}
          onClick={(e) => run(o, e.currentTarget)}
          onMouseDown={(e) => {
            // While cells are edited, keep the keyboard on the selected cell (and on the to-do for a formula).
            if (editingTable || o === 'math' || TASK_EDIT_OPTIONS.includes(o)) e.preventDefault();
          }}
        >
          <span className="tool-icon">
            <Icon name={META[o].icon} size={22} />
          </span>
          {!iconOnly(o) && <span className="tool-label">{META[o].label}</span>}
          {(o === 'color' || o === 'lineColor') && el.color && (
            <span className="ctx-swatch" style={{ background: COLORS[el.color] }} />
          )}
        </button>
      ))}
      {flyout &&
        createPortal(
          <div
            ref={flyoutRef}
            className="ctx-flyout"
            data-flyout={flyout.option}
            onMouseDown={(e) => {
              if (editingTable && !(e.target as HTMLElement).closest('input')) e.preventDefault();
            }}
            style={{ top: Math.min(flyout.top, window.innerHeight - 280), left: flyout.left }}
          >
            {flyoutBody()}
          </div>,
          document.body,
        )}
    </div>
  );
}
