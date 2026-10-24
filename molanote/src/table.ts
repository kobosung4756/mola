/**
 * Spreadsheet logic for table blocks: cell editing helpers, row/column insert and delete, number
 * formats, and a small formula language. Formulas are parsed by hand (never `eval`), so a cell can
 * only do arithmetic, read other cells and call the functions listed in FUNCTIONS.
 */

export type Cells = string[][];
export type CellType = 'auto' | 'currency' | 'percent' | 'datetime' | 'text';
export interface CellFormat {
  /** Show thousands separators. */
  comma?: boolean;
  /** Fixed number of decimals; unset shows the number as is. */
  dec?: number;
  /** How the value is shown; unset is 'auto'. */
  type?: CellType;
  /** Horizontal alignment; unset puts numbers right and text left. */
  h?: 'left' | 'center' | 'right';
  /** Vertical alignment; unset is middle. */
  v?: 'top' | 'middle' | 'bottom';
  /** Fill colour name (see COLORS). */
  bg?: string;
  /** Currency unit for 'currency' (a key of CURRENCIES); unset is won. */
  cur?: string;
}

/** True when a format sets nothing, so it can be dropped. */
/** Currency units a 'currency' cell can show: the sign, and decimals shown by default. */
export const CURRENCIES: Record<string, { sign: string; dec: number; name: [string, string] }> = {
  KRW: { sign: '₩', dec: 0, name: ['원 (KRW)', 'Won (KRW)'] },
  USD: { sign: '$', dec: 2, name: ['달러 (USD)', 'Dollar (USD)'] },
  EUR: { sign: '€', dec: 2, name: ['유로 (EUR)', 'Euro (EUR)'] },
  JPY: { sign: '¥', dec: 0, name: ['엔 (JPY)', 'Yen (JPY)'] },
  CNY: { sign: 'CN¥', dec: 2, name: ['위안 (CNY)', 'Yuan (CNY)'] },
  GBP: { sign: '£', dec: 2, name: ['파운드 (GBP)', 'Pound (GBP)'] },
};

export const isEmptyFormat = (f: CellFormat) =>
  !f.comma && f.dec === undefined && (!f.type || f.type === 'auto') && !f.h && !f.v && !f.bg;
export type CellFormats = Record<string, CellFormat>;

export const cellKey = (r: number, c: number) => `${r}:${c}`;

