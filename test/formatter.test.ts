import { describe, expect, it } from 'vitest';
import {
  formatClaimsReportAsText,
  generateClaimsReport,
  type Claim,
  type ClaimsReport,
} from '../src/index.js';
import { NOW, claim, deepFreeze, looseClaim } from './helpers.js';

// CRK-F02 (external audit P24-P25): formatClaimsReportAsText printed claim ids
// and text raw, so a newline could forge a report heading and an ESC byte
// reached the terminal. The text output now escapes controls, line breaks and
// bidi formatting characters as visible \uXXXX; the structured report stays
// raw.

const FORGED_HEADING = 'Claims report — generated FORGED (maxAgeDays: 1)';

/** A report with one unverified claim (empty evidenceRef) carrying the given fields. */
function unverifiedReport(fields: Partial<Claim>): ClaimsReport {
  return generateClaimsReport([claim({ evidenceRef: '', ...fields })], 90, NOW);
}

/** A report with one stale claim carrying the given fields. */
function staleReport(fields: Partial<Claim>): ClaimsReport {
  return generateClaimsReport([claim({ verifiedAt: '2025-01-01', ...fields })], 90, NOW);
}

// Only these line shapes may appear in the output: the heading, the counts
// line, blank separators, section titles, and indented claim lines.
function lineShapes(text: string): string[] {
  return text.split('\n').map((line) => {
    if (line.startsWith('Claims report — generated ')) return 'heading';
    if (line.startsWith('  current: ')) return 'counts';
    if (line === '') return 'blank';
    if (line.startsWith('Stale claims (')) return 'stale-title';
    if (line.startsWith('Unverified claims (')) return 'unverified-title';
    if (line.startsWith('  [')) return 'claim';
    return `OTHER: ${line}`;
  });
}

describe('a newline in a claim cannot forge report structure (P25)', () => {
  it.each([
    ['LF', '\n'],
    ['CR', '\r'],
    ['CRLF', '\r\n'],
    ['line separator U+2028', '\u2028'],
    ['paragraph separator U+2029', '\u2029'],
    ['next line U+0085', '\u0085'],
    ['vertical tab', '\u000b'],
    ['form feed', '\u000c'],
  ])('%s in the text stays on one claim line', (_label, brk) => {
    const out = formatClaimsReportAsText(unverifiedReport({ text: `real${brk}${FORGED_HEADING}` }));
    expect(lineShapes(out)).toEqual(['heading', 'counts', 'blank', 'unverified-title', 'claim']);
    expect(out.split('\n').filter((line) => line.startsWith('Claims report'))).toHaveLength(1);
    // The report itself is joined with LF, so only the other breaks can be checked for absence.
    if (brk !== '\n') expect(out).not.toContain(brk);
  });

  it('the exact text the audit used: a forged heading after a newline', () => {
    const out = formatClaimsReportAsText(
      unverifiedReport({ text: 'x\nClaims report — generated FORGED' }),
    );
    expect(out).toBe(
      [
        'Claims report — generated 2026-08-02T00:00:00.000Z (maxAgeDays: 90)',
        '  current: 0  stale: 0  unverified: 1  total: 1',
        '',
        'Unverified claims (no evidenceRef):',
        '  [c1] "x\\u000aClaims report — generated FORGED"',
      ].join('\n'),
    );
  });

  it('a newline in the id cannot forge a heading either', () => {
    const id = `real\n${FORGED_HEADING}`;
    const unverified = formatClaimsReportAsText(unverifiedReport({ id }));
    const stale = formatClaimsReportAsText(staleReport({ id }));
    for (const out of [unverified, stale]) {
      expect(out.split('\n').filter((line) => line.startsWith('Claims report'))).toHaveLength(1);
      expect(lineShapes(out).filter((shape) => shape.startsWith('OTHER'))).toEqual([]);
      expect(out).toContain('[real\\u000aClaims report');
    }
  });

  it('a newline in a stale claim cannot start a new section either', () => {
    const out = formatClaimsReportAsText(
      staleReport({ text: 'x\n\nUnverified claims (no evidenceRef):\n  [forged] "y"' }),
    );
    expect(lineShapes(out)).toEqual(['heading', 'counts', 'blank', 'stale-title', 'claim']);
  });
});

