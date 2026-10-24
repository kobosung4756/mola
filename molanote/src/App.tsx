import { useCallback, useEffect, useMemo, useRef, useState, useLayoutEffect } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import './App.css';
// The dark theme comes after the light styles it overrides (generated: tools/make-dark-css.py).
import './dark.css';
import type { El, ElMap, ElementType, LabelDef } from './types';
import { COLORS, PROFILE_ID, ROOT_ID } from './types';
import type { TableCell } from './types';
import {
  blobKeysIn,
  boardPath,
  boardToMarkdown,
  DEFAULT_WIDTH,
  containingBoard,
  deleteForever,
  elText,
  elTitle,
  insertSnapshot,
  isHidden,
  makeEl,
  makeSnapshot,
  pasteCopy,
  pasteCut,
  uid,
  labelDefsOf,
  toInbox,
  profileOf,
  restore,
  trashIds,
  update,
} from './model';
import type { Snapshot } from './model';
import { useStore } from './store';
import { Canvas } from './components/Canvas';
import { CommentsPanel, ProfileDialog } from './components/Comments';
import { CONTEXT_OPTIONS, ContextBar } from './components/ContextBar';
import { flushSync } from 'react-dom';
import { LatexSuggest } from './components/LatexSuggest';
import { blockPng, PICTURE_BLOCKS } from './clipImage';
import { textHas } from './hangul';
import { DiagramEditor } from './components/DiagramEditor';
import { ColorPicker } from './components/ColorPicker';
import { diagramBounds, emptyDiagram } from './diagram';
import { ALIGN_KEYS, alignedPlaces } from './align';
import type { AlignBox, AlignKind } from './align';
import { TextBar, TEXT_COLORS } from './components/TextBar';
import { isMathShortcut, OPEN_MATH_EVENT, TASK_FORMAT_EVENT } from './components/MathEditor';
import { CropImageDialog, DrawImageDialog } from './components/ImageTools';
import type { DrawSettings } from './draw';
import { INK_COLORS, INK_SIZES } from './draw';
import { Avatar } from './components/Avatar';
import { Icon } from './components/Icon';
import type { IconName } from './components/Icon';
import { LineControls } from './components/LineControls';
import { ToolStrip } from './components/ToolStrip';
import { ToolOrder } from './components/ToolOrder';
import { MenuPrefs } from './components/Settings';
import { useSlidingState } from './slideOut';
import { editStart } from './context';
import { FolderGuard } from './components/FolderGuard';
import { FolderPicker } from './components/FolderPicker';
import { FirstRunFolder } from './components/FirstRunFolder';
import { LinkPicker } from './components/LinkPicker';
import { DRAW_ON_EVENT } from './context';
import { ImageThumb, usePointerPick } from './components/ImageThumb';
import { noteBoardVisit, noteSearchPick, recentEdits, recentQueries, topPicks } from './recent';
import { ShortcutsHelp } from './components/ShortcutsHelp';
import RelationMap from './components/RelationMap';
import type { MapApi } from './components/RelationMap';
import { FindBar } from './components/FindBar';
import { blockLinkHtml, blockLinkText, copyBlockLink, copiedBlockLink, linkLabel, NEW_NOTE_NAME, SEARCH_KINDS, searchScope, setLinkPickerHost, setLinkResolver, unresolvedLinkText } from './blockLinks';
import type { Picked } from './blockLinks';
import { BoardTree } from './components/BoardTree';
import type { LineLook, LinePatch } from './components/LineControls';
import type { CanvasApi } from './components/Canvas';
import { addElement, addFiles, download, normalizeUrl } from './actions';
import type { ColumnSlot, Point } from './actions';
import { dataFolder, folderFirstRun, getBlob, LEGACY_STATE_KEY, putBlob } from './db';
import { textToHtml } from './sanitize';
import { tr } from './i18n';

const TOOLS: { type: ElementType; icon: string; label: string }[] = [
  { type: 'CARD', icon: 'note', label: tr('노트', 'Note') },
  { type: 'TASK_LIST', icon: 'todo', label: tr('할 일', 'To-do') },
  { type: 'LINK', icon: 'link', label: tr('링크', 'Link') },
  { type: 'IMAGE', icon: 'image', label: tr('이미지', 'Image') },
  { type: 'FILE', icon: 'file', label: tr('파일', 'File') },
  { type: 'COLUMN', icon: 'column', label: tr('컬럼', 'Column') },
  { type: 'BOARD', icon: 'board', label: tr('보드', 'Board') },
  { type: 'DIAGRAM', icon: 'diagram', label: tr('도형', 'Shapes') },
  { type: 'TABLE', icon: 'table', label: tr('표', 'Table') },
];

/** What each block tool makes, for its hover bubble (the shortcut goes in brackets). */
const TOOL_TIPS: Record<string, string> = {
  CARD: tr('서식 있는 글 · 클릭하거나 보드로 끌어다 놓기 (N)', 'Rich text · Click or drag onto the board (N)'),
  TASK_LIST: tr('체크하며 진행률을 보는 목록 · 클릭하거나 끌어다 놓기 (T)', 'Checklist with progress · Click or drag (T)'),
  LINK: tr('웹 주소를 미리보기 카드로 · 클릭하거나 끌어다 놓기 (H)', 'Web link as a preview card · Click or drag (H)'),
  IMAGE: tr('그림 파일 올리기 · 클릭하거나 끌어다 놓기 (I)', 'Upload an image · Click or drag (I)'),
  FILE: tr('아무 파일이나 올려 두기 · 클릭하거나 끌어다 놓기 (F)', 'Upload any file · Click or drag (F)'),
  COLUMN: tr('블록을 세로로 모아 두는 칸 · 클릭하거나 끌어다 놓기 (C)', 'Stack blocks vertically · Click or drag (C)'),
  BOARD: tr('블록을 담는 하위 보드 (선택 후 Enter로 열기) · 클릭하거나 끌어다 놓기 (B)', 'Sub-board for blocks (select, then Enter to open) · Click or drag (B)'),
  DIAGRAM: tr('블록선도: 도형과 연결선 그리기 · 클릭하거나 끌어다 놓기 (S)', 'Block diagram: shapes and connectors · Click or drag (S)'),
  TABLE: tr('수식으로 계산하는 표 · 클릭하거나 끌어다 놓기 (G)', 'Table with formulas · Click or drag (G)'),
};

/** A letter for each tool of the left bar besides N (note), L (line) and D (draw). */
const TOOL_KEYS: Record<string, ElementType> = {
  KeyT: 'TASK_LIST',
  KeyH: 'LINK',
  KeyI: 'IMAGE',
  KeyF: 'FILE',
  KeyC: 'COLUMN',
  KeyB: 'BOARD',
  KeyS: 'DIAGRAM',
  KeyG: 'TABLE',
};

/** The tool a key stands for (by the key's place, so a Korean layout works too). */
const toolKey = (e: KeyboardEvent): ElementType | undefined => TOOL_KEYS[e.code] ?? TOOL_KEYS['Key' + e.key.toUpperCase()];

/** The buttons of the bar shown over several picked blocks: what each does, its icon, its name and its key. */
const ALIGN_BUTTONS: [AlignKind, IconName, string, string, string][] = [
  ['left', 'objLeft', '왼쪽 맞춤', 'Align left', 'L'],
  ['center', 'objCenter', '가운데 맞춤', 'Align centre', 'C'],
  ['right', 'objRight', '오른쪽 맞춤', 'Align right', 'R'],
  ['top', 'objTop', '위쪽 맞춤', 'Align top', 'T'],
  ['middle', 'objMiddle', '중간 맞춤', 'Align middle', 'M'],
  ['bottom', 'objBottom', '아래쪽 맞춤', 'Align bottom', 'B'],
  ['hspace', 'distH', '가로 간격을 동일하게 (3개 이상)', 'Same gaps across (3 or more)', 'H'],
  ['vspace', 'distV', '세로 간격을 동일하게 (3개 이상)', 'Same gaps down (3 or more)', 'V'],
];

/** Every tool of the left bar, in the default order. */
const TOOL_INFO = [
  ...TOOLS.map((t) => ({ key: t.type as string, label: t.label, icon: t.icon })),
  { key: 'LINE', label: tr('연결선', 'Line'), icon: 'line' },
  { key: 'DRAW', label: tr('그리기', 'Draw'), icon: 'pen' },
];
/** The bar's default order: the most used blocks first, drawing last. */
/** About how tall a new block is, for putting its middle in the middle of the screen. */
const MIDDLE_H: Partial<Record<ElementType, number>> = { CARD: 44, TASK_LIST: 110, BOARD: 150, LINK: 80, IMAGE: 220, FILE: 64, COLUMN: 150, TABLE: 110, COLOR_SWATCH: 130, SKETCH: 200, DIAGRAM: 200 };

const DEFAULT_TOOL_ORDER = ['CARD', 'TASK_LIST', 'BOARD', 'LINE', 'COLUMN', 'TABLE', 'LINK', 'IMAGE', 'FILE', 'DIAGRAM', 'DRAW'];
const TOOL_ORDER_KEY = 'board-studio:tool-order';

/** The saved tool order of this browser; unknown keys are dropped and new tools join at the end. */
function loadToolOrder(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(TOOL_ORDER_KEY) ?? 'null');
    if (Array.isArray(saved)) {
      const known = saved.filter((k): k is string => typeof k === 'string' && DEFAULT_TOOL_ORDER.includes(k));
      return [...new Set([...known, ...DEFAULT_TOOL_ORDER])];
    }
  } catch {
    // Storage can be blocked; the default order is fine then.
  }
  return DEFAULT_TOOL_ORDER;
}