export function colName(c: number): string {
  let s = '';
  let n = c + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function width(cells: Cells) {
  return Math.max(1, ...cells.map((r) => r.length));
}

/** Copy with every row padded to the same width. */
export function normalize(cells: Cells): Cells {
  const w = width(cells);
  return cells.map((row) => Array.from({ length: w }, (_, c) => row[c] ?? ''));
}

export function setCell(cells: Cells, r: number, c: number, value: string): Cells {
  const out = normalize(cells);
  while (out.length <= r) out.push(Array(width(out)).fill(''));
  if (c >= width(out)) out.forEach((row) => row.push(...Array(c + 1 - row.length).fill('')));
  out[r][c] = value;
  return out;
}

/* ---------- Cell ranges ---------- */

export type CellRange = { r0: number; c0: number; r1: number; c1: number };

/** The rectangle spanned by a picked cell and the other corner of its range. */
export function rangeOf(t: { r: number; c: number; r2?: number; c2?: number }): CellRange {
  const r2 = t.r2 ?? t.r;
  const c2 = t.c2 ?? t.c;
  return { r0: Math.min(t.r, r2), r1: Math.max(t.r, r2), c0: Math.min(t.c, c2), c1: Math.max(t.c, c2) };
}

export const inRange = (g: CellRange, r: number, c: number) => r >= g.r0 && r <= g.r1 && c >= g.c0 && c <= g.c1;

export const rangeKeys = (g: CellRange) => {
  const keys: string[] = [];
  for (let r = g.r0; r <= g.r1; r++) for (let c = g.c0; c <= g.c1; c++) keys.push(cellKey(r, c));
  return keys;
};

export function clearRange(cells: Cells, g: CellRange): Cells {
  let out = cells;
  for (let r = g.r0; r <= g.r1; r++) for (let c = g.c0; c <= g.c1; c++) if ((out[r]?.[c] ?? '') !== '') out = setCell(out, r, c, '');
  return out;
}

/* ---------- Copy and paste as tab-separated text (what spreadsheets put on the clipboard) ---------- */

/** Rows of tab-separated text. Quoted cells ("a""b") may hold tabs and line breaks. */
export function parseTsv(text: string): string[][] {
  const t = text.replace(/\r\n?/g, '\n');
  const rows: string[][] = [[]];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (t[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = false;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === '\t') {
      rows[rows.length - 1].push(cell);
      cell = '';
    } else if (ch === '\n') {
      rows[rows.length - 1].push(cell);
      cell = '';
      rows.push([]);
    } else cell += ch;
  }
  rows[rows.length - 1].push(cell);
  // Copied cells end with a line break; it does not start another row.
  const last = rows[rows.length - 1];
  if (rows.length > 1 && last.length === 1 && last[0] === '') rows.pop();
  return rows;
}

/**
 * A formula moved by dr rows and dc columns, the way spreadsheets paste it: plain references
 * (A1) move along, $-fixed parts ($A$1, A$1) stay. A reference pushed off the table becomes #REF!.
 */
export function shiftFormula(raw: string, dr: number, dc: number): string {
  if (!raw.startsWith('=') || (!dr && !dc)) return raw;
  return raw.replace(/(?<![A-Za-z0-9_.$])(\$?)([A-Za-z]+)(\$?)(\d+)(?![A-Za-z0-9_(])/g, (_all: string, fc: string, col: string, fr: string, row: string) => {
    let c = 0;
    for (const ch of col.toUpperCase()) c = c * 26 + (ch.charCodeAt(0) - 64);
    c -= 1;
    let r = parseInt(row, 10) - 1;
    if (!fc) c += dc;
    if (!fr) r += dr;
    if (r < 0 || c < 0) return '#REF!';
    return `${fc}${colName(c)}${fr}${r + 1}`;
  });
}

/** A1-style name of a cell, or of a range when the corners differ. */
export function rangeName(g: CellRange): string {
  const a = `${colName(g.c0)}${g.r0 + 1}`;
  return g.r0 === g.r1 && g.c0 === g.c1 ? a : `${a}:${colName(g.c1)}${g.r1 + 1}`;
}

/** Whether a clicked cell's reference can be put into a formula at this caret (after =, an operator, ( or a comma). */
export function refSlot(draft: string, caret: number): boolean {
  return draft.startsWith('=') && /[=+\-*/^(,:<>&%]$/.test(draft.slice(0, caret).trimEnd());
}

/** The cells and ranges a formula refers to, for outlining them while it is typed. */
export function formulaRanges(raw: string): CellRange[] {
  if (!raw.startsWith('=')) return [];
  const out: CellRange[] = [];
  const col = (s: string) => [...s.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const re = /(?<![A-Za-z0-9_.$])\$?([A-Za-z]+)\$?(\d+)(?::\$?([A-Za-z]+)\$?(\d+))?(?![A-Za-z0-9_(])/g;
  for (const m of raw.matchAll(re)) {
    const r0 = parseInt(m[2], 10) - 1;
    const c0 = col(m[1]);
    const r1 = m[4] ? parseInt(m[4], 10) - 1 : r0;
    const c1 = m[3] ? col(m[3]) : c0;
    out.push({ r0: Math.min(r0, r1), c0: Math.min(c0, c1), r1: Math.max(r0, r1), c1: Math.max(c0, c1) });
  }
  return out;
}

export function toTsv(rows: string[][]): string {
  return rows.map((row) => row.map((v) => (/[\t\n"]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v)).join('\t')).join('\n');
}

/**
 * Pastes rows of values from (r0, c0), one value per cell. Values that would land outside the
 * table are left out. Returns the new cells and the range that was filled.
 */
export function pasteCells(cells: Cells, r0: number, c0: number, data: string[][]): { cells: Cells; range: CellRange } {
  const out = normalize(cells).map((row) => [...row]);
  const h = Math.min(data.length, out.length - r0);
  const w = Math.min(Math.max(...data.map((row) => row.length)), width(out) - c0);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) out[r0 + r][c0 + c] = (data[r][c] ?? '').replace(/\n/g, ' ');
  return { cells: out, range: { r0, c0, r1: r0 + Math.max(h, 1) - 1, c1: c0 + Math.max(w, 1) - 1 } };
}

/* ---------- Table size (the Resize option) ---------- */

export const MAX_ROWS = 200;
export const MAX_COLS = 52;

/**
 * The table made rows × cols: new rows and columns come in empty at the bottom and right; cut ones
 * take their values, formats and sizes with them. Explicit column widths gain NEW_COL_WIDTH columns.
 */
export function resizeTable(t: TableEdit, rows: number, cols: number): TableEdit {
  const cells = normalize(t.cells);
  const out = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => cells[r]?.[c] ?? ''));
  const formats = t.formats
    ? Object.fromEntries(
        Object.entries(t.formats).filter(([k]) => {
          const [r, c] = k.split(':').map(Number);
          return r < rows && c < cols;
        }),
      )
    : undefined;
  return {
    cells: out,
    formats: formats && Object.keys(formats).length ? formats : undefined,
    colW: t.colW ? Array.from({ length: cols }, (_, c) => t.colW![c] || NEW_COL_WIDTH) : undefined,
    rowH: t.rowH ? Array.from({ length: rows }, (_, r) => t.rowH![r] || 0) : undefined,
  };
}

/** How many filled cells a resize to rows × cols would cut off. */
export function cellsCutBy(cells: Cells, rows: number, cols: number): number {
  let n = 0;
  normalize(cells).forEach((row, r) => row.forEach((v, c) => (r >= rows || c >= cols) && v !== '' && n++));
  return n;
}

/* ---------- Insert and delete (formats move with their cells) ---------- */

function remapFormats(formats: CellFormats | undefined, map: (r: number, c: number) => [number, number] | null) {
  if (!formats) return undefined;
  const out: CellFormats = {};
  for (const [k, f] of Object.entries(formats)) {
    const [r, c] = k.split(':').map(Number);
    const to = map(r, c);
    if (to) out[cellKey(to[0], to[1])] = f;
  }
  return Object.keys(out).length ? out : undefined;
}

export type TableEdit = { cells: Cells; formats?: CellFormats; colW?: number[]; rowH?: number[] };

/** Default width given to a new column once the table has explicit widths. */
export const NEW_COL_WIDTH = 120;

function spliced(a: number[] | undefined, at: number, remove: number, ...items: number[]) {
  if (!a) return undefined;
  const b = [...a];
  while (b.length < at) b.push(a === undefined ? 0 : 0);
  b.splice(at, remove, ...items);
  return b;
}

export function insertRow(t: TableEdit, at: number): TableEdit {
  const cells = normalize(t.cells);
  cells.splice(at, 0, Array(width(cells)).fill(''));
  return { ...t, cells, formats: remapFormats(t.formats, (r, c) => [r >= at ? r + 1 : r, c]), rowH: spliced(t.rowH, at, 0, 0) };
}

export function insertCol(t: TableEdit, at: number): TableEdit {
  const cells = normalize(t.cells).map((row) => {
    const next = [...row];
    next.splice(at, 0, '');
    return next;
  });
  return { ...t, cells, formats: remapFormats(t.formats, (r, c) => [r, c >= at ? c + 1 : c]), colW: spliced(t.colW, at, 0, NEW_COL_WIDTH) };
}

export function deleteRow(t: TableEdit, at: number): TableEdit {
  const cells = normalize(t.cells);
  if (cells.length <= 1) return { ...t, cells: [Array(width(cells)).fill('')], formats: undefined, rowH: undefined };
  cells.splice(at, 1);
  return { ...t, cells, formats: remapFormats(t.formats, (r, c) => (r === at ? null : [r > at ? r - 1 : r, c])), rowH: spliced(t.rowH, at, 1) };
}

export function deleteCol(t: TableEdit, at: number): TableEdit {
  const w = width(t.cells);
  if (w <= 1) return { ...t, cells: normalize(t.cells).map(() => ['']), formats: undefined, colW: undefined };
  const cells = normalize(t.cells).map((row) => row.filter((_, c) => c !== at));
  return { ...t, cells, formats: remapFormats(t.formats, (r, c) => (c === at ? null : [r, c > at ? c - 1 : c])), colW: spliced(t.colW, at, 1) };
}

/** Inserts an empty cell at (r, c); the rest of that row moves one cell to the right. */
export function shiftRight(t: TableEdit, r: number, c: number): TableEdit {
  const cells = normalize(t.cells);
  const row = cells[r];
  const last = row[row.length - 1];
  const grew = last !== '';
  if (grew) cells.forEach((x) => x.push(''));
  row.splice(c, 0, '');
  row.length = width(cells);
  return {
    ...t,
    cells: normalize(cells),
    formats: remapFormats(t.formats, (rr, cc) => [rr, rr === r && cc >= c ? cc + 1 : cc]),
    colW: grew && t.colW ? [...t.colW, NEW_COL_WIDTH] : t.colW,
  };
}

/** Inserts an empty cell at (r, c); the rest of that column moves one cell down. */
export function shiftDown(t: TableEdit, r: number, c: number): TableEdit {
  const cells = normalize(t.cells);
  if (cells[cells.length - 1][c] !== '') cells.push(Array(width(cells)).fill(''));
  for (let i = cells.length - 1; i > r; i--) cells[i][c] = cells[i - 1][c];
  cells[r][c] = '';
  return { ...t, cells, formats: remapFormats(t.formats, (rr, cc) => [cc === c && rr >= r ? rr + 1 : rr, cc]) };
}

/* ---------- Number display ---------- */

export function toNumber(raw: string): number | null {
  const s = raw.trim().replace(/,/g, '');
  if (!s || !/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?%?$/i.test(s)) return null;
  const n = parseFloat(s);
  return s.endsWith('%') ? n / 100 : n;
}

/** Decimals the value shows with no explicit format (used as the start for + / − buttons). */
export function naturalDecimals(n: number): number {
  const s = String(Math.round(n * 1e10) / 1e10);
  const i = s.indexOf('.');
  return i < 0 ? 0 : Math.min(10, s.length - i - 1);
}

export function formatNumber(n: number, f?: CellFormat): string {
  if (!Number.isFinite(n)) return '#NUM!';
  const dec = f?.dec;
  if (f?.comma || dec !== undefined) {
    return n.toLocaleString('en-US', {
      useGrouping: !!f?.comma,
      minimumFractionDigits: dec ?? 0,
      maximumFractionDigits: dec ?? 10,
    });
  }
  return String(Math.round(n * 1e10) / 1e10);
}

/* ---------- Formulas ---------- */

class FormulaError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

type Token =
  | { t: 'num'; v: number }
  | { t: 'ref'; r: number; c: number }
  | { t: 'range'; r1: number; c1: number; r2: number; c2: number }
  | { t: 'name'; v: string }
  | { t: 'op'; v: string };

function parseRef(s: string): { r: number; c: number } {
  const m = s.toUpperCase().match(/^\$?([A-Z]+)\$?(\d+)$/);
  if (!m) throw new FormulaError('#REF!');
  let c = 0;
  for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64);
  return { r: parseInt(m[2], 10) - 1, c: c - 1 };
}

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  const re = /\s*(?:(\d+\.?\d*(?:e[-+]?\d+)?|\.\d+)|(\$?[A-Za-z]+\$?\d+(?::\$?[A-Za-z]+\$?\d+)?)|([A-Za-z_][A-Za-z0-9_.]*)|([-+*/^%(),:]))/gy;
  let i = 0;
  while (i < src.length) {
    if (/\s/.test(src[i])) {
      i++;
      continue;
    }
    re.lastIndex = i;
    const m = re.exec(src);
    if (!m) throw new FormulaError('#ERROR!');
    i = re.lastIndex;
    if (m[1] !== undefined) out.push({ t: 'num', v: parseFloat(m[1]) });
    else if (m[2] !== undefined) {
      const [a, b] = m[2].split(':');
      if (b) {
        const p = parseRef(a);
        const q = parseRef(b);
        out.push({ t: 'range', r1: Math.min(p.r, q.r), c1: Math.min(p.c, q.c), r2: Math.max(p.r, q.r), c2: Math.max(p.c, q.c) });
      } else out.push({ t: 'ref', ...parseRef(a) });
    } else if (m[3] !== undefined) out.push({ t: 'name', v: m[3].toUpperCase() });
    else out.push({ t: 'op', v: m[4] });
  }
  return out;
}

type Value = number | number[];

const FUNCTIONS: Record<string, (args: Value[]) => number> = {
  SUM: (a) => flat(a).reduce((x, y) => x + y, 0),
  AVERAGE: (a) => {
    const v = flat(a);
    if (!v.length) throw new FormulaError('#DIV/0!');
    return v.reduce((x, y) => x + y, 0) / v.length;
  },
  MIN: (a) => (flat(a).length ? Math.min(...flat(a)) : 0),
  MAX: (a) => (flat(a).length ? Math.max(...flat(a)) : 0),
  COUNT: (a) => flat(a).length,
  ROUND: (a) => {
    const [x, d = 0] = a.map(scalar);
    const k = 10 ** d;
    return Math.round(x * k) / k;
  },
  ABS: (a) => Math.abs(scalar(a[0])),
};

function flat(a: Value[]): number[] {
  return a.flatMap((v) => (Array.isArray(v) ? v : [v]));
}
function scalar(v: Value | undefined): number {
  if (v === undefined) throw new FormulaError('#VALUE!');
  if (Array.isArray(v)) {
    if (v.length !== 1) throw new FormulaError('#VALUE!');
    return v[0];
  }
  return v;
}

/** Evaluates every cell; formula cells get their result, others their own text. */
export class Sheet {
  private cells: Cells;
  private cache = new Map<string, number | string>();
  private visiting = new Set<string>();

  constructor(cells: Cells) {
    this.cells = cells;
  }

  /** Display value before formatting: a number, a text, or an error code like #DIV/0!. */
  value(r: number, c: number): number | string {
    const key = cellKey(r, c);
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const raw = this.cells[r]?.[c] ?? '';
    let out: number | string;
    if (raw.startsWith('=')) {
      if (this.visiting.has(key)) return '#CIRC!';
      this.visiting.add(key);
      try {
        out = this.evaluate(raw.slice(1));
      } catch (e) {
        out = e instanceof FormulaError ? e.code : '#ERROR!';
      } finally {
        this.visiting.delete(key);
      }
    } else {
      const n = toNumber(raw);
      out = n === null ? raw : n;
    }
    this.cache.set(key, out);
    return out;
  }

  /** Number for arithmetic: empty counts as 0, text is an error. */
  private num(r: number, c: number): number {
    const v = this.value(r, c);
    if (typeof v === 'number') return v;
    if (v === '') return 0;
    if (v.startsWith('#')) throw new FormulaError(v);
    throw new FormulaError('#VALUE!');
  }

  private evaluate(src: string): number {
    const toks = tokenize(src);
    let i = 0;
    const peek = () => toks[i];
    const isOp = (v: string) => peek()?.t === 'op' && (peek() as { v: string }).v === v;
    const eat = (v: string) => {
      if (!isOp(v)) throw new FormulaError('#ERROR!');
      i++;
    };

    const expr = (): Value => {
      let left = term();
      while (isOp('+') || isOp('-')) {
        const op = (toks[i++] as { v: string }).v;
        const right = term();
        left = op === '+' ? scalar(left) + scalar(right) : scalar(left) - scalar(right);
      }
      return left;
    };
    const term = (): Value => {
      let left = power();
      while (isOp('*') || isOp('/')) {
        const op = (toks[i++] as { v: string }).v;
        const right = scalar(power());
        if (op === '/' && right === 0) throw new FormulaError('#DIV/0!');
        left = op === '*' ? scalar(left) * right : scalar(left) / right;
      }
      return left;
    };
    const power = (): Value => {
      const base = unary();
      if (isOp('^')) {
        i++;
        return scalar(base) ** scalar(power());
      }
      return base;
    };
    const unary = (): Value => {
      if (isOp('-')) {
        i++;
        return -scalar(unary());
      }
      if (isOp('+')) {
        i++;
        return scalar(unary());
      }
      let v = primary();
      while (isOp('%')) {
        i++;
        v = scalar(v) / 100;
      }
      return v;
    };
    const primary = (): Value => {
      const tk = toks[i++];
      if (!tk) throw new FormulaError('#ERROR!');
      if (tk.t === 'num') return tk.v;
      if (tk.t === 'ref') return this.num(tk.r, tk.c);
      if (tk.t === 'range') {
        const vals: number[] = [];
        for (let r = tk.r1; r <= tk.r2; r++)
          for (let c = tk.c1; c <= tk.c2; c++) {
            const v = this.value(r, c);
            if (typeof v === 'number') vals.push(v);
            else if (typeof v === 'string' && v.startsWith('#')) throw new FormulaError(v);
          }
        return vals;
      }
      if (tk.t === 'name') {
        const fn = FUNCTIONS[tk.v];
        if (!fn) throw new FormulaError('#NAME?');
        eat('(');
        const args: Value[] = [];
        if (!isOp(')')) {
          args.push(expr());
          while (isOp(',')) {
            i++;
            args.push(expr());
          }
        }
        eat(')');
        return fn(args);
      }
      if (tk.v === '(') {
        const v = expr();
        eat(')');
        return v;
      }
      throw new FormulaError('#ERROR!');
    };

    const result = expr();
    if (i < toks.length) throw new FormulaError('#ERROR!');
    return scalar(result);
  }
}

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

/** Date and time as "2026-10-15 14:30" (time left out at midnight); null when the text is not a date. */
export function formatDateTime(raw: string, v: number | string): string | null {
  const s = raw.trim();
  if (!s) return null;
  let d: Date | null = null;
  if (typeof v === 'number' && !/[-/:.]/.test(s.replace(/^=.*/, ''))) {
    // A plain number is a spreadsheet day count (1 = 1900-01-01).
    if (v > 0 && v < 2958466) d = new Date(Date.UTC(1899, 11, 30) + Math.round(v * 86400000));
    if (d) d = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes());
  } else {
    // "2026-10-15", "2026.10.15", "2026/10/15 14:30" read as local time; anything else as the browser reads it.
    const m = s.match(/^(\d{4})[-/.]\s*(\d{1,2})[-/.]\s*(\d{1,2})\.?(?:[ T]+(\d{1,2}):(\d{2}))?$/);
    if (m) d = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0));
    else {
      const t = Date.parse(s);
      if (!Number.isNaN(t)) d = new Date(t);
    }
  }
  if (!d || Number.isNaN(d.getTime())) return null;
  const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  return d.getHours() || d.getMinutes() ? `${date} ${pad2(d.getHours())}:${pad2(d.getMinutes())}` : date;
}

/** Text shown in a cell: formula results and numbers in the cell's format, text as typed. */
export function displayCell(sheet: Sheet, r: number, c: number, f?: CellFormat, raw?: string): string {
  const v = sheet.value(r, c);
  const type = f?.type ?? 'auto';
  if (type === 'text') return raw ?? String(v);
  if (type === 'datetime') return formatDateTime(raw ?? String(v), v) ?? (raw ?? String(v));
  if (typeof v === 'number' && type === 'currency') {
    const unit = CURRENCIES[f?.cur ?? 'KRW'] ?? CURRENCIES.KRW;
    const dec = f?.dec ?? unit.dec;
    const body = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    return (v < 0 ? '-' : '') + unit.sign + body;
  }
  if (typeof v === 'number' && type === 'percent') {
    const p = v * 100;
    const dec = f?.dec ?? Math.min(2, naturalDecimals(p));
    return p.toLocaleString('en-US', { useGrouping: !!f?.comma, minimumFractionDigits: dec, maximumFractionDigits: dec }) + '%';
  }
  // Plain cells keep what was typed (e.g. "1,234.5") until a number format is applied.
  if (raw !== undefined && !raw.startsWith('=') && !f?.comma && f?.dec === undefined) return raw;
  return typeof v === 'number' ? formatNumber(v, f) : v;
}

/* ---------- Fill down (double-click the fill handle), like a spreadsheet ---------- */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const NUMBERED_RE = /^(.*?)(\d+)(\D*)$/;
const round = (n: number) => Math.round(n * 1e10) / 1e10;

/** Steps of a series: from one value, +1 for numbered text and dates; from several, their trend. */
function trend(xs: number[], single: number): (k: number) => number {
  if (xs.length === 1) return (k) => xs[0] + single * k;
  // Least-squares line through the picked values (exact for an evenly spaced series).
  const n = xs.length;
  const mx = (n - 1) / 2;
  const my = xs.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  xs.forEach((y, i) => {
    num += (i - mx) * (y - my);
    den += (i - mx) ** 2;
  });
  const b = num / den;
  return (k) => my + b * (k - mx);
}

export type FillDir = 'down' | 'up' | 'right' | 'left';

/** How a copied formula moves when it is filled `steps` cells further in a direction. */
export const fillShift = (dir: FillDir) => (raw: string, steps: number) =>
  shiftFormula(raw, dir === 'down' ? steps : dir === 'up' ? -steps : 0, dir === 'right' ? steps : dir === 'left' ? -steps : 0);

/**
 * Values for the `count` cells that follow the picked cells `src` (in fill order: for a fill up or
 * left, the picked cells are given nearest-first), by the spreadsheet rules:
 * - formulas repeat, their references moving down with each row;
 * - one number is copied; several numbers continue their series (1, 2 → 3, 4…);
 * - text ending in a number counts up (Item 1 → Item 2…), as do dates (one day at a time);
 * - anything else repeats the picked cells in turn.
 */
export function fillValues(src: string[], count: number, shift: (raw: string, steps: number) => string = fillShift('down')): string[] {
  const out: string[] = [];
  const len = src.length;
  const at = (k: number) => len + k; // index in the series of the k-th filled cell
  if (src.some((v) => v.startsWith('='))) {
    for (let k = 0; k < count; k++) {
      const i = at(k) % len;
      out.push(shift(src[i], at(k) - i));
    }
    return out;
  }
  const nums = src.map(toNumber);
  if (nums.every((n) => n !== null)) {
    if (len === 1) return Array(count).fill(src[0]);
    const f = trend(nums as number[], 0);
    const pct = src.every((v) => v.trim().endsWith('%'));
    for (let k = 0; k < count; k++) {
      const v = round(f(at(k)));
      out.push(pct ? `${round(v * 100)}%` : String(v));
    }
    return out;
  }
  const dates = src.map((v) => DATE_RE.exec(v.trim()));
  if (dates.every(Boolean)) {
    const days = dates.map((m) => Date.UTC(+m![1], +m![2] - 1, +m![3]) / 864e5);
    const f = trend(days, 1);
    for (let k = 0; k < count; k++) out.push(new Date(Math.round(f(at(k))) * 864e5).toISOString().slice(0, 10));
    return out;
  }
  const parts = src.map((v) => NUMBERED_RE.exec(v));
  if (parts.every((m) => m && m[1] === parts[0]![1] && m[3] === parts[0]![3])) {
    const [, head, digits, tail] = parts[0]!;
    const f = trend(
      parts.map((m) => parseInt(m![2], 10)),
      1,
    );
    for (let k = 0; k < count; k++) {
      const n = Math.max(0, Math.round(f(at(k))));
      out.push(head + String(n).padStart(digits.length, '0') + tail);
    }
    return out;
  }
  for (let k = 0; k < count; k++) out.push(src[at(k) % len]);
  return out;
}

/**
 * How far a fill goes down: as far as the column next to the picked cells has data (left first,
 * then right), like a spreadsheet; with no data beside it, to the last row of the table.
 */
export function fillEnd(cells: Cells, g: CellRange): number {
  const rows = cells.length;
  for (const c of [g.c0 - 1, g.c1 + 1]) {
    if (c < 0 || c >= width(cells)) continue;
    let r = g.r1;
    while (r + 1 < rows && (cells[r + 1][c] ?? '') !== '') r++;
    if (r > g.r1) return r;
  }
  return rows - 1;
}
