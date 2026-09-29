import { describe, expect, it } from 'vitest';
import {
  checkEvidenceLinked,
  evaluateClaim,
  generateClaimsReport,
  type Claim,
} from '../src/index.js';
import { NOW, claim, looseClaim } from './helpers.js';

// "Evidence present" is a structural check on the reference, never a check on
// what it points at. These tests pin exactly which values count as present.

function statusOf(evidenceRef: unknown): string {
  return evaluateClaim(looseClaim({ evidenceRef }), 90, NOW).status;
}

function nestedArray(depth: number, leaf: unknown): unknown {
  let value: unknown = [leaf];
  for (let i = 1; i < depth; i += 1) value = [value];
  return value;
}

describe('evidenceRef counts as present', () => {
  it.each([
    ['a path', 'src/sync/broadcast.ts'],
    ['a path with surrounding whitespace', '  src/a.ts  '],
    ['a single character', 'x'],
    ['placeholder text (the library cannot tell it is a placeholder)', 'TODO'],
    ['a string that admits it points nowhere', 'n/a'],
    ['non-Latin text', 'ドキュメント/仕様.md'],
    ['an emoji', '📄'],
    ['a zero-width space next to visible text', '\u200bx'],
    ['a joiner inside an emoji sequence', '👨\u200d👩'],
    ['a list with one real entry', ['docs/a.md']],
    ['a list with blanks and one real entry', ['', '  ', 'docs/a.md']],
    ['a nested list with one real entry', [[], [['docs/a.md']]]],
    ['the number zero (a valid id)', 0],
    ['false', false],
    ['NaN', Number.NaN],
    ['an empty object (its shape is unknown to the library)', {}],
    ['an object with an empty ref field', { kind: 'test', ref: '' }],
    ['an empty Map', new Map()],
    ['a function', () => 'evidence'],
    ['a symbol', Symbol('evidence')],
  ])('%s', (_label, evidenceRef) => {
    expect(statusOf(evidenceRef)).toBe('current');
  });
});

describe('evidenceRef counts as missing (status unverified)', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['an empty string', ''],
    ['spaces', '   '],
    ['tabs and newlines', '\t\n\r '],
    ['a non-breaking space', '\u00a0'],
    ['a zero-width space', '\u200b'],
    ['several zero-width characters', '\u200b\u200c\u200d\u2060'],
    ['a soft hyphen', '\u00ad'],
    ['a byte-order mark', '\ufeff'],
    ['a bidi override', '\u202e'],
    ['a NUL control character', '\u0000'],
    ['a line separator', '\u2028'],
    ['an empty array', []],
    ['an array of empty strings', ['']],
    ['an array of blank and invisible strings', ['  ', '\u200b', '\t']],
    ['an array of null and undefined', [null, undefined]],
    ['nested empty arrays', [[], [[]]]],
    ['nested blank strings', [[''], ['  ']]],
    ['a sparse array of holes', new Array<string>(3)],
  ])('%s', (_label, evidenceRef) => {
    expect(statusOf(evidenceRef)).toBe('unverified');
  });

  it('agrees across evaluateClaim, checkEvidenceLinked and generateClaimsReport', () => {
    const blankList: Claim<string[]> = { ...claim(), evidenceRef: ['', ' '] };
    expect(evaluateClaim(blankList, 90, NOW).status).toBe('unverified');
    expect(checkEvidenceLinked([blankList], NOW)).toHaveLength(1);
    expect(generateClaimsReport([blankList], 90, NOW).counts.unverified).toBe(1);
  });
});

