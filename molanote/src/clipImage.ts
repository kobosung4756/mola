import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { El } from './types';
import { COLORS } from './types';
import { blobUrl } from './db';
import { sketchDataUrl } from './draw';
import { diagramBounds } from './diagram';
import { DiagramParts } from './components/DiagramView';

/*
 * A picture, a drawing or a diagram copied with Ctrl+C also goes on the clipboard as a PNG, so it
 * can be pasted into other programs (a chat, a document, PowerPoint …).
 */

/** The kinds of block that are pasted elsewhere as a picture. */
export const PICTURE_BLOCKS = new Set(['IMAGE', 'SKETCH', 'DIAGRAM']);

/** A picture (any URL a browser can load) drawn onto a canvas and saved as PNG. */
function toPng(src: string, w?: number, h?: number, scale = 1, background?: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const cw = Math.max(1, Math.round((w ?? img.naturalWidth) * scale));
      const ch = Math.max(1, Math.round((h ?? img.naturalHeight) * scale));
      const cv = document.createElement('canvas');
      cv.width = cw;
      cv.height = ch;
      const g = cv.getContext('2d')!;
      if (background) {
        g.fillStyle = background;
        g.fillRect(0, 0, cw, ch);
      }
      g.drawImage(img, 0, 0, cw, ch);
      cv.toBlob((b) => (b ? resolve(b) : reject(new Error('no picture'))), 'image/png');
    };
    img.onerror = () => reject(new Error('the picture did not load'));
    img.src = src;
  });
}

/** A diagram as a plain SVG (words as SVG text, so a canvas may read it back). */
export function diagramSvg(el: El): { svg: string; w: number; h: number } | null {
  const d = el.content.diagram;
  const b = d ? diagramBounds(d, 12) : null;
  if (!d || !b) return null;
  const inner = renderToStaticMarkup(createElement(DiagramParts, { d, plainText: true }));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${b.w}" height="${b.h}" viewBox="${b.x} ${b.y} ${b.w} ${b.h}" font-family="'Times New Roman', Times, Pretendard, 'Malgun Gothic', serif">${inner}</svg>`;
  return { svg, w: b.w, h: b.h };
}

/** The block as a PNG (white behind it, twice the size for sharpness where it can be). */
export async function blockPng(el: El): Promise<Blob> {
  if (el.type === 'DIAGRAM') {
    const out = diagramSvg(el);
    if (!out) throw new Error('an empty diagram');
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(out.svg);
    return toPng(url, out.w, out.h, 2, '#ffffff');
  }
  if (el.type === 'SKETCH') {
    const url = sketchDataUrl(el, el.content.bg ? COLORS[el.content.bg] : '#fff');
    return toPng(url, el.content.vw ?? el.width, el.content.vh ?? el.height ?? undefined, 2, '#ffffff');
  }
  const key = el.content.blobKey;
  const url = key ? await blobUrl(key) : null;
  if (!url) throw new Error('no picture');
  const blob = await (await fetch(url)).blob();
  return blob.type === 'image/png' ? blob : toPng(url);
}
