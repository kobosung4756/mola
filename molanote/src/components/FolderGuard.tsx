import { useEffect, useRef, useState } from 'react';
import { announcePresence, dataFolder, folderStatus, mergeFolderConflicts, retryFolder, viewingLastCopy } from '../db';
import type { FolderStatus } from '../db';
import { tr } from '../i18n';
import { Icon } from './Icon';

/** How often the data folder is checked for other PCs, their changes and sync clashes. */
const POLL_MS = 4000;
/** After another PC's changes came in, look once more a little later: a sync app may bring its files one by one. */
const FOLLOW_UP_MS = 20_000;

type Other = FolderStatus['others'][number];

const ago = (t: number) => {
  const min = Math.max(0, Math.round((Date.now() - t) / 60_000));
  return min < 1 ? tr('방금', 'just now') : tr(`${min}분 전`, `${min} min ago`);
};
const names = (others: Other[]) => [...new Set(others.map((o) => o.machine))].join(', ');

/**
 * For a data folder kept in Google Drive (or another sync app) and opened on several PCs:
 *  - another PC that has it open is shown at the start, with a choice to only look (read-only);
 *  - what another PC saves is taken in here a moment after the sync app brings it;
 *  - copies the sync app made when both PCs changed the same file are shown and can be merged back.
 */