describe('evidenceRef with unusual structure cannot hang or crash the check', () => {
  it('a self-containing list with no real entry is missing', () => {
    const cyclic: unknown[] = [];
    cyclic.push(cyclic, '');
    expect(statusOf(cyclic)).toBe('unverified');
  });

  it('a self-containing list with a real entry is present', () => {
    const cyclic: unknown[] = ['docs/a.md'];
    cyclic.push(cyclic);
    expect(statusOf(cyclic)).toBe('current');
  });

  it('two lists that contain each other and nothing else are missing', () => {
    const a: unknown[] = [];
    const b: unknown[] = [a];
    a.push(b);
    expect(statusOf(a)).toBe('unverified');
  });

  it('a very deep nesting does not overflow the stack', () => {
    expect(statusOf(nestedArray(200_000, 'docs/a.md'))).toBe('current');
    expect(statusOf(nestedArray(200_000, ''))).toBe('unverified');
  });

  it('a very wide list is checked in reasonable time', () => {
    const wide: string[] = new Array<string>(1_000_000).fill('');
    const started = Date.now();
    expect(statusOf(wide)).toBe('unverified');
    wide[wide.length - 1] = 'docs/a.md';
    expect(statusOf(wide)).toBe('current');
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('a shared sub-list reached twice is fine', () => {
    const shared = ['docs/a.md'];
    expect(statusOf([shared, shared])).toBe('current');
    const blank = [''];
    expect(statusOf([blank, blank])).toBe('unverified');
  });
});

describe('custom evidenceRef types', () => {
  interface Ref {
    kind: 'test' | 'url' | 'file';
    ref: string;
  }

  it('a caller-defined object type is treated as present without inspecting its fields', () => {
    const typed: Claim<Ref> = { ...claim(), evidenceRef: { kind: 'test', ref: 'suite > case' } };
    const result = evaluateClaim(typed, 90, NOW);
    expect(result.status).toBe('current');
    expect(result.evidenceRef).toEqual({ kind: 'test', ref: 'suite > case' });
  });

  it('a list-of-strings type gets the list rules', () => {
    const empty: Claim<string[]> = { ...claim(), evidenceRef: [] };
    const filled: Claim<string[]> = { ...claim(), evidenceRef: ['a', 'b'] };
    expect(evaluateClaim(empty, 90, NOW).status).toBe('unverified');
    expect(evaluateClaim(filled, 90, NOW).status).toBe('current');
  });
});

// CRK-F01 (external audit P22A-P22E, P23): a reference made only of bidi
// controls used to read as "present", so an otherwise valid claim came back
// 'current'. Blank now means whitespace, Default_Ignorable_Code_Point and
// control characters only.
describe('a reference that shows nothing is missing, whatever invisible characters it uses', () => {
  const NOW_ISO = new Date('2026-09-28T12:00:00.000Z');
  const fresh = (evidenceRef: unknown): Claim =>
    looseClaim({ evidenceRef, verifiedAt: '2026-09-28T11:00:00Z' });

  it.each([
    ['U+2066 left-to-right isolate', '\u2066'],
    ['U+2067 right-to-left isolate', '\u2067'],
    ['U+2068 first strong isolate', '\u2068'],
    ['U+2069 pop directional isolate', '\u2069'],
    ['U+061C Arabic letter mark', '\u061c'],
    ['a wrapped pair of isolates with nothing inside', '\u2066\u2069'],
    ['U+200E and U+200F direction marks', '\u200e\u200f'],
    ['U+3164 Hangul filler', '\u3164'],
    ['U+FE0F variation selector on its own', '\ufe0f'],
    ['U+180E Mongolian vowel separator', '\u180e'],
    ['U+034F combining grapheme joiner on its own', '\u034f'],
    ['a C1 control character', '\u0080'],
    ['a mix of whitespace, controls and invisibles', ' \u2066\t\u061c\u0000\u200b\u3164 '],
  ])('%s is unverified even with a fresh date (evaluateClaim)', (_label, ref) => {
    const result = evaluateClaim(fresh(ref), 90, NOW_ISO);
    expect(result.status).toBe('unverified');
    expect(result.evidenceRef).toBe(ref); // the stored reference is never altered
  });

  it.each([
    ['U+2066', '\u2066'],
    ['U+2067', '\u2067'],
    ['U+2068', '\u2068'],
    ['U+2069', '\u2069'],
    ['U+061C', '\u061c'],
  ])('%s alone is caught by every entry point (P22A-P22E, P23)', (_label, ref) => {
    const c = fresh(ref);
    expect(checkEvidenceLinked([c], NOW_ISO).map((x) => x.id)).toEqual(['c1']);
    const report = generateClaimsReport([c], 90, NOW_ISO);
    expect(report.counts).toEqual({ current: 0, stale: 0, unverified: 1, total: 1 });
    expect(report.unverified[0]?.evidenceRef).toBe(ref);
  });

  it('finds nothing to keep in a nested list of only isolates', () => {
    expect(statusOf([['\u2066', '\u2069'], ['\u061c']])).toBe('unverified');
    expect(statusOf(['\u2067', ['\u2068', ['\u2069']]])).toBe('unverified');
  });

  it('missing evidence still wins over an invalid, stale or future date', () => {
    for (const verifiedAt of ['not-a-date', '2020-01-01', '2099-01-01', '2026-09-28T13:00:00Z']) {
      const c = looseClaim({ evidenceRef: '\u2066\u2069', verifiedAt });
      expect(evaluateClaim(c, 90, NOW_ISO).status).toBe('unverified');
    }
  });

  it.each([
    ['visible Arabic', 'مستند/مواصفات.md'],
    ['visible Arabic with a leading Arabic letter mark', '\u061cمستند'],
    ['Japanese', 'ドキュメント/仕様.md'],
    ['an emoji', '📄'],
    ['an emoji with a variation selector', '❤\ufe0f'],
    ['a family emoji (zero-width joiners inside)', '👨\u200d👩\u200d👧'],
    ['visible text wrapped in isolates', '\u2066docs/a.md\u2069'],
    ['visible Arabic wrapped in isolates and marks', '\u2067\u200fمستند\u200f\u2069'],
    ['visible text after a right-to-left override', '\u202esrc/a.ts'],
    ['a Braille blank (it draws a cell, so it is present)', '\u2800'],
    ['a lone surrogate (not invisible, not a real character)', '\ud800'],
  ])('%s stays present', (_label, ref) => {
    expect(evaluateClaim(fresh(ref), 90, NOW_ISO).status).toBe('current');
  });

  it('a nested list keeps a visible entry beside isolates', () => {
    expect(statusOf([['\u2066\u2069'], ['\u2067docs/a.md\u2069']])).toBe('current');
  });

  it('a non-string entry nested in a list counts as present', () => {
    expect(statusOf([[42]])).toBe('current');
    expect(statusOf([['\u2066'], [{}]])).toBe('current');
  });

  it('a very long invisible-only string is checked in linear time', () => {
    const started = Date.now();
    expect(statusOf('\u200b'.repeat(2_000_000))).toBe('unverified');
    expect(statusOf('\u200b'.repeat(2_000_000) + 'x')).toBe('current');
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
