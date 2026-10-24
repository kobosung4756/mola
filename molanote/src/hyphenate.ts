import { hyphenateSync } from 'hyphen/en-us';

/** Text in these is left as it is (code, formulas, links, an embed's address, what is typed in). */
const SKIP = 'code, pre, .katex, .math, a, .embed-addr, input, textarea, [contenteditable=true]';
const LATIN_WORD = /[A-Za-z]{6,}/;

/**
 * Soft hyphens in the long English words of shown text: justified lines then break inside a word
 * (with a "-") instead of moving the whole word down and leaving wide gaps. Only what is shown
 * changes, never the saved text.
 */
export function hyphenateIn(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes: Text[] = [];
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) if (LATIN_WORD.test(n.data) && !n.data.includes('\u00AD')) nodes.push(n);
  for (const n of nodes) {
    const next = hyphenateSync(n.data, { minWordLength: 6 });
    if (next !== n.data) n.data = next;
  }
}

/** Copying shown text leaves the soft hyphens out. */
export const withoutSoftHyphens = (s: string) => s.replace(/\u00AD/g, '');
