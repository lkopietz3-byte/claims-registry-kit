import { describe, expect, it } from 'vitest';
import {
  checkEvidenceLinked,
  checkStaleness,
  evaluateClaim,
  generateClaimsReport,
  type Claim,
} from '../src/index.js';
import { NOW, claim, looseClaim } from './helpers.js';

// The dangerous failure for a gate like this is failing OPEN: a bad policy or
// a bad clock must never turn every claim into "current".

const asNumber = (value: unknown): number => value as number;
const asDate = (value: unknown): Date => value as Date;

describe('maxAgeDays validation', () => {
  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['-1', -1],
    ['-0.0001', -0.0001],
  ])('rejects %s with a RangeError instead of quietly passing every claim', (_label, bad) => {
    // 2026-01-01 is 213 days old at NOW: must never be reported "current" because of a bad policy.
    const old = claim({ verifiedAt: '2026-01-01' });
    expect(() => evaluateClaim(old, bad, NOW)).toThrow(RangeError);
    expect(() => checkStaleness([old], bad, NOW)).toThrow(RangeError);
    expect(() => generateClaimsReport([old], bad, NOW)).toThrow(RangeError);
    expect(() => evaluateClaim(old, bad, NOW)).toThrow(/maxAgeDays/);
  });

  it.each([
    ['a numeric string', '90'],
    ['null', null],
    ['undefined', undefined],
    ['an object', {}],
    ['a boolean', true],
  ])('rejects %s with a TypeError', (_label, bad) => {
    const c = claim();
    expect(() => evaluateClaim(c, asNumber(bad), NOW)).toThrow(TypeError);
    expect(() => checkStaleness([c], asNumber(bad), NOW)).toThrow(TypeError);
    expect(() => generateClaimsReport([c], asNumber(bad), NOW)).toThrow(TypeError);
  });

  it('accepts zero: only a claim verified within the current whole day is current', () => {
    expect(evaluateClaim(claim({ verifiedAt: '2026-08-02' }), 0, NOW).status).toBe('current');
    expect(evaluateClaim(claim({ verifiedAt: '2026-08-01' }), 0, NOW).status).toBe('stale');
  });

  it('accepts a fractional policy and compares it against whole-day ages', () => {
    expect(evaluateClaim(claim({ verifiedAt: '2026-08-02' }), 0.5, NOW).status).toBe('current');
    expect(evaluateClaim(claim({ verifiedAt: '2026-08-01' }), 0.5, NOW).status).toBe('stale');
  });

  it('accepts a very large finite policy', () => {
    expect(evaluateClaim(claim({ verifiedAt: '0001-01-01' }), 1e12, NOW).status).toBe('current');
  });
});

describe('now validation', () => {
  it('rejects an Invalid Date with a RangeError instead of reporting "current"', () => {
    const invalid = new Date(Number.NaN);
    const old = claim({ verifiedAt: '2026-01-01' });
    expect(() => evaluateClaim(old, 90, invalid)).toThrow(RangeError);
    expect(() => checkStaleness([old], 90, invalid)).toThrow(RangeError);
    expect(() => checkEvidenceLinked([claim({ evidenceRef: '' })], invalid)).toThrow(RangeError);
    expect(() => generateClaimsReport([old], 90, invalid)).toThrow(RangeError);
    expect(() => evaluateClaim(old, 90, invalid)).toThrow(/now/);
  });

  it.each([
    ['a millisecond timestamp', 1_780_000_000_000],
    ['an ISO string', '2026-08-02T00:00:00.000Z'],
    ['null', null],
    ['a plain object', { getTime: () => 0 }],
  ])('rejects %s with a TypeError', (_label, bad) => {
    const c = claim();
    expect(() => evaluateClaim(c, 90, asDate(bad))).toThrow(TypeError);
    expect(() => checkEvidenceLinked([c], asDate(bad))).toThrow(TypeError);
  });

  it('uses the real clock when now is omitted or undefined', () => {
    const fresh = claim({ verifiedAt: new Date().toISOString() });
    expect(evaluateClaim(fresh, 90).status).toBe('current');
    expect(evaluateClaim(fresh, 90, undefined).status).toBe('current');
    expect(generateClaimsReport([fresh], 90).counts.total).toBe(1);
  });
});

