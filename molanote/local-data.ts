import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, rmSync } from 'node:fs'
import { appendFile, copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { homedir, hostname, userInfo } from 'node:os'
import { dirname, join, parse, resolve } from 'node:path'
import type { Connect, Plugin } from 'vite'

/**
 * molanote's data folder: boards and files live in an ordinary folder on this PC (by default
 * C:\Users\<name>\molanote-data) instead of inside one browser, so every browser and every new version
 * of the app sees the same data. The page reads and writes it through /__data/… on the local server.
 *
 * Only on when MOLANOTE_DATA_DIR is set (the launcher sets it); without it the app keeps using the
 * browser's storage, as `npm run dev` and the main tests do.
 *
 *   <dir>/molanote-data.json   marks the folder as molanote's
 *   <dir>/kv/<key>.json        boards and settings (JSON)
 *   <dir>/kv/<key>.log.jsonl   a board's changes since that file was last written: one line per save
 *                              with only the blocks that changed; folded into the .json now and then
 *   <dir>/blobs/<key>.<ext>    images and files (pdf, png…), with <key>.type holding the media type. The
 *                              extension is there for sync apps: Google Drive adds one to a file without
 *                              it, so a file found with any extension (or none, as older versions wrote) is the same.
 *   <dir>/backups/<day>/       one copy of the boards per day, the last 14 days
 *   <dir>/deleted-files/       files no board uses any more, kept 30 days before they go
 *   <dir>/in-use/<pc>.json     which PCs have molanote open on this folder right now (one file per PC)
 *   <dir>/conflicts/<day>/     copies a sync app (Google Drive…) made of a file changed on two PCs, once handled
 *
 * When the folder cannot be reached (Google Drive stopped, the G: drive gone…), saves go to this
 * PC instead, in %LOCALAPPDATA%\molanote\pending\<folder>\, and are written to the folder as soon as it
 * is back (tried every few seconds, or at once from the app's "다시 시도" button): block by block,
 * on top of whatever the folder holds by then, the later edit of each block winning.
 *
 * The folder may be kept in a synced folder (Google Drive, OneDrive…) and opened from several PCs.
 * For that: each PC says it has the folder open (in-use/), the page is told when another PC's
 * changes arrive (status), the copies a sync app makes on a clash are found and can be merged
 * back, and a file is only cleaned up once it is old enough that its board has surely arrived too.
 */

const MARKER = 'molanote-data.json'
const BACKUP_DAYS = 14
const DELETED_KEEP_MS = 30 * 24 * 60 * 60_000
const MAX_JSON = 200 * 1024 * 1024
/** A change log this long is folded into its board file. */
const LOG_FOLD_BYTES = 512 * 1024
const LOG_FOLD_LINES = 400
/** A PC counts as having the folder open while it said so this recently (sync apps can lag a minute or two). */
const PRESENCE_STALE_MS = 3 * 60_000
const PRESENCE_WRITE_MS = 30_000
/** Pages of this PC that went quiet this long are gone. */
const PAGE_STALE_MS = 90_000
/** An unused file younger than this is kept: on another PC its board may not have synced yet. */
const UNUSED_KEEP_MS = 3 * 24 * 60 * 60_000

/** This PC, as the other PCs see it. */
const machine = hostname() || 'PC'
/** This PC and user, as a name: for its in-use file and its own save times. */
const machineId = () => `${machine}-${safeUser()}`
const presenceName = () => keyToName(machineId()) + '.json'

const isBoardKey = (key: string) => key.startsWith('board-studio:state:') && !key.endsWith(':saved-at')
/**
 * When this PC last saved a board, in a file of its own: the other PCs read these to notice its
 * changes (one shared file would be overwritten by whoever saved last).
 */
const SAVED_BY = 'molanote:saved-by:'
async function markSaved(dir: string, key: string, at: number) {
  if (!isBoardKey(key)) return
  await writeAtomic(join(dir, 'kv', keyToName(`${SAVED_BY}${machineId()}:${key}`) + '.json'), String(at))
}
function safeUser() {
  try {
    return userInfo().username
  } catch {
    return 'user'
  }
}

/** Every file this app writes in kv/ and blobs/ is named like this; anything else came from elsewhere. */
const OWN_NAME = /^[A-Za-z0-9_~-]+(\.json|\.log\.jsonl|\.type|\.[A-Za-z0-9]{1,8})?(\.\d+\.\d+\.tmp)?$/

/** The extension a file of this media type is saved with. */
const EXT_BY_TYPE: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/bmp': '.bmp',
  'image/avif': '.avif',
  'video/mp4': '.mp4',
  'text/plain': '.txt',
  'text/csv': '.csv',
  'application/zip': '.zip',
}
const extFor = (type: string) => EXT_BY_TYPE[type.split(';')[0].trim().toLowerCase()] ?? '.bin'
const LIKELY_EXTS = ['', ...new Set([...Object.values(EXT_BY_TYPE), '.jpeg', '.bin'])]