const parseHash = () => location.hash.match(/^#\/b\/([\w-]+)/)?.[1] ?? ROOT_ID;

/**
 * Blocks copied or cut in molanote live here. The system clipboard gets their text plus a hidden
 * marker in its HTML, so a paste can tell them from things copied elsewhere (those go to Unsorted).
 */
let clipboard: {
  snap: Snapshot;
  text: string;
  /** The hidden marker written with this copy. */
  token: string;
  /** The board they were copied from. */
  from: string;
  /** Cut: the first paste brings the very blocks back from the trash. */
  cut: boolean;
  /** How many times this copy has been pasted. */
  pastes: number;
} | null = null;
/** Set by Ctrl+C / Ctrl+X just before the browser's copy event, which then writes it to the system clipboard. */
let clipboardToWrite: { text: string; token: string; markOnly?: boolean } | null = null;
const CLIP_MARK = /data-molanote-clip="([\w-]+)"/;
/** The HTML put on the clipboard with copied blocks: their text, and the marker that says they are ours. */
const clipHtml = (text: string, token: string) =>
  `<meta data-molanote-clip="${token}"><div>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</div>`;
/** Text compared without the line endings Windows adds. */
const sameText = (a: string, b: string) => a.replace(/\r\n/g, '\n').trim() === b.replace(/\r\n/g, '\n').trim();

export default function App() {
  const store = useStore();
  const [accountOpen, setAccountOpen] = useState(false);
  const { els, commit, undo, redo, breakMerge, pullFolder, readOnly, setReadOnly } = store;
  const [hashBoard, setHashBoard] = useState(parseHash);
  const [selection, setSelection] = useState<string[]>([]);
  const [editingId, setEditingIdRaw] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  /** The relation map (bottom-right switch, Shift+G) over the board. */
  const [mapOpen, setMapOpen] = useState(false);
  /** While the map is open, the top bar's zoom (buttons, keys) works on it; its zoom is shown there. */
  const mapApiRef = useRef<MapApi | null>(null);
  const [mapZoom, setMapZoom] = useState(1);
  const [panel, setPanel] = useSlidingState<'none' | 'search' | 'trash' | 'comments' | 'unsorted'>('none', 'none', 'aside.panel');
  /** The panel shown before, and whether it was swapped for another one (then it opens without animating). */
  const panelWas = useRef({ panel, swap: false });
  if (panelWas.current.panel !== panel) panelWas.current = { panel, swap: panelWas.current.panel !== 'none' && panel !== 'none' };
  const [commentTarget, setCommentTarget] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const lastCtx = useRef<string | null>(null);
  /** The order of the left bar's tools, kept in this browser. */
  const [toolOrder, setToolOrder] = useState<string[]>(loadToolOrder);
  const [orderOpen, setOrderOpen] = useState(false);
  /** Breadcrumb whose › menu (the boards under it) is open. */
  const [treeFor, setTreeFor] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const saveToolOrder = (keys: string[]) => {
    setToolOrder(keys);
    try {
      localStorage.setItem(TOOL_ORDER_KEY, JSON.stringify(keys));
    } catch {
      // Not saved; the order still holds for this visit.
    }
  };
  /** Selected cell of a table block. */
  const [tableCell, setTableCell] = useState<TableCell | null>(null);
  /** Whether a text bubble (colour or link) holds the note's selection. */
  const [, setTextPinned] = useState(false);
  /** Draw mode on the board (pen, highlighter or eraser), or off. */
  const [drawing, setDrawing] = useState<DrawSettings | null>(null);
  const [imageTool, setImageTool] = useState<{ kind: 'draw' | 'crop'; id: string } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [menuOpen, setMenuOpen] = useState(false);
  /** Moving the data folder: the folder picker is open on the PC. */
  const [moving, setMoving] = useState(false);
  const [pickingFolder, setPickingFolder] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  /** Ctrl+F: finding text inside the block being edited. */
  const [findIn, setFindIn] = useState<string | null>(null);
  /** An option of the left bar to open for this block once it shows (right-click › Add tag). */
  const [openCtx, setOpenCtx] = useState<{ id: string; option: 'label' } | null>(null);
  /** The colour palette of the drawing bar (spectrum, eyedropper), open or not. */
  const [inkPicker, setInkPicker] = useState(false);
  /** The block-diagram editor: for a diagram block (id), or a new one to put at `at`. */
  const [diagramEdit, setDiagramEdit] = useState<{ id?: string; at?: Point; slot?: ColumnSlot | null } | null>(null);
  // A diagram block "opened for editing" (a double-click on it): its editor instead.
  useEffect(() => {
    // (A caption being typed ends with the editing.)
    if (!editingId && editStart.by === 'caption') editStart.id = editStart.by = null;
    if (editingId && els?.[editingId]?.type === 'DIAGRAM') {
      // Its caption being typed: stays on the board. Otherwise the diagram's own editor.
      if (editStart.id === editingId && editStart.by === 'caption') return;
      setDiagramEdit({ id: editingId });
      setEditingId(null);
    }
  }, [editingId]); // eslint-disable-line react-hooks/exhaustive-deps
  /** The first-run question: where the data is kept (asked once per PC). */
  const [askFolder, setAskFolder] = useState(folderFirstRun);
  const [toast, setToast] = useState<string | null>(null);
  const apiRef = useRef<CanvasApi | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const pendingFile = useRef<{ kind: 'IMAGE' | 'FILE'; at: Point; slot: ColumnSlot | null } | null>(null);
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);
  const [lineDefaults, setLineDefaultsRaw] = useState<LineLook>(loadLineDefaults);
  const setLineDefaults = (look: LineLook) => {
    setLineDefaultsRaw(look);
    try {
      localStorage.setItem(LINE_DEFAULTS_KEY, JSON.stringify(look));
    } catch {
      // Remembering the last line style is only a convenience.
    }
  };

  const setEditingId = useCallback(
    (id: string | null) => {
      // Read-only (the data folder is in use on another PC): nothing opens for editing.
      if (id && readOnly) {
        dispatchEvent(new Event('molanote:read-only'));
        return;
      }
      breakMerge();
      setEditingIdRaw(id);
    },
    [breakMerge, readOnly],
  );

  const boardId =
    els && els[hashBoard]?.type === 'BOARD' && !isHidden(els, hashBoard) ? hashBoard : ROOT_ID;

  useEffect(() => {
    const f = () => setHashBoard(parseHash());
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 2600);
  };

  // A change refused while read-only says why (once in a while, not on every key).
  useEffect(() => {
    let last = 0;
    const said = () => {
      if (Date.now() - last < 2600) return;
      last = Date.now();
      setToast(tr('읽기 전용으로 보는 중입니다. 위의 "편집하기"를 누르면 고칠 수 있습니다.', 'Viewing read-only. Press "Edit" at the top to make changes.'));
      window.setTimeout(() => setToast(null), 2600);
    };
    addEventListener('molanote:read-only', said);
    return () => removeEventListener('molanote:read-only', said);
  }, []);

  useEffect(() => setMapOpen(false), [boardId]);
  useEffect(() => {
    if (panel === 'search') setMapOpen(false);
  }, [panel]);
  const openBoard = useCallback(
    (id: string) => {
      // Going to a board (the tree, the path on top, back and forward) leaves the relation map.
      setMapOpen(false);
      // A board shortcut opens the board it points to.
      const ref = els?.[id]?.boardRef;
      if (ref) {
        if (!els?.[ref] || isHidden(els, ref)) {
          flash(tr('원본 보드가 휴지통에 있거나 지워졌습니다', 'The original board is in the trash or was deleted'));
          return;
        }
        id = ref;
      }
      setSelection([]);
      setEditingId(null);
      setConnecting(false);
      // Where its card is on screen, for the board to open out of it.
      const card = document.querySelector('.layer .el-board.selected') ?? document.querySelector(`.layer [data-el-id="${id}"]`);
      const r = card?.getBoundingClientRect();
      boardFrom.current = r && r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
      location.hash = id === ROOT_ID ? '#/' : `#/b/${id}`;
    },
    [setEditingId, els],
  );
  /*
   * Opening a board: the view grows out of the board's card. Leaving it for the board it is in: the
   * view comes out of that card (as if it went into it). Any other board: a short zoom from the middle.
   */
  const stageRef = useRef<HTMLElement | null>(null);
  const boardFrom = useRef<{ x: number; y: number } | null>(null);
  const shownBoard = useRef(boardId);
  useLayoutEffect(() => {
    const prev = shownBoard.current;
    shownBoard.current = boardId;
    const from = boardFrom.current;
    boardFrom.current = null;
    const stage = stageRef.current;
    if (prev === boardId || !stage || !els || !stage.animate) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    /** Whether board `a` is inside board `b` (at any depth). */
    const within = (a: string, b: string) => {
      let cur = els[a];
      for (let i = 0; cur && i < 100; i++) {
        if (cur.loc.parentId === b) return true;
        cur = els[cur.loc.parentId];
      }
      return false;
    };
    const sr = stage.getBoundingClientRect();
    let origin = { x: sr.left + sr.width / 2, y: sr.top + sr.height / 2 };
    let frames: Keyframe[];
    if (within(prev, boardId)) {
      // Out: from inside the card (here) of the board that was left.
      let child = els[prev];
      for (let i = 0; child && child.loc.parentId !== boardId && i < 100; i++) child = els[child.loc.parentId];
      const card = child && document.querySelector(`.layer [data-el-id="${child.id}"]`);
      const r = card?.getBoundingClientRect();
      if (r && r.width) origin = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      frames = [
        { transform: 'scale(3.2)', opacity: 0 },
        { transform: 'scale(1)', opacity: 1 },
      ];
    } else {
      // In: out of the card that was opened (or the middle).
      if (from && within(boardId, prev)) origin = from;
      frames = within(boardId, prev)
        ? [
            { transform: 'scale(0.15)', opacity: 0.15 },
            { transform: 'scale(1)', opacity: 1 },
          ]
        : [
            { transform: 'scale(0.94)', opacity: 0.4 },
            { transform: 'scale(1)', opacity: 1 },
          ];
    }
    // Only the board's content: the Unsorted panel, its tab and the bars stay where they are.
    const zoomed = stage.querySelector<HTMLElement>('.board-zoom');
    const cr = stage.querySelector('.canvas')?.getBoundingClientRect() ?? sr;
    if (!zoomed) return;
    zoomed.style.transformOrigin = `${origin.x - cr.left}px ${origin.y - cr.top}px`;
    zoomed.animate(frames, { duration: 300, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
  }, [boardId]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Keep selection pointing at visible elements after undo, delete or navigation. */
  const liveSelection = useMemo(
    () => (els ? selection.filter((id) => els[id] && !isHidden(els, id)) : []),
    [els, selection],
  );

  useEffect(() => {
    if (!pendingFocus || !els) return;
    if (containingBoard(els, pendingFocus) !== boardId) return;
    const id = pendingFocus;
    setPendingFocus(null);
    requestAnimationFrame(() => {
      const node = document.querySelector<HTMLElement>(`.layer [data-el-id="${id}"]`);
      // Inside a scrolling column or to-do list, scroll it so the item shows.
      const box = node?.parentElement?.closest<HTMLElement>('.column-body, .tasks-scroll');
      if (node && box) {
        const nb = node.getBoundingClientRect();
        const bb = box.getBoundingClientRect();
        if (nb.top < bb.top || nb.bottom > bb.bottom) box.scrollTop += nb.top - bb.top - (bb.height - nb.height) / 2;
      }
      apiRef.current?.focusOn(id);
      // A moment of glow says which one it is.
      if (node) {
        node.classList.remove('search-glow');
        void node.offsetWidth;
        node.classList.add('search-glow');
        window.setTimeout(() => node.classList.remove('search-glow'), 2600);
      }
    });
  }, [pendingFocus, boardId, els]);

  /**
   * After an undo or redo: if what changed is out of sight (another board, or off screen), go to it
   * and light it up, so the change can be seen. What is already in view is left as it is.
   */
  const showChange = (step: { before: ElMap; after: ElMap; ids: string[] } | null) => {
    if (!step || !step.ids.length) return;
    const { before, after, ids } = step;
    const visible = (m: ElMap, id: string) => !!m[id] && !isHidden(m, id) && m[id].type !== 'PROFILE' && m[id].type !== 'LABELS';
    // A block that is there after the step (for a line: one of its ends); else where a removed one was.
    let target = ids.find((id) => visible(after, id) && after[id].type !== 'LINE');
    if (!target) {
      const line = ids.map((id) => after[id]).find((e) => e?.type === 'LINE');
      target = [line?.content.from, line?.content.to].find((id): id is string => !!id && visible(after, id));
    }
    if (!target) {
      const gone = ids.find((id) => visible(before, id) && before[id].type !== 'LINE');
      if (!gone) return;
      const was = containingBoard(before, gone);
      if (was !== boardId && after[was] && !isHidden(after, was)) location.hash = was === ROOT_ID ? '#/' : `#/b/${was}`;
      return;
    }
    const board = containingBoard(after, target);
    if (board !== boardId) {
      setEditingId(null);
      location.hash = board === ROOT_ID ? '#/' : `#/b/${board}`;
      setPendingFocus(target);
      return;
    }
    // On this board: only when it is out of sight.
    const id = target;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const node = document.querySelector<HTMLElement>(`.layer [data-el-id="${id}"]`);
        const view = document.querySelector<HTMLElement>('.canvas')?.getBoundingClientRect();
        if (!node || !view) return;
        const r = node.getBoundingClientRect();
        const seen = Math.max(0, Math.min(r.right, view.right) - Math.max(r.left, view.left)) * Math.max(0, Math.min(r.bottom, view.bottom) - Math.max(r.top, view.top));
        if (seen < 0.5 * r.width * r.height) setPendingFocus(id);
      }),
    );
  };
  /* The [[ ]] link picker, asked for by a note or to-do being edited. */
  const [picker, setPicker] = useState<((p: Picked) => void) | null>(null);
  // The search and the trash close when something outside them is clicked (not their own buttons).
  useEffect(() => {
    if (panel !== 'search' && panel !== 'trash') return;
    const down = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t?.closest || t.closest('.panel, [data-panel-toggle], .image-thumb, .gate-backdrop, .lp-backdrop, .ctx-menu')) return;
      setPanel('none');
    };
    window.addEventListener('pointerdown', down, true);
    return () => window.removeEventListener('pointerdown', down, true);
  }, [panel]);
  const elsForF2 = useRef(els);
  elsForF2.current = els;
  /** Titles and captions F2 put up ("id:title", "id:caption"): taken away again if left empty. */
  const f2Shown = useRef(new Set<string>());
  const dropEmptyField = (id: string, field: 'title' | 'caption', value?: string) => {
    const key = `${id}:${field}`;
    if (!f2Shown.current.has(key)) return;
    f2Shown.current.delete(key);
    const now = elsForF2.current?.[id];
    const text = value ?? (field === 'title' ? now?.content.title : now?.content.caption) ?? '';
    if (text.trim()) return;
    commit((m) => update(m, id, { content: field === 'title' ? { showTitle: false, title: undefined } : { showCaption: false, caption: undefined } }));
  };
  // Editing ends with a title or caption F2 put up still empty: it goes.
  const lastEditing = useRef<string | null>(null);
  useEffect(() => {
    const was = lastEditing.current;
    lastEditing.current = editingId;
    if (!was || was === editingId) return;
    dropEmptyField(was, 'title');
    dropEmptyField(was, 'caption');
  }, [editingId]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Goes on drawing into a drawing block (Enter or a double-click on it): the pen, its strokes added to it. */
  const drawOn = (id: string) => {
    setConnecting(false);
    setEditingId(null);
    setSelection([]);
    setDrawing((d) => (d && d.tool !== 'eraser' && d.tool !== 'select' ? d : { tool: 'pen', color: d?.color ?? INK_COLORS[0], size: d?.size ?? INK_SIZES[1] }));
    // After the board has turned drawing on (which starts a new drawing otherwise).
    setTimeout(() => dispatchEvent(new CustomEvent(DRAW_ON_EVENT, { detail: id })), 0);
  };
  /**
   * Arrow keys on the board: the picked block moves on to the nearest block that way (ahead of it,
   * not far off to the side). With none picked, the block nearest the middle of the screen is
   * picked first. A block out of sight is brought into view.
   */
  const stepBlocks = (dir: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight') => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('.layer > [data-el-id], .layer > .el-stack > [data-el-id]')).filter(
      (n) => els?.[n.dataset.elId!] && els[n.dataset.elId!].type !== 'LINE',
    );
    if (!nodes.length) return;
    const centre = (n: HTMLElement) => {
      const r = n.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, r };
    };
    const stage = document.querySelector('.canvas')?.getBoundingClientRect();
    const show = (id: string) => {
      setSelection([id]);
      const node = nodes.find((n) => n.dataset.elId === id);
      const r = node?.getBoundingClientRect();
      if (stage && r && (r.left < stage.left || r.right > stage.right || r.top < stage.top || r.bottom > stage.bottom)) apiRef.current?.focusOn(id);
    };
    const cur = liveSelection.length === 1 ? nodes.find((n) => n.dataset.elId === liveSelection[0]) : undefined;
    if (!cur) {
      // Nothing picked (or several): the block nearest the middle of the screen.
      const mx = stage ? stage.left + stage.width / 2 : innerWidth / 2;
      const my = stage ? stage.top + stage.height / 2 : innerHeight / 2;
      let best: HTMLElement | null = null;
      let bd = Infinity;
      for (const n of nodes) {
        const c = centre(n);
        const d = Math.hypot(c.x - mx, c.y - my);
        if (d < bd) (bd = d), (best = n);
      }
      if (best) show(best.dataset.elId!);
      return;
    }
    const from = centre(cur);
    const vx = dir === 'ArrowRight' ? 1 : dir === 'ArrowLeft' ? -1 : 0;
    const vy = dir === 'ArrowDown' ? 1 : dir === 'ArrowUp' ? -1 : 0;
    let best: HTMLElement | null = null;
    let bs = Infinity;
    for (const n of nodes) {
      if (n === cur) continue;
      const c = centre(n);
      const dx = c.x - from.x;
      const dy = c.y - from.y;
      const ahead = dx * vx + dy * vy;
      const side = Math.abs(dx * vy - dy * vx);
      // Ahead of it, within a wide cone; nearer and straighter ahead is better.
      if (ahead <= 4 || side > ahead * 2.2) continue;
      const score = ahead + side * 1.8;
      if (score < bs) (bs = score), (best = n);
    }
    if (best) show(best.dataset.elId!);
  };
  /** The picked blocks that can be lined up: on the board, not lines, not locked. */
  const alignable = () =>
    liveSelection.filter((id) => els?.[id] && els[id].loc.section === 'CANVAS' && els[id].type !== 'LINE' && !els[id].locked);
  /** Lines the picked blocks up (Shift+L/C/R/T/M/B, Shift+H/V for the same gaps), in one step. */
  const alignSelection = (kind: AlignKind) => {
    if (!els) return;
    const boxes: AlignBox[] = [];
    for (const id of alignable()) {
      const node = document.querySelector<HTMLElement>(`.layer > [data-el-id="${id}"], .layer > .el-stack > [data-el-id="${id}"]`);
      if (!node) continue;
      boxes.push({ id, x: els[id].loc.x, y: els[id].loc.y, w: node.offsetWidth, h: node.offsetHeight });
    }
    const places = alignedPlaces(boxes, kind);
    if (!places.size) return;
    commit((m) => {
      for (const [id, p] of places) update(m, id, { loc: { ...m[id].loc, x: p.x, y: p.y } });
    });
  };
  /** Ctrl+O: the finder for a board to go to. */
  const [boardFinder, setBoardFinder] = useState(false);
  useEffect(() => {
    setLinkPickerHost((done) => setPicker(() => done));
    return () => setLinkPickerHost(null);
  }, []);
  // A link opened up as [[address|alias]] needs the blocks' names.
  const elsNow = useRef(els);
  elsNow.current = els;
  useEffect(() => {
    setLinkResolver({
      title: (id) => {
        const e = elsNow.current?.[id];
        return e ? linkLabel(e) : undefined;
      },
      byTitle: (name) => {
        const m = elsNow.current;
        if (!m || !name.trim()) return undefined;
        const want = name.trim().toLowerCase();
        return Object.values(m).find((e) => e.type !== 'LINE' && e.type !== 'LABELS' && !isHidden(m, e.id) && linkLabel(e).toLowerCase() === want)?.id;
      },
      byAddress: (address) => {
        const m = elsNow.current;
        if (!m || address.length < 4) return undefined;
        if (m[address]) return address;
        const hits = Object.keys(m).filter((id) => id.startsWith(address));
        return hits.length === 1 ? hits[0] : undefined;
      },
    });
    return () => setLinkResolver(null);
  }, []);

  /** Following a link to a block (in a note or a to-do): to that block, or a word when it is gone. */
  const followLink = (id: string) => {
    if (!els?.[id] || isHidden(els, id)) {
      flash(
        !els?.[id]
          ? tr('링크된 블록을 찾을 수 없습니다 · 주소(^…)를 확인하세요', "Can't find the linked block · check its address (^…)")
          : tr('링크된 블록이 휴지통에 있습니다', 'The linked block is in the trash'),
      );
      return;
    }
    setEditingId(null);
    showBlock(id);
  };
  /**
   * Pressing an unresolved link: a new note of its name (in the middle of the screen), the link
   * pointed at it, and the note open for writing.
   */
  const makeLinkedNote = (a: HTMLElement) => {
    const name = a.dataset.new || NEW_NOTE_NAME();
    const hostId = a.closest<HTMLElement>('[data-el-id]')?.dataset.elId;
    const taskId = a.closest<HTMLElement>('li[data-task-id]')?.dataset.taskId;
    const note = makeEl('CARD', { parentId: boardId }, { html: '', title: name, showTitle: true });
    const spot = middleSpot('CARD');
    note.loc.x = Math.round(spot.x - note.width / 2);
    note.loc.y = Math.round(spot.y - 40);
    const wanted = a.dataset.new ?? '';
    // The link on screen too (a note being edited saves what it shows when it closes).
    a.classList.remove('unresolved');
    a.removeAttribute('data-new');
    a.setAttribute('data-ref', note.id);
    commit((m) => {
      m[note.id] = note;
      const host = hostId ? m[hostId] : undefined;
      if (!host) return;
      if (host.type === 'CARD') {
        const doc = new DOMParser().parseFromString(`<body>${host.content.html ?? ''}</body>`, 'text/html');
        const link = Array.from(doc.querySelectorAll<HTMLElement>('a.block-link.unresolved')).find((x) => (x.dataset.new ?? '') === wanted);
        if (link) {
          link.classList.remove('unresolved');
          link.removeAttribute('data-new');
          link.setAttribute('data-ref', note.id);
          update(m, host.id, { content: { html: doc.body.innerHTML } });
        }
      } else if (host.type === 'TASK_LIST' && taskId) {
        const from = unresolvedLinkText(wanted);
        update(m, host.id, {
          content: { tasks: (host.content.tasks ?? []).map((t) => (t.id === taskId && t.text.includes(from) ? { ...t, text: t.text.replace(from, blockLinkText(note.id, name)) } : t)) },
        });
      }
    });
    setSelection([note.id]);
    setEditingId(note.id);
  };
  const followRef = useRef(followLink);
  followRef.current = followLink;
  const makeRef = useRef(makeLinkedNote);
  makeRef.current = makeLinkedNote;
  useEffect(() => {
    const click = (e: MouseEvent) => {
      // An embed goes to its block from its address, shown while the note is edited (not from what it shows).
      const embed = (e.target as HTMLElement).closest?.<HTMLElement>('.embed.editing[data-ref] > .embed-addr');
      if (embed && embed.closest('.layer, .unsorted-panel')) {
        e.preventDefault();
        e.stopPropagation();
        followRef.current(embed.parentElement!.dataset.ref!);
        return;
      }
      const a = (e.target as HTMLElement).closest?.<HTMLElement>('a.block-link');
      if (!a || !a.closest('.layer, .unsorted-panel, .search-panel')) return;
      e.preventDefault();
      e.stopPropagation();
      if (a.dataset.ref) followRef.current(a.dataset.ref);
      else if (a.dataset.new !== undefined) makeRef.current(a);
    };
    addEventListener('click', click, true);
    return () => removeEventListener('click', click, true);
  }, []);
  // Links whose block is gone look so.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      for (const a of Array.from(document.querySelectorAll<HTMLElement>('a.block-link[data-ref]'))) {
        const ref = a.dataset.ref ?? '';
        const missing = !els?.[ref] || isHidden(els, ref);
        a.classList.toggle('missing', missing);
        if (missing) a.title = !els?.[ref] ? tr('찾을 수 없는 블록 (주소가 바뀌었거나 지워짐)', 'Block not found (its address changed, or it was deleted)') : tr('휴지통에 있는 블록', 'Block in the trash');
        else if (a.title) a.removeAttribute('title');
      }
    });
    return () => cancelAnimationFrame(frame);
  });

  /*
   * The boards visited, for Ctrl+[ (back) and Ctrl+] (forward), like a web browser's history:
   * going somewhere new after going back drops what was ahead.
   */
  const visits = useRef<{ list: string[]; at: number; stepping: boolean }>({ list: [], at: -1, stepping: false });
  useEffect(() => {
    const v = visits.current;
    if (v.stepping) {
      v.stepping = false;
      return;
    }
    if (v.list[v.at] === boardId) return;
    noteBoardVisit(boardId);
    v.list = [...v.list.slice(0, v.at + 1), boardId];
    v.at = v.list.length - 1;
  }, [boardId]);
  const stepHistory = (by: number) => {
    const v = visits.current;
    let i = v.at + by;
    // Boards since deleted are skipped.
    while (i >= 0 && i < v.list.length && v.list[i] !== ROOT_ID && (!els?.[v.list[i]] || isHidden(els, v.list[i]))) i += by;
    if (i < 0 || i >= v.list.length || v.list[i] === boardId) return;
    v.at = i;
    v.stepping = true;
    openBoard(v.list[i]);
  };

  const undoAndShow = () => showChange(undo());
  const redoAndShow = () => showChange(redo());

  const center = () => apiRef.current?.center() ?? { x: 200, y: 200 };

  /** Free spot near the viewport centre sized for the element type, so new items do not overlap. */
  const freeSpot = (type: ElementType = 'CARD'): Point =>
    apiRef.current?.freeSpot(DEFAULT_WIDTH[type], type === 'IMAGE' ? 280 : 120) ?? center();

  /**
   * Where a block made from the left bar goes: its middle on the middle of what is on screen (not
   * its top edge, so tall blocks are centred too). If something is already there, the nearest
   * empty spot, so nothing gets covered.
   */
  const middleSpot = (type: ElementType): Point => {
    // (The long end-to-end test builds one crowded board on the old placement; it asks for that.)
    if ((window as unknown as { __molanoteOldPlacement?: boolean }).__molanoteOldPlacement) return freeSpot(type);
    const c = center();
    const h = MIDDLE_H[type] ?? 100;
    const at = { x: Math.round(c.x), y: Math.round(c.y - h / 2 + 40) };
    return apiRef.current?.freeSpot(DEFAULT_WIDTH[type], h, at, undefined, true) ?? at;
  };

  const createTool = useCallback(
    (type: ElementType, at: Point, slot: ColumnSlot | null = null) => {
      if (type === 'LINE') {
        // A loose line: drag each end onto a block to connect it.
        const line = makeEl('LINE', { parentId: boardId }, {
          arrow: true,
          label: '',
          ...lineDefaults.content,
          fromPoint: { x: Math.round(at.x - 90), y: Math.round(at.y) },
          toPoint: { x: Math.round(at.x + 90), y: Math.round(at.y) },
        });
        if (lineDefaults.color) line.color = lineDefaults.color;
        commit((m) => {
          m[line.id] = line;
        });
        setSelection([line.id]);
        return;
      }
      if (type === 'DIAGRAM') {
        // The diagram editor opens; the block is made when it is done.
        setDiagramEdit({ at, slot });
        return;
      }
      if (type === 'IMAGE' || type === 'FILE') {
        pendingFile.current = { kind: type, at, slot };
        if (fileInput.current) {
          fileInput.current.accept = type === 'IMAGE' ? 'image/*' : '';
          fileInput.current.value = '';
          fileInput.current.click();
        }
        return;
      }
      const id = addElement(commit, type, boardId, at, slot);
      setSelection([id]);
      // A new table opens for editing at A1, ready to type.
      if (type === 'TABLE') setTableCell({ id, r: 0, c: 0 });
      setEditingId(id);
    },
    [commit, boardId, setEditingId, lineDefaults],
  );

  useEffect(() => {
    const onToolDrop = (e: Event) => {
      const { tool, at, slot } = (e as CustomEvent).detail as { tool: ElementType; at: Point; slot: ColumnSlot | null };
      createTool(tool, at, slot);
    };
    window.addEventListener('board-tool-drop', onToolDrop);
    return () => window.removeEventListener('board-tool-drop', onToolDrop);
  }, [createTool]);

  const onFilesPicked = async (files: FileList | null) => {
    const p = pendingFile.current;
    pendingFile.current = null;
    if (!files?.length || !p) return;
    const ids = await addFiles(commit, Array.from(files), boardId, p.at, p.slot);
    setSelection(ids);
  };

  /* ---------- Selection actions ---------- */

  const trashSelection = useCallback(() => {
    if (!liveSelection.length) return;
    commit((m) => trashIds(m, liveSelection));
    setSelection([]);
    setEditingId(null);
  }, [commit, liveSelection, setEditingId]);

  const copySelection = useCallback(
    (cut = false) => {
      if (!els || !liveSelection.length) return false;
      // Copied boards are pasted as shortcuts (their contents are not copied); a cut board moves whole.
      const snap = makeSnapshot(els, liveSelection, { shortcuts: !cut });
      const count = snap.roots.length + (snap.loose?.length ?? 0);
      if (!count) return false;
      const text = snap.roots.map((id) => elText(els[id])).filter(Boolean).join('\n\n') || tr(`[molanote ${count}개 항목]`, `[molanote: ${count} items]`);
      const token = uid();
      clipboard = { snap, text, token, from: boardId, cut, pastes: 0 };
      /*
       * A picture, drawing or diagram on its own goes on the clipboard as a picture, for other
       * programs: the PNG, and HTML holding the same picture (with molanote's marker, so pasting it
       * on a board still copies the block). No plain text: other programs would paste that instead.
       * The browser's own copy (right away) puts just the marker; the picture follows over it, once
       * it is drawn (where the browser lets a page put pictures on the clipboard).
       */
      const only = liveSelection.length === 1 ? els[liveSelection[0]] : null;
      if (only && PICTURE_BLOCKS.has(only.type) && typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        const png = blockPng(only);
        const html = png
          .then((b) => new Promise<string>((ok) => {
            const r = new FileReader();
            r.onload = () => ok(String(r.result));
            r.readAsDataURL(b);
          }))
          .then((url) => new Blob([`<meta data-molanote-clip="${token}"><img src="${url}" alt="">`], { type: 'text/html' }));
        navigator.clipboard.write([new ClipboardItem({ 'text/html': html, 'image/png': png })]).catch(() => {});
        clipboardToWrite = { text, token, markOnly: true };
        return true;
      }
      clipboardToWrite = { text, token };
      return true;
    },
    [els, liveSelection, boardId],
  );

  /* The browser's copy/cut event right after Ctrl+C / Ctrl+X: the text, and the marker in the HTML. */
  useEffect(() => {
    const write = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement;
      if (!clipboardToWrite || !e.clipboardData || t.closest?.('input, textarea, [contenteditable="true"]')) return;
      const { text, token, markOnly: markOnlyNow } = clipboardToWrite;
      clipboardToWrite = null;
      e.preventDefault();
      // (A picture block: only the marker, no text for other programs to paste instead of its picture.)
      if (!markOnlyNow) e.clipboardData.setData('text/plain', text);
      e.clipboardData.setData('text/html', markOnlyNow ? `<meta data-molanote-clip="${token}">` : clipHtml(text, token));
    };
    addEventListener('copy', write);
    addEventListener('cut', write);
    return () => {
      removeEventListener('copy', write);
      removeEventListener('cut', write);
    };
  }, []);

  /*
   * Unsorted is one of the side panels (with search, the trash and comments): one at a time, in the
   * same place, so switching between any of them looks the same. The board draws its contents into it.
   */
  const unsortedOpen = panel === 'unsorted';
  const panelNow = useRef(panel);
  panelNow.current = panel;
  const setUnsortedOpen = useCallback(
    (open: boolean) => {
      if (open) setPanel('unsorted');
      else if (panelNow.current === 'unsorted') setPanel('none');
    },
    [setPanel],
  );
  const [unsortedSlot, setUnsortedSlot] = useState<HTMLElement | null>(null);

  const pasteSnapshot = useCallback(
    (snap: Snapshot, offset: number, inbox = false) => {
      let ids: string[] = [];
      const c = center();
      commit((m) => {
        ids = insertSnapshot(m, snap, boardId, { dx: offset, dy: offset }, c);
        if (inbox) toInbox(m, ids, boardId);
      });
      setSelection(ids);
      if (inbox) setUnsortedOpen(true);
    },
    [commit, boardId],
  );

  /**
   * Pastes what was copied or cut in molanote onto this board, keeping how the blocks lie together.
   * On the board they came from it goes a little down and right of them (further each time);
   * on another board, in the middle of the screen. The first paste after a cut moves the very blocks.
   */
  const pasteOwn = () => {
    const clip = clipboard;
    if (!clip || !els) return;
    clip.pastes++;
    const canvasRoots = clip.snap.items.filter((e) => clip.snap.roots.includes(e.id) && e.loc.section === 'CANVAS');
    const c = center();
    const firstCut = clip.cut && clip.pastes === 1;
    let offset = { dx: 24 * clip.pastes, dy: 24 * clip.pastes };
    if (firstCut && clip.from === boardId) offset = { dx: 0, dy: 0 };
    else if (clip.from !== boardId && canvasRoots.length) {
      const l = Math.min(...canvasRoots.map((e) => e.loc.x));
      const t = Math.min(...canvasRoots.map((e) => e.loc.y));
      const r = Math.max(...canvasRoots.map((e) => e.loc.x + (e.width || 200)));
      const b = Math.max(...canvasRoots.map((e) => e.loc.y + 120));
      const k = 24 * (clip.pastes - 1);
      offset = { dx: Math.round(c.x - (l + r) / 2) + k, dy: Math.round(c.y - (t + b) / 2) + k };
    }
    const place = { offset, fallback: c };
    let ids: string[] = [];
    commit((m) => {
      ids = (firstCut && pasteCut(m, clip.snap, boardId, place)) || pasteCopy(m, clip.snap, boardId, place, clip.pastes);
    });
    setEditingId(null);
    setSelection(ids);
  };

  const duplicate = useCallback(() => {
    if (!els || !liveSelection.length) return;
    pasteSnapshot(makeSnapshot(els, liveSelection), 24);
  }, [els, liveSelection, pasteSnapshot]);


  /** Opens the inline label editor on a line. */
  const editLineLabel = useCallback(
    (id: string) => {
      setSelection([id]);
      setEditingId(id);
    },
    [setEditingId],
  );

  /** Profile shown on this account's comments. */
  const me = useMemo(() => profileOf(els, 'local'), [els]);

  /** Comments open in a speech bubble beside the block's comment icon. */
  const openComments = useCallback((id: string) => {
    setCommentTarget(id);
  }, []);
  const closeComments = useCallback(() => setCommentTarget(null), []);

  /** Shows a block on its board: goes there, selects it, scrolls it into view and lights it up. */
  const showBlock = useCallback(
    (id: string) => {
      if (!els?.[id]) return;
      const target = containingBoard(els, id);
      setSelection([id]);
      setPendingFocus(id);
      if (target !== boardId) {
        location.hash = target === ROOT_ID ? '#/' : `#/b/${target}`;
        setEditingId(null);
      }
    },
    [els, boardId, setEditingId],
  );

  /*
   * Ctrl+M+K / Ctrl+M+B / Ctrl+M+R (Ctrl held): black, blue or red text in the note or to-do being
   * edited (the picked text, or what is typed next). Ctrl+M and letting go of Ctrl: the formula editor.
   */
  const chordEdit = useRef<{ id: string; type: string } | null>(null);
  chordEdit.current = editingId && els?.[editingId] ? { id: editingId, type: els[editingId].type } : null;
  useEffect(() => {
    let pending: { id: string; type: string; used: boolean } | null = null;
    // At once (not on the next frame), so keys typed right after go into the formula editor.
    const openMathNow = (id: string) => flushSync(() => window.dispatchEvent(new CustomEvent(OPEN_MATH_EVENT, { detail: id })));
    const COLOUR: Record<string, string> = { KeyK: TEXT_COLORS[0], KeyB: '#1971c2', KeyR: '#e03131' };
    const down = (e: KeyboardEvent) => {
      const ed = chordEdit.current;
      if (pending && !e.ctrlKey && !e.metaKey && e.key !== 'Control' && e.key !== 'Meta') pending = null;
      if (!pending && ed && (ed.type === 'CARD' || ed.type === 'TASK_LIST') && isMathShortcut(e) && !e.repeat) {
        e.preventDefault();
        e.stopImmediatePropagation();
        pending = { ...ed, used: false };
        return;
      }
      if (!pending || e.key === 'Control' || e.key === 'Meta') return;
      if ((e.ctrlKey || e.metaKey) && isMathShortcut(e)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      const colour = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey ? COLOUR[e.code] : undefined;
      if (!colour) {
        // Something else: Ctrl+M was the formula editor after all.
        const id = pending.id;
        pending = null;
        openMathNow(id);
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      pending.used = true;
      if (pending.type === 'TASK_LIST') {
        window.dispatchEvent(new CustomEvent(TASK_FORMAT_EVENT, { detail: { id: pending.id, kind: 'color', value: colour } }));
      } else {
        document.execCommand('styleWithCSS', false, 'true');
        document.execCommand('foreColor', false, colour);
        document.execCommand('styleWithCSS', false, 'false');
      }
    };
    const up = (e: KeyboardEvent) => {
      if (!pending || (e.key !== 'Control' && e.key !== 'Meta')) return;
      const { id, used } = pending;
      pending = null;
      if (!used) openMathNow(id);
    };
    const reset = () => (pending = null);
    addEventListener('keydown', down, true);
    addEventListener('keyup', up, true);
    addEventListener('blur', reset);
    return () => {
      removeEventListener('keydown', down, true);
      removeEventListener('keyup', up, true);
      removeEventListener('blur', reset);
    };
  }, []);

  /**
   * Right after a linked copy's badge took you to its original: the copy, so that Ctrl+Z as the very
   * next thing goes back to it. Anything else first (a click, a key, an edit) and Ctrl+Z undoes as usual.
   */
  const linkJump = useRef<{ back: string; els: typeof els } | null>(null);
  useEffect(() => {
    const forget = (e: Event) => {
      if (e instanceof KeyboardEvent && (e.key === 'Control' || e.key === 'Meta' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z'))) return;
      linkJump.current = null;
    };
    addEventListener('pointerdown', forget, true);
    addEventListener('keydown', forget, true);
    return () => {
      removeEventListener('pointerdown', forget, true);
      removeEventListener('keydown', forget, true);
    };
  }, []);

  /** A linked copy's badge (`byBadge`) or the right-click menu: the block it was copied from. */
  const goToOriginal = useCallback(
    (id: string, byBadge = false) => {
      const from = els?.[id]?.linkOf;
      if (!from || !els?.[from]) return;
      if (isHidden(els, from)) {
        flash(tr('원본이 휴지통에 있습니다', 'The original is in the trash'));
        return;
      }
      showBlock(from);
      // Set after the click that pressed the badge, so that click does not clear it.
      linkJump.current = byBadge ? { back: id, els } : null;
    },
    [els, showBlock],
  );

  /** Right-click menu actions (they used to sit in the popup above a selected block). */
  const menuAction = useCallback(
    (action: 'open' | 'edit' | 'comment' | 'duplicate' | 'delete' | 'label' | 'unlink' | 'original' | 'tag', ids: string[]) => {
      if (!els || !ids.length) return;
      const id = ids[0];
      if (action === 'open') openBoard(id);
      else if (action === 'edit') {
        setSelection([id]);
        setEditingId(id);
      } else if (action === 'comment') openComments(id);
      else if (action === 'label') editLineLabel(id);
      else if (action === 'duplicate') pasteSnapshot(makeSnapshot(els, ids), 24);
      else if (action === 'original') goToOriginal(id);
      else if (action === 'tag') {
        // The block is selected and the left bar opens its Tag list.
        setEditingId(null);
        setSelection([id]);
        setOpenCtx({ id, option: 'label' });
      }
      else if (action === 'unlink')
        commit((m) => {
          if (!m[id]?.linkOf) return;
          const { linkOf: _gone, ...rest } = m[id];
          void _gone;
          m[id] = { ...rest, updatedAt: Date.now() };
        });
      else if (action === 'delete') {
        commit((m) => trashIds(m, ids));
        setSelection([]);
        setEditingId(null);
      }
    },
    [els, openBoard, setEditingId, openComments, editLineLabel, pasteSnapshot, commit, goToOriginal],
  );

  /* The table cell selection ends when the table is no longer selected or edited. */
  useEffect(() => {
    if (tableCell && (!liveSelection.includes(tableCell.id) || editingId !== tableCell.id)) setTableCell(null);
  }, [tableCell, liveSelection, editingId]);

  useEffect(() => {
    if (!editingId) setTextPinned(false);
  }, [editingId]);

  /* ---------- Keyboard ---------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = !!t.closest?.('input, textarea, [contenteditable="true"]') && !t.closest?.('[data-idle="true"]');
      // A selected table cell takes letters as the start of an entry, not as tool shortcuts.
      const letters = !t.closest?.('[data-idle="true"]');
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === 'Escape') {
        if (menuOpen || accountOpen) {
          setMenuOpen(false);
          setAccountOpen(false);
          return;
        }
        if (drawing) setDrawing(null);
        else if (connecting) setConnecting(false);
        else if (editingId) {
          setEditingId(null);
          (document.activeElement as HTMLElement | null)?.blur?.();
        } else if (panel !== 'none') setPanel('none');
        else setSelection([]);
        return;
      }
      if (drawing && mod && e.key === 'Enter') {
        // Ctrl+Enter: done drawing (the strokes are kept).
        e.preventDefault();
        setDrawing(null);
        return;
      }
      if (mod && !e.altKey && !e.shiftKey && (e.code === 'KeyO' || e.key.toLowerCase() === 'o')) {
        // Ctrl+O: find a board and go to it.
        e.preventDefault();
        setBoardFinder(true);
        return;
      }
      if (mod && e.code === 'Space' && !e.altKey) {
        // Ctrl+Space: search every board.
        e.preventDefault();
        setMapOpen(false);
        setPanel('search');
        return;
      }
      if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'f') {
        // Ctrl+F: find inside the note or to-do list being edited (a picked one opens for it).
        e.preventDefault();
        const id = editingId ?? (liveSelection.length === 1 ? liveSelection[0] : null);
        const kind = id ? els?.[id]?.type : undefined;
        if (!id || (kind !== 'CARD' && kind !== 'TASK_LIST')) {
          flash(tr('노트나 할 일을 편집하는 중에 그 안에서 찾습니다 · 전체 검색은 Ctrl+Space', 'Finds inside a note or to-do being edited · search everything with Ctrl+Space'));
          return;
        }
        if (editingId !== id) setEditingId(id);
        setFindIn(id);
        return;
      }
      if (e.key === 'F2' && !mod && !e.altKey && liveSelection.length === 1 && els?.[liveSelection[0]]) {
        // F2: rename a board or column, or jump to the title (then the caption, back and forth).
        const el = els[liveSelection[0]];
        e.preventDefault();
        // Gone to it from the search (Ctrl+Space): the search closes as its editing starts.
        if (panel === 'search') setPanel('none');
        if (el.type === 'BOARD' || el.type === 'COLUMN') {
          setEditingId(el.id);
          return;
        }
        if (el.type === 'LINE') {
          editLineLabel(el.id);
          return;
        }
        const opts = CONTEXT_OPTIONS[el.type] ?? [];
        const hasTitle = opts.includes('title');
        const hasCaption = opts.includes('caption');
        if (!hasTitle && !hasCaption) return;
        // F2 goes title → caption → the block itself (picked, not edited), then round again.
        const mine = !!t.closest?.(`[data-el-id="${el.id}"]`);
        const inField: 'title' | 'caption' | null = !mine ? null : t.matches?.('input.tl-title, input.card-title-input') ? 'title' : t.matches?.('input.caption') ? 'caption' : null;
        const order: ('title' | 'caption')[] = [...(hasTitle ? (['title'] as const) : []), ...(hasCaption ? (['caption'] as const) : [])];
        const target = inField ? (order[order.indexOf(inField) + 1] ?? null) : order[0];
        // A title or caption F2 put up and left empty does not stay.
        if (inField) dropEmptyField(el.id, inField, (t as HTMLInputElement).value ?? '');
        if (!target) {
          setEditingId(null);
          (document.activeElement as HTMLElement | null)?.blur?.();
          setSelection([el.id]);
          return;
        }
        const c = el.content;
        const shown = target === 'title' ? (el.type === 'TASK_LIST' ? c.showTitle !== false : !!c.showTitle) : (c.showCaption ?? !!c.caption);
        if (!shown) {
          commit((m) => update(m, el.id, { content: target === 'title' ? { showTitle: true } : { showCaption: true } }));
          f2Shown.current.add(`${el.id}:${target}`);
        }
        if (el.type === 'DIAGRAM') {
          editStart.id = el.id;
          editStart.by = 'caption';
        }
        setEditingId(el.id);
        // After the block has switched to editing (which puts the caret in its text first).
        setTimeout(() => {
          const field = document.querySelector<HTMLInputElement>(
            `[data-el-id="${el.id}"] ${target === 'title' ? 'input.tl-title, [data-el-id="' + el.id + '"] input.card-title-input' : 'input.caption'}`,
          );
          if (!field) return;
          field.focus();
          field.setSelectionRange(field.value.length, field.value.length);
        }, 80);
        return;
      }
      if (typing) return;
      const k = e.key.toLowerCase();
      if (mod && !e.altKey && !e.shiftKey && k === 'l' && !typing && liveSelection.length === 1 && els?.[liveSelection[0]] && els[liveSelection[0]].type !== 'LINE') {
        // Ctrl+L: a link to the picked block (Ctrl+K puts it in a note or to-do, or as a new note).
        e.preventDefault();
        const el = els[liveSelection[0]];
        copyBlockLink(el.id, linkLabel(el));
        navigator.clipboard?.writeText(`[[${linkLabel(el)}]]`).catch(() => {});
        flash(tr('블록 링크를 복사했습니다 · 노트·할 일에서 Ctrl+K로 붙여넣기', 'Copied a link to the block · Ctrl+K in a note or to-do puts it there'));
        return;
      }
      if (mod && !e.altKey && !e.shiftKey && k === 'k' && !typing && copiedBlockLink()) {
        // Ctrl+K on the board: a new note holding the copied link.
        e.preventDefault();
        const link = copiedBlockLink()!;
        const id = addElement(commit, 'CARD', boardId, middleSpot('CARD'), null, { content: { html: `<div>${blockLinkHtml(link.id, link.label)}</div>` } });
        setSelection([id]);
        return;
      }
      if (mod && (e.code === 'BracketLeft' || e.code === 'BracketRight') && !e.altKey) {
        // Ctrl+[ : back to the board before; Ctrl+] : forward again; Ctrl+Shift+[ : home.
        e.preventDefault();
        setMapOpen(false);
        if (e.shiftKey && e.code === 'BracketLeft') {
          if (boardId !== ROOT_ID) openBoard(ROOT_ID);
        } else stepHistory(e.code === 'BracketLeft' ? -1 : 1);
        return;
      }
      if (mod && k === 'z') {
        e.preventDefault();
        const jump = linkJump.current;
        linkJump.current = null;
        // Just followed a link and changed nothing since: back to where the link was.
        if (!e.shiftKey && jump && jump.els === els && els?.[jump.back] && !isHidden(els, jump.back)) {
          showBlock(jump.back);
          return;
        }
        if (e.shiftKey) redoAndShow();
        else undoAndShow();
      } else if (mod && k === 'y') {
        e.preventDefault();
        redoAndShow();
      } else if (mod && k === 'd') {
        e.preventDefault();
        duplicate();
      } else if (mod && k === 'a') {
        e.preventDefault();
        if (els) setSelection(Object.values(els).filter((x) => x.loc.parentId === boardId && x.loc.section === 'CANVAS').map((x) => x.id));
      } else if (mod && k === 'c') {
        copySelection();
      } else if (mod && k === 'x') {
        if (copySelection(true)) trashSelection();
      } else if (mod && (k === '=' || k === '+')) {
        e.preventDefault();
        apiRef.current?.zoomBy(1.2);
      } else if (mod && k === '-') {
        e.preventDefault();
        apiRef.current?.zoomBy(1 / 1.2);
      } else if (mod && k === '0') {
        e.preventDefault();
        apiRef.current?.resetZoom();
      } else if (!mod && !e.altKey && e.shiftKey && e.code === 'Digit1') {
        // Shift+1: fit all (every block on screen), as in Figma, Miro and Excalidraw.
        e.preventDefault();
        apiRef.current?.fitAll();
      } else if (!mod && !e.altKey && e.shiftKey && e.code === 'KeyG') {
        // Shift+G: the relation map (how blocks are tied, ideaverse-style).
        e.preventDefault();
        setMapOpen(true);
      } else if (!mod && !e.altKey && e.shiftKey && e.code === 'Digit2') {
        // Shift+2: the picked blocks fill the screen (nothing picked: everything).
        e.preventDefault();
        if (liveSelection.length) apiRef.current?.fitTo(liveSelection);
        else apiRef.current?.fitAll();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        trashSelection();
      } else if (e.key === 'Enter' && liveSelection.length === 1 && els) {
        e.preventDefault();
        const el = els[liveSelection[0]];
        if (el.type === 'LINE') editLineLabel(el.id);
        else if (el.type === 'BOARD') openBoard(el.id);
        else if (el.type === 'SKETCH') drawOn(el.id);
        else if (el.type === 'DIAGRAM') setDiagramEdit({ id: el.id });
        else if (el.type !== 'FILE') {
          editStart.id = el.id;
          editStart.by = 'enter';
          setEditingId(el.id);
        }
      } else if (e.key.startsWith('Arrow') && !mod && !e.altKey && !e.shiftKey) {
        // Arrows go from block to block on the board (with none picked: the one nearest the middle).
        e.preventDefault();
        stepBlocks(e.key as 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight');
      } else if (e.key.startsWith('Arrow') && e.altKey && !mod && liveSelection.length) {
        // Alt+arrows nudge the picked blocks (with Shift, 10px at a time).
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        commit((m) => {
          for (const id of liveSelection) {
            const l = m[id].loc;
            if (l.section === 'CANVAS' && m[id].type !== 'LINE' && !m[id].locked)
              update(m, id, { loc: { ...l, x: l.x + dx, y: l.y + dy } });
          }
        }, 'nudge:' + liveSelection.join(','));
      } else if (letters && !mod && !e.altKey && k === 'n') {
        // The new note takes the focus at once, so the key itself must not type an n into it.
        e.preventDefault();
        createTool('CARD', freeSpot());
      } else if (letters && !mod && !e.altKey && e.shiftKey && ALIGN_KEYS[e.code] && alignable().length >= 2) {
        // Shift+L/C/R/T/M/B: line the picked blocks up; Shift+H/V: the same gap across / down.
        e.preventDefault();
        alignSelection(ALIGN_KEYS[e.code]);
      } else if (letters && !mod && !e.altKey && !e.shiftKey && toolKey(e)) {
        // The other tools of the left bar, a letter each (see TOOL_KEYS).
        e.preventDefault();
        const type = toolKey(e)!;
        createTool(type, freeSpot(type));
      } else if (letters && !mod && !e.altKey && k === 'l') {
        setDrawing(null);
        setConnecting((c) => !c);
      } else if (letters && !mod && !e.altKey && (k === 'd' || k === 'e') && liveSelection.length === 1 && els?.[liveSelection[0]]?.type === 'IMAGE') {
        // A picked image: D draws on it, E crops it.
        e.preventDefault();
        setImageTool({ kind: k === 'd' ? 'draw' : 'crop', id: liveSelection[0] });
      } else if (letters && !mod && !e.altKey && k === 'd') {
        setConnecting(false);
        setDrawing((d) => (d ? null : { tool: 'pen', color: INK_COLORS[0], size: INK_SIZES[1] }));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /**
   * Points the app at another data folder (picked in the Windows folder picker). An empty folder
   * gets a copy of the current data; a folder that already holds molanote data is opened as it is.
   * The old folder is left untouched.
   */
  const moveDataFolder = async (dir: string, quiet = false) => {
    setMoving(true);
    // Let the last edit reach the folder before it is copied.
    await new Promise((r) => setTimeout(r, 600));
    try {
      const r = await fetch('/__data/relocate', {
        method: 'POST',
        headers: { 'x-molanote': '1', 'content-type': 'application/json' },
        body: JSON.stringify({ dir }),
      });
      const out = await r.json();
      if (!r.ok) throw new Error(out.error ?? r.status);
      if (out.cancelled) return;
      if (quiet && !out.same) {
        location.reload();
        return;
      }
      if (out.same) {
        alert(tr('지금 쓰는 데이터 폴더와 같습니다.', 'This is already the current data folder.'));
        return;
      }
      alert(
        out.reused
          ? tr(
              `데이터 폴더를 바꿨습니다.\n${out.dir}\n\n이 폴더에 있던 molanote 데이터를 엽니다. 예전 폴더(${out.from})는 그대로 남아 있습니다.`,
              `Data folder changed.\n${out.dir}\n\nOpening the molanote data in this folder. The old folder (${out.from}) is left as it was.`,
            )
          : tr(
              `데이터 폴더를 바꿨습니다.\n${out.dir}\n\n지금 데이터를 이 폴더로 복사했습니다. 예전 폴더(${out.from})는 그대로 남아 있으니, 필요 없으면 직접 지우세요.`,
              `Data folder changed.\n${out.dir}\n\nYour data was copied to this folder. The old folder (${out.from}) is left as it was; delete it yourself if you no longer need it.`,
            ),
      );
      location.reload();
    } catch (err) {
      alert(tr('데이터 폴더를 바꾸지 못했습니다: ', 'Could not change the data folder: ') + (err as Error).message);
    } finally {
      setMoving(false);
      setMenuOpen(false);
    }
  };
  // For automated checks: move without going through the folder picker.
  (window as unknown as { __moveDataFolder?: typeof moveDataFolder }).__moveDataFolder = moveDataFolder;

  /* ---------- Paste from the system clipboard ---------- */

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest?.('input, textarea, [contenteditable="true"]')) return;
      const data = e.clipboardData;
      if (!data) return;
      // Pasted things wait in the Unsorted panel; drag them onto the board from there.
      const text = data.getData('text/plain');
      // Copied or cut in molanote: straight onto the board, as it was (not to Unsorted). (First:
      // a copied picture block also carries its picture, which must not come back as a new one.)
      const mark = data.getData('text/html').match(CLIP_MARK)?.[1];
      if (clipboard && (mark ? mark === clipboard.token : sameText(text, clipboard.text))) {
        e.preventDefault();
        pasteOwn();
        return;
      }
      const files = Array.from(data.files);
      if (files.length) {
        e.preventDefault();
        setUnsortedOpen(true);
        addFiles(commit, files, boardId, center(), null, { inbox: true }).then((ids) => setSelection(ids));
        return;
      }
      if (!text.trim()) return;
      e.preventDefault();
      const isUrl = /^https?:\/\/\S+$/.test(text.trim());
      const id = isUrl
        ? addElement(commit, 'LINK', boardId, center(), null, { inbox: true, content: { url: normalizeUrl(text) } })
        : addElement(commit, 'CARD', boardId, center(), null, { inbox: true, content: { html: textToHtml(text) } });
      setSelection([id]);
      setUnsortedOpen(true);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  /* ---------- Export / import ---------- */

  const exportJson = async () => {
    if (!els) return;
    const blobs: Record<string, string> = {};
    for (const key of blobKeysIn(els)) {
      const b = await getBlob(key);
      if (b) blobs[key] = await blobToDataUrl(b);
    }
    const data = { format: 'board-studio', version: 1, exportedAt: new Date().toISOString(), elements: els, blobs };
    download(`board-studio-${new Date().toISOString().slice(0, 10)}.json`, new Blob([JSON.stringify(data)], { type: 'application/json' }));
    setMenuOpen(false);
  };

  const exportMarkdown = () => {
    if (!els) return;
    const title = els[boardId].content.title || tr('보드', 'Board');
    const md = `# ${els[boardId].content.icon ?? ''} ${title}\n\n${boardToMarkdown(els, boardId)}`;
    download(`${title.replace(/[\\/:*?"<>|]/g, '_')}.md`, new Blob([md], { type: 'text/markdown' }));
    setMenuOpen(false);
  };

  const importJson = async (file: File | undefined) => {
    setMenuOpen(false);
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data?.format !== 'board-studio' || !data.elements?.[ROOT_ID]) throw new Error(tr('형식이 맞지 않습니다', 'Invalid file format'));
      if (!confirm(tr('현재 모든 보드를 백업 파일 내용으로 바꿀까요? 실행 취소로 되돌릴 수 있습니다.', 'Replace all boards with the backup file? You can undo this.'))) return;
      for (const [key, url] of Object.entries<string>(data.blobs ?? {})) {
        await putBlob(await (await fetch(url)).blob(), key);
      }
      const next = data.elements as ElMap;
      commit((m) => {
        for (const k of Object.keys(m)) delete m[k];
        Object.assign(m, next);
      });
      openBoard(ROOT_ID);
      flash(tr('백업을 불러왔습니다', 'Backup imported'));
    } catch (err) {
      alert(tr('가져오기 실패: ', 'Import failed: ') + (err as Error).message);
    }
  };

  if (!els) return <div className="loading">{tr('불러오는 중…', 'Loading…')}</div>;

  const path = boardPath(els, boardId);
  const trashed = Object.values(els).filter((e) => e.loc.section === 'TRASH');
  const selEls = liveSelection.map((id) => els[id]);
  // One selected block with settings: the left bar slides over to them.
  const ctxCandidate = !connecting && !drawing && selEls.length === 1 ? selEls[0] : null;
  const ctxEl = ctxCandidate && CONTEXT_OPTIONS[ctxCandidate.type] ? ctxCandidate : null;
  if (ctxEl) lastCtx.current = ctxEl.id;
  // Keep showing the last block's settings while the bar slides back.
  const shownCtx = ctxEl ?? (lastCtx.current && els[lastCtx.current] ? els[lastCtx.current] : null);
  // While a note is being edited, the left bar holds its text tools (they used to float above the note).
  const showText = !!editingId && els[editingId]?.type === 'CARD';
  const commentEl = commentTarget && els[commentTarget] && !isHidden(els, commentTarget) ? els[commentTarget] : null;

  return (
    <div className={readOnly ? 'app read-only' : 'app'}>
      <header className={mapOpen ? 'topbar over-map' : 'topbar'}>
        <nav className="crumbs">
          {path.map((b, i) => (
            <span key={b.id} className="crumb-wrap">
              <button className={i === path.length - 1 ? 'crumb current' : 'crumb'} onClick={() => openBoard(b.id)}>
                {b.id === ROOT_ID ? <Icon name="home" size={17} /> : b.content.icon} {b.content.title || tr('제목 없는 보드', 'Untitled board')}
              </button>
              {/* › shows the boards under this one as a tree. */}
              <button
                className={treeFor?.id === b.id ? 'sep tree-toggle open' : 'sep tree-toggle'}
                data-tree-for={b.id}
                title={tr('이 보드 아래의 보드들을 트리로 보기', 'Show boards under this one as a tree')}
                aria-expanded={treeFor?.id === b.id}
                onClick={(e) => {
                  const anchor = e.currentTarget;
                  setTreeFor((t) => (t?.id === b.id ? null : { id: b.id, anchor }));
                }}
              >
                ›
              </button>
            </span>
          ))}
          {treeFor && (
            <BoardTree
              els={els}
              rootId={treeFor.id}
              currentId={boardId}
              anchor={treeFor.anchor}
              onOpen={(id) => {
                setTreeFor(null);
                openBoard(id);
              }}
              onClose={() => setTreeFor(null)}
            />
          )}
        </nav>
        <div className="top-actions">
          <span className={`save ${store.saveStatus}`} data-save-state={store.saveStatus}>
            {store.saveStatus === 'saved' ? tr('저장됨', 'Saved') : store.saveStatus === 'saving' ? tr('저장 중…', 'Saving…') : tr('저장 실패', 'Save failed')}
          </span>
          <button onClick={undoAndShow} disabled={!store.canUndo} title={tr('실행 취소 (Ctrl+Z)', 'Undo (Ctrl+Z)')}>
            <Icon name="undo" size={18} />
          </button>
          <button onClick={redoAndShow} disabled={!store.canRedo} title={tr('다시 실행 (Ctrl+Shift+Z)', 'Redo (Ctrl+Shift+Z)')}>
            <Icon name="redo" size={18} />
          </button>
          <div className="zoom">
            {/* (While the relation map is open, these zoom the map.) */}
            <button data-zoom-out onClick={() => (mapOpen ? mapApiRef.current?.zoomBy(1 / 1.2) : apiRef.current?.zoomBy(1 / 1.2))} title={tr('축소 (Ctrl+-)', 'Zoom out (Ctrl+-)')}>
              <Icon name="minus" size={16} />
            </button>
            <button
              className="zoom-val"
              onClick={() => (mapOpen ? mapApiRef.current?.fit() : apiRef.current?.resetZoom())}
              title={mapOpen ? tr('관계 지도 전체 보기 (Ctrl+0)', 'Fit the relation map (Ctrl+0)') : tr('100% 크기로 (Ctrl+0)', 'Reset to 100% (Ctrl+0)')}
            >
              {Math.round((mapOpen ? mapZoom : zoom) * 100)}%
            </button>
            <button data-zoom-in onClick={() => (mapOpen ? mapApiRef.current?.zoomBy(1.2) : apiRef.current?.zoomBy(1.2))} title={tr('확대 (Ctrl+=)', 'Zoom in (Ctrl+=)')}>
              <Icon name="plus" size={16} />
            </button>
            <button data-zoom-fit onClick={() => (mapOpen ? mapApiRef.current?.fit() : apiRef.current?.fitAll())} title={tr('전체 보기: 모든 블록이 화면에 들어오게 맞추기 (Shift+1)', 'Fit all: show every block on screen (Shift+1)')}>
              <Icon name="fit" size={16} />
            </button>
          </div>
          <button className={panel === 'search' ? 'on' : ''} data-panel-toggle="search" onClick={() => setPanel(panel === 'search' ? 'none' : 'search')} title={tr('검색 (Ctrl+Space)', 'Search (Ctrl+Space)')}>
            <Icon name="search" size={18} />
          </button>
          <div className="menu-wrap">
            <button className="account-btn" onClick={() => setAccountOpen(!accountOpen)} title={me.name}>
              <Avatar author={me} size={30} />
            </button>
            {accountOpen && (
              <div className="menu account-menu" onMouseLeave={() => setAccountOpen(false)}>
                <div className="account-head">
                  <Avatar author={me} size={36} />
                  <div>
                    <div className="account-email">{me.name}</div>
                    <div className="muted small">{tr('댓글에 보이는 이름과 사진', 'Name and photo on your comments')}</div>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setAccountOpen(false);
                    setProfileOpen(true);
                  }}
                >
                  {tr('프로필 편집', 'Edit profile')}
                </button>
              </div>
            )}
          </div>
          <div className="menu-wrap">
            <button data-more-menu onClick={() => setMenuOpen(!menuOpen)} title={tr('시스템 설정', 'System settings')}>
              <Icon name="more" size={18} />
            </button>
            {menuOpen && (
              <div className="menu" onMouseLeave={() => setMenuOpen(false)}>
                {/* Language and theme first, then export/import, then where the data is kept; the shortcuts at the end. */}
                <MenuPrefs />
                <div className="menu-sep" />
                <button onClick={exportMarkdown}>{tr('이 보드를 Markdown으로 내보내기', 'Export this board as Markdown')}</button>
                <button onClick={exportJson}>{tr('전체 백업 (JSON) 내보내기', 'Export full backup (JSON)')}</button>
                <button onClick={() => importInput.current?.click()}>{tr('백업 (JSON) 가져오기', 'Import backup (JSON)')}</button>
                {dataFolder && (
                  <>
                    <div className="menu-sep" />
                    <div className="menu-folder" data-data-folder={dataFolder}>
                      <span className="menu-folder-label">{tr('데이터 폴더', 'Data folder')}</span>
                      <span className="menu-folder-path">{dataFolder}</span>
                    </div>
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        fetch('/__data/open', { method: 'POST', headers: { 'x-molanote': '1' } }).catch(() => {});
                      }}
                    >
                      {tr('데이터 폴더 열기', 'Open data folder')}
                    </button>
                    <button
                      data-move-folder
                      disabled={moving}
                      onClick={() => {
                        setMenuOpen(false);
                        setPickingFolder(true);
                      }}
                    >
                      {moving ? tr('데이터를 옮기는 중…', 'Moving the data…') : tr('데이터 폴더 바꾸기…', 'Change data folder…')}
                    </button>
                  </>
                )}
                <div className="menu-sep" />
                <button
                  className="menu-help"
                  data-open-shortcuts
                  onClick={() => {
                    setMenuOpen(false);
                    setHelpOpen(true);
                  }}
                >
                  <Icon name="help" size={16} /> {tr('단축키 모음', 'Keyboard shortcuts')}
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className={panelWas.current.swap ? 'main panel-swap' : 'main'}>
        <aside className={ctxEl || showText ? 'toolbar context' : 'toolbar'}>
          <div className="toolbar-track">
          <ToolStrip
            inert={!!ctxEl}
            items={[
              ...TOOLS.map((t) => ({
                key: t.type,
                node: (
                  <button
                    className="tool card-tool"
                    data-type={t.type}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('application/x-board-tool', t.type);
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                    onClick={() => createTool(t.type, middleSpot(t.type))}
                    title={TOOL_TIPS[t.type] ?? tr(`${t.label} 추가`, `Add ${t.label}`)}
                  >
                    <span className="tool-icon">
                      <Icon name={t.icon} size={22} />
                    </span>
                    <span className="tool-label">{t.label}</span>
                  </button>
                ),
              })),
              {
                key: 'LINE',
                active: connecting,
                node: (
                  <button
                    className={connecting ? 'tool on' : 'tool'}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('application/x-board-tool', 'LINE');
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                    onClick={() => {
                      setDrawing(null);
                      setConnecting(!connecting);
                    }}
                    title={tr('두 블록을 선으로 잇기 · 보드로 끌어다 놓거나, 클릭해서 두 블록을 차례로 고르기 (L)', 'Connect two blocks with a line · Drag onto the board, or click two blocks in turn (L)')}
                  >
                    <span className="tool-icon">
                      <Icon name="line" size={22} />
                    </span>
                    <span className="tool-label">{tr('연결선', 'Line')}</span>
                  </button>
                ),
              },
              {
                key: 'DRAW',
                active: !!drawing,
                node: (
                  <button
                    className={drawing ? 'tool card-tool on' : 'tool card-tool'}
                    onClick={() => {
                      setConnecting(false);
                      setSelection([]);
                      setEditingId(null);
                      setDrawing(drawing ? null : { tool: 'pen', color: INK_COLORS[0], size: INK_SIZES[1] });
                    }}
                    title={tr('보드에 펜으로 자유롭게 그리기 (D)', 'Draw freely on the board (D)')}
                    data-tool="draw"
                  >
                    <span className="tool-icon">
                      <Icon name="pen" size={22} />
                    </span>
                    <span className="tool-label">{tr('그리기', 'Draw')}</span>
                  </button>
                ),
              },
            ].sort((a, b) => toolOrder.indexOf(a.key) - toolOrder.indexOf(b.key))}
            footer={
              <>
                <div className="tool-sep" />
                {/* Tool order above trash, both icon-only so more tools fit above. */}
                <div className="tool-foot-row">
                  <button
                    className={orderOpen ? 'tool foot-btn order-tool on' : 'tool foot-btn order-tool'}
                    onClick={() => setOrderOpen(true)}
                    title={tr('도구 순서 바꾸기: 왼쪽 막대의 도구를 끌어서 정렬', 'Reorder tools: drag to arrange the left bar')}
                    aria-label={tr('도구 순서 바꾸기', 'Reorder tools')}
                  >
                    <span className="tool-icon">
                      <Icon name="reorderFilled" size={20} />
                    </span>
                  </button>
                  <button
                    className={panel === 'trash' ? 'tool foot-btn trash-tool on' : 'tool foot-btn trash-tool'}
                    data-panel-toggle="trash"
                    onClick={() => setPanel(panel === 'trash' ? 'none' : 'trash')}
                    title={tr('휴지통: 지운 블록을 보고 되살리기 (블록 선택 후 Delete로 지우기)', 'Trash: view and restore deleted blocks (select a block, then Delete to delete)')}
                    aria-label={tr('휴지통', 'Trash')}
                  >
                    <span className="tool-icon">
                      <Icon name="trashFilled" size={20} />
                    </span>
                    {trashed.length > 0 && <span className="badge">{trashed.length}</span>}
                  </button>
                </div>
              </>
            }
          />
          {orderOpen && (
            <ToolOrder
              tools={toolOrder.map((k) => TOOL_INFO.find((t) => t.key === k)!).filter(Boolean)}
              onChange={saveToolOrder}
              onReset={() => saveToolOrder(DEFAULT_TOOL_ORDER)}
              onClose={() => setOrderOpen(false)}
            />
          )}
          <div className="toolbar-pane ctx-pane" inert={!ctxEl}>
            {showText && editingId ? (
              <TextBar editorId={editingId} onPin={setTextPinned} />
            ) : shownCtx && (
              <ContextBar
                key={shownCtx.id + (editingId === shownCtx.id ? ':edit' : '')}
                el={shownCtx}
                editing={editingId === shownCtx.id}
                openOption={openCtx?.id === shownCtx.id ? openCtx.option : undefined}
                onOpened={() => setOpenCtx(null)}
                meId={me.id}
                labelDefs={labelDefsOf(els)}
                commit={commit}
                onComment={openComments}
                onEdit={(id) => {
                  setSelection([id]);
                  setEditingId(id);
                }}
                onImageTool={(kind, id) => setImageTool({ kind, id })}
                onLineLook={(look) => setLineDefaults(look)}
                tableCell={tableCell}
              />
            )}
          </div>
          </div>
        </aside>

        <section className="stage" ref={stageRef}>
          <Canvas
            key={boardId}
            els={els}
            boardId={boardId}
            commit={commit}
            selection={liveSelection}
            setSelection={setSelection}
            editingId={editingId}
            setEditingId={setEditingId}
            connecting={connecting}
            setConnecting={setConnecting}
            openBoard={openBoard}
            apiRef={apiRef}
            onZoom={setZoom}
            newLine={lineDefaults.content}
            newLineColor={lineDefaults.color}
            onOpenComments={openComments}
            onMenuAction={menuAction}
            goToOriginal={(id) => goToOriginal(id, true)}
            showBlock={showBlock}
            meId={me.id}
            tableCell={tableCell}
            setTableCell={setTableCell}
            drawing={drawing}
            onDrawOn={drawOn}
            unsortedOpen={unsortedOpen}
            setUnsortedOpen={setUnsortedOpen}
            unsortedSlot={unsortedOpen ? unsortedSlot : null}
          />

          {drawing && (
            <div className="selbar draw-bar" role="toolbar" aria-label={tr('그리기', 'Draw')}>
              {(['pen', 'highlighter', 'eraser', 'select'] as const).map((t) => (
                <button
                  key={t}
                  className={drawing.tool === t ? 'on' : ''}
                  data-draw-tool={t}
                  title={
                    t === 'pen'
                      ? tr('펜', 'Pen')
                      : t === 'highlighter'
                        ? tr('형광펜', 'Highlighter')
                        : t === 'eraser'
                          ? tr('지우개', 'Eraser')
                          : tr('획 고르기: 둘러싸서 고른 뒤 끌어서 옮기기 · Ctrl+X/C/V · Delete', 'Pick strokes: draw around them, then drag to move · Ctrl+X/C/V · Delete')
                  }
                  onClick={() =>
                    setDrawing({
                      ...drawing,
                      tool: t,
                      color: t === 'highlighter' && drawing.color === INK_COLORS[0] ? '#ffe066' : drawing.color,
                    })
                  }
                >
                  <Icon name={t === 'select' ? 'lasso' : t} size={19} />
                </button>
              ))}
              <span className="ink-sep" />
              {INK_COLORS.map((c) => (
                <button
                  key={c}
                  className={drawing.color === c ? 'ink-dot on' : 'ink-dot'}
                  style={{ background: c }}
                  title={c}
                  data-draw-color={c}
                  onClick={() => setDrawing({ ...drawing, color: c, tool: drawing.tool === 'eraser' ? 'pen' : drawing.tool })}
                />
              ))}
              {/* A colour picked from the palette (not one of the dots): shown as one more dot. */}
              {!INK_COLORS.includes(drawing.color) && <button className="ink-dot on" style={{ background: drawing.color }} title={drawing.color} data-draw-color-own />}
              <button className={inkPicker ? 'ink-more on' : 'ink-more'} title={tr('다른 색 (스펙트럼·스포이드)', 'More colours (spectrum, eyedropper)')} data-draw-more onClick={() => setInkPicker(!inkPicker)}>
                +
              </button>
              {inkPicker && (
                <div className="ink-picker" data-ink-picker onPointerDown={(e) => e.stopPropagation()}>
                  <ColorPicker value={drawing.color} onChange={(c) => setDrawing({ ...drawing, color: c, tool: drawing.tool === 'eraser' ? 'pen' : drawing.tool })} />
                </div>
              )}
              <span className="ink-sep" />
              {INK_SIZES.map((s) => (
                <button key={s} className={drawing.size === s ? 'ink-size on' : 'ink-size'} title={tr(`굵기 ${s}`, `Size ${s}`)} onClick={() => setDrawing({ ...drawing, size: s })}>
                  <span style={{ width: s + 3, height: s + 3 }} />
                </button>
              ))}
              <span className="ink-sep" />
              <button onClick={undo} disabled={!store.canUndo} title={tr('실행 취소 (Ctrl+Z)', 'Undo (Ctrl+Z)')}>
                <Icon name="undo" size={19} />
              </button>
              <button onClick={redo} disabled={!store.canRedo} title={tr('다시 실행 (Ctrl+Shift+Z)', 'Redo (Ctrl+Shift+Z)')}>
                <Icon name="redo" size={19} />
              </button>
              <button className="draw-done" onClick={() => setDrawing(null)} title={tr('그리기 끝내기 (Esc · Ctrl+Enter)', 'Finish drawing (Esc · Ctrl+Enter)')}>
                <Icon name="check" size={17} /> {tr('완료', 'Done')}
              </button>
            </div>
          )}

          {!connecting && !drawing && !editingId && alignable().length >= 2 && (
            <div className="selbar align-bar" role="toolbar" aria-label={tr('맞춤', 'Align')} data-align-bar onPointerDown={(e) => e.stopPropagation()}>
              {ALIGN_BUTTONS.map(([kind, icon, ko, en, key], i) => (
                <button
                  key={kind}
                  className={i === 3 || i === 6 ? 'gap-before' : undefined}
                  data-align={kind}
                  disabled={(kind === 'hspace' || kind === 'vspace') && alignable().length < 3}
                  title={`${tr(ko, en)} (Shift+${key})`}
                  onClick={() => alignSelection(kind)}
                >
                  <Icon name={icon} size={19} />
                </button>
              ))}
            </div>
          )}

          {connecting && (
            <div className="selbar connect-bar" onPointerDown={(e) => e.stopPropagation()}>
              <span className="hint-text">{tr('연결할 요소 두 개를 차례로 클릭하세요', 'Click two items to connect')}</span>
              <LineControls look={lineDefaults} onChange={(p) => setLineDefaults(applyLook(lineDefaults, p))} />
              <button onClick={() => setConnecting(false)} title={tr('연결선 모드 끝내기 (Esc)', 'Exit line mode (Esc)')}>
                {tr('취소', 'Cancel')}
              </button>
            </div>
          )}

          <FolderGuard
            stateKey={LEGACY_STATE_KEY}
            busy={!!editingId}
            readOnly={readOnly}
            setReadOnly={(on) => {
              if (on) setEditingIdRaw(null);
              setReadOnly(on);
            }}
            pullFolder={pullFolder}
            retrySave={store.retrySave}
            flash={flash}
          />
          {toast && <div className="toast">{toast}</div>}
          {mapOpen && (
            <RelationMap
              els={els}
              boardId={boardId}
              onClose={() => setMapOpen(false)}
              apiRef={mapApiRef}
              onZoom={setMapZoom}
              onShow={(id) => {
                setMapOpen(false);
                if (id === ROOT_ID) openBoard(ROOT_ID);
                else showBlock(id);
              }}
            />
          )}
          <button
            className={mapOpen ? 'map-switch on' : 'map-switch'}
            role="switch"
            aria-checked={mapOpen}
            data-map-switch
            onClick={() => setMapOpen(!mapOpen)}
            title={mapOpen ? tr('보드로 돌아가기 (Shift+G · Esc)', 'Back to the board (Shift+G · Esc)') : tr('관계 지도: 블록끼리 어떻게 이어졌는지 (Shift+G)', 'Relation map: how blocks are tied (Shift+G)')}
          >
            <Icon name="board" size={15} />
            <span className="map-switch-track">
              <span className="map-switch-knob" />
            </span>
            <Icon name="constellation" size={16} />
          </button>
        </section>

        {panel === 'unsorted' && <aside ref={setUnsortedSlot} className="panel unsorted-side slide-in" aria-label="Unsorted" />}
        {panel === 'search' && (
          <SearchPanel
            els={els}
            onClose={() => setPanel('none')}
            onPick={(el) => showBlock(el.id)}
            onEdit={(el) => {
              // Enter a second time on a result: edit it there (as Enter on the board does).
              setPanel('none');
              const go = () => {
                if (el.type === 'LINE') editLineLabel(el.id);
                else if (el.type === 'BOARD') openBoard(el.id);
                else if (el.type === 'SKETCH') drawOn(el.id);
                else if (el.type !== 'FILE') {
                  setSelection([el.id]);
                  editStart.id = el.id;
                  editStart.by = 'enter';
                  setEditingId(el.id);
                }
              };
              if (containingBoard(els!, el.id) !== boardId) {
                showBlock(el.id);
                window.setTimeout(go, 120);
              } else go();
            }}
          />
        )}
        {commentEl && (
          <CommentsPanel
            key={commentEl.id}
            el={commentEl}
            me={me}
            commit={commit}
            onClose={closeComments}
            onEditProfile={() => setProfileOpen(true)}
          />
        )}
        {panel === 'trash' && (
          <TrashPanel
            els={els}
            items={trashed}
            onClose={() => setPanel('none')}
            onRestore={(id) => {
              commit((m) => restore(m, id));
              flash(tr('복원했습니다', 'Restored'));
            }}
            onDelete={(id) => {
              if (confirm(tr('완전히 삭제할까요? 안에 있는 항목도 함께 삭제됩니다.', 'Delete permanently? Items inside will be deleted too.'))) commit((m) => deleteForever(m, id));
            }}
            onEmpty={() => {
              if (confirm(tr(`휴지통의 ${trashed.length}개 항목을 완전히 삭제할까요?`, `Permanently delete ${trashed.length} items in the trash?`)))
                commit((m) => {
                  for (const t of trashed) deleteForever(m, t.id);
                });
            }}
          />
        )}
      </div>

      {imageTool && els[imageTool.id]?.type === 'IMAGE' && imageTool.kind === 'draw' && (
        <DrawImageDialog el={els[imageTool.id]} commit={commit} onClose={() => setImageTool(null)} />
      )}
      {imageTool && els[imageTool.id]?.type === 'IMAGE' && imageTool.kind === 'crop' && (
        <CropImageDialog el={els[imageTool.id]} commit={commit} onClose={() => setImageTool(null)} />
      )}
      {askFolder && dataFolder && !pickingFolder && (
        <FirstRunFolder
          current={dataFolder}
          onKeep={() => {
            fetch('/__data/keep-folder', { method: 'POST', headers: { 'x-molanote': '1' } }).catch(() => {});
            setAskFolder(false);
          }}
          onMove={(dir) => {
            setAskFolder(false);
            moveDataFolder(dir, true);
          }}
          onPickOther={() => setPickingFolder(true)}
        />
      )}
      {helpOpen && <ShortcutsHelp onClose={() => setHelpOpen(false)} />}
      {findIn && editingId === findIn && <FindBar key={findIn} blockId={findIn} onClose={() => setFindIn(null)} />}
      {boardFinder && (
        <LinkPicker
          boards
          els={els}
          onClose={() => setBoardFinder(false)}
          onPick={(b) => {
            setBoardFinder(false);
            if ('id' in b) {
              setEditingId(null);
              openBoard(b.id);
            }
          }}
        />
      )}
      {picker && (
        <LinkPicker
          els={els}
          onPick={(el) => {
            const done = picker;
            setPicker(null);
            done(el);
          }}
        />
      )}
      {pickingFolder && (
        <FolderPicker
          current={dataFolder}
          onClose={() => setPickingFolder(false)}
          onPick={(dir) => {
            setPickingFolder(false);
            const first = askFolder;
            setAskFolder(false);
            moveDataFolder(dir, first);
          }}
        />
      )}
      {profileOpen && (
        <ProfileDialog
          me={me}
          hasProfile={!!els[PROFILE_ID]}
          commit={commit}
          onClose={() => setProfileOpen(false)}
        />
      )}
      <input ref={fileInput} type="file" multiple hidden onChange={(e) => onFilesPicked(e.target.files)} />
      <LatexSuggest />
      {diagramEdit && (
        <DiagramEditor
          initial={(diagramEdit.id && els[diagramEdit.id]?.content.diagram) || emptyDiagram()}
          onCancel={() => setDiagramEdit(null)}
          onDone={(dg) => {
            const job = diagramEdit;
            setDiagramEdit(null);
            if (job.id && els[job.id]) {
              const id = job.id;
              commit((m) => update(m, id, { content: { diagram: dg } }));
              setSelection([id]);
              return;
            }
            if (!dg.shapes.length && !dg.lines.length) return;
            const b = diagramBounds(dg, 12);
            const width = Math.round(Math.min(900, Math.max(160, b?.w ?? 360)));
            const id = addElement(commit, 'DIAGRAM', boardId, job.at ?? middleSpot('DIAGRAM'), job.slot ?? null, { content: { diagram: dg }, width });
            setSelection([id]);
          }}
        />
      )}
      <input ref={importInput} type="file" accept=".json,application/json" hidden onChange={(e) => importJson(e.target.files?.[0])} />
    </div>
  );
}