describe('claims input validation', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['an object', {}],
    ['a string', 'claims'],
  ])('rejects %s where an array is required, with a TypeError naming the argument', (_label, bad) => {
    const notArray = bad as unknown as Claim[];
    expect(() => checkStaleness(notArray, 90, NOW)).toThrow(TypeError);
    expect(() => checkStaleness(notArray, 90, NOW)).toThrow(/claims must be an array/);
    expect(() => checkEvidenceLinked(notArray, NOW)).toThrow(TypeError);
    expect(() => generateClaimsReport(notArray, 90, NOW)).toThrow(TypeError);
  });

  it('rejects a non-object entry and names its index', () => {
    const list = [claim(), null, claim({ id: 'c3' })] as unknown as Claim[];
    expect(() => checkStaleness(list, 90, NOW)).toThrow(/claims\[1\]/);
    expect(() => generateClaimsReport(list, 90, NOW)).toThrow(/claims\[1\]/);
    expect(() => checkEvidenceLinked(list, NOW)).toThrow(/claims\[1\]/);
  });

  it('rejects primitive entries and array holes', () => {
    expect(() => checkStaleness(['x'] as unknown as Claim[], 90, NOW)).toThrow(TypeError);
    // eslint-disable-next-line no-sparse-arrays -- a hole is exactly the malformed input under test
    const holey = [claim(), , claim({ id: 'c3' })] as unknown as Claim[];
    expect(() => generateClaimsReport(holey, 90, NOW)).toThrow(/claims\[1\]/);
  });

  it('evaluateClaim rejects a missing or non-object claim with a TypeError', () => {
    expect(() => evaluateClaim(undefined as unknown as Claim, 90, NOW)).toThrow(TypeError);
    expect(() => evaluateClaim(null as unknown as Claim, 90, NOW)).toThrow(/claim must be an object/);
    expect(() => evaluateClaim('nope' as unknown as Claim, 90, NOW)).toThrow(TypeError);
  });

  it('accepts a frozen (readonly) array, as a module-level config export would be', () => {
    const frozen: readonly Claim[] = Object.freeze([claim(), claim({ id: 'c2', evidenceRef: '' })]);
    expect(checkStaleness(frozen, 90, NOW)).toHaveLength(0);
    expect(checkEvidenceLinked(frozen, NOW).map((c) => c.id)).toEqual(['c2']);
    expect(generateClaimsReport(frozen, 90, NOW).counts.total).toBe(2);
  });

  it('treats a claim with a runtime-missing verifiedAt as stale, not as a crash', () => {
    const missing = looseClaim({ verifiedAt: undefined });
    const result = evaluateClaim(missing, 90, NOW);
    expect(result.status).toBe('stale');
    expect(result.ageDays).toBeNull();
  });
});

describe('generateClaimsReport rejects a claim with no id', () => {
  it.each([
    ['missing entirely', looseClaim({ id: undefined })],
    ['null', looseClaim({ id: null })],
    ['an empty string', looseClaim({ id: '' })],
    ['whitespace only', looseClaim({ id: '   ' })],
    ['a number', looseClaim({ id: 42 })],
  ])('rejects an id that is %s, naming the offending claim', (_label, bad) => {
    expect(() => generateClaimsReport([bad], 90, NOW)).toThrow(TypeError);
    expect(() => generateClaimsReport([bad], 90, NOW)).toThrow(/claims\[0\]\.id/);
  });

  it('names the correct index when a later claim in the list has no id', () => {
    const list = [claim({ id: 'ok' }), looseClaim({ id: undefined })];
    expect(() => generateClaimsReport(list, 90, NOW)).toThrow(/claims\[1\]\.id/);
  });

  it('does not reject a well-formed id', () => {
    expect(() => generateClaimsReport([claim({ id: 'realtime-sync' })], 90, NOW)).not.toThrow();
  });
});

describe('checkEvidenceLinked agrees with evaluateClaim', () => {
  it('returns exactly what evaluateClaim reports for each unlinked claim, ageDays included', () => {
    const claims = [
      claim({ id: 'a', evidenceRef: '', verifiedAt: '2026-07-01' }),
      claim({ id: 'b' }),
      claim({ id: 'c', evidenceRef: '   ', verifiedAt: 'not-a-date' }),
    ];
    const linked = checkEvidenceLinked(claims, NOW);
    expect(linked).toEqual([
      evaluateClaim(claims[0], 90, NOW),
      evaluateClaim(claims[2], 90, NOW),
    ]);
  });
});