export function FolderGuard({
  stateKey,
  busy,
  readOnly,
  setReadOnly,
  pullFolder,
  retrySave,
  flash,
}: {
  stateKey: string;
  /** A block is being edited: changes from elsewhere wait until it is done. */
  busy: boolean;
  readOnly: boolean;
  setReadOnly: (on: boolean) => void;
  pullFolder: () => Promise<number>;
  /** Saves what is on screen again (after a save could not reach the local server). */
  retrySave: () => Promise<void>;
  flash: (msg: string) => void;
}) {
  const [ask, setAsk] = useState<Other[] | null>(null);
  const [others, setOthers] = useState<Other[]>([]);
  const [hiddenOthers, setHiddenOthers] = useState('');
  const [conflicts, setConflicts] = useState<FolderStatus['conflicts']>([]);
  const [hiddenConflicts, setHiddenConflicts] = useState('');
  const [merging, setMerging] = useState(false);
  /** The data folder cannot be reached: saves wait on this PC (how many). */
  const [away, setAway] = useState<{ folderOk: boolean; pending: number } | null>(null);
  /** The local server does not answer (the app was stopped): saves wait in this browser. */
  const [serverLost, setServerLost] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const presence = useRef<ReturnType<typeof announcePresence> | null>(null);
  const live = useRef({ busy, readOnly, pullFolder, flash });
  live.current = { busy, readOnly, pullFolder, flash };

  useEffect(() => {
    if (!dataFolder) return;
    let alive = true;
    let decided = false;
    let running = false;
    let seen: string | undefined;
    let candidate: string | null = null;
    let followUp = 0;
    let misses = 0;
    let wasDown = false;
    const pull = async (quiet: boolean) => {
      const n = await live.current.pullFolder().catch(() => 0);
      if (n && !quiet) live.current.flash(tr('다른 PC에서 바뀐 내용을 불러왔습니다', 'Loaded the changes made on another PC'));
      return n;
    };
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        const st = await folderStatus();
        if (!alive) return;
        misses = st ? 0 : misses + 1;
        setServerLost(misses >= 2);
        if (!st) return;
        const down = !st.folderOk || st.pending > 0;
        if (down) setAway({ folderOk: st.folderOk, pending: st.pending });
        else if (wasDown) {
          // Back: what waited here is in the folder now, laid over what other PCs saved meanwhile.
          setAway(null);
          await pull(true);
          live.current.flash(tr('데이터 폴더에 다시 연결해 보관해 둔 변경을 저장했습니다', 'Reconnected to the data folder and saved the changes kept meanwhile'));
        }
        wasDown = down;
        if (down) return;
        setOthers(st.others);
        setConflicts(st.conflicts);
        if (!decided) {
          decided = true;
          if (st.others.length) setAsk(st.others);
          else presence.current = announcePresence(false);
        }
        const sig = st.stamps[stateKey] ?? '';
        if (seen === undefined || sig === seen) {
          seen = sig;
          candidate = null;
          if (followUp && Date.now() >= followUp && !live.current.busy) {
            followUp = 0;
            await pull(true);
          }
          return;
        }
        // Another PC saved: wait until its files have stopped arriving (the same twice), and until editing ends here.
        if (candidate !== sig || live.current.busy) {
          candidate = sig;
          return;
        }
        candidate = null;
        seen = sig;
        await pull(false);
        followUp = Date.now() + FOLLOW_UP_MS;
      } finally {
        running = false;
      }
    };
    tick();
    const timer = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
      presence.current?.('stop');
      presence.current = null;
    };
  }, [stateKey]);

  const choose = (watch: boolean) => {
    setAsk(null);
    setReadOnly(watch);
    presence.current = announcePresence(watch);
    if (watch) setHiddenOthers(names(others));
  };

  const startEditing = () => {
    if (others.length && !confirm(tr(`${names(others)}에서도 열려 있습니다. 두 곳에서 함께 고치면 같은 블록은 나중에 저장한 쪽으로 맞춰집니다. 편집할까요?`, `It is also open on ${names(others)}. If both edit, a block changed in both places keeps the later save. Start editing?`))) return;
    setReadOnly(false);
    presence.current?.(false);
  };

  const merge = async () => {
    setMerging(true);
    try {
      const changed = await mergeFolderConflicts();
      if (changed.includes(stateKey)) await pullFolder();
      setConflicts([]);
      flash(changed.length ? tr('충돌 사본을 합쳤습니다', 'Merged the conflict copies') : tr('충돌 사본을 따로 보관했습니다', 'Moved the conflict copies aside'));
    } catch (err) {
      flash((err as Error).message);
    } finally {
      setMerging(false);
    }
  };

  /** The warning's button: the folder again now (the server writes what waits), and this page's last save. */
  const retryNow = async () => {
    setRetrying(true);
    try {
      const r = await retryFolder();
      await retrySave().catch(() => {});
      if (!r) flash(tr('molanote 서버에 연결할 수 없습니다', "Can't reach the molanote server"));
      else if (!r.folderOk) flash(tr('아직 데이터 폴더에 연결할 수 없습니다. 계속 다시 시도합니다.', "The data folder still can't be reached. Still trying."));
      else if (r.pending === 0) {
        setAway(null);
        await pullFolder().catch(() => 0);
        flash(tr('데이터 폴더에 다시 연결해 보관해 둔 변경을 저장했습니다', 'Reconnected to the data folder and saved the changes kept meanwhile'));
      }
    } finally {
      setRetrying(false);
    }
  };

  if (viewingLastCopy) {
    return (
      <div className="folder-notices">
        <div className="folder-notice warn" data-last-copy-notice>
          <Icon name="eye" size={16} />
          <span>
            {tr('데이터 폴더에 연결할 수 없어 이 브라우저에 남은 마지막 사본을 읽기 전용으로 보는 중', "Viewing this browser's last copy read-only: the data folder can't be reached")}
            <span className="muted"> · {dataFolder} · {tr('이미지와 파일은 보이지 않을 수 있습니다', 'images and files may not show')}</span>
          </span>
          <button
            className="folder-notice-btn"
            data-reconnect
            disabled={retrying}
            onClick={async () => {
              setRetrying(true);
              const r = await retryFolder();
              setRetrying(false);
              if (r?.folderOk) location.reload();
              else flash(tr('아직 데이터 폴더에 연결할 수 없습니다', "The data folder still can't be reached"));
            }}
          >
            {retrying ? tr('연결 중…', 'Connecting…') : tr('다시 연결', 'Reconnect')}
          </button>
        </div>
      </div>
    );
  }

  if (!dataFolder) return null;
  const otherNames = names(others);
  const conflictNames = conflicts.map((c) => c.name).join('|');
  const showOthers = !readOnly && !ask && others.length > 0 && hiddenOthers !== otherNames;
  const showConflicts = conflicts.length > 0 && hiddenConflicts !== conflictNames;

  return (
    <>
      {ask && (
        <div className="gate-backdrop soft">
          <div className="gate-dialog folder-dialog warning" role="dialog" aria-modal="true" aria-labelledby="folder-busy-title" data-folder-in-use>
            <div className="folder-dialog-icon">
              <Icon name="monitor" size={30} />
            </div>
            <h1 id="folder-busy-title">{tr('다른 PC에서 열려 있습니다', 'Open on another PC')}</h1>
            <p className="folder-dialog-who">
              {ask.map((o) => (
                <span key={o.machine + o.user}>
                  <strong>{o.machine}</strong> {o.user && `(${o.user})`} · {tr('마지막 확인', 'last seen')} {ago(o.beat)}
                </span>
              ))}
            </p>
            <p className="muted small">
              {tr(
                '같은 데이터 폴더를 두 PC에서 함께 고치면, 동기화가 늦을 때 바뀐 내용이 엇갈릴 수 있습니다. 저쪽을 닫았다면 몇 분 뒤에 이 표시가 사라집니다.',
                'If two PCs edit the same data folder at once, changes can cross while the sync catches up. If you closed it there, this goes away in a few minutes.',
              )}
            </p>
            <button className="gate-primary" data-folder-watch onClick={() => choose(true)}>
              {tr('읽기 전용으로 보기', 'View read-only')}
            </button>
            <button className="gate-secondary" data-folder-open-anyway onClick={() => choose(false)}>
              {tr('그래도 편집하기', 'Edit anyway')}
            </button>
          </div>
        </div>
      )}
      {(readOnly || showOthers || showConflicts || away || serverLost) && (
        <div className="folder-notices">
          {serverLost && (
            <div className="folder-notice danger" data-server-lost>
              <Icon name="alert" size={16} />
              <span>
                {tr('molanote 서버와 연결이 끊겼습니다.', 'Lost the connection to the molanote server.')}
                <span className="muted"> {tr('바꾼 내용은 이 브라우저에 보관하고 몇 초마다 다시 저장해 봅니다. 계속되면 molanote.cmd로 다시 여세요.', 'Changes are kept in this browser and saved again every few seconds. If it goes on, open molanote.cmd again.')}</span>
              </span>
              <button className="folder-notice-btn" disabled={retrying} onClick={retryNow}>
                {retrying ? tr('시도 중…', 'Trying…') : tr('다시 시도', 'Try again')}
              </button>
            </div>
          )}
          {away && !serverLost && (
            <div className="folder-notice danger" data-folder-down>
              <Icon name="alert" size={16} />
              <span>
                {away.folderOk
                  ? tr('데이터 폴더에 다시 연결되어 보관해 둔 변경을 저장하는 중입니다', 'The data folder is back: saving the changes kept meanwhile')
                  : tr(`데이터 폴더(${dataFolder})에 저장하지 못하고 있습니다`, `Can't save to the data folder (${dataFolder})`)}
                <span className="muted">
                  {' · '}
                  {tr(`변경 ${away.pending}건을 이 PC에 안전하게 보관 중이며, 몇 초마다 다시 시도합니다. Google Drive가 켜져 있는지 확인하세요.`, `${away.pending} change(s) kept safely on this PC; trying again every few seconds. Check that Google Drive is running.`)}
                </span>
              </span>
              <button className="folder-notice-btn" data-retry-folder disabled={retrying} onClick={retryNow}>
                {retrying ? tr('시도 중…', 'Trying…') : tr('다시 시도', 'Try again')}
              </button>
            </div>
          )}
          {readOnly && (
            <div className="folder-notice" data-read-only-notice>
              <Icon name="eye" size={16} />
              <span>
                {tr('읽기 전용으로 보는 중', 'Viewing read-only')}
                {otherNames && <span className="muted"> · {tr(`${otherNames}에서 사용 중`, `in use on ${otherNames}`)}</span>}
                <span className="muted"> · {tr('저쪽에서 바꾼 내용은 여기에 바로 반영됩니다', 'changes made there show up here')}</span>
              </span>
              <button className="folder-notice-btn" data-folder-start-editing onClick={startEditing}>
                {tr('편집하기', 'Edit')}
              </button>
            </div>
          )}
          {showOthers && (
            <div className="folder-notice warn" data-other-pc-notice>
              <Icon name="monitor" size={16} />
              <span>
                {tr(`${otherNames}에서도 이 데이터 폴더를 열었습니다.`, `${otherNames} has this data folder open too.`)}
                <span className="muted"> {tr('같은 블록을 두 곳에서 고치면 나중에 저장한 쪽으로 맞춰집니다.', 'A block changed in both places keeps the later save.')}</span>
              </span>
              <button className="folder-notice-btn" onClick={() => (setReadOnly(true), presence.current?.(true))}>
                {tr('읽기 전용으로', 'Read-only')}
              </button>
              <button className="folder-notice-x" aria-label={tr('닫기', 'Close')} onClick={() => setHiddenOthers(otherNames)}>
                <Icon name="close" size={14} />
              </button>
            </div>
          )}
          {showConflicts && (
            <div className="folder-notice warn" data-conflict-notice>
              <Icon name="alert" size={16} />
              <span>
                {tr(`동기화 앱이 충돌 사본 ${conflicts.length}개를 만들었습니다`, `The sync app made ${conflicts.length} conflict ${conflicts.length === 1 ? 'copy' : 'copies'}`)}
                <span className="muted">
                  {' '}
                  {tr('(두 PC에서 같은 파일을 거의 동시에 고쳤을 때 생깁니다). 합치면 블록마다 나중에 고친 쪽이 남고, 사본은 conflicts 폴더로 옮겨집니다.', '(two PCs changed the same file at about the same time). Merging keeps the later version of each block and moves the copies to the conflicts folder.')}
                </span>
              </span>
              <button className="folder-notice-btn" data-merge-conflicts disabled={merging} onClick={merge}>
                {merging ? tr('합치는 중…', 'Merging…') : tr('합치기', 'Merge')}
              </button>
              <button className="folder-notice-btn plain" onClick={() => fetch('/__data/open', { method: 'POST', headers: { 'x-molanote': '1' } }).catch(() => {})}>
                {tr('폴더 열기', 'Open folder')}
              </button>
              <button className="folder-notice-x" aria-label={tr('닫기', 'Close')} onClick={() => setHiddenConflicts(conflictNames)}>
                <Icon name="close" size={14} />
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
