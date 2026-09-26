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
