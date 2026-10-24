const ALLOWED = new Set([
  'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL', 'H1', 'H2', 'H3', 'UL', 'OL', 'LI',
  'BR', 'DIV', 'P', 'SPAN', 'A', 'BLOCKQUOTE', 'CODE', 'PRE', 'HR',
]);
/** Toggle lists are <div>s with these classes; nothing else keeps a class. */
const TOGGLE_PARTS = ['toggle', 'toggle-head', 'toggle-body'];
/** Inline tags that may keep a text colour or highlight (browsers put them on <b>, <i>, … too). */
const STYLED = new Set(['SPAN', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL', 'CODE', 'A']);
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE', 'SVG', 'MATH', 'LINK', 'META']);

/** Keeps simple formatting tags and safe links; removes every other tag and attribute. */
export function sanitize(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      if (DROP.has(child.tagName.toUpperCase())) {
        child.remove();
        continue;
      }
      walk(child);
      if (!ALLOWED.has(child.tagName)) {
        child.replaceWith(...Array.from(child.childNodes));
        continue;
      }
      if (child.tagName === 'SPAN' && child.classList.contains('math') && child.hasAttribute('data-tex')) {
        // A formula keeps only its LaTeX; it is drawn when shown.
        const tex = child.getAttribute('data-tex') ?? '';
        const display = child.getAttribute('data-display') === 'true';
        for (const attr of Array.from(child.attributes)) child.removeAttribute(attr.name);
        child.className = display ? 'math display' : 'math';
        child.setAttribute('data-tex', tex);
        if (display) child.setAttribute('data-display', 'true');
        child.textContent = tex;
        continue;
      }
      if (child.tagName === 'DIV' && child.classList.contains('embed')) {
        // An embed: its block's id and its address (![[name|70]]); what it shows is drawn anew.
        const ref = child.getAttribute('data-ref') ?? '';
        const addr = child.querySelector('.embed-addr')?.textContent ?? child.textContent ?? '';
        for (const attr of Array.from(child.attributes)) child.removeAttribute(attr.name);
        child.className = 'embed';
        if (/^[\w-]{1,64}$/.test(ref)) child.setAttribute('data-ref', ref);
        child.innerHTML = '';
        const span = child.ownerDocument.createElement('span');
        span.className = 'embed-addr';
        span.textContent = addr.trim();
        child.appendChild(span);
        continue;
      }
      if (child.tagName === 'A' && child.classList.contains('block-link')) {
        // A link to a block: only the block's id is kept (it is followed inside the app).
        const ref = child.getAttribute('data-ref') ?? '';
        const name = child.getAttribute('data-new');
        const size = child.getAttribute('data-size') ?? '';
        for (const attr of Array.from(child.attributes)) child.removeAttribute(attr.name);
        child.className = 'block-link';
        if (/^[\w-]{1,64}$/.test(ref)) child.setAttribute('data-ref', ref);
        if (/^\d{1,3}$/.test(size)) child.setAttribute('data-size', size);
        else if (name !== null) {
          // Not pointing at a block yet: its name, for the note it makes when pressed.
          child.className = 'block-link unresolved';
          child.setAttribute('data-new', name.slice(0, 100));
        }
        child.setAttribute('contenteditable', 'false');
        child.textContent = child.textContent ?? '';
        continue;
      }
      const style = STYLED.has(child.tagName) ? safeStyle(child.getAttribute('style') ?? '') : '';
      // What the typing shortcuts build: to-do lists and their ticks, toggle lists and their state.
      const checklist = child.tagName === 'UL' && child.classList.contains('checklist');
      const checked = child.tagName === 'LI' ? child.getAttribute('data-checked') : null;
      const part = child.tagName === 'DIV' ? TOGGLE_PARTS.find((c) => child.classList.contains(c)) : undefined;
      const open = part === 'toggle' ? child.getAttribute('data-open') : null;
      const level = part === 'toggle' ? child.getAttribute('data-level') : null;
      // A numbered list split in two goes on counting.
      const start = child.tagName === 'OL' ? child.getAttribute('start') : null;
      // A line indented with Tab.
      const indent = /^(DIV|P|H1|H2|H3|BLOCKQUOTE|PRE)$/.test(child.tagName) ? child.getAttribute('data-indent') : null;
      for (const attr of Array.from(child.attributes)) {
        if (!(child.tagName === 'A' && attr.name === 'href')) child.removeAttribute(attr.name);
      }
      if (style) child.setAttribute('style', style);
      if (checklist) child.className = 'checklist';
      if (checked === 'true' || checked === 'false') child.setAttribute('data-checked', checked);
      if (part) child.className = part;
      if (open === 'true' || open === 'false') child.setAttribute('data-open', open);
      if (level && /^[123]$/.test(level)) child.setAttribute('data-level', level);
      if (start && /^\d{1,4}$/.test(start) && start !== '1') child.setAttribute('start', start);
      if (indent && /^[1-8]$/.test(indent)) child.setAttribute('data-indent', indent);
      if (child.tagName === 'A') {
        const href = child.getAttribute('href') ?? '';
        if (!/^(https?:|mailto:)/i.test(href)) child.removeAttribute('href');
        child.setAttribute('target', '_blank');
        child.setAttribute('rel', 'noopener noreferrer');
      }
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

/** Only text colour and highlight survive, and only as plain colour values. */
function safeStyle(css: string): string {
  const keep: string[] = [];
  for (const part of css.split(';')) {
    const [prop, ...rest] = part.split(':');
    const name = prop?.trim().toLowerCase();
    const value = rest.join(':').trim();
    if ((name === 'color' || name === 'background-color') && /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|transparent)$/i.test(value)) {
      keep.push(`${name}: ${value}`);
    }
  }
  return keep.join('; ');
}

export function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

export const textToHtml = (text: string) =>
  text
    .split(/\r?\n/)
    .map((l) => `<div>${l ? escapeHtml(l) : '<br>'}</div>`)
    .join('');
