import { useEffect, useState } from 'react';
import { tr } from '../i18n';
import { Icon } from './Icon';

const MOLANOTE = { 'x-molanote': '1' };

type Choice = { kind: 'cloud' | 'here'; label: string; path: string; hasData: boolean };

/**
 * The first time molanote opens on a PC: where should the data be kept? Google Drive (when it is
 * on this PC) comes first, then the default folder on this PC, or any other folder. Until it is
 * answered the default folder is used; the choice can be changed later in ⋯ › Change data folder.
 */
export function FirstRunFolder({
  current,
  onKeep,
  onMove,
  onPickOther,
}: {
  current: string;
  onKeep: () => void;
  onMove: (dir: string) => void;
  onPickOther: () => void;
}) {
  const [choices, setChoices] = useState<Choice[] | null>(null);
  const [picked, setPicked] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      const here: Choice = { kind: 'here', label: tr('이 PC', 'This PC'), path: current, hasData: false };
      const out: Choice[] = [];
      try {
        const p = await (await fetch('/__data/browse', { headers: MOLANOTE, cache: 'no-store' })).json();
        for (const place of (p.places ?? []) as { label: string; path: string; kind: string }[]) {
          if (place.kind !== 'cloud') continue;
          const l = await (await fetch('/__data/browse?path=' + encodeURIComponent(place.path), { headers: MOLANOTE, cache: 'no-store' })).json();
          if (l.error || !l.target) continue;
          out.push({ kind: 'cloud', label: place.label, path: l.target, hasData: !!l.targetHasData });
        }
      } catch {
        // Only this PC, then.
      }
      if (alive) setChoices([...out, here]);
    })();
    return () => {
      alive = false;
    };
  }, [current]);

  const go = () => {
    const c = choices?.[picked];
    if (!c) return;
    if (c.path === current) onKeep();
    else onMove(c.path);
  };

  return (
    <div className="gate-backdrop soft">
      <div className="gate-dialog folder-dialog first-run" role="dialog" aria-modal="true" aria-labelledby="first-run-title" data-first-run>
        <div className="folder-dialog-icon">
          <img className="first-run-logo" src="/molanote-logo.webp" alt="molanote" draggable={false} data-first-run-logo />
        </div>
        <h1 id="first-run-title">{tr('데이터를 어디에 저장할까요?', 'Where should your data be kept?')}</h1>
        <p className="muted small">
          {tr(
            '보드, 이미지, 파일이 저장될 폴더입니다. 집과 직장 등 여러 PC에서 함께 쓰려면 Google Drive를 고르세요. 나중에 오른쪽 위 ⋯ › 데이터 폴더 바꾸기에서 바꿀 수 있습니다.',
            'The folder for your boards, images and files. To use them on several PCs (home and work), pick Google Drive. You can change it later in ⋯ › Change data folder.',
          )}
        </p>
        <div className="first-run-choices" role="radiogroup" aria-label={tr('저장 위치', 'Where to keep the data')}>
          {!choices && <div className="muted small">{tr('위치를 찾는 중…', 'Looking for places…')}</div>}
          {choices?.map((c, i) => (
            <button
              key={c.path}
              role="radio"
              aria-checked={picked === i}
              className={picked === i ? 'first-run-choice on' : 'first-run-choice'}
              data-choice={c.kind}
              onClick={() => setPicked(i)}
            >
              <Icon name={c.kind === 'cloud' ? 'cloud' : 'monitor'} size={20} />
              <span className="first-run-text">
                <strong>
                  {c.label}
                  {c.kind === 'cloud' && <span className="first-run-tag">{tr('추천', 'Recommended')}</span>}
                </strong>
                <span className="first-run-path">{c.path}</span>
                {c.hasData && <span className="first-run-note">{tr('이미 molanote 데이터가 있어 그 데이터를 엽니다', 'Already holds molanote data: it opens that')}</span>}
                {c.kind === 'here' && <span className="first-run-note">{tr('이 PC에서만 씁니다', 'Used on this PC only')}</span>}
              </span>
            </button>
          ))}
        </div>
        <button className="gate-primary" data-first-run-ok disabled={!choices} onClick={go}>
          {tr('이 위치에 저장', 'Keep it here')}
        </button>
        <button className="gate-secondary" data-first-run-other onClick={onPickOther}>
          {tr('다른 폴더 고르기…', 'Choose another folder…')}
        </button>
      </div>
    </div>
  );
}