/** The search panel's width when it opens. */
const SEARCH_W = 320;
/**
 * Search across every board. Typing \note, \todo, \board, \image, \table, \column, \link, \file
 * or \tag and a space narrows it to that kind (shown as a chip; Backspace in the empty box takes it
 * off). Results come grouped by kind, and each group folds open or shut.
 */
function SearchPanel({
  els,
  onClose,
  onPick: pickIt,
  onEdit,
}: {
  els: ElMap;
  onClose: () => void;
  onPick: (el: El) => void;
  onEdit: (el: El) => void;
}) {
  const [q, setQ] = useState('');
  /** The result picked with the arrow keys (or the mouse); Enter opens it, Enter again edits it. -1: none yet (the typing box). */
  const [at, setAt] = useState(-1);
  /** The result Enter just went to (a second Enter on it edits it). */
  const entered = useRef<string | null>(null);
  useEffect(() => {
    entered.current = null;
  }, [at, q]);
  const hover = usePointerPick(setAt);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [row, setRow] = useState<HTMLElement | null>(null);
  const onPick = (el: El) => {
    noteSearchPick(el.id, q);
    pickIt(el);
  };
  const [scope, setScope] = useState<ElementType | 'tag' | null>(null);
  const [shut, setShut] = useState<Set<string>>(new Set());
  /** Width while open (it starts at the default each time the panel opens). */
  const [width, setWidth] = useState(SEARCH_W);
  const startWidthDrag = (e: ReactPointerEvent) => {
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = width;
    document.body.classList.add('resizing-panel');
    const move = (ev: PointerEvent) => setWidth(Math.round(Math.max(SEARCH_W, Math.min(window.innerWidth - 240, w0 + x0 - ev.clientX))));
    const up = () => {
      document.body.classList.remove('resizing-panel');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const tagNames = useMemo(() => new Map(labelDefsOf(els).map((d) => [d.id, d] as const)), [els]);
  const tagsOf = (e: El) => [...(e.content.labels ?? []).map((id) => tagNames.get(id)).filter(Boolean), ...(e.content.tag?.text ? [{ id: 'old', name: e.content.tag.text, color: e.content.tag.color ?? 'gray' }] : [])] as LabelDef[];

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle && !scope) return [];
    const found = Object.values(els)
      .filter((e) => e.id !== ROOT_ID && e.type !== 'LINE' && e.type !== 'LABELS' && !isHidden(els, e.id))
      .filter((e) => (scope === 'tag' ? tagsOf(e).length > 0 : scope ? e.type === scope : true))
      // (Korean also by its first consonants: ㅎㅇ finds 회의.)
      .filter((e) => !needle || textHas(elText(e).toLowerCase(), needle) || tagsOf(e).some((t) => textHas(t.name.toLowerCase(), needle)));
    return SEARCH_KINDS.map((k) => ({ kind: k, items: found.filter((e) => e.type === k.type).slice(0, 60) })).filter((g) => g.items.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [els, q, scope, tagNames]);

  /** A \command followed by a space becomes the scope chip. */
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
  const scopeName = scope === 'tag' ? tr('태그', 'Tagged') : SEARCH_KINDS.find((k) => k.type === scope)?.name;
  const typingCommand = !scope && q.startsWith('\\');
  const commands = [{ word: 'tag', name: tr('태그가 붙은 모든 것', 'Everything tagged') }, ...SEARCH_KINDS.map((k) => ({ word: k.words[0], name: k.name }))].filter((c) =>
    c.word.startsWith(q.slice(1).toLowerCase()),
  );
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  // Nothing typed: what was picked from the search most, and what was searched for lately.
  const idle = !q.trim() && !scope;
  const often = useMemo(() => (idle ? topPicks(els) : []), [idle, els]);
  /** Nothing typed: under the ones found often, the ones changed lately. */
  const edited = useMemo(() => (idle ? recentEdits(els, new Set(often.map((e) => e.id))) : []), [idle, els, often]);
  const lately = useMemo(() => (idle ? recentQueries() : []), [idle]);
  /** The results in the order the arrow keys go through them. */
  const rows: El[] = typingCommand ? [] : idle ? [...often, ...edited] : groups.flatMap((g) => (shut.has(g.kind.type) ? [] : g.items));
  /** What the arrow keys go through: the \ scopes being typed, or the results. */
  const count = typingCommand ? commands.length : rows.length;
  const cur = count && at >= 0 ? Math.min(at, count - 1) : -1;
  // Typed: the first one is picked (Enter takes it). Nothing typed: none until ↓ goes into the list.
  // ↑ from the first one goes back to the typing box (none picked).
  useEffect(() => setAt(q.trim() || scope ? 0 : -1), [q, scope]);
  useLayoutEffect(() => {
    const n = bodyRef.current?.querySelector<HTMLElement>('.result.on');
    n?.scrollIntoView({ block: 'nearest' });
    setRow(n && !typingCommand ? n : null);
  }, [cur, count, q, scope]); // eslint-disable-line react-hooks/exhaustive-deps
  const resultProps = (el: El) => {
    const i = rows.indexOf(el);
    return { className: i === cur ? 'result on' : 'result', onPointerMove: hover(i) };
  };

  return (
    <aside className="panel search-panel slide-in" style={{ width, '--panel-w': `${width}px` } as CSSProperties}>
      <div
        className="panel-resizer"
        data-panel-resizer
        role="separator"
        aria-orientation="vertical"
        aria-label={tr('검색 창 너비', 'Search panel width')}
        title={tr('끌어서 너비 조절', 'Drag to resize')}
        onPointerDown={startWidthDrag}
        onDoubleClick={() => setWidth(SEARCH_W)}
      />
      <div className="panel-head">
        <div className="search-box">
          {scope && (
            <button className="search-chip" data-search-scope={scope} title={tr('범위 지우기', 'Clear scope')} onClick={() => setScope(null)}>
              {scopeName} <span aria-hidden="true">×</span>
            </button>
          )}
          <input
            // Focused without scrolling: while the panel is still opening, the box is past the right edge.
            ref={(n) => {
              if (n && !n.dataset.focused) {
                n.dataset.focused = '1';
                n.focus({ preventScroll: true });
              }
            }}
            value={q}
            onChange={(e) => onType(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === 'Backspace' && !q && scope) setScope(null);
              else if (e.key === 'ArrowDown' && count) {
                e.preventDefault();
                setAt((i) => Math.min(count - 1, i + 1));
              } else if (e.key === 'ArrowUp' && count) {
                e.preventDefault();
                setAt((i) => Math.max(-1, i - 1));
              } else if (e.key === 'Enter' && cur >= 0) {
                e.preventDefault();
                if (typingCommand) onType(`\\${commands[cur].word} `);
                else if (entered.current === rows[cur].id) onEdit(rows[cur]);
                else {
                  onPick(rows[cur]);
                  entered.current = rows[cur].id;
                }
              }
            }}
            placeholder={scope ? tr('이 범위에서 검색', 'Search here') : tr('모든 보드에서 검색 (\\로 범위)', 'Search all boards (\\ for scope)')}
          />
        </div>
        <button onClick={onClose} title={tr('닫기', 'Close')}>
          <Icon name="close" size={16} />
        </button>
      </div>
      <div className="panel-body" ref={bodyRef}>
        {idle && (often.length > 0 || lately.length > 0 || edited.length > 0) && (
          <div className="search-idle" data-search-idle>
            {lately.length > 0 && (
              <>
                <div className="search-idle-head">{tr('최근 검색', 'Recent searches')}</div>
                <div className="search-recent">
                  {lately.map((w) => (
                    <button key={w} className="search-recent-word" data-recent-query={w} onClick={() => setQ(w)}>
                      <Icon name="search" size={12} /> {w}
                    </button>
                  ))}
                </div>
              </>
            )}
            {often.length > 0 && (
              <div className="search-idle-head" data-often-head>
                <svg className="search-star" width="13" height="13" viewBox="0 0 24 24" aria-hidden>
                  <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />
                </svg>
                {tr('자주 찾은 것', 'Found often')}
              </div>
            )}
            {often.map((el) => (
              <button key={el.id} {...resultProps(el)} data-result-id={el.id} data-often="true" onClick={() => onPick(el)}>
                <div className="result-title">{elTitle(el) || SEARCH_KINDS.find((k) => k.type === el.type)?.name}</div>
                <div className="muted small">
                  {boardPath(els, containingBoard(els, el.id))
                    .map((b) => b.content.title)
                    .join(' › ')}
                </div>
              </button>
            ))}
            {edited.length > 0 && often.length > 0 && <div className="search-idle-sep" data-idle-sep />}
            {edited.length > 0 && <div className="search-idle-head">{tr('최근 편집', 'Edited lately')}</div>}
            {edited.map((el) => (
              <button key={el.id} {...resultProps(el)} data-result-id={el.id} data-edited="true" onClick={() => onPick(el)}>
                <div className="result-title">{elTitle(el) || SEARCH_KINDS.find((k) => k.type === el.type)?.name}</div>
                <div className="muted small">
                  {SEARCH_KINDS.find((k) => k.type === el.type)?.name}
                  {' · '}
                  {boardPath(els, containingBoard(els, el.id))
                    .map((b) => b.content.title)
                    .join(' › ')}
                </div>
              </button>
            ))}
          </div>
        )}
        {typingCommand && (
          <div className="search-commands" data-search-commands>
            {commands.map((c, i) => (
              <button key={c.word} className={i === cur ? 'result on' : 'result'} data-command={c.word} onPointerMove={hover(i)} onClick={() => onType(`\\${c.word} `)}>
                <code>\{c.word}</code> <span className="muted small">{c.name}</span>
              </button>
            ))}
          </div>
        )}
        {!typingCommand && (q || scope) && total === 0 && <div className="muted pad">{tr('결과가 없습니다', 'No results')}</div>}
        {!typingCommand &&
          groups.map((g) => {
            const open = !shut.has(g.kind.type);
            return (
              <section key={g.kind.type} className="search-group" data-search-group={g.kind.type}>
                <button
                  className={open ? 'search-group-head open' : 'search-group-head'}
                  aria-expanded={open}
                  onClick={() =>
                    setShut((cur) => {
                      const next = new Set(cur);
                      if (next.has(g.kind.type)) next.delete(g.kind.type);
                      else next.add(g.kind.type);
                      return next;
                    })
                  }
                >
                  <span className="search-caret" aria-hidden="true" />
                  {g.kind.name}
                  <span className="count">{g.items.length}</span>
                </button>
                {open &&
                  g.items.map((el) => (
                    <button key={el.id} {...resultProps(el)} data-result-id={el.id} onClick={() => onPick(el)}>
                      <div className="result-title">
                        {(el.linkOf || el.boardRef) && (
                          <span className={el.boardRef ? 'copy-mark shortcut' : 'copy-mark'} data-copy-mark title={el.boardRef ? tr('보드 바로가기', 'Board shortcut') : tr('링크된 복사본', 'Linked copy')}>
                            <Icon name={el.boardRef ? 'external' : 'exchange'} size={11} />
                          </span>
                        )}
                        {elTitle(el)}
                      </div>
                      {tagsOf(el).length > 0 && (
                        <div className="result-tags">
                          {tagsOf(el).map((t) => (
                            <span key={t.id + t.name} className="result-tag" style={{ background: COLORS[t.color] ?? COLORS.gray }}>
                              {t.name}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="muted small">
                        {boardPath(els, containingBoard(els, el.id))
                          .map((b) => b.content.title)
                          .join(' › ')}
                      </div>
                    </button>
                  ))}
              </section>
            );
          })}
      </div>
      <ImageThumb el={cur >= 0 ? rows[cur] : null} anchor={row} side="left" />
    </aside>
  );
}

function TrashPanel({
  els,
  items,
  onClose,
  onRestore,
  onDelete,
  onEmpty,
}: {
  els: ElMap;
  items: El[];
  onClose: () => void;
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
  onEmpty: () => void;
}) {
  const sorted = [...items].sort((a, b) => b.updatedAt - a.updatedAt);
  return (
    <aside className="panel trash-panel slide-in">
      <div className="panel-head">
        <strong>{tr('휴지통', 'Trash')}</strong>
        <button onClick={onClose} title={tr('닫기', 'Close')}>
          <Icon name="close" size={16} />
        </button>
      </div>
      <div className="panel-body">
        {sorted.length === 0 && <div className="muted pad">{tr('휴지통이 비어 있습니다', 'Trash is empty')}</div>}
        {sorted.map((el) => (
          <div key={el.id} className="trash-item">
            <div>
              <div className="result-title">{elTitle(el)}</div>
              <div className="muted small">
                {els[el.prevLoc?.parentId ?? '']?.content.title ?? tr('알 수 없는 위치', 'Unknown location')} ·{' '}
                {new Date(el.updatedAt).toLocaleString()}
              </div>
            </div>
            <div className="trash-actions">
              <button onClick={() => onRestore(el.id)}>{tr('복원', 'Restore')}</button>
              <button className="danger" onClick={() => onDelete(el.id)}>
                {tr('삭제', 'Delete')}
              </button>
            </div>
          </div>
        ))}
      </div>
      {sorted.length > 0 && (
        <div className="panel-foot">
          <button className="danger" onClick={onEmpty}>
            {tr('휴지통 비우기', 'Empty trash')}
          </button>
        </div>
      )}
    </aside>
  );
}

const LINE_DEFAULTS_KEY = 'board-studio:line-defaults';

function loadLineDefaults(): LineLook {
  const fallback: LineLook = { content: { lineStyle: 'solid', weight: 'normal', arrow: true, arrowStart: false } };
  try {
    const saved = JSON.parse(localStorage.getItem(LINE_DEFAULTS_KEY) ?? 'null');
    return saved?.content ? { content: { ...fallback.content, ...saved.content }, color: saved.color } : fallback;
  } catch {
    return fallback;
  }
}

/** Merges a picker change into a line look; only the line-style fields are kept. */
function applyLook(look: LineLook, patch: LinePatch): LineLook {
  const c = { ...look.content, ...patch.content };
  return {
    content: { lineStyle: c.lineStyle, weight: c.weight, arrow: c.arrow, arrowStart: c.arrowStart },
    color: patch.color === undefined ? look.color : (patch.color ?? undefined),
  };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
