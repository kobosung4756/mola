import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { tr } from '../i18n';
import { Icon } from './Icon';
import { SHORTCUT_HELP } from './TextBar';

/** Shortcuts of the board, links, tables and to-dos (the note editor's come from its own list). */
const BOARD_HELP: { title: string; rows: [string, string][] }[] = [
  {
    title: tr('보드', 'Board'),
    rows: [
      [tr('빈 곳 더블클릭', 'Double-click empty space'), tr('새 노트', 'New note')],
      ['N', tr('새 노트', 'New note')],
      ['T / H / B / C', tr('새 할 일 / 링크 / 보드 / 컬럼', 'New to-do / link / board / column')],
      ['S / G / I / F', tr('새 블록선도(도형) / 표 / 이미지 / 파일', 'New diagram (shapes) / table / image / file')],
      ['Enter', tr('편집 (보드는 열기, 할 일은 끝에 새 항목, 그림은 이어 그리기)', 'Edit (opens a board; a to-do list gets a new item; a drawing: draw on)')],
      [tr('그리기 올가미', 'Drawing lasso'), tr('둘러싸서 획 고르기 → 끌어서 옮기기 · Ctrl+X/C/V · Delete', 'Draw around strokes → drag to move · Ctrl+X/C/V · Delete')],
      ['F2', tr('이름 고치기 · 제목 → 캡션 → 블록 선택 차례로 (빈 제목·캡션은 남지 않음)', 'Rename · title → caption → the block, in turn (empty ones do not stay)')],
      ['Esc', tr('편집 끝내기, 선택 풀기', 'Finish editing, deselect')],
      ['Delete', tr('휴지통으로', 'To the trash')],
      ['L', tr('연결선 그리기', 'Draw a line')],
      ['D', tr('펜으로 그리기 (사진을 고른 채: 사진 위에 그리기)', 'Draw with the pen (an image picked: draw on it)')],
      ['E', tr('고른 사진 자르기·회전', 'Crop / rotate the picked image')],
      ['Ctrl+Enter', tr('그리기 끝내기 · 사진 그리기·자르기 저장', 'Finish drawing · save drawing on / cropping an image')],
      [tr('Ctrl+클릭', 'Ctrl+click'), tr('여러 개 선택', 'Pick several')],
      ['Shift+L / Shift+C / Shift+R', tr('고른 블록들 왼쪽 / 가운데 / 오른쪽 맞춤', 'Align the picked blocks left / centre / right')],
      ['Shift+T / Shift+M / Shift+B', tr('고른 블록들 위쪽 / 중간 / 아래쪽 맞춤', 'Align the picked blocks top / middle / bottom')],
      ['Shift+H / Shift+V', tr('가로 / 세로 간격을 동일하게 (3개 이상)', 'Same gaps across / down (3 or more)')],
      ['Ctrl+A', tr('모두 선택', 'Select all')],
      [tr('방향키', 'Arrows'), tr('블록 사이 이동 (고른 블록이 없으면 화면 가운데 블록부터)', 'Go from block to block (none picked: the one in the middle first)')],
      [tr('Alt+방향키 (+Shift)', 'Alt+arrows (+Shift)'), tr('고른 블록 1px (10px) 옮기기', 'Nudge the picked blocks 1px (10px)')],
      ['Space', tr('짧게: 모든 블록의 가운데로 · 누른 채 끌기: 화면 옮기기', 'Tap: to the middle of all blocks · hold and drag: pan')],
    ],
  },
  {
    title: tr('편집과 이동', 'Editing and moving around'),
    rows: [
      ['Ctrl+Z', tr('실행 취소 (안 보이는 곳이면 그리로 가서 보여 줌)', 'Undo (goes to it when out of sight)')],
      ['Ctrl+Shift+Z', tr('다시 실행', 'Redo')],
      ['Ctrl+C / Ctrl+X', tr('복사 / 잘라내기', 'Copy / cut')],
      ['Ctrl+V', tr('붙여넣기 (molanote 블록은 그대로, 밖의 것은 Unsorted로)', 'Paste (molanote blocks as they are, others to Unsorted)')],
      ['Ctrl+D', tr('복제', 'Duplicate')],
      ['Ctrl+Space', tr('모든 보드에서 검색', 'Search every board')],
      ['Ctrl+O', tr('보드를 찾아서 이동 (아무것도 안 치면 자주 방문한 보드)', 'Find a board and go to it (nothing typed: the ones gone to often)')],
      ['↑ / ↓', tr('검색·찾기 창에서 결과 고르기 (Enter: 열기)', 'Pick a result in a search or finder (Enter opens it)')],
      ['Ctrl+F', tr('편집 중인 노트·할 일 안에서 찾기', 'Find inside the note or to-do being edited')],
      ['Ctrl+[', tr('보드 뒤로', 'Back a board')],
      ['Ctrl+]', tr('보드 앞으로 (Ctrl+[로 떠났던 보드로)', 'Forward a board (to where Ctrl+[ left)')],
      ['Ctrl+Shift+[', tr('홈으로', 'Home')],
      ['Ctrl+= / Ctrl+- / Ctrl+0', tr('확대 / 축소 / 100%', 'Zoom in / out / 100%')],
      ['Shift+1', tr('전체 보기 (모든 블록이 화면에 들어오게)', 'Fit all (every block on screen)')],
      ['Shift+2', tr('고른 블록 확대 (고른 블록이 화면에 꽉 차게)', 'Zoom to the picked blocks')],
      ['Shift+G', tr('관계 지도 켜기/끄기 (오른쪽 아래 스위치) · 지도에서 1/2/3 보기 바꾸기(포커스 모드에서는 단계), / 찾기, Shift+2 포커스 모드, Shift+1·Ctrl+=·Ctrl+- 지도 맞춤·확대·축소, L 범례 숨기기/보이기, Enter 보드에서 보기', 'Relation map on/off (bottom-right switch) · in the map: 1/2/3 views (in focus mode: depth), / find, Shift+2 focus mode, Shift+1 · Ctrl+= · Ctrl+- fit and zoom the map, L legend, Enter show on board')],
    ],
  },
  {
    title: tr('블록 링크', 'Links to blocks'),
    rows: [
      ['[[', tr('블록 찾기 창 열기 ([[]] 안에 링크)', 'Open the block finder (a link in [[ ]])')],
      ['![[', tr('임베드: 블록 내용을 노트 안에 보여 주기 (사진은 ![[이름|70]]으로 크기)', 'Embed: show a block in the note (images: ![[name|70]] for the size)')],
      ['[[이름|표시]]', tr('링크에 이름 대신 보일 이름(별칭) 붙이기', 'Give a link an alias to show instead of the name')],
      ['\\note + Space', tr('찾기 창에서 범위 좁히기 (\\board, \\todo …)', 'Narrow the finder (\\board, \\todo …)')],
      ['Esc', tr('찾기 창에서: 고르지 않고 닫기 → 새 노트 링크', 'In the finder: close without a pick → link to a new note')],
      ['Ctrl+L', tr('고른 블록의 링크 복사', 'Copy a link to the picked block')],
      ['Ctrl+K', tr('복사한 링크 붙이기 (편집 중: 커서 자리, 보드: 새 노트)', 'Put the copied link (editing: at the caret; board: a new note)')],
    ],
  },
  {
    title: tr('표', 'Tables'),
    rows: [
      ['Tab / Enter', tr('오른쪽 / 아래 칸으로', 'Next cell right / down')],
      ['F2', tr('칸 고치기', 'Edit the cell')],
      ['=', tr('수식 시작 (칸을 누르거나 방향키로 참조)', 'Start a formula (click or arrow to cells)')],
      ['Ctrl+C / Ctrl+V', tr('여러 칸 복사 / 붙여넣기', 'Copy / paste several cells')],
      [tr('채우기 손잡이 더블클릭', 'Double-click the fill handle'), tr('아래로 채우기', 'Fill down')],
    ],
  },
  {
    title: tr('할 일', 'To-dos'),
    rows: [
      ['Enter', tr('다음 할 일 (가운데에서 누르면 나눔)', 'Next to-do (splits in the middle)')],
      ['Shift+Enter', tr('할 일 안에서 줄바꿈', 'Line break inside a to-do')],
      ['Backspace', tr('맨 앞에서: 위 할 일과 합치기', 'At the start: join with the one above')],
      ['Ctrl+B / Ctrl+E', tr('굵게 / 인라인 코드', 'Bold / inline code')],
      ['Ctrl+M+K / Ctrl+M+B / Ctrl+M+R', tr('글자 색: 검정 / 파랑 / 빨강', 'Text colour: black / blue / red')],
      ['Ctrl+Z / Ctrl+Shift+Z', tr('할 일 안에서 되돌리기 / 다시 (글자·서식·색)', 'Undo / redo in the to-do (text, marks, colours)')],
      ['Backspace', tr('서식 걸린 글자 바로 뒤: 그 서식 풀기', 'Right after styled text: take the style off')],
      ['$ / ( / [ / {', tr('수식 / 괄호 (짝으로 자동 완성 · 고른 글자는 감싸기 · 할 일에는 링크·임베드 없음)', 'Formula / brackets (paired as you type · picked text is wrapped · no links or embeds in to-dos)')],
    ],
  },
];

