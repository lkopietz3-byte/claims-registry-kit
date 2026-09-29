import { describe, expect, it } from 'vitest';
import { evaluateClaim } from '../src/index.js';
import { NOW, claim, looseClaim, withTimeZone } from './helpers.js';

// NOW is 2026-08-02T00:00:00Z. Ages are whole 24-hour periods (floor).
function ageOf(verifiedAt: unknown, now: Date = NOW): number | null {
  return evaluateClaim(looseClaim({ verifiedAt }), 90, now).ageDays;
}

describe('verifiedAt: accepted ISO 8601 forms (a bare date is UTC midnight; a timestamp needs an explicit zone)', () => {
  it.each([
    ['date only is UTC midnight', '2026-08-02', 0],
    ['date only, nine days back', '2026-07-24', 9],
    ['hour:minute with an explicit Z, seconds optional', '2026-07-24T00:00Z', 9],
    ['explicit Z', '2026-07-24T12:00:00Z', 8],
    ['fractional seconds', '2026-07-24T12:00:00.5Z', 8],
    ['long fractional seconds are truncated', '2026-07-24T12:00:00.123456789Z', 8],
    ['lowercase t and z', '2026-07-24t12:00:00z', 8],
    ['a space instead of T, with an explicit zone', '2026-07-24 12:00:00Z', 8],
    // 02:00+05:00 on the 25th is 21:00Z on the 24th: 8.125 days back. Ignoring the offset gives 7.
    ['positive offset with colon', '2026-07-25T02:00:00+05:00', 8],
    ['positive offset without colon', '2026-07-25T02:00:00+0500', 8],
    ['positive hour-only offset', '2026-07-25T02:00:00+05', 8],
    // 20:00-08:00 on the 24th is 04:00Z on the 25th: 7.83 days back. Ignoring the offset gives 8.
    ['negative offset', '2026-07-24T20:00:00-08:00', 7],
    ['half-hour offset', '2026-07-25T02:30:00+05:30', 8],
  ])('%s', (_label, verifiedAt, expectedAge) => {
    expect(ageOf(verifiedAt)).toBe(expectedAge);
  });

  it.each(['2024-02-29', '2000-02-29', '1900-01-01', '1999-12-31T23:59:59.999Z'])(
    'a real calendar moment (%s) ages exactly as the built-in ISO parser says',
    (verifiedAt) => {
      const expected = Math.floor((NOW.getTime() - Date.parse(verifiedAt)) / 86_400_000);
      expect(ageOf(verifiedAt)).toBe(expected);
    },
  );

  it('does not alias years below 100 into the 1900s', () => {
    const expected = Math.floor((NOW.getTime() - Date.parse('0026-08-01T00:00:00Z')) / 86_400_000);
    expect(ageOf('0026-08-01')).toBe(expected);
    expect(expected).toBeGreaterThan(700_000);
  });

  it('accepts the first calendar year', () => {
    expect(ageOf('0000-01-01')).not.toBeNull();
  });
});