describe('control characters reach the output only as visible escapes (P24)', () => {
  it('escapes a terminal escape sequence in the text and in the id', () => {
    const esc = '\u001b';
    const seq = `${esc}[2J${esc}[Hcleared`;
    const out = formatClaimsReportAsText(unverifiedReport({ id: `id${seq}`, text: `t${seq}` }));
    expect(out).not.toContain(esc);
    expect(out).toContain('[id\\u001b[2J\\u001b[Hcleared]');
    expect(out).toContain('"t\\u001b[2J\\u001b[Hcleared"');
    const staleOut = formatClaimsReportAsText(staleReport({ id: `id${seq}`, text: `t${seq}` }));
    expect(staleOut).not.toContain(esc);
    expect(staleOut).toContain('[id\\u001b[2J\\u001b[Hcleared] "t\\u001b[2J\\u001b[Hcleared" — ');
  });

  it.each([
    ['NUL', '\u0000', '\\u0000'],
    ['BEL', '\u0007', '\\u0007'],
    ['backspace', '\u0008', '\\u0008'],
    ['tab', '\t', '\\u0009'],
    ['CR', '\r', '\\u000d'],
    ['LF', '\n', '\\u000a'],
    ['ESC', '\u001b', '\\u001b'],
    ['unit separator', '\u001f', '\\u001f'],
    ['DEL', '\u007f', '\\u007f'],
    ['C1 control U+0080', '\u0080', '\\u0080'],
    ['C1 control CSI U+009B', '\u009b', '\\u009b'],
    ['C1 control U+009F', '\u009f', '\\u009f'],
    ['line separator', '\u2028', '\\u2028'],
    ['paragraph separator', '\u2029', '\\u2029'],
    ['Arabic letter mark', '\u061c', '\\u061c'],
    ['left-to-right mark', '\u200e', '\\u200e'],
    ['right-to-left mark', '\u200f', '\\u200f'],
    ['left-to-right embedding', '\u202a', '\\u202a'],
    ['right-to-left embedding', '\u202b', '\\u202b'],
    ['pop directional formatting', '\u202c', '\\u202c'],
    ['left-to-right override', '\u202d', '\\u202d'],
    ['right-to-left override', '\u202e', '\\u202e'],
    ['left-to-right isolate', '\u2066', '\\u2066'],
    ['right-to-left isolate', '\u2067', '\\u2067'],
    ['first strong isolate', '\u2068', '\\u2068'],
    ['pop directional isolate', '\u2069', '\\u2069'],
  ])('%s becomes %s-style visible text in ids and claim text', (_label, ch, escaped) => {
    const out = formatClaimsReportAsText(unverifiedReport({ id: `a${ch}b`, text: `c${ch}d` }));
    if (ch !== '\n') expect(out).not.toContain(ch); // LF is the report's own line separator
    expect(out).toContain(`[a${escaped}b] "c${escaped}d"`);
  });

  it('a right-to-left override cannot reverse the label around it', () => {
    const out = formatClaimsReportAsText(
      unverifiedReport({ text: 'safe \u202e"tnemtseretni" gnihtemos' }),
    );
    expect(out).not.toContain('\u202e');
    expect(out).toContain('"safe \\u202e"tnemtseretni" gnihtemos"');
  });
});

