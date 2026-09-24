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

describe('a verifiedAt within one day ahead is clock skew or a local calendar date, not a typo', () => {
  it('a timestamp one second ahead is current with age 0 (not -1)', () => {
    const result = evaluateClaim(claim({ verifiedAt: '2026-08-02T00:00:01Z' }), 90, NOW);
    expect(result.status).toBe('current');
    expect(Object.is(result.ageDays, 0)).toBe(true);
  });

  it('a date-only value for "today" in UTC+14 is accepted while UTC is still on the previous day', () => {
    // 10:00Z on Aug 2 is already Aug 3 at UTC+14 (Line Islands). Date-only reads as 00:00Z: 14h ahead.
    const result = evaluateClaim(claim({ verifiedAt: '2026-08-03' }), 90, new Date('2026-08-02T10:00:00Z'));
    expect(result.status).toBe('current');
    expect(Object.is(result.ageDays, 0)).toBe(true);
  });

  it('exactly 24 hours ahead is still accepted (boundary)', () => {
    const result = evaluateClaim(claim({ verifiedAt: '2026-08-03T00:00:00Z' }), 90, NOW);
    expect(result.status).toBe('current');
    expect(Object.is(result.ageDays, 0)).toBe(true);
  });

  it('one millisecond past 24 hours ahead is stale (just above the boundary)', () => {
    const result = evaluateClaim(claim({ verifiedAt: '2026-08-03T00:00:00.001Z' }), 90, NOW);
    expect(result.status).toBe('stale');
    expect(result.ageDays).toBeLessThan(0);
  });

  it('two calendar days ahead is stale', () => {
    expect(evaluateClaim(claim({ verifiedAt: '2026-08-04' }), 90, NOW).status).toBe('stale');
  });

  it('the moment of now itself has age 0', () => {
    const result = evaluateClaim(claim({ verifiedAt: NOW.toISOString() }), 0, NOW);
    expect(result.status).toBe('current');
    expect(Object.is(result.ageDays, 0)).toBe(true);
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
