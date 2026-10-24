// Double-click launcher (molanote.cmd runs this in a hidden window): builds the app, serves it at
// http://127.0.0.1:4173 and opens the browser. The server stops by itself when every tab is closed
// (see auto-exit.ts). If it is already running, this only opens the browser.
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const url = 'http://127.0.0.1:4173/';

// There is no console window, so output goes to launch.log (errors also to launch-error.log).
const logFile = join(root, 'launch.log');
const errFile = join(root, 'launch-error.log');
try {
  writeFileSync(logFile, `molanote ${new Date().toISOString()}\n`);
  writeFileSync(errFile, '');
} catch {
  // A read-only folder only loses the log.
}
const toLog = (file) => (...args) => {
  try {
    appendFileSync(file, args.map((a) => (a instanceof Error ? a.stack : String(a))).join(' ') + '\n');
  } catch {
    // Same as above.
  }
};
console.log = console.info = toLog(logFile);
console.warn = console.error = toLog(errFile);

// Opens the address in the default browser.
const openBrowser = () => {
  if (process.env.BOARD_NO_OPEN === '1') return; // for automated checks
  spawn('rundll32', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore' }).unref();
};

/** Shows a small Windows message, since there is no console window to read. */
function showError(message) {
  const text = String(message).replace(/'/g, "''").slice(0, 600);
  const ps = `Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('${text}', 'molanote') | Out-Null`;
  spawn('powershell', ['-NoProfile', '-Command', ps], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

/** The remembered data folder (%APPDATA%\molanote\config.json), or the default one. */
function dataDir() {
  try {
    const appData = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
    const cfg = JSON.parse(readFileSync(join(appData, 'molanote', 'config.json'), 'utf8').replace(/^\uFEFF/, ''));
    if (typeof cfg.dataDir === 'string' && cfg.dataDir.trim()) return cfg.dataDir;
  } catch {
    // Not chosen yet.
  }
  return join(homedir(), 'molanote-data');
}

async function alreadyRunning() {
  try {
    const res = await fetch(url + '__board_alive', { cache: 'no-store', signal: AbortSignal.timeout(1500) });
    return res.ok && (await res.text()) === 'ok';
  } catch {
    return false;
  }
}

/**
 * The files a beta zip came with (beta-files.txt) that are not here: the zip was unpacked over an
 * older copy, or only partly. Building would fail with "Could not resolve …", so this says it plainly.
 */
function missingFiles() {
  const list = join(root, 'beta-files.txt');
  if (!existsSync(list)) return [];
  return readFileSync(list, 'utf8')
    .split(/\r?\n/)
    .map((f) => f.trim())
    .filter((f) => f && !existsSync(join(root, f)));
}

try {
  process.chdir(root);
  const missing = missingFiles();
  if (missing.length) {
    console.error('Missing files: ' + missing.join(', '));
    showError(
      `압축이 다 풀리지 않아 molanote 파일 ${missing.length}개가 빠져 있습니다(예: ${missing.slice(0, 3).join(', ')}).\n\n` +
        '비어 있는 새 폴더에 zip을 "모두 압축 풀기"로 다시 푼 뒤 그 안의 molanote.cmd를 실행해 주세요. ' +
        '보드와 파일은 데이터 폴더에 따로 있으므로 예전 폴더는 지워도 됩니다.',
    );
    process.exit(1);
  }
  if (await alreadyRunning()) {
    openBrowser();
    process.exit(0);
  }
  // The data folder chosen in molanote.cmd (see local-data.ts), or the default C:\Users\<name>\molanote-data.
  process.env.MOLANOTE_DATA_DIR ||= dataDir();
  // A folder on a drive that is not there right now (Google Drive not running) is not made elsewhere:
  // the app opens and says so, and offers to try again.
  if (existsSync(dirname(process.env.MOLANOTE_DATA_DIR))) {
    try {
      mkdirSync(process.env.MOLANOTE_DATA_DIR, { recursive: true });
    } catch (err) {
      console.warn('Data folder not available: ' + err.message);
    }
  }
  console.log('Data folder: ' + process.env.MOLANOTE_DATA_DIR);
  process.env.BOARD_AUTO_EXIT = '1';
  process.env.VITE_BOARD_AUTO_EXIT = '1';
  const { build, preview } = await import('vite');
  await build({ root, logLevel: 'warn' });
  await preview({ root, preview: { open: false } });
  openBrowser();
  console.log('molanote is running at ' + url);
} catch (err) {
  console.error(err);
  const msg = String(err?.message ?? err);
  showError(
    msg.includes('4173') || msg.includes('EADDRINUSE')
      ? '4173 포트를 다른 프로그램이 쓰고 있어 molanote를 열 수 없습니다. stop.cmd를 실행한 뒤 다시 시도해 보세요.'
      : 'molanote를 시작하지 못했습니다. 폴더의 launch-error.log를 확인해 주세요.\n\n' + msg,
  );
  process.exit(1);
}
