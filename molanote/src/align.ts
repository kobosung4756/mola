/*
 * Lining up blocks picked together, as in PowerPoint: left, centre, right, top, middle, bottom
 * edges, or the same gap between them across or down.
 */

export type AlignKind = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom' | 'hspace' | 'vspace';

/** A picked block: where it is on the board and how big it is. */
export type AlignBox = { id: string; x: number; y: number; w: number; h: number };

/** Shift+letter for each (as PowerPoint's Align: L C R T M B, H and V for the gaps). */
export const ALIGN_KEYS: Record<string, AlignKind> = {
  KeyL: 'left',
  KeyC: 'center',
  KeyR: 'right',
  KeyT: 'top',
  KeyM: 'middle',
  KeyB: 'bottom',
  KeyH: 'hspace',
  KeyV: 'vspace',
};

/** Where each block goes (only those that move). The same gap needs three blocks or more. */
export function alignedPlaces(boxes: AlignBox[], kind: AlignKind): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  if (boxes.length < 2) return out;
  const l = Math.min(...boxes.map((b) => b.x));
  const r = Math.max(...boxes.map((b) => b.x + b.w));
  const t = Math.min(...boxes.map((b) => b.y));
  const btm = Math.max(...boxes.map((b) => b.y + b.h));
  const put = (b: AlignBox, x: number, y: number) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x !== b.x || y !== b.y) out.set(b.id, { x, y });
  };
  if (kind === 'hspace' || kind === 'vspace') {
    if (boxes.length < 3) return out;
    const across = kind === 'hspace';
    const sorted = [...boxes].sort((a, b) => (across ? a.x + a.w / 2 - (b.x + b.w / 2) : a.y + a.h / 2 - (b.y + b.h / 2)));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const span = across ? last.x + last.w - first.x : last.y + last.h - first.y;
    const sizes = sorted.reduce((s, b) => s + (across ? b.w : b.h), 0);
    const gap = (span - sizes) / (sorted.length - 1);
    let at = across ? first.x : first.y;
    for (const b of sorted) {
      if (b !== first && b !== last) put(b, across ? at : b.x, across ? b.y : at);
      at += (across ? b.w : b.h) + gap;
    }
    return out;
  }
  for (const b of boxes) {
    if (kind === 'left') put(b, l, b.y);
    else if (kind === 'center') put(b, (l + r) / 2 - b.w / 2, b.y);
    else if (kind === 'right') put(b, r - b.w, b.y);
    else if (kind === 'top') put(b, b.x, t);
    else if (kind === 'middle') put(b, b.x, (t + btm) / 2 - b.h / 2);
    else put(b, b.x, btm - b.h);
  }
  return out;
}
