export type ElementType =
  | 'BOARD'
  | 'CARD'
  | 'TASK_LIST'
  | 'IMAGE'
  | 'LINK'
  | 'FILE'
  | 'COLUMN'
  | 'COLOR_SWATCH'
  | 'TABLE'
  /** Freehand drawing made with the Draw tool. */
  | 'SKETCH'
  /** A block diagram (shapes and connector lines) made with the Shape tool. */
  | 'DIAGRAM'
  | 'LINE'
  /** The account's profile (name, colour, photo); not shown on any board. */
  | 'PROFILE'
  /** The account's label definitions, shared by every block; not shown on any board. */
  | 'LABELS';

/**
 * CANVAS: placed freely on a board. ATTACHED: stacked inside a column. INBOX: waiting in the
 * board's Unsorted panel (pasted items land here). TRASH: removed.
 */
export type Section = 'CANVAS' | 'ATTACHED' | 'INBOX' | 'TRASH';

export interface Loc {
  parentId: string;
  section: Section;
  x: number;
  y: number;
  /** Order inside a column (fractional, lower comes first). */
  score: number;
}

export interface Task {
  id: string;
  text: string;
  done: boolean;
  /** Text colour and highlight of the whole to-do (Text style while the list is edited). */
  color?: string;
  bg?: string;
}

export type InkTool = 'pen' | 'highlighter';

/** One freehand stroke. Points are flat x,y pairs in the owner's drawing space. */
export interface Stroke {
  id: string;
  tool: InkTool;
  color: string;
  size: number;
  points: number[];
}

export interface LabelDef {
  id: string;
  name: string;
  /** COLORS name. */
  color: string;
}

export interface CommentAuthor {
  id: string;
  name: string;
  color: string;
  /** Stored profile photo, if any. */
  photoKey?: string;
}

export interface Comment {
  id: string;
  text: string;
  author: CommentAuthor;
  createdAt: number;
  editedAt?: number;
}

export interface Content {
  html?: string;
  /** A note with no card behind its text (Color › Transparent). */
  clear?: boolean;
  title?: string;
  icon?: string;
  tasks?: Task[];
  /** A block diagram's shapes and lines (DIAGRAM). */
  diagram?: import('./diagram').Diagram;
  blobKey?: string;
  caption?: string;
  fileName?: string;
  fileSize?: number;
  mime?: string;
  url?: string;
  hex?: string;
  name?: string;
  /** Line start: an element id, or a free point on the board when `fromPoint` is set. */
  from?: string;
  fromPoint?: { x: number; y: number };
  /** Line end: an element id, or a free point on the board when `toPoint` is set. */
  to?: string;
  toPoint?: { x: number; y: number };
  /** Arrowhead at the target end. */
  arrow?: boolean;
  /** Arrowhead at the source end. */
  arrowStart?: boolean;
  lineStyle?: LineStyle;
  weight?: LineWeight;
  /** Curvature: how far the line's middle sits from the straight chord, in board units (signed). */
  bend?: number;
  label?: string;
  /** Where the label sits along the line, as a curve parameter from 0 (start) to 1 (end). */
  labelT?: number;
  /** Colour of a line's label (a COLORS name). */
  labelColor?: string;
  /** The formulas a note was last fitted to (its width), so it is not widened again for the same ones. */
  mathFit?: string;
  /** A line label's background: 'clear' for none (the line is left out behind it), a COLORS name, or white when not set. */
  labelBg?: string;
  /** Emoji reactions: emoji -> ids of the people who reacted. */
  reactions?: Record<string, string[]>;
  /** Whether the title area is shown (notes and tables default to hidden, to-do lists to shown). */
  showTitle?: boolean;
  /** Whether the caption area is shown (default: shown when there is caption text). */
  showCaption?: boolean;
  /** Table cells, row by row; the first row is the header. A cell starting with = is a formula. */
  cells?: string[][];
  /** Table number formats by "row:col" (thousands separators, decimals). */
  cellFmt?: Record<string, import('./table').CellFormat>;
  /** Table column widths and row heights in px, set by dragging cell borders (0 = automatic). */
  colW?: number[];
  rowH?: number[];
  /** Freehand strokes: a drawing block's ink, or ink drawn over an image. */
  strokes?: Stroke[];
  /** Drawing block: size of its drawing space; the block can be resized and the ink scales. */
  vw?: number;
  vh?: number;
  /** Image ink: height of the drawing space, whose width is always 1000. */
  drawH?: number;
  /** Drawing block background (a COLORS name); transparent when unset. */
  bg?: string;
  /** Older single table label; shown alongside `labels`. */
  tag?: { text: string; color: string };
  /** Ids of the labels on this block (definitions live in the LABELS element). */
  labels?: string[];
  /** LABELS element only: every label that can be put on blocks. */
  labelDefs?: LabelDef[];
  /** Comments on this block, oldest first. */
  comments?: Comment[];
  /** To-do lists: the one-time "Delete complete tasks?" question after the first check. */
  /** The one-time question about checked to-dos; 'remove': answered Yes, so checked ones go at once from then on. */
  completePrompt?: 'pending' | 'done' | 'remove';
  /** Picture and title fetched for a link card (YouTube thumbnail or page preview image). */
  preview?: LinkPreview;
  /** Paper fetched for a link card, stored locally for offline reading. */
  paper?: PaperInfo;
}

