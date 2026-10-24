import type { PaperInfo } from './types';
import { tr } from './i18n';

export type PaperSource =
  | { kind: 'arxiv'; id: string; pdfUrl: string; absUrl: string }
  | { kind: 'pdf'; pdfUrl: string };

const ARXIV_NEW = String.raw`\d{4}\.\d{4,5}(?:v\d+)?`;
const ARXIV_OLD = String.raw`[a-z][a-z.-]*\/\d{7}(?:v\d+)?`;
const ARXIV_URL = new RegExp(String.raw`arxiv\.org\/(?:abs|pdf|html)\/(${ARXIV_NEW}|${ARXIV_OLD})`, 'i');
const ARXIV_TAG = new RegExp(String.raw`^arxiv:\s*(${ARXIV_NEW}|${ARXIV_OLD})$`, 'i');

/** Recognises arXiv links (abs, pdf, html or `arXiv:` ids) and direct links to PDF files. */
export function detectPaper(raw: string): PaperSource | null {
  const text = raw.trim();
  const m = text.match(ARXIV_URL) ?? text.match(ARXIV_TAG);
  if (m) {
    const id = m[1].replace(/\.pdf$/i, '');
    return { kind: 'arxiv', id, pdfUrl: `https://arxiv.org/pdf/${id}`, absUrl: `https://arxiv.org/abs/${id}` };
  }
  try {
    const u = new URL(text);
    if (!/^https?:$/.test(u.protocol)) return null;
    const isPdf =
      /\.pdf$/i.test(u.pathname) ||
      (u.hostname.endsWith('openreview.net') && u.pathname === '/pdf') ||
      /\/pdf\/?$/i.test(u.pathname);
    return isPdf ? { kind: 'pdf', pdfUrl: u.href } : null;
  } catch {
    return null;
  }
}

/**
 * Fetches through the local server relay, which works for hosts without CORS headers.
 * When the app is served without the relay, falls back to a direct request.
 */
export async function fetchViaAnyRoute(url: string): Promise<Response> {
  let relayError = '';
  try {
    const relayed = await fetch(`/api/fetch?url=${encodeURIComponent(url)}`);
    // Only answers marked by the relay count; a server without it may return its own page.
    if (relayed.headers.get('x-board-relay')) {
      if (relayed.ok && !relayed.headers.get('x-board-relay-error')) return relayed;
      relayError = (await relayed.text().catch(() => '')) || `HTTP ${relayed.status}`;
    }
  } catch {
    // No local server; try directly.
  }
  if (relayError) throw new Error(relayError);
  const direct = await fetch(url, { mode: 'cors', credentials: 'omit' });
  if (!direct.ok) throw new Error(`HTTP ${direct.status}`);
  return direct;
}

export async function fetchPaperPdf(src: PaperSource): Promise<Blob> {
  const res = await fetchViaAnyRoute(src.pdfUrl);
  const blob = await res.blob();
  const head = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
  if (String.fromCharCode(...head) !== '%PDF-') throw new Error(tr('PDF 파일이 아닙니다', 'Not a PDF file'));
  return new Blob([blob], { type: 'application/pdf' });
}

/** Title, authors, abstract and date from the arXiv API. Returns null when unavailable. */
export async function fetchArxivMeta(id: string): Promise<Partial<PaperInfo> | null> {
  try {
    const res = await fetchViaAnyRoute(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`);
    const xml = new DOMParser().parseFromString(await res.text(), 'application/xml');
    const entry = xml.getElementsByTagName('entry')[0];
    if (!entry) return null;
    const text = (tag: string) => entry.getElementsByTagName(tag)[0]?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    const title = text('title');
    if (!title || /^Error$/i.test(title)) return null;
    return {
      title,
      authors: Array.from(entry.getElementsByTagName('author')).map(
        (a) => a.getElementsByTagName('name')[0]?.textContent?.trim() ?? '',
      ),
      abstract: text('summary'),
      published: text('published').slice(0, 10),
    };
  } catch {
    return null;
  }
}