/** A stored file by its key's file name, whatever extension it has now (none, ours, or one a sync app added). */
async function findBlob(folder: string, name: string): Promise<string | null> {
  for (const ext of LIKELY_EXTS) if (existsSync(join(folder, name + ext))) return join(folder, name + ext)
  for (const f of await readdir(folder).catch(() => [] as string[])) {
    if (f.startsWith(name + '.') && !f.endsWith('.type') && !f.endsWith('.tmp') && /^\.[A-Za-z0-9]{1,8}$/.test(f.slice(name.length))) return join(folder, f)
  }
  return null
}
/** The key's file name of a stored file (what is before its extension). */
const blobStem = (f: string) => f.split('.')[0]
/** Files a sync app or Windows keeps for itself. */
const IGNORED_NAME = /^(desktop\.ini|thumbs\.db|\.ds_store|~\$.*|.*\.tmp\.drivedownload|\.~.*|.*\.gdoc)$/i

/** Where the chosen data folder is remembered, so every version of the app finds it. */
export const configFile = () => join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'molanote', 'config.json')
export const defaultDataDir = () => join(homedir(), 'molanote-data')

/** The data folder to use: MOLANOTE_DATA_DIR, else the remembered one, else the default. */
export async function resolveDataDir(): Promise<string> {
  if (process.env.MOLANOTE_DATA_DIR) return resolve(process.env.MOLANOTE_DATA_DIR)
  try {
    const cfg = JSON.parse((await readFile(configFile(), 'utf8')).replace(/^\uFEFF/, ''))
    if (typeof cfg.dataDir === 'string' && cfg.dataDir.trim()) return resolve(cfg.dataDir)
  } catch {
    // No choice made yet: the default.
  }
  return defaultDataDir()
}

export async function rememberDataDir(dir: string) {
  await mkdir(join(configFile(), '..'), { recursive: true })
  await writeFile(configFile(), JSON.stringify({ dataDir: dir }, null, 2))
}

/** Whether a folder already holds molanote data. */
export const isDataDir = (dir: string) => existsSync(join(dir, MARKER)) || existsSync(join(dir, 'kv'))

export async function prepareDataDir(dir: string) {
  // A folder on a drive that is not there (Google Drive not running…) is not made somewhere else.
  if (!existsSync(dirname(dir))) throw Object.assign(new Error(`not found: ${dirname(dir)}`), { code: 'ENOENT' })
  await mkdir(join(dir, 'kv'), { recursive: true })
  await mkdir(join(dir, 'blobs'), { recursive: true })
  if (!existsSync(join(dir, MARKER))) {
    await writeFile(join(dir, MARKER), JSON.stringify({ app: 'molanote', format: 1, created: new Date().toISOString() }, null, 2))
  }
}

/** A storage key as a file name: letters, digits, - and _ stay; everything else becomes ~XX. */
export const keyToName = (key: string) =>
  Array.from(new TextEncoder().encode(key))
    .map((b) => (/[A-Za-z0-9_-]/.test(String.fromCharCode(b)) ? String.fromCharCode(b) : '~' + b.toString(16).toUpperCase().padStart(2, '0')))
    .join('')
export const nameToKey = (name: string) =>
  new TextDecoder().decode(
    new Uint8Array(name.match(/~[0-9A-F]{2}|[^~]/g)!.map((p) => (p.startsWith('~') ? parseInt(p.slice(1), 16) : p.charCodeAt(0)))),
  )

/** Writes through a temporary file, so a crash never leaves a half-written file behind. */
async function writeAtomic(file: string, data: Buffer | string) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, data)
  await rename(tmp, file)
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const parts: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw Object.assign(new Error('too large'), { status: 413 })
    parts.push(chunk as Buffer)
  }
  return Buffer.concat(parts)
}

const day = () => new Date().toISOString().slice(0, 10)

/** One change at a time in the data folder, so a fold never loses a change written meanwhile. */
let queue: Promise<unknown> = Promise.resolve()
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn)
  queue = run.catch(() => {})
  return run
}

const logOf = (kvFile: string) => kvFile.slice(0, -'.json'.length) + '.log.jsonl'

/**
 * Applies a board's change log to its file and starts a fresh log. Safe to repeat: a change
 * applied twice gives the same result. A line cut short by a crash is skipped.
 */
async function fold(kvFile: string) {
  const log = logOf(kvFile)
  if (!existsSync(log)) return
  const board = existsSync(kvFile) ? JSON.parse(await readFile(kvFile, 'utf8')) : {}
  for (const line of (await readFile(log, 'utf8')).split('\n')) {
    if (!line.trim()) continue
    let entry: { changes?: Record<string, unknown> }
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    for (const [id, el] of Object.entries(entry.changes ?? {})) {
      if (el === null) delete board[id]
      else board[id] = el
    }
  }
  await writeAtomic(kvFile, JSON.stringify(board))
  await rm(log, { force: true })
}

async function foldAll(dir: string) {
  for (const f of await readdir(join(dir, 'kv'))) if (f.endsWith('.log.jsonl')) await fold(join(dir, 'kv', f.slice(0, -'.log.jsonl'.length) + '.json'))
}

/** The first board save of a day also copies the boards into backups/<day>, keeping the last two weeks. */
async function backupOncePerDay(dir: string) {
  const target = join(dir, 'backups', day())
  if (existsSync(target)) return
  await foldAll(dir)
  const files = (await readdir(join(dir, 'kv'))).filter((f) => f.endsWith('.json'))
  if (!files.length) return // nothing saved yet
  await mkdir(target, { recursive: true })
  for (const f of files) await copyFile(join(dir, 'kv', f), join(target, f))
  const days = (await readdir(join(dir, 'backups'))).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort()
  for (const old of days.slice(0, Math.max(0, days.length - BACKUP_DAYS))) await rm(join(dir, 'backups', old), { recursive: true, force: true })
}

