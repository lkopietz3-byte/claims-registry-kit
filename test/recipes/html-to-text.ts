// Visible text from an HTML string, for checkAppearsIn. One pass, no regex
// over the whole document, so the time is linear in the size of the page.
const VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr',
]);
const RAW = new Set(['script', 'style']); // text up to the closing tag, never shown
const INERT = new Set(['template', 'noscript', 'head']); // contents are not shown

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
  ndash: '\u2013', mdash: '\u2014', lsquo: '\u2018', rsquo: '\u2019',
  ldquo: '\u201c', rdquo: '\u201d', hellip: '\u2026',
  copy: '\u00a9', reg: '\u00ae', trade: '\u2122',
};

// A browser reads numeric references 128 to 159 as Windows-1252 (&#146; is a
// right single quote). The five unassigned codes stay as they are.
const C1 = '\u20ac\u0081\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u008d\u017d\u008f' +
  '\u0090\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u009d\u017e\u0178';

function decodeEntities(text: string): string {
  return text.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z][A-Za-z0-9]{1,31}));/g, (all, dec, hex, name) => {
    if (dec !== undefined || hex !== undefined) {
      const code = dec !== undefined ? Number(dec) : parseInt(hex as string, 16);
      const bad = code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff);
      if (bad) return '\ufffd';
      return code >= 0x80 && code <= 0x9f ? C1[code - 0x80] : String.fromCodePoint(code);
    }
    return Object.hasOwn(NAMED, name as string) ? NAMED[name as string] : all; // an unknown name stays as written
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
    while (j < html.length && html[j] !== '>') {
      if (isSpace(html[j]) || html[j] === '/') {
        j += 1;
        continue;
      }
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
      else if (attr === 'aria-hidden' && decodeEntities(value).trim().toLowerCase() === 'true') hidden = true;
      else if (attr === 'style' && /display\s*:\s*none|visibility\s*:\s*hidden/i.test(decodeEntities(value))) hidden = true;
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
    } else if (RAW.has(name)) {
      // Skip to the matching close tag. Each "</" is looked at once.
      let k = i;
      for (;;) {
        k = html.indexOf('</', k);
        if (k === -1) break;
        const after = html[k + 2 + name.length] ?? '>';
        if (html.slice(k + 2, k + 2 + name.length).toLowerCase() === name && (isSpace(after) || after === '/' || after === '>')) break;
        k += 2;
      }
      const end = k === -1 ? -1 : html.indexOf('>', k);
      i = end === -1 ? html.length : end + 1;
    } else if (!VOID.has(name)) {
      if (hidden && hiddenAt < 0) hiddenAt = open.length;
      open.push(name);
      openCount.set(name, (openCount.get(name) ?? 0) + 1);
    }
  }
  return out.join('');
}
