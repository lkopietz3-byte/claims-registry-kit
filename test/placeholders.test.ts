import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLACEHOLDER_REFS,
  checkEvidenceLinked,
  checkStaleness,
  evaluateClaim,
  generateClaimsReport,
} from '../src/index.js';
import { NOW, claim, looseClaim } from './helpers.js';

// Placeholder evidence refs are on by default and configurable. These tests
// pin the option's contract; test/verdict-table.test.ts pins the default verdicts.

function statusOf(evidenceRef: unknown, options?: Parameters<typeof evaluateClaim>[3]): string {
  return evaluateClaim(looseClaim({ evidenceRef }), 90, NOW, options).status;
}

describe('DEFAULT_PLACEHOLDER_REFS', () => {
  it('lists the six default placeholders', () => {
    expect([...DEFAULT_PLACEHOLDER_REFS]).toEqual(['TODO', 'TBD', 'N/A', 'none', '-', 'see above']);
  });

  it('is frozen, so a caller cannot change the defaults for everyone', () => {
    expect(Object.isFrozen(DEFAULT_PLACEHOLDER_REFS)).toBe(true);
    expect(() => {
      (DEFAULT_PLACEHOLDER_REFS as string[]).push('wip');
    }).toThrow(TypeError);
    expect(statusOf('wip')).toBe('current');
  });
});

describe('options.placeholderRefs', () => {
  it('uses the defaults when options or the field are omitted or undefined', () => {
    expect(statusOf('TODO')).toBe('unverified');
    expect(statusOf('TODO', {})).toBe('unverified');
    expect(statusOf('TODO', { placeholderRefs: undefined })).toBe('unverified');
  });

  it('false switches placeholder matching off: only a blank reference is missing', () => {
    expect(statusOf('TODO', { placeholderRefs: false })).toBe('current');
    expect(statusOf('-', { placeholderRefs: false })).toBe('current');
    expect(statusOf('  ', { placeholderRefs: false })).toBe('unverified');
    expect(statusOf('', { placeholderRefs: false })).toBe('unverified');
  });

  it('an empty list switches matching off too', () => {
    expect(statusOf('N/A', { placeholderRefs: [] })).toBe('current');
    expect(statusOf('', { placeholderRefs: [] })).toBe('unverified');
  });

  it('a list replaces the defaults', () => {
    const options = { placeholderRefs: ['wip', 'coming soon'] };
    expect(statusOf('wip', options)).toBe('unverified');
    expect(statusOf('Coming   Soon', options)).toBe('unverified');
    expect(statusOf('TODO', options)).toBe('current');
  });

  it('spreading the defaults extends them', () => {
    const options = { placeholderRefs: [...DEFAULT_PLACEHOLDER_REFS, 'wip'] };
    expect(statusOf('wip', options)).toBe('unverified');
    expect(statusOf('TBD', options)).toBe('unverified');
    expect(statusOf('docs/wip.md', options)).toBe('current');
  });

  it('matches configured entries the same way: exact, case-insensitive, trimmed', () => {
    const options = { placeholderRefs: ['  Not Written Yet  '] };
    expect(statusOf('not written yet', options)).toBe('unverified');
    expect(statusOf('NOT WRITTEN YET.', options)).toBe('current');
    expect(statusOf('not written yet, see docs/a.md', options)).toBe('current');
  });

  it('ignores blank configured entries instead of treating a blank as a placeholder', () => {
    const options = { placeholderRefs: ['', '   ', '​'] };
    expect(statusOf('TODO', options)).toBe('current');
  });

  it('reaches every entry point', () => {
    const todo = claim({ id: 'todo', evidenceRef: 'TODO' });
    const off = { placeholderRefs: false } as const;
    expect(checkEvidenceLinked([todo], NOW)).toHaveLength(1);
    expect(checkEvidenceLinked([todo], NOW, off)).toHaveLength(0);
    expect(checkEvidenceLinked([todo], undefined, off)).toHaveLength(0);
    expect(checkStaleness([todo], 90, NOW, off)).toHaveLength(0);
    expect(generateClaimsReport([todo], 90, NOW).counts.unverified).toBe(1);
    expect(generateClaimsReport([todo], 90, NOW, off).counts.current).toBe(1);
  });

  it('applies to list entries and nested lists', () => {
    expect(statusOf(['TODO', ['n/a']])).toBe('unverified');
    expect(statusOf(['TODO', ['n/a']], { placeholderRefs: false })).toBe('current');
  });

  it('reads the options once: a getter cannot answer differently the second time', () => {
    let reads = 0;
    const options = {
      get placeholderRefs() {
        reads += 1;
        return reads === 1 ? ['TODO'] : false;
      },
    };
    expect(statusOf('TODO', options)).toBe('unverified');
    expect(reads).toBe(1);
  });

  it('does not change a claim or the options it was given', () => {
    const refs = ['TODO'];
    const c = claim({ evidenceRef: 'TODO' });
    const result = evaluateClaim(c, 90, NOW, { placeholderRefs: refs });
    expect(result.evidenceRef).toBe('TODO');
    expect(c.evidenceRef).toBe('TODO');
    expect(refs).toEqual(['TODO']);
  });
});

describe('invalid options throw instead of silently changing a verdict', () => {
  it.each([
    ['a string', 'TODO'],
    ['a number', 1],
    ['null', null],
    ['an array', ['TODO']],
    ['a Map', new Map()],
  ])('options that are %s', (_label, options) => {
    expect(() => evaluateClaim(claim(), 90, NOW, options as never)).toThrow(TypeError);
    expect(() => evaluateClaim(claim(), 90, NOW, options as never)).toThrow(/options must be an object/);
  });

  it.each([
    ['a string', 'TODO'],
    ['true', true],
    ['null', null],
    ['a number', 7],
    ['an object', {}],
  ])('placeholderRefs that is %s', (_label, placeholderRefs) => {
    expect(() => evaluateClaim(claim(), 90, NOW, { placeholderRefs } as never)).toThrow(TypeError);
    expect(() => evaluateClaim(claim(), 90, NOW, { placeholderRefs } as never)).toThrow(
      /options\.placeholderRefs must be an array of strings or false/,
    );
  });

  it('a non-string entry names its position', () => {
    expect(() => evaluateClaim(claim(), 90, NOW, { placeholderRefs: ['TODO', 5] } as never)).toThrow(
      /options\.placeholderRefs\[1\] must be a string \(received number\)/,
    );
  });

  it('checks the options on every entry point', () => {
    const bad = { placeholderRefs: 'TODO' } as never;
    expect(() => checkStaleness([claim()], 90, NOW, bad)).toThrow(TypeError);
    expect(() => checkEvidenceLinked([claim()], NOW, bad)).toThrow(TypeError);
    expect(() => generateClaimsReport([claim()], 90, NOW, bad)).toThrow(TypeError);
  });
});
