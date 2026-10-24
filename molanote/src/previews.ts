import type { LinkPreview } from './types';
import { fetchViaAnyRoute } from './papers';
import { tr } from './i18n';

/** YouTube video id from watch, youtu.be, shorts, embed and live links. */
export function youTubeId(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    const host = u.hostname.replace(/^(www\.|m\.|music\.)/, '');
    if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
    if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      const v = u.searchParams.get('v');
      if (v) return v;
      const m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]{6,})/);
      return m ? m[1] : null;
    }
  } catch {
    // not a URL
  }
  return null;
}

async function imageBlob(url: string): Promise<Blob | null> {
  try {
    const res = await fetchViaAnyRoute(url);
    const blob = await res.blob();
    if (!blob.type.startsWith('image/') || blob.size < 200) return null;
    return blob;
  } catch {
    return null;
  }
}

const meta = (doc: Document, ...keys: string[]) => {
  for (const k of keys) {
    const v = doc.querySelector(`meta[property="${k}"], meta[name="${k}"]`)?.getAttribute('content')?.trim();
    if (v) return v;
  }
  return undefined;
};

/**
 * Fetches what a link card needs to show a picture: YouTube thumbnails and titles, or a page's
 * Open Graph / Twitter card image and title. The image comes back as a Blob to store locally.
 */
export async function fetchLinkPreview(url: string): Promise<{ preview: Omit<LinkPreview, 'imageKey'>; image: Blob | null }> {
  const yt = youTubeId(url);
  if (yt) {
    let title: string | undefined;
    let site = 'YouTube';
    try {
      const res = await fetchViaAnyRoute(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${yt}`)}`);
      const data = (await res.json()) as { title?: string; author_name?: string };
      title = data.title;
      if (data.author_name) site = `YouTube · ${data.author_name}`;
    } catch {
      // The thumbnail alone is still worth showing.
    }
    // hqdefault exists for every video (the 16:9 card crops its letterbox bars).
    const image = await imageBlob(`https://i.ytimg.com/vi/${yt}/hqdefault.jpg`);
    return { preview: { kind: 'youtube', videoId: yt, title, site, fetchedAt: Date.now() }, image };
  }

  const res = await fetchViaAnyRoute(url);
  const type = res.headers.get('content-type') ?? '';
  if (type.startsWith('image/')) {
    const blob = await res.blob();
    return { preview: { kind: 'page', fetchedAt: Date.now() }, image: blob };
  }
  if (!/html/i.test(type)) throw new Error(tr('미리보기를 만들 수 없는 형식입니다', "Can't preview this format"));
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const title = meta(doc, 'og:title', 'twitter:title') ?? doc.querySelector('title')?.textContent?.trim();
  const site = meta(doc, 'og:site_name', 'application-name');
  const description = meta(doc, 'og:description', 'twitter:description', 'description');
  const rawImage = meta(doc, 'og:image:secure_url', 'og:image', 'og:image:url', 'twitter:image', 'twitter:image:src');
  let image: Blob | null = null;
  if (rawImage) {
    try {
      image = await imageBlob(new URL(rawImage, url).href);
    } catch {
      image = null;
    }
  }
  return {
    preview: { kind: 'page', title: title?.slice(0, 300), site, description: description?.slice(0, 500), fetchedAt: Date.now() },
    image,
  };
}
