import { createContext, useContext } from 'react';
import type { Commit, ElMap, TableCell } from './types';

export type DropTarget =
  | { kind: 'column'; id: string; index: number }
  | { kind: 'board'; id: string }
  | { kind: 'inbox' }
  | null;

export interface BoardCtxValue {
  els: ElMap;
  boardId: string;
  selection: Set<string>;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  /** Selects these blocks (the left bar shows their settings). */
  select: (ids: string[]) => void;
  commit: Commit;
  drag: { ids: Set<string>; dx: number; dy: number; mode: 'canvas' | 'attached' } | null;
  dropTarget: DropTarget;
  openBoard: (id: string) => void;
  /** A linked copy's badge: shows the block it was copied from (on its board). */
  goToOriginal: (id: string) => void;
  connectFrom: string | null;
  /** Element a line end is being dragged over. */
  lineTargetId: string | null;
  /** Centre point (top edge + 40) nearest `near` where a box of this size fits without overlap. */
  freeSpot: (width: number, height: number, near?: { x: number; y: number }, exclude?: string) => { x: number; y: number };
  zoom: number;
  /** Opens the comment thread of a block. */
  openComments: (id: string) => void;
  /** Id of the signed-in person, for reactions. */
  meId: string;
  /** Selected cell of a table block (Excel-style). */
  tableCell: TableCell | null;
  setTableCell: (cell: TableCell | null) => void;
}

export const BoardCtx = createContext<BoardCtxValue | null>(null);

/**
 * How the next edit of a block was started, when that matters to the block: Enter on a selected
 * to-do list goes to a new to-do (not its title). Read once by the block, then cleared.
 */
/** How editing a block started: Enter, or its caption asked for (a diagram's caption, not its editor). */
export const editStart: { id: string | null; by: 'enter' | 'caption' | null } = { id: null, by: null };

export function useBoard(): BoardCtxValue {
  const ctx = useContext(BoardCtx);
  if (!ctx) throw new Error('BoardCtx is missing');
  return ctx;
}

/** Asks the board to slide up by this many screen pixels (a block being typed in needs room below). */
export const SLIDE_UP_EVENT = 'molanote:slide-up';

/** Asks the board to go on drawing into this drawing block (Enter or a double-click on it). */
export const DRAW_ON_EVENT = 'molanote:draw-on';