describe('visible text is left exactly as it was', () => {
  it.each([
    ['Arabic', 'مزامنة فورية للتغييرات'],
    ['Japanese', 'チームの変更をリアルタイムで同期'],
    ['an emoji with a variation selector', 'Loved by teams ❤\ufe0f'],
    ['a family emoji with joiners', '👨\u200d👩\u200d👧 plans'],
    ['quotes and backslashes', 'the "best" C:\\temp path, ok'],
    ['an accented word', 'café'],
  ])('%s is not escaped or changed', (_label, text) => {
    const out = formatClaimsReportAsText(unverifiedReport({ text, id: text }));
    expect(out).toContain(`[${text}] "${text}"`);
  });

  it('keeps bidi-wrapped visible text and escapes only the wrapping controls', () => {
    const out = formatClaimsReportAsText(
      unverifiedReport({ text: '\u2067مستند\u2069 and \u2066docs/a.md\u2069' }),
    );
    expect(out).toContain('"\\u2067مستند\\u2069 and \\u2066docs/a.md\\u2069"');
  });

  it('never truncates a long Unicode string', () => {
    const long = 'あ🙂é'.repeat(20_000);
    const out = formatClaimsReportAsText(unverifiedReport({ text: long }));
    expect(out).toContain(`"${long}"`);
  });

  it('never truncates a long string full of escapes, and stays on one claim line', () => {
    const long = 'x\n'.repeat(5_000);
    const out = formatClaimsReportAsText(unverifiedReport({ text: long }));
    expect(out).toContain(`"${'x\\u000a'.repeat(5_000)}"`);
    expect(lineShapes(out)).toEqual(['heading', 'counts', 'blank', 'unverified-title', 'claim']);
  });
});

