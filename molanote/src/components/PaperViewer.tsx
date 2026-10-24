import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { getBlob } from '../db';
import { tr } from '../i18n';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const docs = new Map<string, Promise<PDFDocumentProxy>>();

function loadDoc(blobKey: string): Promise<PDFDocumentProxy> {
  let p = docs.get(blobKey);
  if (!p) {
    p = getBlob(blobKey).then(async (blob) => {
      if (!blob) throw new Error(tr('저장된 PDF를 찾을 수 없습니다', 'Saved PDF not found'));
      return pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
    });
    p.catch(() => docs.delete(blobKey));
    docs.set(blobKey, p);
  }
  return p;
}

interface PageSize {
  w: number;
  h: number;
}

/** Scrollable PDF reader. Pages render lazily when they scroll near the view. */
export function PaperViewer({ blobKey, zoom, onPages }: { blobKey: string; zoom: number; onPages?: (n: number) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<PageSize[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  const [current, setCurrent] = useState(1);

  useEffect(() => {
    let alive = true;
    loadDoc(blobKey)
      .then(async (d) => {
        const all: PageSize[] = [];
        for (let i = 1; i <= d.numPages; i++) {
          const vp = (await d.getPage(i)).getViewport({ scale: 1 });
          all.push({ w: vp.width, h: vp.height });
        }
        if (!alive) return;
        setDoc(d);
        setSizes(all);
        onPages?.(d.numPages);
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
    // onPages only reports the count once per document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blobKey]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const pages = Array.from(el.querySelectorAll<HTMLElement>('.pdf-page'));
    const mid = el.scrollTop + el.clientHeight / 3;
    const idx = pages.findIndex((p) => p.offsetTop + p.offsetHeight > mid);
    setCurrent(idx < 0 ? pages.length : idx + 1);
  };

  if (error) return <div className="paper-error">{tr('PDF를 열 수 없습니다: ', 'Cannot open PDF: ')}{error}</div>;

  const inner = Math.max(0, width - 16);
  return (
    <div className="paper-scroll" ref={scrollRef} onScroll={onScroll}>
      {!doc && <div className="paper-loading">{tr('PDF 여는 중…', 'Opening PDF…')}</div>}
      {doc &&
        inner > 0 &&
        sizes.map((s, i) => (
          <PdfPage key={i} doc={doc} index={i + 1} width={inner} height={(inner * s.h) / s.w} zoom={zoom} root={scrollRef} />
        ))}
      {doc && sizes.length > 0 && (
        <div className="paper-pageno">
          {current} / {sizes.length}
        </div>
      )}
    </div>
  );
}

function PdfPage({
  doc,
  index,
  width,
  height,
  zoom,
  root,
}: {
  doc: PDFDocumentProxy;
  index: number;
  width: number;
  height: number;
  zoom: number;
  root: RefObject<HTMLDivElement | null>;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => setVisible(entries.some((e) => e.isIntersecting)), {
      root: root.current,
      rootMargin: '600px 0px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, [root]);

  /* Render sharp for the current card width, screen density and board zoom. */
  const density = Math.min(3, (window.devicePixelRatio || 1) * Math.max(1, zoom));
  const bucket = Math.round(width * density / 64) * 64;

  useEffect(() => {
    if (!visible || !bucket) return;
    let cancelled = false;
    let task: { cancel(): void; promise: Promise<unknown> } | null = null;
    (async () => {
      const page = await doc.getPage(index);
      if (cancelled) return;
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: bucket / base.width });
      const off = document.createElement('canvas');
      off.width = Math.floor(viewport.width);
      off.height = Math.floor(viewport.height);
      task = page.render({ canvas: off, viewport });
      try {
        await task.promise;
      } catch {
        return;
      }
      const canvas = canvasRef.current;
      if (cancelled || !canvas) return;
      canvas.width = off.width;
      canvas.height = off.height;
      canvas.getContext('2d')?.drawImage(off, 0, 0);
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [visible, bucket, doc, index]);

  return (
    <div className="pdf-page" ref={holder} style={{ width, height }} data-page={index}>
      <canvas ref={canvasRef} style={{ width, height }} />
    </div>
  );
}