describe('verifiedAt: values that are not usable ISO 8601 read as unparseable (null age, stale)', () => {
  it.each([
    // A timestamp with a time-of-day but no explicit zone. Guessing UTC here
    // (the pre-fix behavior) silently gave the same string a different age
    // depending on where it was evaluated -- these are unparseable, not UTC.
    ['hour:minute with no zone', '2026-07-24T00:00'],
    ['hour:minute:second with no zone', '2026-07-24T12:00:00'],
    ['a space instead of T, with no zone', '2026-07-24 12:00:00'],
    // Days that do not exist. The built-in Date parser silently rolls these forward.
    ['2026-02-29 (2026 is not a leap year)', '2026-02-29'],
    ['2026-02-30', '2026-02-30'],
    ['2026-02-31', '2026-02-31'],
    ['2026-06-31', '2026-06-31'],
    ['2100-02-29 (century, not a leap year)', '2100-02-29'],
    ['month 13', '2026-13-01'],
    ['month 00', '2026-00-10'],
    ['day 00', '2026-01-00'],
    ['day 32', '2026-01-32'],
    // Times that do not exist.
    ['hour 24', '2026-07-24T24:00:00Z'],
    ['minute 60', '2026-07-24T12:60:00Z'],
    ['second 60 (leap second)', '2026-07-24T12:00:60Z'],
    ['offset hour 24', '2026-07-24T12:00:00+24:00'],
    ['offset minute 60', '2026-07-24T12:00:00+05:60'],
    // Other formats: the built-in parser accepts these in local time, and engines disagree.
    ['month name', 'July 4, 2026'],
    ['US slashes', '7/4/2026'],
    ['ISO with slashes', '2026/07/04'],
    ['unpadded month and day', '2026-7-4'],
    ['basic (compact) format', '20260704'],
    ['year and month only', '2026-07'],
    ['year only', '2026'],
    ['hour without minutes', '2026-07-24T12'],
    ['a bare number string', '1'],
    ['text around a year', 'foo 2026'],
    ['dot after seconds with no digits', '2026-07-24T12:00:00.Z'],
    ['leading whitespace', ' 2026-07-01'],
    ['trailing whitespace', '2026-07-01 '],
    ['trailing newline', '2026-07-01\n'],
    ['empty string', ''],
    ['the word now', 'now'],
    ['Invalid Date text', 'Invalid Date'],
    ['full-width digits', '２０２６-07-01'],
    ['signed extended year', '+002026-07-01'],
    ['two dates', '2026-07-01/2026-07-02'],
  ])('%s', (_label, verifiedAt) => {
    const result = evaluateClaim(looseClaim({ verifiedAt }), 90, NOW);
    expect(result.ageDays).toBeNull();
    expect(result.status).toBe('stale');
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a number of milliseconds', 1_780_000_000_000],
    ['a Date object', new Date('2026-07-01T00:00:00Z')],
    ['an object', {}],
    ['a boolean', true],
    ['an array holding a date string', ['2026-07-01']],
  ])('a non-string value (%s) is unparseable, not coerced', (_label, verifiedAt) => {
    const result = evaluateClaim(looseClaim({ verifiedAt }), 90, NOW);
    expect(result.ageDays).toBeNull();
    expect(result.status).toBe('stale');
  });

  it('does not let an unparseable date rescue or hide a claim: it is stale, never current', () => {
    for (const verifiedAt of ['2026-02-30', 'July 4, 2026', '']) {
      expect(evaluateClaim(claim({ verifiedAt }), 3650, NOW).status).toBe('stale');
    }
  });

  it('still lets missing evidence outrank an unparseable date', () => {
    const result = evaluateClaim(claim({ verifiedAt: 'garbage', evidenceRef: '' }), 90, NOW);
    expect(result.status).toBe('unverified');
    expect(result.ageDays).toBeNull();
  });
});