describe('what the escaping does not cover (documented in the README)', () => {
  it('a claim cannot add a line, but its own quotes and brackets can make one line imitate another field', () => {
    const out = formatClaimsReportAsText(
      staleReport({ id: 'a] [b', text: 'x" — 1d old\u0009tab' }),
    );
    const claimLines = out.split('\n').filter((line) => line.startsWith('  ['));
    // One claim, one line: the tab is escaped, so nothing starts a new line.
    expect(claimLines).toHaveLength(1);
    // The quote, the brackets and the em dash are printed as given, so the text
    // reads as if the claim's age were "1d old" before the real age suffix.
    expect(claimLines[0]).toMatch(/^ {2}\[a\] \[b\] "x" — 1d old\\u0009tab" — \d+d old$/);
  });
});

describe('the structured report is left raw', () => {
  it('escapes only the text: the report object, JSON and claims are unchanged', () => {
    const text = 'line one\nline two \u001b[31m';
    const id = 'id\u202e';
    const report = deepFreeze(generateClaimsReport([claim({ id, text, evidenceRef: '' })], 90, NOW));
    const before = JSON.stringify(report);
    const out = formatClaimsReportAsText(report);
    expect(JSON.stringify(report)).toBe(before);
    expect(report.unverified[0]?.text).toBe(text);
    expect(report.unverified[0]?.id).toBe(id);
    expect(report.counts).toEqual({ current: 0, stale: 0, unverified: 1, total: 1 });
    expect(out).not.toContain('\n  [c1]');
  });

  it('gives the same output for the same report every time', () => {
    const report = unverifiedReport({ text: 'a\nb' });
    expect(formatClaimsReportAsText(report)).toBe(formatClaimsReportAsText(report));
  });
});

describe('every report shape formats as documented', () => {
  it('an empty claim set prints the two header lines only', () => {
    expect(formatClaimsReportAsText(generateClaimsReport([], 30, NOW))).toBe(
      [
        'Claims report — generated 2026-08-02T00:00:00.000Z (maxAgeDays: 30)',
        '  current: 0  stale: 0  unverified: 0  total: 0',
      ].join('\n'),
    );
  });

  it('an all-current set prints no claim sections', () => {
    const report = generateClaimsReport([claim(), claim({ id: 'c2' })], 90, NOW);
    expect(formatClaimsReportAsText(report)).toBe(
      [
        'Claims report — generated 2026-08-02T00:00:00.000Z (maxAgeDays: 90)',
        '  current: 2  stale: 0  unverified: 0  total: 2',
      ].join('\n'),
    );
  });

  it('a mixed set names each stale reason distinctly and lists unverified claims', () => {
    const report = generateClaimsReport(
      [
        claim({ id: 'ok' }),
        claim({ id: 'old', text: 'Old claim', verifiedAt: '2025-11-01' }),
        claim({ id: 'bad-date', text: 'Bad date', verifiedAt: 'July 4' }),
        claim({ id: 'future', text: 'Future date', verifiedAt: '2099-01-01' }),
        claim({ id: 'none', text: 'No evidence', evidenceRef: '\u2066' }),
      ],
      90,
      NOW,
    );
    expect(formatClaimsReportAsText(report)).toBe(
      [
        'Claims report — generated 2026-08-02T00:00:00.000Z (maxAgeDays: 90)',
        '  current: 1  stale: 3  unverified: 1  total: 5',
        '',
        'Stale claims (evidence linked, but review is overdue):',
        '  [old] "Old claim" — 274d old',
        '  [bad-date] "Bad date" — unparseable verifiedAt',
        '  [future] "Future date" — verifiedAt is in the future',
        '',
        'Unverified claims (no evidenceRef):',
        '  [none] "No evidence"',
      ].join('\n'),
    );
  });
});

describe('a hand-built report cannot make the formatter throw or lie', () => {
  function handBuilt(claimFields: Record<string, unknown>): ClaimsReport {
    const evaluated = looseClaim({ status: 'unverified', ageDays: null, ...claimFields });
    return {
      generatedAt: NOW.toISOString(),
      maxAgeDays: 90,
      counts: { current: 0, stale: 0, unverified: 1, total: 1 },
      current: [],
      stale: [],
      unverified: [evaluated as unknown as ClaimsReport['unverified'][number]],
    };
  }

  it.each([
    ['undefined text', { text: undefined }, '"undefined"'],
    ['a number', { text: 42 }, '"42"'],
    ['a bigint', { text: 7n }, '"7n"'],
    ['a symbol', { text: Symbol('secret\nheading') }, '"a symbol"'],
    ['a function', { text: () => 'x' }, '"a function"'],
    ['null', { text: null }, '"null"'],
    ['an object', { text: { a: 1 } }, '"an object"'],
    [
      'an object whose toString throws and toJSON is hostile',
      {
        text: {
          toString() {
            throw new Error('boom');
          },
          toJSON() {
            throw new Error('boom');
          },
        },
      },
      '"an object"',
    ],
    ['a cyclic object', { text: (() => { const o: Record<string, unknown> = {}; o.self = o; return o; })() }, '"an object"'],
    ['an array', { text: ['a\nb'] }, '"an object"'],
  ])('text is %s', (_label, fields, expected) => {
    const out = formatClaimsReportAsText(handBuilt(fields));
    expect(out).toContain(`[c1] ${expected}`);
  });

  it('a generatedAt with a newline is escaped', () => {
    const report = { ...unverifiedReport({}), generatedAt: 'x\nClaims report — generated FORGED' };
    const out = formatClaimsReportAsText(report);
    expect(lineShapes(out)[0]).toBe('heading');
    expect(out.split('\n').filter((line) => line.startsWith('Claims report'))).toHaveLength(1);
    expect(out).toContain('generated x\\u000aClaims report');
  });

  it('reads each claim field once even when the report uses getters', () => {
    let reads = 0;
    const evaluated = {
      id: 'g',
      text: 't',
      evidenceRef: 'x',
      verifiedAt: '2025-01-01',
      status: 'stale',
      get ageDays(): number {
        reads += 1;
        return reads === 1 ? 5 : -1;
      },
    };
    const report = {
      ...unverifiedReport({}),
      stale: [evaluated as unknown as ClaimsReport['stale'][number]],
    };
    const out = formatClaimsReportAsText(report);
    expect(reads).toBe(1);
    expect(out).toContain('[g] "t" — 5d old');
  });
});

describe('the age wording at its boundaries', () => {
  it('a hand-built stale claim with age zero is "0d old", and a negative age is "in the future"', () => {
    const at = (ageDays: number): string =>
      formatClaimsReportAsText({
        ...unverifiedReport({}),
        unverified: [],
        stale: [{ ...claim(), status: 'stale', ageDays }],
      });
    expect(at(0)).toContain('[c1] "Changes sync across your team in real time" — 0d old');
    expect(at(1)).toContain('— 1d old');
    expect(at(-1)).toContain('— verifiedAt is in the future');
  });
});
