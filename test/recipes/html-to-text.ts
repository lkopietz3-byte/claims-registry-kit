// Visible text from an HTML string, for checkAppearsIn. One pass, no regex
// over the whole document, so the time is linear in the size of the page.
const VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr',
]);
const RAW = new Set(['script', 'style']); // text up to the closing tag, never shown
const INERT = new Set(['template', 'noscript', 'head']); // contents are not shown

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’',
  ldquo: '“', rdquo: '”', hellip: '…',
  copy: '©', reg: '®', trade: '™',
};

function decodeEntities(text: string): string {
  return text.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z][A-Za-z0-9]{1,31}));/g, (all, dec, hex, name) => {
    if (dec !== undefined || hex !== undefined) {
      const code = dec !== undefined ? Number(dec) : parseInt(hex as string, 16);
      const bad = code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff);
      return bad ? '�' : String.fromCodePoint(code);
    }
    return NAMED[name as string] ?? all; // an unknown name stays as written
  });
}

const isSpace = (c: string) => c === ' ' || c === '\n' || c === '\t' || c === '\r' || c === '\f';
const isLetter = (c: string) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');

export function htmlToText(html: string): string {
  const out: string[] = [];
  const open: string[] = []; // names of the elements that are open
  const openCount = new Map<string, number>();
  let hiddenAt = -1; // stack depth of the hidden element we are inside, or -1
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    const textEnd = lt === -1 ? html.length : lt;
    if (textEnd > i && hiddenAt < 0) out.push(decodeEntities(html.slice(i, textEnd)));
    if (lt === -1) break;
    i = lt;
    if (html.startsWith('<!--', i)) {
      const end = html.indexOf('-->', i + 4);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    const closing = html[i + 1] === '/';
    const first = html[i + (closing ? 2 : 1)] ?? '';
    if (!isLetter(first)) {
      if (first === '!' || first === '?') { // doctype, CDATA, processing instruction
        const end = html.indexOf('>', i);
        i = end === -1 ? html.length : end + 1;
      } else { // a bare "<" such as "a < b" is just text
        if (hiddenAt < 0) out.push('<');
        i += 1;
      }
      continue;
    }
    // A tag: read its name, then its attributes (only three matter here).
    let j = i + (closing ? 2 : 1);
    const nameStart = j;
    while (j < html.length && !isSpace(html[j]) && html[j] !== '/' && html[j] !== '>') j += 1;
    const name = html.slice(nameStart, j).toLowerCase();
    let hidden = INERT.has(name);
    let selfClosing = false;
    while (j < html.length && html[j] !== '>') {
      if (isSpace(html[j]) || html[j] === '/') {
        selfClosing = html[j] === '/';
        j += 1;
        continue;
      }
      selfClosing = false;
      const attrStart = j;
      while (j < html.length && !isSpace(html[j]) && html[j] !== '=' && html[j] !== '>' && html[j] !== '/') j += 1;
      const attr = html.slice(attrStart, j).toLowerCase();
      let value = '';
      while (j < html.length && isSpace(html[j])) j += 1;
      if (html[j] === '=') {
        j += 1;
        while (j < html.length && isSpace(html[j])) j += 1;
        const quote = html[j];
        if (quote === '"' || quote === "'") {
          const end = html.indexOf(quote, j + 1);
          if (end === -1) { j = html.length; break; } // never closed: the rest is not a page
          value = html.slice(j + 1, end);
          j = end + 1;
        } else {
          const valueStart = j;
          while (j < html.length && !isSpace(html[j]) && html[j] !== '>') j += 1;
          value = html.slice(valueStart, j);
        }
      }
      if (attr === 'hidden') hidden = true;
      else if (attr === 'aria-hidden' && value.trim().toLowerCase() === 'true') hidden = true;
      else if (attr === 'style' && /display\s*:\s*none|visibility\s*:\s*hidden/i.test(value)) hidden = true;
    }
    i = j + 1; // past the ">" (or past the end of an unterminated tag)
    if (hiddenAt < 0) out.push(' '); // every tag is a break between words
    if (closing) {
      if ((openCount.get(name) ?? 0) > 0) {
        let top: string | undefined;
        while (top !== name) {
          top = open.pop();
          openCount.set(top as string, (openCount.get(top as string) ?? 1) - 1);
        }
        if (open.length <= hiddenAt) hiddenAt = -1;
      }
    } else if (RAW.has(name) && !selfClosing) {
      // Skip to the matching close tag. Each "</" is looked at once.
      let k = i;
      for (;;) {
        k = html.indexOf('</', k);
        if (k === -1 || html.slice(k + 2, k + 2 + name.length).toLowerCase() === name) break;
        k += 2;
      }
      const end = k === -1 ? -1 : html.indexOf('>', k);
      i = end === -1 ? html.length : end + 1;
    } else if (!VOID.has(name) && !selfClosing) {
      if (hidden && hiddenAt < 0) hiddenAt = open.length;
      open.push(name);
      openCount.set(name, (openCount.get(name) ?? 0) + 1);
    }
  }
  return out.join('');
}