/** Every shortcut, from the ⋯ menu's ?: a window in the middle of the screen. */
export function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    addEventListener('keydown', key, true);
    return () => removeEventListener('keydown', key, true);
  }, [onClose]);
  const groups = [...BOARD_HELP, ...SHORTCUT_HELP.map((g) => ({ ...g, title: `${tr('노트', 'Notes')} · ${g.title}` }))];
  return createPortal(
    <div className="gate-backdrop soft" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="gate-dialog shortcuts-help" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title" data-shortcuts-help>
        <div className="shortcuts-head">
          <h1 id="shortcuts-title">
            <Icon name="help" size={20} /> {tr('단축키 모음', 'Keyboard shortcuts')}
          </h1>
          <button className="shortcuts-close" onClick={onClose} aria-label={tr('닫기', 'Close')}>
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="shortcuts-grid">
          {groups.map((g) => (
            <section key={g.title} className="shortcuts-group">
              <h2>{g.title}</h2>
              {g.rows.map(([k, what], i) => (
                <div key={k + i} className="shortcuts-row">
                  <span className="shortcuts-keys">
                    {k.split(' / ').map((part, j) => (
                      <kbd key={j}>{part}</kbd>
                    ))}
                  </span>
                  <span className="shortcuts-what">{what}</span>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
