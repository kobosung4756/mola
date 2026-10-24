import { useState } from 'react';
import { retryFolder } from '../db';
import { tr } from '../i18n';
import { Icon } from './Icon';

/**
 * Shown at the start when the data folder cannot be reached (Google Drive not running, the drive
 * gone…), instead of quietly opening the browser's own storage. Try again, or look at this
 * browser's last copy read-only.
 */
export function FolderMissing({ dir, onViewLastCopy }: { dir: string; onViewLastCopy: () => void }) {
  const [trying, setTrying] = useState(false);
  const [still, setStill] = useState(false);

  const retry = async () => {
    setTrying(true);
    const r = await retryFolder();
    if (r?.folderOk) {
      location.reload();
      return;
    }
    setTrying(false);
    setStill(true);
  };

  return (
    <div className="gate-backdrop">
      <div className="gate-dialog folder-dialog warning" role="dialog" aria-modal="true" aria-labelledby="folder-missing-title" data-folder-missing>
        <div className="folder-dialog-icon">
          <Icon name="alert" size={30} />
        </div>
        <h1 id="folder-missing-title">{tr('데이터 폴더를 찾을 수 없습니다', "Can't find the data folder")}</h1>
        <p className="folder-dialog-who">
          <strong>{dir}</strong>
        </p>
        <p className="muted small">
          {tr(
            'Google Drive 같은 동기화 앱이 켜져 있는지, 드라이브가 연결되어 있는지 확인한 뒤 다시 시도하세요. 연결되기 전에는 아무것도 저장하지 않으므로 보드가 둘로 갈라지지 않습니다.',
            'Check that Google Drive (or your sync app) is running and the drive is connected, then try again. Nothing is saved until then, so the boards never split in two.',
          )}
        </p>
        {still && <p className="fp-error">{tr('아직 연결할 수 없습니다.', 'Still not reachable.')}</p>}
        <button className="gate-primary" data-retry-missing disabled={trying} onClick={retry}>
          {trying ? tr('연결 중…', 'Connecting…') : tr('다시 시도', 'Try again')}
        </button>
        <button className="gate-secondary" data-view-last-copy onClick={onViewLastCopy}>
          {tr('마지막 사본 보기 (읽기 전용)', 'View the last copy (read-only)')}
        </button>
      </div>
    </div>
  );
}
