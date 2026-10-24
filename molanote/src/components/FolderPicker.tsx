import { useEffect, useState } from 'react';
import { tr } from '../i18n';
import { Icon } from './Icon';

const MOLANOTE = { 'x-molanote': '1' };

type Place = { label: string; path: string; kind: 'cloud' | 'home' | 'drive' };
type Listing = {
  path: string;
  parent: string | null;
  folders: { name: string; path: string; molanote: boolean }[];
  /** This folder already holds molanote data. */
  molanote?: boolean;
  /** Where the data would go if this folder is picked (a molanote-data folder inside, if it holds other files). */
  target?: string;
  error?: string;
};

/**
 * The app's own folder picker for the data folder (the Windows one, opened by the local server,
 * could stay hidden behind the browser). Google Drive and other synced folders come first.
 */
export function FolderPicker({ current, onPick, onClose }: { current: string | null; onPick: (dir: string) => void; onClose: () => void }) {
  const [places, setPlaces] = useState<Place[]>([]);
  const [list, setList] = useState<Listing | null>(null);
  const [naming, setNaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = async (path: string) => {
    setNaming(null);
    setError(null);
    const r = await fetch('/__data/browse?path=' + encodeURIComponent(path), { headers: MOLANOTE, cache: 'no-store' });
    const l = (await r.json()) as Listing;
    setList(l);
    if (l.error) setError(tr('이 폴더를 열 수 없습니다.', "This folder can't be opened."));
  };

  useEffect(() => {
    let alive = true;
    fetch('/__data/browse', { headers: MOLANOTE, cache: 'no-store' })
      .then((r) => r.json())
      .then((p: { places: Place[] }) => {
        if (!alive) return;
        setPlaces(p.places);
        // Start in Google Drive when it is there, else where the data is now.
        const start = p.places.find((x) => x.kind === 'cloud')?.path ?? current ?? p.places[0]?.path;
        if (start) open(start);
      })
      .catch(() => setError(tr('폴더 목록을 읽지 못했습니다.', "Couldn't read the folders.")));
    return () => {
      alive = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (naming !== null) setNaming(null);
      else onClose();
    };
    addEventListener('keydown', key, true);
    return () => removeEventListener('keydown', key, true);
  }, [naming, onClose]);

  const makeFolder = async () => {
    const name = (naming ?? '').trim();
    if (!list || !name) return;
    const r = await fetch('/__data/mkdir', {
      method: 'POST',
      headers: { ...MOLANOTE, 'content-type': 'application/json' },
      body: JSON.stringify({ path: list.path, name }),
    });
    const out = await r.json();
    if (r.status === 409) return setError(tr('같은 이름의 폴더가 이미 있습니다.', 'A folder with that name already exists.'));
    if (!r.ok) return setError(tr('이 이름으로는 폴더를 만들 수 없습니다.', "Can't make a folder with that name."));
    await open(out.path);
  };

  const crumbs = list ? list.path.split(/[\\/]/).filter(Boolean) : [];
  const crumbPath = (i: number) => {
    const parts = crumbs.slice(0, i + 1);
    return parts.length === 1 && /^[A-Za-z]:$/.test(parts[0]) ? parts[0] + '\\' : parts.join('\\');
  };

  return (
    <div className="gate-backdrop soft" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="gate-dialog folder-picker" role="dialog" aria-modal="true" aria-labelledby="folder-picker-title" data-folder-picker>
        <h1 id="folder-picker-title">{tr('데이터 폴더 고르기', 'Choose the data folder')}</h1>
        <p className="muted small">
          {tr('집과 직장에서 함께 쓰려면 Google Drive 안의 폴더를 고르세요.', 'To use it at home and at work, pick a folder inside Google Drive.')}
        </p>
        <div className="fp-body">
          <nav className="fp-places" aria-label={tr('위치', 'Places')}>
            {places.map((p) => (
              <button key={p.path} className={list?.path === p.path ? 'on' : ''} data-place={p.kind} onClick={() => open(p.path)} title={p.path}>
                <Icon name={p.kind === 'cloud' ? 'cloud' : p.kind === 'home' ? 'home' : 'drive'} size={15} />
                <span>{p.label}</span>
              </button>
            ))}
          </nav>
          <div className="fp-main">
            <div className="fp-crumbs">
              {list?.parent && (
                <button className="fp-up" onClick={() => open(list.parent!)} title={tr('위 폴더', 'Up')} aria-label={tr('위 폴더', 'Up')}>
                  ↑
                </button>
              )}
              {crumbs.map((c, i) => (
                <span key={i}>
                  {i > 0 && <span className="fp-sep">›</span>}
                  <button onClick={() => open(crumbPath(i))}>{c}</button>
                </span>
              ))}
            </div>
            <div className="fp-list" data-folder-list>
              {list && list.folders.length === 0 && !error && <div className="muted small fp-empty">{tr('하위 폴더가 없습니다', 'No folders inside')}</div>}
              {list?.folders.map((f) => (
                <button key={f.path} className="fp-folder" onClick={() => open(f.path)} data-folder-name={f.name}>
                  <Icon name={f.molanote ? 'board' : 'folder'} size={16} />
                  <span>{f.name}</span>
                  {f.molanote && <span className="fp-badge">molanote</span>}
                </button>
              ))}
              {naming !== null && (
                <form
                  className="fp-new"
                  onSubmit={(e) => {
                    e.preventDefault();
                    makeFolder();
                  }}
                >
                  <input autoFocus value={naming} onChange={(e) => setNaming(e.target.value)} placeholder={tr('새 폴더 이름', 'New folder name')} data-new-folder-name />
                  <button type="submit" className="gate-primary">
                    {tr('만들기', 'Create')}
                  </button>
                </form>
              )}
            </div>
            {error && <div className="fp-error">{error}</div>}
          </div>
        </div>
        {list && (
          <div className="fp-target muted small" data-folder-target={list.target}>
            {list.molanote
              ? tr('이 폴더의 molanote 데이터를 엽니다.', 'Opens the molanote data in this folder.')
              : list.target && list.target !== list.path
                ? tr(`다른 파일이 있어서 이 안에 molanote-data 폴더를 만들어 저장합니다: ${list.target}`, `It holds other files, so the data goes into a molanote-data folder inside: ${list.target}`)
                : tr(`여기에 저장합니다: ${list.path}`, `Saves here: ${list.path}`)}
          </div>
        )}
        <div className="fp-actions">
          <button className="gate-secondary" onClick={() => setNaming('molanote-data')} disabled={!list || naming !== null} data-new-folder>
            {tr('새 폴더', 'New folder')}
          </button>
          <span className="fp-spacer" />
          <button className="gate-secondary" onClick={onClose}>
            {tr('취소', 'Cancel')}
          </button>
          <button className="gate-primary" disabled={!list || !!list.error} onClick={() => list && onPick(list.path)} data-use-folder>
            {tr('이 폴더 사용', 'Use this folder')}
          </button>
        </div>
      </div>
    </div>
  );
}