/** Files moved aside more than 30 days ago are removed for good. */
async function purgeDeleted(dir: string) {
  const bin = join(dir, 'deleted-files')
  if (!existsSync(bin)) return
  for (const f of await readdir(bin)) {
    const s = await stat(join(bin, f)).catch(() => null)
    if (s && Date.now() - s.mtimeMs > DELETED_KEEP_MS) await rm(join(bin, f), { force: true })
  }
}

/** Copies every file of one data folder into another (used when the folder is moved). */
async function copyTree(from: string, to: string) {
  await foldAll(from).catch(() => {})
  const copy = async (a0: string, b0: string) => {
    await mkdir(b0, { recursive: true })
    for (const entry of await readdir(a0, { withFileTypes: true })) {
      const a = join(a0, entry.name)
      const b = join(b0, entry.name)
      if (entry.isDirectory()) await copy(a, b)
      else if (!existsSync(b)) await copyFile(a, b)
    }
  }
  await copy(from, to)
}

/**
 * Places offered first in the app's folder picker: Google Drive (and other synced folders) when
 * they are on this PC, then the home folder, its desktop and documents, then every drive.
 */
function places() {
  const home = homedir()
  const out: { label: string; path: string; kind: 'cloud' | 'home' | 'drive' }[] = []
  const add = (label: string, path: string | undefined, kind: 'cloud' | 'home' | 'drive') => {
    if (path && existsSync(path) && !out.some((p) => p.path.toLowerCase() === path.toLowerCase())) out.push({ label, path, kind })
  }
  const drives = process.platform === 'win32' ? 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((d) => `${d}:\\`).filter((d) => existsSync(d)) : ['/']
  // Google Drive for desktop shows up as its own drive (G:) with "내 드라이브" / "My Drive" inside.
  for (const d of drives) {
    add('Google Drive', join(d, '내 드라이브'), 'cloud')
    add('Google Drive', join(d, 'My Drive'), 'cloud')
  }
  add('Google Drive', join(home, 'Google Drive'), 'cloud')
  add('Google Drive', join(home, '내 드라이브'), 'cloud')
  add('Google Drive', join(home, 'My Drive'), 'cloud')
  add('OneDrive', process.env.OneDrive, 'cloud')
  add('Dropbox', join(home, 'Dropbox'), 'cloud')
  add(userInfo().username, home, 'home')
  add('Desktop', join(home, 'Desktop'), 'home')
  add('Documents', join(home, 'Documents'), 'home')
  for (const d of drives) add(d.replace(/\\$/, ''), d, 'drive')
  return out
}