describe('verifiedAt: pathological strings cannot stall the parser', () => {
  it('rejects a very long non-date string quickly', () => {
    const started = Date.now();
    expect(ageOf('2026-07-24T12:00:00' + '0'.repeat(200_000))).toBeNull();
    expect(ageOf('9'.repeat(200_000))).toBeNull();
    expect(ageOf('2026-07-24' + ' '.repeat(200_000))).toBeNull();
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

describe('age is computed in elapsed 24-hour periods, so time zone and DST do not matter', () => {
  const zones = ['UTC', 'America/Chicago', 'America/New_York', 'Pacific/Auckland', 'Asia/Kolkata', 'Pacific/Kiritimati'];

  it('the time zone override is real (guard against a vacuous pass)', () => {
    const offsets = zones.map((tz) => withTimeZone(tz, () => new Date(2026, 6, 1).getTimezoneOffset()));
    expect(new Set(offsets).size).toBeGreaterThan(3);
  });

  const cases: [string, Date][] = [
    ['2026-05-04', NOW],
    ['2026-05-04T00:00:00Z', NOW],
    ['2026-05-04T05:30:00+05:30', NOW],
    ['2026-03-08', new Date('2026-03-09T00:00:00Z')],
    ['2026-11-01', new Date('2026-11-02T00:00:00Z')],
  ];

  it.each(cases)('verifiedAt %s gives the same age in every time zone', (verifiedAt, now) => {
    const results = zones.map((tz) => withTimeZone(tz, () => evaluateClaim(claim({ verifiedAt }), 90, now)));
    const first = results[0];
    for (const result of results) {
      expect(result.ageDays).toBe(first.ageDays);
      expect(result.status).toBe(first.status);
    }
    expect(first.ageDays).not.toBeNull();
  });

  it('a zoneless timestamp is unparseable in every time zone, never silently read as machine-local time', () => {
    // US spring-forward (2026-03-08) and fall-back (2026-11-01) fall inside
    // these spans, so this also guards against the rejection itself somehow
    // depending on DST.
    const zonelessCases: [string, Date][] = [
      ['2026-05-04T00:00:00', NOW],
      ['2026-03-07T12:00:00', new Date('2026-03-09T12:00:00Z')],
      ['2026-10-31T12:00:00', new Date('2026-11-02T12:00:00Z')],
    ];
    for (const [verifiedAt, now] of zonelessCases) {
      for (const tz of zones) {
        const result = withTimeZone(tz, () => evaluateClaim(claim({ verifiedAt }), 90, now));
        expect(result.ageDays).toBeNull();
        expect(result.status).toBe('stale');
      }
    }
  });

  it('spring-forward and fall-back days are still 24 elapsed hours, not 23 or 25', () => {
    expect(withTimeZone('America/New_York', () => ageOf('2026-03-08T00:00:00Z', new Date('2026-03-09T00:00:00Z')))).toBe(1);
    expect(withTimeZone('America/New_York', () => ageOf('2026-11-01T00:00:00Z', new Date('2026-11-02T00:00:00Z')))).toBe(1);
    expect(withTimeZone('America/New_York', () => ageOf('2026-03-08T00:00:00Z', new Date('2026-03-08T23:59:59.999Z')))).toBe(0);
    expect(withTimeZone('America/New_York', () => ageOf('2026-11-01T00:00:00Z', new Date('2026-11-01T23:59:59.999Z')))).toBe(0);
  });
});

// Boundary cases that pin the exact arithmetic (fraction padding, offset
// minutes, the offset limits) rather than just "some age comes back".
describe('verifiedAt: exact arithmetic', () => {
  it.each([
    // One digit means tenths, two mean hundredths: .5 is 500 ms, .25 is 250 ms, .05 is 50 ms.
    ['.5 is 500 ms', '2026-08-01T00:00:00.5Z', '2026-08-02T00:00:00.400Z', 0],
    ['.5 is 500 ms (age 1 once 500 ms have passed)', '2026-08-01T00:00:00.5Z', '2026-08-02T00:00:00.500Z', 1],
    ['.25 is 250 ms', '2026-08-01T00:00:00.25Z', '2026-08-02T00:00:00.200Z', 0],
    ['.05 is 50 ms', '2026-08-01T00:00:00.05Z', '2026-08-02T00:00:00.040Z', 0],
    ['.123456789 keeps only the first three digits', '2026-08-01T00:00:00.123456789Z', '2026-08-02T00:00:00.122Z', 0],
    ['.123456789 keeps only the first three digits (boundary)', '2026-08-01T00:00:00.123456789Z', '2026-08-02T00:00:00.123Z', 1],
  ])('fraction: %s', (_label, verifiedAt, now, expected) => {
    expect(ageOf(verifiedAt, new Date(now))).toBe(expected);
  });

  it.each([
    // Each of these is exactly 2026-08-01T00:00:00Z, one day before NOW.
    ['+05:30', '2026-08-01T05:30:00+05:30'],
    ['-03:30', '2026-07-31T20:30:00-03:30'],
    ['+23:00 (the largest whole-hour offset)', '2026-08-01T23:00:00+23:00'],
    ['+00:59 (the largest minute offset)', '2026-08-01T00:59:00+00:59'],
    ['+23:59 (the largest offset)', '2026-08-01T23:59:00+23:59'],
    ['-23:59', '2026-07-31T00:01:00-23:59'],
  ])('offset %s names the exact instant', (_label, verifiedAt) => {
    expect(ageOf(verifiedAt)).toBe(1);
    expect(ageOf(verifiedAt, new Date('2026-08-01T23:59:59.999Z'))).toBe(0);
  });

  it.each(['2026-08-01T00:00:00+23:60', '2026-08-01T00:00:00-24:00', '2026-08-01T00:00:00+99'])(
    'offset in %s is not a real offset',
    (verifiedAt) => {
      expect(ageOf(verifiedAt)).toBeNull();
    },
  );
});