export interface LinkPreview {
  kind: 'youtube' | 'page';
  videoId?: string;
  title?: string;
  site?: string;
  description?: string;
  /** Stored thumbnail; missing when the page has no picture. */
  imageKey?: string;
  fetchedAt: number;
}

export interface PaperInfo {
  blobKey: string;
  source: string;
  arxivId?: string;
  title?: string;
  authors?: string[];
  abstract?: string;
  published?: string;
  pages?: number;
  fetchedAt: number;
}

export type LineStyle = 'solid' | 'dotted' | 'dash-short' | 'dashed' | 'dash-long';
export type LineWeight = 'thin' | 'normal' | 'thick' | 'heavy';

export const LINE_WEIGHTS: Record<LineWeight, number> = { thin: 1.25, normal: 2, thick: 3.5, heavy: 5 };

/** SVG dash pattern for a line style at a given stroke width. */
export function dashFor(style: LineStyle | undefined, width: number): string | undefined {
  if (style === 'dash-short') return `${width * 2} ${width * 2}`;
  if (style === 'dashed') return `${width * 4} ${width * 3}`;
  if (style === 'dash-long') return `${width * 9} ${width * 4}`;
  if (style === 'dotted') return `0 ${width * 2.5}`;
  return undefined;
}

export interface El {
  id: string;
  type: ElementType;
  loc: Loc;
  /** Where the element was before it went to the trash. */
  prevLoc?: Loc;
  width: number;
  /** Stacking order on the canvas; higher is drawn on top. */
  z?: number;
  /** Position locked: the block cannot be dragged, nudged or resized. */
  locked?: boolean;
  /** Fixed height set with the resize handle; unset means the height follows the content. */
  height?: number;
  color?: string;
  content: Content;
  createdAt: number;
  updatedAt: number;
  /**
   * A linked copy (pasted with Ctrl+V): the block it was copied from. Changes to that block show up
   * here too; changing this copy itself ends the link (the original never changes because of it).
   */
  linkOf?: string;
  /** A board pasted as a shortcut: opening it opens this board (its contents are not copied). */
  boardRef?: string;
}

export type ElMap = Record<string, El>;

/** Applies a change to a copy of the element map. `key` merges consecutive edits into one undo step. */
export type Commit = (fn: (m: ElMap) => void, key?: string) => void;

export const ROOT_ID = 'root';
/** Fixed id of the PROFILE element. */
export const PROFILE_ID = 'profile';
/** Fixed id of the LABELS element. */
export const LABELS_ID = 'labels';

/** The picked cell of a table (r, c) and, for a dragged range, its other corner (r2, c2). */
export type TableCell = { id: string; r: number; c: number; r2?: number; c2?: number };

/** Emoji a board can show as its icon. */
export const BOARD_ICONS = ['📋', '📁', '💡', '🎨', '📚', '✈️', '🏠', '🎬', '🎵', '🧪', '💼', '⭐', '🗺️', '📝', '🛒', '❤️'];

export const COLORS: Record<string, string> = {
  yellow: '#f2c94c',
  orange: '#f2994a',
  red: '#eb5757',
  pink: '#e86fb4',
  purple: '#9b6cf0',
  blue: '#4c8df2',
  teal: '#2fb5a8',
  green: '#5cb85c',
  gray: '#9aa0a6',
};