/** The folders inside a folder (hidden and system ones left out), for the app's folder picker. */
async function listFolders(path: string) {
  const entries = await readdir(path, { withFileTypes: true })
  const folders = entries
    .filter((e) => e.isDirectory() && !/^[.$]/.test(e.name) && !/^(System Volume Information|Recovery|PerfLogs|node_modules)$/i.test(e.name))
    .map((e) => ({ name: e.name, path: join(path, e.name), molanote: isDataDir(join(path, e.name)) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  return { path, parent: parse(path).root === path ? null : dirname(path), folders }
}

/**
 * Where data goes when a folder is picked: the folder itself if it is empty or already holds
 * molanote data, otherwise a "molanote-data" folder inside it (so other files are left alone).
 */
export async function dataDirFor(picked: string): Promise<string> {
  if (isDataDir(picked)) return picked
  const entries = existsSync(picked) ? await readdir(picked) : []
  return entries.length === 0 ? picked : join(picked, 'molanote-data')
}

/** A block kept when two versions disagree: the one changed last. Blocks only one side has are kept. */
type Block = { updatedAt?: number }
const newer = (a: Block | undefined, b: Block) => !a || (b.updatedAt ?? 0) > (a.updatedAt ?? 0)

/** Copies a sync app made in kv/ and blobs/ (a name this app never writes), with the file each one is a copy of. */
async function findConflicts(dir: string) {
  const out: { folder: 'kv' | 'blobs'; name: string; of: string | null }[] = []
  for (const folder of ['kv', 'blobs'] as const) {
    const names = await readdir(join(dir, folder)).catch(() => [] as string[])
    // An own name is a key (no dots: they are escaped) and then its ending.
    const stems = [...new Set(names.filter((n) => OWN_NAME.test(n)).map((n) => n.split('.')[0]))].sort((a, b) => b.length - a.length)
    for (const name of names) {
      if (OWN_NAME.test(name) || IGNORED_NAME.test(name)) continue
      // "<file> (1).json", "<file>.log (1).jsonl", "<file>_conflict"…: the longest key it starts with.
      const stem = stems.find((k) => name.startsWith(k))
      const of = !stem ? null : folder === 'blobs' ? stem : stem + (/\.log/.test(name.slice(stem.length)) ? '.log.jsonl' : '.json')
      out.push({ folder, name, of })
    }
  }
  return out
}

/** Whether a conflict copy holds a board (its blocks can be merged back). */
function isBoardCopy(c: { folder: string; of: string | null }) {
  if (c.folder !== 'kv' || !c.of) return false
  const key = nameToKey(c.of.split('.')[0])
  return key.startsWith('board-studio:state:') && !key.endsWith(':saved-at')
}

/**
 * Merges the copies of a board a sync app made back into it: for every block the version changed
 * last wins, and nothing is deleted (a block only the copy has comes back). Every copy, merged or
 * not, then moves to conflicts/<day>/ so it can still be looked at. Returns the boards that changed.
 */
async function mergeConflicts(dir: string) {
  const changed: string[] = []
  const aside = join(dir, 'conflicts', day())
  for (const c of await findConflicts(dir)) {
    const file = join(dir, c.folder, c.name)
    if (isBoardCopy(c)) {
      const key = nameToKey(c.of!.split('.')[0])
      const kvFile = join(dir, 'kv', keyToName(key) + '.json')
      await fold(kvFile).catch(() => {})
      const board: Record<string, Block> = existsSync(kvFile) ? JSON.parse(await readFile(kvFile, 'utf8')) : {}
      const text = await readFile(file, 'utf8')
      let other: Record<string, Block> = {}
      if (c.name.endsWith('.log.jsonl')) {
        for (const line of text.split('\n')) {
          try {
            for (const [id, el] of Object.entries(JSON.parse(line).changes ?? {})) if (el) other[id] = el as Block
          } catch {
            // a line cut short
          }
        }
      } else {
        try {
          other = JSON.parse(text)
        } catch {
          other = {}
        }
      }
      let n = 0
      for (const [id, el] of Object.entries(other)) {
        if (el && typeof el === 'object' && newer(board[id], el)) {
          board[id] = el
          n++
        }
      }
      if (n) {
        await writeAtomic(kvFile, JSON.stringify(board))
        await writeAtomic(join(dir, 'kv', keyToName(key + ':saved-at') + '.json'), String(Date.now()))
        await markSaved(dir, key, Date.now())
        changed.push(key)
      }
    }
    await mkdir(aside, { recursive: true })
    await rename(file, join(aside, `${c.folder}-${c.name}`)).catch(() => {})
  }
  return changed
}

/** The other PCs that have this folder open now. */
async function otherPcs(dir: string) {
  const out: { machine: string; user: string; beat: number }[] = []
  const folder = join(dir, 'in-use')
  for (const f of await readdir(folder).catch(() => [] as string[])) {
    if (f === presenceName() || !f.endsWith('.json')) continue
    try {
      const p = JSON.parse(await readFile(join(folder, f), 'utf8'))
      if (typeof p.beat === 'number' && Date.now() - p.beat < PRESENCE_STALE_MS) out.push({ machine: String(p.machine ?? f), user: String(p.user ?? ''), beat: p.beat })
    } catch {
      // half-synced
    }
  }
  return out
}

/** Per board, when each other PC last saved it ("<pc>=<time>,…"): changes when one of them saves. */
async function otherSaves(dir: string) {
  const per: Record<string, string[]> = {}
  for (const f of await readdir(join(dir, 'kv')).catch(() => [] as string[])) {
    if (!OWN_NAME.test(f) || !f.endsWith('.json') || f.endsWith('.log.jsonl')) continue
    const key = nameToKey(f.slice(0, -5))
    if (!key.startsWith(SAVED_BY)) continue
    const rest = key.slice(SAVED_BY.length)
    const cut = rest.indexOf(':board-studio:')
    if (cut < 0) continue
    const pc = rest.slice(0, cut)
    if (pc === machineId()) continue
    const at = (await readFile(join(dir, 'kv', f), 'utf8').catch(() => '')).trim()
    ;(per[rest.slice(cut + 1)] ??= []).push(`${pc}=${at}`)
  }
  return Object.fromEntries(Object.entries(per).map(([k, v]) => [k, v.sort().join(',')]))
}

/** A board with the changes in its log applied, without rewriting any file (only the PC that wrote them folds them). */
async function readBoard(kvFile: string) {
  const log = logOf(kvFile)
  if (!existsSync(log)) return readFile(kvFile)
  const board = existsSync(kvFile) ? JSON.parse(await readFile(kvFile, 'utf8')) : {}
  for (const line of (await readFile(log, 'utf8')).split('\n')) {
    if (!line.trim()) continue
    try {
      for (const [id, el] of Object.entries(JSON.parse(line).changes ?? {})) {
        if (el === null) delete board[id]
        else board[id] = el
      }
    } catch {
      // a line cut short
    }
  }
  return Buffer.from(JSON.stringify(board))
}

/* ---------- Saves kept on this PC while the data folder cannot be reached ---------- */

/** The data folder can be used right now. */
const folderOk = (dir: string) => existsSync(join(dir, 'kv')) && existsSync(join(dir, 'blobs'))
const localAppData = () => process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
/** One pending store per data folder. */
export const pendingDir = (dir: string) => join(localAppData(), 'molanote', 'pending', keyToName(resolve(dir)))
const pendingLog = (dir: string) => join(pendingDir(dir), 'changes.jsonl')

type Patch = { key: string; at: number; changes: Record<string, Block | null> }

async function readPendingPatches(dir: string): Promise<Patch[]> {
  const text = await readFile(pendingLog(dir), 'utf8').catch(() => '')
  const out: Patch[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      out.push(JSON.parse(line))
    } catch {
      // a line cut short
    }
  }
  return out
}

/** How many saves are waiting on this PC for the folder. */
async function pendingCount(dir: string) {
  const base = pendingDir(dir)
  const kv = await readdir(join(base, 'kv')).catch(() => [] as string[])
  const blobs = (await readdir(join(base, 'blobs')).catch(() => [] as string[])).filter((f) => !f.endsWith('.type'))
  return (await readPendingPatches(dir)).length + kv.length + blobs.length
}

async function addPendingPatch(dir: string, patch: Patch) {
  await mkdir(pendingDir(dir), { recursive: true })
  await appendFile(pendingLog(dir), JSON.stringify(patch) + '\n')
}

async function addPendingValue(dir: string, key: string, body: Buffer) {
  await mkdir(join(pendingDir(dir), 'kv'), { recursive: true })
  await writeAtomic(join(pendingDir(dir), 'kv', keyToName(key) + '.json'), JSON.stringify({ at: Date.now(), value: JSON.parse(body.toString('utf8')) }))
}

async function pendingValue(dir: string, key: string): Promise<{ at: number; value: unknown } | null> {
  try {
    return JSON.parse(await readFile(join(pendingDir(dir), 'kv', keyToName(key) + '.json'), 'utf8'))
  } catch {
    return null
  }
}

/**
 * Puts changes on a board: a block is taken unless the board's copy was edited later than the
 * change was saved (another PC's newer edit wins), a removal likewise. Returns what was taken.
 */
function applyLater(board: Record<string, Block>, changes: Record<string, Block | null>, at: number) {
  const taken: Record<string, Block | null> = {}
  for (const [id, el] of Object.entries(changes)) {
    const theirs = board[id]
    if (theirs && (theirs.updatedAt ?? 0) > at) continue
    if (el === null) {
      if (theirs) delete board[id]
      taken[id] = null
    } else {
      board[id] = el
      taken[id] = el
    }
  }
  return taken
}

/** A board as this PC sees it: the folder's copy (if it can be read) with the saves still waiting here on top. */
async function boardWithPending(dir: string, key: string, kvFile: string): Promise<Record<string, Block> | null> {
  // Without the folder's copy there is no whole board to show (the waiting changes alone are not one).
  if (!folderOk(dir)) return null
  let board: Record<string, Block> | null = null
  if (existsSync(kvFile) || existsSync(logOf(kvFile))) board = JSON.parse((await readBoard(kvFile)).toString('utf8'))
  const whole = await pendingValue(dir, key)
  const patches = (await readPendingPatches(dir)).filter((p) => p.key === key)
  if (!whole && !patches.length) return board
  board ??= {}
  if (whole) applyLater(board, whole.value as Record<string, Block>, whole.at)
  for (const p of patches) applyLater(board, p.changes, p.at)
  return board
}

/**
 * Writes the saves kept on this PC into the data folder, now that it is back: files, settings, then
 * each board's changes on top of what the folder holds (so another PC's edits to other blocks stay).
 */
async function flushPending(dir: string): Promise<number> {
  const base = pendingDir(dir)
  if (!existsSync(base) || !folderOk(dir)) return 0
  let n = 0
  const blobs = join(base, 'blobs')
  for (const f of await readdir(blobs).catch(() => [] as string[])) {
    if (f.endsWith('.type') || f.endsWith('.tmp')) continue
    const typeFile = join(blobs, blobStem(f) + '.type')
    const to = join(dir, 'blobs', f)
    if (!existsSync(to)) await copyFile(join(blobs, f), to)
    if (existsSync(typeFile)) await copyFile(typeFile, join(dir, 'blobs', blobStem(f) + '.type'))
    await rm(join(blobs, f), { force: true })
    await rm(typeFile, { force: true })
    n++
  }
  const boards = new Map<string, Patch[]>()
  const kv = join(base, 'kv')
  for (const f of await readdir(kv).catch(() => [] as string[])) {
    const key = nameToKey(f.slice(0, -'.json'.length))
    const v = JSON.parse(await readFile(join(kv, f), 'utf8'))
    if (isBoardKey(key)) boards.set(key, [{ key, at: v.at, changes: v.value }])
    else if (!key.endsWith(':saved-at')) await writeAtomic(join(dir, 'kv', f), JSON.stringify(v.value))
    await rm(join(kv, f), { force: true })
    n++
  }
  for (const p of await readPendingPatches(dir)) boards.set(p.key, [...(boards.get(p.key) ?? []), p])
  for (const [key, patches] of boards) {
    const kvFile = join(dir, 'kv', keyToName(key) + '.json')
    const exists = existsSync(kvFile) || existsSync(logOf(kvFile))
    const board: Record<string, Block> = exists ? JSON.parse((await readBoard(kvFile)).toString('utf8')) : {}
    const taken: Record<string, Block | null> = {}
    for (const p of patches) Object.assign(taken, applyLater(board, p.changes, p.at))
    const at = Date.now()
    if (!exists) await writeAtomic(kvFile, JSON.stringify(board))
    else if (Object.keys(taken).length) await appendFile(logOf(kvFile), JSON.stringify({ at, changes: taken }) + '\n')
    await writeAtomic(join(dir, 'kv', keyToName(key + ':saved-at') + '.json'), String(at))
    await markSaved(dir, key, at)
    n += patches.length
  }
  await rm(pendingLog(dir), { force: true })
  if (!(await pendingCount(dir))) await rm(base, { recursive: true, force: true })
  return n
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

/**
 * Only molanote's own page may use the data folder: the request must come to this local server by
 * its own address, from its own page (a custom header, which other sites cannot send without a
 * CORS permission this server never gives).
 */
function allowed(req: IncomingMessage) {
  const host = req.headers.host ?? ''
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) return false
  const origin = req.headers.origin
  if (origin && origin !== `http://${host}`) return false
  return req.headers['x-molanote'] === '1'
}

export function localData(): Plugin {
  let dir: string | null = null
  /** This PC's open pages (id → last ping) and when this PC last said so in in-use/. */
  const pages = new Map<string, number>()
  let presenceWritten = 0
  let presenceSince = 0
  const presenceFile = () => (dir ? join(dir, 'in-use', presenceName()) : null)
  async function writePresence(force = false) {
    const f = presenceFile()
    if (!f || !folderOk(dir!) || (!force && Date.now() - presenceWritten < PRESENCE_WRITE_MS)) return
    presenceWritten = Date.now()
    if (!presenceSince) presenceSince = Date.now()
    await mkdir(join(f, '..'), { recursive: true })
    await writeAtomic(f, JSON.stringify({ machine, user: safeUser(), since: presenceSince, beat: Date.now() }))
  }
  function clearPresence() {
    const f = presenceFile()
    presenceWritten = 0
    presenceSince = 0
    if (f) rmSync(f, { force: true })
  }
  // The folder is no longer open here once every page has closed (or gone quiet), or the server stops.
  setInterval(() => {
    for (const [id, t] of pages) if (Date.now() - t > PAGE_STALE_MS) pages.delete(id)
    if (!pages.size && presenceWritten) clearPresence()
  }, 10_000).unref()
  process.once('exit', clearPresence)
  /** Why the data folder could not be opened at the start (null: it could). */
  let dirError: string | null = null
  /** No folder has been chosen yet on this PC: the app asks where to keep the data (the default is used until then). */
  let firstRun = !existsSync(configFile())
  const ready = (async () => {
    if (!process.env.MOLANOTE_DATA_DIR) return
    dir = await resolveDataDir()
    try {
      await prepareDataDir(dir)
      purgeDeleted(dir).catch(() => {})
    } catch (err) {
      dirError = String((err as Error).message ?? err)
    }
  })()
  /** Tries the data folder again: opens it if it could not be opened at the start, writes what waits here. */
  async function retryFolder() {
    if (!dir) return 0
    if (dirError) {
      try {
        await prepareDataDir(dir)
        dirError = null
      } catch {
        return 0
      }
    }
    return serial(() => flushPending(dir!))
  }
  setInterval(() => {
    if (dir && existsSync(pendingDir(dir))) retryFolder().catch(() => {})
  }, 5000).unref()

  const handler: Connect.NextHandleFunction = (req, res, next) => {
    const url = new URL(req.url ?? '', 'http://local')
    if (!url.pathname.startsWith('/__data/')) return next()
    ;(async () => {
      await ready
      // Without a data folder the page is told so (and uses the browser), without an error in its console.
      if (!dir) return url.pathname === '/__data/info' ? json(res, 200, { dir: null }) : json(res, 404, { error: 'no data folder' })
      if (!allowed(req)) return json(res, 403, { error: 'molanote only' })
      const route = url.pathname.slice('/__data/'.length)
      const key = url.searchParams.get('key') ?? ''
      const kvFile = join(dir, 'kv', keyToName(key) + '.json')
      const blobName = keyToName(key)
      const blobFile = join(dir, 'blobs', blobName)

      if (route === 'info' && req.method === 'GET') {
        if (dirError || !folderOk(dir)) return json(res, 200, { dir, unavailable: true, error: dirError ?? 'not found' })
        const kv = await readdir(join(dir, 'kv'))
        const blobs = await readdir(join(dir, 'blobs'))
        return json(res, 200, { dir, empty: !kv.some((f) => f.endsWith('.json')) && !blobs.length, firstRun })
      }
      if (route === 'keep-folder' && req.method === 'POST') {
        // The first-run choice "keep it here": remembered, not asked again.
        await rememberDataDir(dir)
        firstRun = false
        return json(res, 200, { dir })
      }
      if (route === 'keys' && req.method === 'GET') {
        if (!folderOk(dir)) return json(res, 200, [])
        const kv = (await readdir(join(dir, 'kv'))).filter((f) => f.endsWith('.json')).map((f) => nameToKey(f.slice(0, -5)))
        const blobs = (await readdir(join(dir, 'blobs'))).filter((f) => OWN_NAME.test(f) && !f.endsWith('.type') && !f.endsWith('.tmp')).map((f) => nameToKey(blobStem(f)))
        return json(res, 200, [...new Set([...kv, ...blobs])])
      }
      if (route === 'patch' && key && req.method === 'POST') {
        // Only the blocks that changed: { at, changes: { id: block or null } }, appended to the log.
        const body = await readBody(req, MAX_JSON)
        const entry = JSON.parse(body.toString('utf8'))
        if (typeof entry?.at !== 'number' || typeof entry.changes !== 'object' || !entry.changes) return json(res, 400, { error: 'bad patch' })
        return serial(async () => {
          // Saves already waiting here go first, so the folder gets them in order.
          const waiting = existsSync(pendingDir(dir!))
          if (waiting && folderOk(dir!)) await flushPending(dir!).catch(() => {})
          if (!folderOk(dir!) || existsSync(pendingLog(dir!))) {
            await addPendingPatch(dir!, { key, at: entry.at, changes: entry.changes })
            return json(res, 200, { ok: true, pending: true })
          }
          if (!existsSync(kvFile)) return json(res, 409, { error: 'send the whole board first' })
          try {
            await backupOncePerDay(dir!).catch(() => {})
            const log = logOf(kvFile)
            await appendFile(log, JSON.stringify({ at: entry.at, changes: entry.changes }) + '\n')
            await writeAtomic(join(dir!, 'kv', keyToName(key + ':saved-at') + '.json'), String(entry.at))
            await markSaved(dir!, key, entry.at)
            const s = await stat(log)
            if (s.size > LOG_FOLD_BYTES || (await readFile(log, 'utf8')).split('\n').length > LOG_FOLD_LINES) await fold(kvFile)
          } catch {
            // The folder went away just now: keep the change here.
            await addPendingPatch(dir!, { key, at: entry.at, changes: entry.changes })
            return json(res, 200, { ok: true, pending: true })
          }
          return json(res, 200, { ok: true })
        })
      }
      if (route === 'kv' && key) {
        if (req.method === 'GET') {
          const sendJson = (data: Buffer | string) => {
            res.setHeader('content-type', 'application/json; charset=utf-8')
            res.setHeader('x-kind', 'json')
            res.setHeader('cache-control', 'no-store')
            return res.end(data)
          }
          if (isBoardKey(key)) {
            const board = await serial(() => boardWithPending(dir!, key, kvFile))
            if (board) return sendJson(JSON.stringify(board))
          } else {
            const waiting = await pendingValue(dir, key)
            if (waiting) return sendJson(JSON.stringify(waiting.value))
          }
          if (!folderOk(dir)) {
            // A file kept here while the folder is away.
            const kept = await findBlob(join(pendingDir(dir), 'blobs'), blobName)
            const keptType = join(pendingDir(dir), 'blobs', blobName + '.type')
            if (kept) {
              res.setHeader('content-type', existsSync(keptType) ? (await readFile(keptType, 'utf8')).trim() || 'application/octet-stream' : 'application/octet-stream')
              res.setHeader('x-kind', 'blob')
              res.setHeader('cache-control', 'no-store')
              return res.end(await readFile(kept))
            }
            return json(res, 503, { error: 'data folder unavailable' })
          }
          if (existsSync(kvFile) || existsSync(logOf(kvFile))) return sendJson(await serial(() => readBoard(kvFile)))
          const stored = await findBlob(join(dir, 'blobs'), blobName)
          const keptBlob = stored ? null : await findBlob(join(pendingDir(dir), 'blobs'), blobName)
          if (keptBlob) {
            res.setHeader('x-kind', 'blob')
            res.setHeader('cache-control', 'no-store')
            return res.end(await readFile(keptBlob))
          }
          if (stored) {
            const type = existsSync(blobFile + '.type') ? (await readFile(blobFile + '.type', 'utf8')).trim() : 'application/octet-stream'
            res.setHeader('content-type', type || 'application/octet-stream')
            res.setHeader('x-kind', 'blob')
            res.setHeader('cache-control', 'no-store')
            return res.end(await readFile(stored))
          }
          return json(res, 404, { error: 'not found' })
        }
        if (req.method === 'PUT') {
          if (req.headers['x-kind'] === 'blob') {
            // Files are streamed to disk, so large ones do not have to fit in memory. While the folder is away, to this PC.
            const away = !folderOk(dir)
            // Saved with its extension, so Google Drive has no reason to rename it.
            const ext = extFor(String(req.headers['content-type'] ?? ''))
            const target = join(away ? join(pendingDir(dir), 'blobs') : join(dir, 'blobs'), blobName + ext)
            if (away) await mkdir(join(pendingDir(dir), 'blobs'), { recursive: true })
            const tmp = `${target}.${process.pid}.${Date.now()}.tmp`
            await new Promise<void>((done, fail) => {
              const out = createWriteStream(tmp)
              req.pipe(out)
              out.on('finish', () => done())
              out.on('error', fail)
              req.on('error', fail)
            })
            await rename(tmp, target)
            await writeFile(join(target, '..', blobName + '.type'), String(req.headers['content-type'] ?? ''))
            return json(res, 200, away ? { ok: true, pending: true } : { ok: true })
          }
          const body = await readBody(req, MAX_JSON)
          JSON.parse(body.toString('utf8')) // only valid JSON is stored
          return serial(async () => {
            if (folderOk(dir!) && existsSync(pendingDir(dir!))) await flushPending(dir!).catch(() => {})
            try {
              if (!folderOk(dir!) || (isBoardKey(key) && existsSync(pendingLog(dir!)))) throw new Error('away')
              if (key.startsWith('board-studio:state:')) await backupOncePerDay(dir!).catch(() => {})
              await writeAtomic(kvFile, body)
              if (key.endsWith(':saved-at')) await markSaved(dir!, key.slice(0, -':saved-at'.length), Number(body.toString('utf8')) || Date.now())
              await rm(logOf(kvFile), { force: true }) // the whole board replaces any changes before it
            } catch {
              await addPendingValue(dir!, key, body)
              return json(res, 200, { ok: true, pending: true })
            }
            return json(res, 200, { ok: true })
          })
        }
        if (req.method === 'DELETE') {
          if (!folderOk(dir)) return json(res, 200, { kept: true })
          // An unused file that is still new may belong to a board another PC has not synced here yet.
          const stored = await findBlob(join(dir, 'blobs'), blobName)
          if (url.searchParams.has('unused') && stored) {
            const s = await stat(stored)
            if (Date.now() - Math.max(s.mtimeMs, s.birthtimeMs || 0) < UNUSED_KEEP_MS) return json(res, 200, { kept: true })
          }
          if (existsSync(kvFile)) await rm(kvFile, { force: true })
          await rm(logOf(kvFile), { force: true })
          if (stored) {
            // Kept aside for a while instead of gone at once (a backup may still point at it).
            await mkdir(join(dir, 'deleted-files'), { recursive: true })
            await rename(stored, join(dir, 'deleted-files', stored.slice(join(dir, 'blobs').length + 1)))
            if (existsSync(blobFile + '.type')) await rename(blobFile + '.type', join(dir, 'deleted-files', blobName + '.type'))
          }
          return json(res, 200, { ok: true })
        }
      }
      if (route === 'presence' && req.method === 'POST') {
        // A page of this PC: { id, bye? }. Watching only (read-only) does not count as having it open.
        const body = JSON.parse((await readBody(req, 4096)).toString('utf8') || '{}')
        const id = String(body.id ?? '')
        if (body.bye || body.watching) pages.delete(id)
        else if (id) pages.set(id, Date.now())
        if (pages.size) await writePresence(body.first === true)
        else if (presenceWritten) clearPresence()
        return json(res, 200, { ok: true })
      }
      if (route === 'status' && req.method === 'GET') {
        const [others, stamps, conflicts, pending] = await Promise.all([otherPcs(dir), otherSaves(dir), findConflicts(dir), pendingCount(dir)])
        return json(res, 200, {
          machine,
          dir,
          folderOk: !dirError && folderOk(dir),
          pending,
          others,
          stamps,
          conflicts: conflicts.map((c) => ({ name: c.name, board: isBoardCopy(c) })),
        })
      }
      if (route === 'retry' && req.method === 'POST') {
        // The app's "다시 시도": the folder again, and what waits here into it.
        const written = await retryFolder().catch(() => 0)
        return json(res, 200, { folderOk: !dirError && folderOk(dir), written, pending: await pendingCount(dir) })
      }
      if (route === 'conflicts' && req.method === 'POST') {
        if (!folderOk(dir)) return json(res, 503, { error: 'data folder unavailable' })
        // Merges the board copies back (the newer version of each block) and moves every copy aside.
        const changed = await serial(() => mergeConflicts(dir!))
        return json(res, 200, { ok: true, changed })
      }
      if (route === 'open' && req.method === 'POST') {
        if (process.platform === 'win32') spawn('explorer', [dir], { detached: true, stdio: 'ignore' }).unref()
        return json(res, 200, { ok: true })
      }
      if (route === 'browse' && req.method === 'GET') {
        // The app's own folder picker: the places to start from, or the folders inside one.
        const path = url.searchParams.get('path')
        if (!path) return json(res, 200, { places: places(), current: dir })
        const at = resolve(path)
        try {
          const list = await listFolders(at)
          const target = await dataDirFor(at)
          return json(res, 200, { ...list, molanote: isDataDir(at), target, targetHasData: isDataDir(target) })
        } catch (err) {
          return json(res, 200, { path: at, parent: dirname(at) === at ? null : dirname(at), folders: [], error: String((err as Error).message) })
        }
      }
      if (route === 'mkdir' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8') || '{}')
        const name = String(body.name ?? '').trim()
        if (typeof body.path !== 'string' || !name || /[\\/:*?"<>|]/.test(name) || /^\.+$/.test(name)) return json(res, 400, { error: 'bad name' })
        const made = join(resolve(body.path), name)
        if (existsSync(made)) return json(res, 409, { error: 'exists', path: made })
        await mkdir(made)
        return json(res, 200, { path: made })
      }
      if (route === 'relocate' && req.method === 'POST') {
        // { dir } is the folder picked in the app's folder picker.
        const body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8') || '{}')
        const picked = typeof body.dir === 'string' ? body.dir : null
        if (!picked) return json(res, 200, { cancelled: true })
        const next = await dataDirFor(resolve(picked))
        if (next === dir) return json(res, 200, { dir, same: true })
        const reused = isDataDir(next)
        // A folder that already holds molanote data is used as it is; otherwise the data moves along.
        if (!reused) await copyTree(dir, next)
        await prepareDataDir(next)
        await rememberDataDir(next)
        firstRun = false
        const from = dir
        clearPresence()
        dir = next
        if (pages.size) await writePresence(true)
        return json(res, 200, { dir, from, reused })
      }
      return json(res, 404, { error: 'unknown' })
    })().catch((err) => json(res, err?.status ?? 500, { error: String(err?.message ?? err) }))
  }

  return {
    name: 'molanote-local-data',
    configureServer(server) {
      server.middlewares.use(handler)
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler)
    },
  }
}
