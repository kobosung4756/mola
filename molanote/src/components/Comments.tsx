import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { Comment, CommentAuthor, Commit, El } from '../types';
import { PROFILE_ID } from '../types';
import { AVATAR_COLORS, elTitle, makeEl, uid, update } from '../model';
import { putBlob } from '../db';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { tr } from '../i18n';

export function timeAgo(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return tr('방금', 'just now');
  if (s < 3600) return tr(`${Math.round(s / 60)}분 전`, `${Math.round(s / 60)}m ago`);
  if (s < 86400) return tr(`${Math.round(s / 3600)}시간 전`, `${Math.round(s / 3600)}h ago`);
  if (s < 86400 * 7) return tr(`${Math.round(s / 86400)}일 전`, `${Math.round(s / 86400)}d ago`);
  return new Date(ts).toLocaleDateString();
}

/**
 * Comment thread of one block, with the author's picture, name and time on every comment. Shown as
 * a speech bubble beside the block's comment icon (or the block itself while it has none yet).
 */
export function CommentsPanel({
  el,
  me,
  commit,
  onClose,
  onEditProfile,
}: {
  el: El;
  me: CommentAuthor;
  commit: Commit;
  onClose: () => void;
  onEditProfile: () => void;
}) {
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; side: 'right' | 'left'; arrow: number } | null>(null);

  /* Beside the comment icon, following it while the board moves; gone when the block is. */
  useEffect(() => {
    let frame = 0;
    let last = '';
    const place = () => {
      const host = document.querySelector<HTMLElement>(`.layer [data-el-id="${el.id}"], .unsorted-panel [data-el-id="${el.id}"], .column [data-el-id="${el.id}"]`);
      if (!host) {
        onClose();
        return;
      }
      const anchor = host.querySelector<HTMLElement>(`[data-comment-badge="${el.id}"]`) ?? host;
      const a = anchor.getBoundingClientRect();
      const w = popRef.current?.offsetWidth ?? 320;
      const h = popRef.current?.offsetHeight ?? 360;
      const right = a.right + 12 + w <= innerWidth - 8;
      const left = right ? a.right + 12 : Math.max(8, a.left - 12 - w);
      const mid = a.top + Math.min(a.height, 40) / 2;
      const top = Math.max(56, Math.min(mid - 28, innerHeight - h - 8));
      const next = { left: Math.round(left), top: Math.round(top), side: (right ? 'right' : 'left') as 'right' | 'left', arrow: Math.round(Math.max(14, Math.min(h - 14, mid - top))) };
      const key = JSON.stringify(next);
      if (key !== last) {
        last = key;
        setPos(next);
      }
      frame = requestAnimationFrame(place);
    };
    place();
    return () => cancelAnimationFrame(frame);
  }, [el.id, onClose]);

  /* Escape or a click elsewhere closes it (the comment icon itself keeps it open). */
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (popRef.current?.contains(t) || t.closest?.(`[data-comment-badge="${el.id}"]`) || t.closest?.('.profile-dialog, .context-menu')) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || (e.target as HTMLElement).closest?.('.comment-edit')) return;
      e.stopPropagation();
      onClose();
    };
    addEventListener('pointerdown', down, true);
    addEventListener('keydown', key, true);
    return () => {
      removeEventListener('pointerdown', down, true);
      removeEventListener('keydown', key, true);
    };
  }, [el.id, onClose]);

  const comments = el.content.comments ?? [];
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [, tick] = useState(0);

  // Once the bubble shows (a hidden box cannot take the focus).
  const shown = !!pos;
  useEffect(() => {
    if (shown) inputRef.current?.focus({ preventScroll: true });
  }, [el.id, shown]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [comments.length]);

  /* Keeps "n분 전" fresh. */
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  /** Own comments show the current profile; others keep the profile they were written with. */
  const authorOf = (c: Comment) => (c.author.id === me.id ? me : c.author);

  const setComments = (next: Comment[]) =>
    commit((m) => update(m, el.id, { content: { comments: next.length ? next : undefined } }));

  const post = () => {
    const text = draft.trim();
    if (!text) return;
    setComments([...comments, { id: uid(), text, author: me, createdAt: Date.now() }]);
    setDraft('');
  };

  const saveEdit = (id: string) => {
    const text = editText.trim();
    if (text) setComments(comments.map((c) => (c.id === id ? { ...c, text, editedAt: Date.now() } : c)));
    setEditing(null);
  };

  const submitOnCtrlEnter = (e: ReactKeyboardEvent, fn: () => void) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
      e.preventDefault();
      fn();
    }
  };

  return createPortal(
    <div
      ref={popRef}
      className={`comments-panel comments-pop arrow-${pos?.side ?? 'right'}`}
      role="dialog"
      aria-label={tr('댓글', 'Comments')}
      data-comments-pop={el.id}
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? undefined : 'hidden', ['--arrow-y' as string]: `${pos?.arrow ?? 24}px` }}
    >
      <div className="panel-head">
        <div className="comments-title">
          <strong>{tr('댓글', 'Comments')}</strong>
          <span className="muted small" title={elTitle(el)}>
            {elTitle(el)}
          </span>
        </div>
        <button onClick={onClose} title={tr('닫기 (Esc)', 'Close (Esc)')}>
          <Icon name="close" size={16} />
        </button>
      </div>
      <div className="panel-body comments-list" ref={listRef}>
        {comments.length === 0 && <div className="muted pad">{tr('아직 댓글이 없습니다. 첫 댓글을 남겨 보세요.', 'No comments yet. Be the first to comment.')}</div>}
        {comments.map((c) => {
          const a = authorOf(c);
          const mine = c.author.id === me.id;
          return (
            <div key={c.id} className="comment" data-comment-id={c.id}>
              <Avatar author={a} size={30} />
              <div className="comment-body">
                <div className="comment-meta">
                  <span className="comment-author">{a.name}</span>
                  <span className="muted small" title={new Date(c.createdAt).toLocaleString()}>
                    {timeAgo(c.createdAt)}
                    {c.editedAt ? tr(' · 수정됨', ' · edited') : ''}
                  </span>
                  {mine && editing !== c.id && (
                    <span className="comment-actions">
                      <button
                        onClick={() => {
                          setEditing(c.id);
                          setEditText(c.text);
                        }}
                      >
                        {tr('수정', 'Edit')}
                      </button>
                      <button className="danger" onClick={() => setComments(comments.filter((x) => x.id !== c.id))}>
                        {tr('삭제', 'Delete')}
                      </button>
                    </span>
                  )}
                </div>
                {editing === c.id ? (
                  <div className="comment-edit">
                    <textarea
                      value={editText}
                      autoFocus
                      rows={3}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => {
                        submitOnCtrlEnter(e, () => saveEdit(c.id));
                        if (e.key === 'Escape') {
                          e.stopPropagation();
                          setEditing(null);
                        }
                      }}
                    />
                    <div className="comment-actions">
                      <button onClick={() => saveEdit(c.id)}>{tr('저장', 'Save')}</button>
                      <button onClick={() => setEditing(null)}>{tr('취소', 'Cancel')}</button>
                    </div>
                  </div>
                ) : (
                  <div className="comment-text">{c.text}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="comment-compose">
        <button className="avatar-btn" onClick={onEditProfile} title={tr('내 프로필 편집', 'Edit my profile')}>
          <Avatar author={me} size={30} />
        </button>
        <div className="compose-box">
          <textarea
            ref={inputRef}
            value={draft}
            rows={2}
            placeholder={tr(`${me.name}(으)로 댓글 남기기…`, `Comment as ${me.name}…`)}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => submitOnCtrlEnter(e, post)}
          />
          <div className="compose-foot">
            <span className="muted small">{tr('Ctrl+Enter로 등록', 'Ctrl+Enter to post')}</span>
            <button className="compose-send" disabled={!draft.trim()} onClick={post}>
              {tr('댓글 달기', 'Comment')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Decodes a picked image. `createImageBitmap` is strict and skips some formats (e.g. SVG), so
 * fall back to an <img> element, which decodes everything the browser can show.
 */
async function decodeImage(file: File): Promise<{ width: number; height: number } & CanvasImageSource> {
  try {
    return await createImageBitmap(file);
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return Object.assign(img, { width: img.naturalWidth, height: img.naturalHeight });
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/** Shrinks a picked photo to a small square JPEG for avatars. */
async function toAvatarBlob(file: File, size = 128): Promise<Blob> {
  const bmp = await decodeImage(file);
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  canvas
    .getContext('2d')!
    .drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(tr('이미지를 만들 수 없습니다', 'Could not create the image')))), 'image/jpeg', 0.85),
  );
}

/** Name, colour and photo shown next to the account's comments. */
export function ProfileDialog({
  me,
  email,
  hasProfile,
  commit,
  onClose,
}: {
  me: CommentAuthor;
  email?: string;
  hasProfile: boolean;
  commit: Commit;
  onClose: () => void;
}) {
  const [name, setName] = useState(me.name);
  const [color, setColor] = useState(me.color);
  const [photoKey, setPhotoKey] = useState<string | undefined>(me.photoKey);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const pick = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try {
      setPhotoKey(await putBlob(await toAvatarBlob(file)));
    } catch (err) {
      alert(tr('사진을 쓸 수 없습니다: ', 'Cannot use this photo: ') + (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    const content = { name: name.trim(), hex: color, blobKey: photoKey };
    commit((m) => {
      if (m[PROFILE_ID]) update(m, PROFILE_ID, { content });
      else m[PROFILE_ID] = { ...makeEl('PROFILE', { parentId: '' }, content), id: PROFILE_ID };
    });
    onClose();
  };

  return (
    <div className="gate-backdrop soft" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="gate-dialog profile-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-title">
        <h1 id="profile-title">{tr('내 프로필', 'My profile')}</h1>
        <p className="muted small">{email ? `${email} · ` : ''}{tr('댓글 옆에 보이는 이름과 사진입니다.', 'The name and photo shown next to your comments.')}</p>
        <div className="profile-preview">
          <Avatar author={{ name: name || '?', color, photoKey }} size={72} />
          <div className="profile-photo-actions">
            <button onClick={() => fileRef.current?.click()} disabled={busy}>
              {busy ? tr('처리 중…', 'Working…') : photoKey ? tr('사진 바꾸기', 'Change photo') : tr('사진 올리기', 'Upload photo')}
            </button>
            {photoKey && <button onClick={() => setPhotoKey(undefined)}>{tr('사진 지우기', 'Remove photo')}</button>}
          </div>
        </div>
        <label className="profile-field">
          {tr('이름', 'Name')}
          <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder={tr('표시할 이름', 'Display name')} autoFocus />
        </label>
        <div className="profile-field">
          {tr('색', 'Color')}
          <div className="profile-colors">
            {AVATAR_COLORS.map((c) => (
              <button
                key={c}
                className={c === color ? 'dot on' : 'dot'}
                style={{ background: c }}
                title={c}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </div>
        <div className="profile-buttons">
          <button className="gate-secondary" onClick={onClose}>
            {tr('취소', 'Cancel')}
          </button>
          <button className="gate-primary" onClick={save} disabled={!name.trim()}>
            {hasProfile ? tr('저장', 'Save') : tr('프로필 만들기', 'Create profile')}
          </button>
        </div>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
      </div>
    </div>
  );
}
