import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { El } from '../types';
import { COLORS } from '../types';
import { blobUrl, cachedBlobUrl } from '../db';
import { sketchDataUrl } from '../draw';
import { sanitize } from '../sanitize';
import { tr } from '../i18n';
import { DiagramView } from './DiagramView';
import { MathText, renderNoteView } from './MathEditor';

/*
 * What a block holds, in the relation map's side card: a picture's thumbnail (photo, drawing,
 * block diagram, link card), or a note's, to-do list's or table's content. Only to look at:
 * nothing in it can be edited or pressed.
 */

/** A stored picture, loaded from its file. */
function BlobImage({ blobKey }: { blobKey?: string }) {
  const [src, setSrc] = useState<string | undefined>(blobKey ? (cachedBlobUrl(blobKey) ?? undefined) : undefined);
  useEffect(() => {
    if (!blobKey) return;
    let live = true;
    const cached = cachedBlobUrl(blobKey);
    if (cached) setSrc(cached);
    else blobUrl(blobKey).then((u) => live && u && setSrc(u));
    return () => {
      live = false;
    };
  }, [blobKey]);
  return src ? <img className="rmap-pv-img" src={src} alt="" draggable={false} data-map-thumb /> : null;
}

/** A note's text as it shows on its board (formulas drawn), read only. */
function NoteText({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!ref.current) return;
    ref.current.innerHTML = sanitize(html);
    for (const n of Array.from(ref.current.querySelectorAll('[contenteditable]'))) n.removeAttribute('contenteditable');
    try {
      renderNoteView(ref.current);
    } catch {
      /* (shown as text) */
    }
  }, [html]);
  return <div ref={ref} className="rmap-pv-note card-text" data-map-text />;
}

export function RelationPreview({ el }: { el: El }) {
  const c = el.content;
  switch (el.type) {
    case 'IMAGE':
      return (
        <div className="rmap-pv">
          <BlobImage blobKey={c.blobKey} />
        </div>
      );
    case 'SKETCH':
      return (
        <div className="rmap-pv">
          <img className="rmap-pv-img" src={sketchDataUrl(el, c.bg ? COLORS[c.bg] : '#fff')} alt="" draggable={false} data-map-thumb />
        </div>
      );
    case 'DIAGRAM':
      return (
        <div className="rmap-pv rmap-pv-diagram" data-map-thumb>
          <DiagramView d={c.diagram} />
        </div>
      );
    case 'LINK':
      return (
        <div className="rmap-pv">
          {c.preview?.imageKey && <BlobImage blobKey={c.preview.imageKey} />}
          {c.url && <div className="rmap-pv-url">{c.url}</div>}
          {(c.paper?.abstract || c.preview?.description) && <div className="rmap-pv-note">{c.paper?.abstract || c.preview?.description}</div>}
        </div>
      );
    case 'CARD':
      return c.html ? (
        <div className="rmap-pv rmap-pv-text">
          <NoteText html={c.html} />
        </div>
      ) : null;
    case 'TASK_LIST':
      return (
        <div className="rmap-pv rmap-pv-text" data-map-text>
          <ul className="rmap-pv-tasks">
            {(c.tasks ?? []).map((t) => (
              <li key={t.id} className={t.done ? 'done' : ''}>
                <span className="rmap-pv-box">{t.done ? '☑' : '☐'}</span>
                {t.text ? <MathText text={t.text} /> : <em className="muted">{tr('빈 항목', 'Empty')}</em>}
              </li>
            ))}
          </ul>
        </div>
      );
    case 'TABLE':
      return (
        <div className="rmap-pv rmap-pv-text" data-map-text>
          <table className="rmap-pv-table">
            <tbody>
              {(c.cells ?? []).slice(0, 12).map((row, r) => (
                <tr key={r}>
                  {row.slice(0, 6).map((cell, k) => (r === 0 ? <th key={k}>{cell}</th> : <td key={k}>{cell}</td>))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'FILE':
      return (
        <div className="rmap-pv rmap-pv-url">
          📎 {c.fileName} {c.fileSize ? `· ${Math.max(1, Math.round(c.fileSize / 1024))} KB` : ''}
        </div>
      );
    case 'COLOR_SWATCH':
      return (
        <div className="rmap-pv">
          <div className="rmap-pv-swatch" style={{ background: c.hex }} />
        </div>
      );
    default:
      return null;
  }
}

