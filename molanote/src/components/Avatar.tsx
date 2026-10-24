import { useEffect, useState } from 'react';
import type { CommentAuthor } from '../types';
import { blobUrl, cachedBlobUrl } from '../db';

/** Object URL of a stored file, loaded from this device or the cloud. */
export function useBlobUrl(key?: string) {
  const [url, setUrl] = useState<string | null>(() => (key ? cachedBlobUrl(key) : null));
  useEffect(() => {
    if (!key) {
      setUrl(null);
      return;
    }
    let alive = true;
    blobUrl(key).then((u) => {
      if (alive) setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [key]);
  return url;
}

/** Round profile picture, or the first letter of the name on the profile colour. */
export function Avatar({ author, size = 28 }: { author: Pick<CommentAuthor, 'name' | 'color' | 'photoKey'>; size?: number }) {
  const url = useBlobUrl(author.photoKey);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.44) };
  if (url) return <img className="avatar" src={url} alt={author.name} style={style} draggable={false} />;
  return (
    <span className="avatar" style={{ ...style, background: author.color }} aria-label={author.name}>
      {(author.name.trim()[0] ?? '?').toUpperCase()}
    </span>
  );
}
