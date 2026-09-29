import { describe, expect, it } from 'vitest';
import {
  checkStaleness,
  evaluateClaim,
  formatClaimsReportAsText,
  generateClaimsReport,
} from '../src/index.js';
import { NOW, claim } from './helpers.js';

// A verification date that has not happened yet cannot be evidence of a past
// check. Before this was handled, a typo like 2062 instead of 2026 produced a
// negative age that is never greater than the policy: current, forever.

describe('a verifiedAt in the future', () => {
  it('is stale, not current, when it is far ahead (a year typo)', () => {
    const result = evaluateClaim(claim({ verifiedAt: '2062-08-01' }), 90, NOW);
    expect(result.status).toBe('stale');
    expect(result.ageDays).not.toBeNull();
    expect(result.ageDays).toBeLessThan(0);
  });

  it('appears in checkStaleness and in the report stale list', () => {
    const typo = claim({ id: 'typo', verifiedAt: '2062-08-01' });
    expect(checkStaleness([typo], 90, NOW).map((c) => c.id)).toEqual(['typo']);
    const report = generateClaimsReport([typo], 90, NOW);
    expect(report.counts).toEqual({ current: 0, stale: 1, unverified: 0, total: 1 });
  });

  it('stays stale however generous the policy is', () => {
    expect(evaluateClaim(claim({ verifiedAt: '2062-08-01' }), 1e9, NOW).status).toBe('stale');
  });

  it('missing evidence still outranks it, and the negative age is still reported', () => {
    const result = evaluateClaim(claim({ verifiedAt: '2062-08-01', evidenceRef: '' }), 90, NOW);
    expect(result.status).toBe('unverified');
    expect(result.ageDays).toBeLessThan(0);
  });

  it('becomes current once its date arrives', () => {
    const c = claim({ verifiedAt: '2026-12-01' });
    expect(evaluateClaim(c, 90, NOW).status).toBe('stale');
    expect(evaluateClaim(c, 90, new Date('2026-12-01T00:00:00Z')).status).toBe('current');
    expect(evaluateClaim(c, 90, new Date('2027-02-28T23:59:59Z')).status).toBe('current');
    expect(evaluateClaim(c, 90, new Date('2027-03-02T00:00:00Z')).status).toBe('stale');
  });
});

describe('future-date tolerance depends on whether verifiedAt is a bare date or an explicit timestamp', () => {
  // A bare YYYY-MM-DD carries no zone, so it is already "today" somewhere on
  // Earth up to 14 hours before UTC agrees (UTC+14, e.g. Pacific/Kiritimati,
  // is the furthest-ahead civil zone) — the same rule freshness-kit uses for
  // its own bare-date reviewedOn values. An explicit timestamp names an exact
  // instant and gets none of that slack.

  describe('a bare date gets up to 14 hours', () => {
    it('a date-only value for "today" in UTC+14 is accepted while UTC is still on the previous day', () => {
      // 10:00Z on Aug 2 is already Aug 3 at UTC+14. Date-only reads as 00:00Z: 14h ahead.
      const result = evaluateClaim(claim({ verifiedAt: '2026-08-03' }), 90, new Date('2026-08-02T10:00:00.000Z'));
      expect(result.status).toBe('current');
      expect(Object.is(result.ageDays, 0)).toBe(true);
    });

    it('one millisecond less than 14 hours ahead is accepted (just below the boundary)', () => {
      const result = evaluateClaim(claim({ verifiedAt: '2026-08-03' }), 90, new Date('2026-08-02T10:00:00.001Z'));
      expect(result.status).toBe('current');
      expect(Object.is(result.ageDays, 0)).toBe(true);
    });

    it('one millisecond more than 14 hours ahead is stale (just above the boundary)', () => {
      const result = evaluateClaim(claim({ verifiedAt: '2026-08-03' }), 90, new Date('2026-08-02T09:59:59.999Z'));
      expect(result.status).toBe('stale');
      expect(result.ageDays).toBeLessThan(0);
    });

    it('two calendar days ahead is stale', () => {
      expect(evaluateClaim(claim({ verifiedAt: '2026-08-04' }), 90, NOW).status).toBe('stale');
    });
  });

  describe('an explicit timestamp gets none', () => {
    it('the exact instant of now is accepted (age 0, at the boundary)', () => {
      const result = evaluateClaim(claim({ verifiedAt: NOW.toISOString() }), 0, NOW);
      expect(result.status).toBe('current');
      expect(Object.is(result.ageDays, 0)).toBe(true);
    });

    it('one millisecond ahead is stale (just above the boundary) even though a bare date would tolerate hours', () => {
      const result = evaluateClaim(claim({ verifiedAt: '2026-08-02T00:00:00.001Z' }), 90, NOW);
      expect(result.status).toBe('stale');
      expect(result.ageDays).toBeLessThan(0);
    });

    it('a timestamp exactly 14 hours ahead is stale, unlike the equivalent bare date', () => {
      const result = evaluateClaim(claim({ verifiedAt: '2026-08-02T14:00:00.000Z' }), 90, NOW);
      expect(result.status).toBe('stale');
    });

    it('an offset timestamp landing at the same instant as "now" is still accepted', () => {
      // 05:00+05:00 on Aug 2 is 00:00Z on Aug 2, i.e. exactly NOW.
      const result = evaluateClaim(claim({ verifiedAt: '2026-08-02T05:00:00+05:00' }), 90, NOW);
      expect(result.status).toBe('current');
      expect(Object.is(result.ageDays, 0)).toBe(true);
    });
  });
});

describe('text report wording for future dates', () => {
  it('says the date is in the future instead of printing a negative age', () => {
    const report = generateClaimsReport([claim({ id: 'typo', verifiedAt: '2062-08-01' })], 90, NOW);
    const text = formatClaimsReportAsText(report);
    expect(text).toContain('[typo]');
    expect(text).toContain('verifiedAt is in the future');
    expect(text).not.toMatch(/-\d+d old/);
  });
});

describe('the negative age of a future verifiedAt is exact', () => {
  it.each([
    ['a bare date one day ahead', '2026-08-03', -1],
    ['a bare date two days ahead', '2026-08-04', -2],
    ['a timestamp one and a half days ahead rounds down', '2026-08-03T12:00:00Z', -2],
    ['a timestamp one millisecond ahead', '2026-08-02T00:00:00.001Z', -1],
    ['a timestamp exactly one day ahead', '2026-08-03T00:00:00Z', -1],
  ])('%s', (_label, verifiedAt, expectedAge) => {
    const result = evaluateClaim(claim({ verifiedAt }), 90, NOW);
    expect(result.status).toBe('stale');
    expect(result.ageDays).toBe(expectedAge);
  });
});
