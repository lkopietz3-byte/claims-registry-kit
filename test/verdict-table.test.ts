import { describe, expect, it } from 'vitest';
import {
  checkEvidenceLinked,
  checkStaleness,
  createClaimsRegistry,
  evaluateClaim,
  generateClaimsReport,
  type ClaimStatus,
} from '../src/index.js';
import { MS_PER_DAY, NOW, claim, looseClaim, withTimeZone } from './helpers.js';

// A verdict regression table: one named case per finding, each asserting the
// CORRECT bucket. The rules these cases pin:
//
//   - A claim is stale when strictly MORE than maxAgeDays x 24h have elapsed
//     since verifiedAt, compared in elapsed milliseconds. Exactly at the limit
//     is still current (the limit is inclusive). `ageDays` is only a floored
//     display number and plays no part in the decision.
//   - An evidenceRef that is only a placeholder (TODO, TBD, N/A, none, -,
//     "see above"; exact match, case-insensitive, trimmed) is no evidence, so
//     the claim is unverified. A real reference that merely contains one of
//     those words is still linked.
//   - Fail only on positive evidence: honest data keeps its honest verdict.

/** `NOW` minus a duration, as a full UTC timestamp string. */
function ago(ms: number): string {
  return new Date(NOW.getTime() - ms).toISOString();
}

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

interface Case {
  name: string;
  verifiedAt: string;
  maxAgeDays: number;
  expected: ClaimStatus;
  now?: Date;
}

function verdict(c: Case): ClaimStatus {
  return evaluateClaim(claim({ verifiedAt: c.verifiedAt }), c.maxAgeDays, c.now ?? NOW).status;
}

describe('verdict table: the age threshold is elapsed time, not floored days', () => {
  const cases: Case[] = [
    // The finding: floored whole days let a claim stay current up to 24h late.
    { name: '90d 23h59m old, maxAgeDays 90', verifiedAt: ago(90 * MS_PER_DAY + 23 * HOUR + 59 * MINUTE), maxAgeDays: 90, expected: 'stale' },
    { name: 'fractional maxAgeDays 1.5, claim 1.9 days old', verifiedAt: ago(1.9 * MS_PER_DAY), maxAgeDays: 1.5, expected: 'stale' },
    { name: 'maxAgeDays 0.5, claim 20h old', verifiedAt: ago(20 * HOUR), maxAgeDays: 0.5, expected: 'stale' },
    { name: 'maxAgeDays 0, claim 23h59m old', verifiedAt: ago(23 * HOUR + 59 * MINUTE), maxAgeDays: 0, expected: 'stale' },
    // The documented rule: exactly at the limit is current, one ms past is stale.
    { name: 'exactly 90 days old (bare date), maxAgeDays 90: inclusive limit', verifiedAt: '2026-05-04', maxAgeDays: 90, expected: 'current' },
    { name: '90 days and 1 ms old, maxAgeDays 90', verifiedAt: ago(90 * MS_PER_DAY + 1), maxAgeDays: 90, expected: 'stale' },
    { name: '90 days less 1 ms old, maxAgeDays 90', verifiedAt: ago(90 * MS_PER_DAY - 1), maxAgeDays: 90, expected: 'current' },
    { name: 'exactly 1.5 days old, maxAgeDays 1.5', verifiedAt: ago(1.5 * MS_PER_DAY), maxAgeDays: 1.5, expected: 'current' },
    { name: '1.5 days and 1 ms old, maxAgeDays 1.5', verifiedAt: ago(1.5 * MS_PER_DAY + 1), maxAgeDays: 1.5, expected: 'stale' },
    { name: 'exactly 12h old, maxAgeDays 0.5', verifiedAt: ago(12 * HOUR), maxAgeDays: 0.5, expected: 'current' },
    { name: 'verified this very instant, maxAgeDays 0', verifiedAt: NOW.toISOString(), maxAgeDays: 0, expected: 'current' },
    { name: 'verified 1 ms ago, maxAgeDays 0', verifiedAt: ago(1), maxAgeDays: 0, expected: 'stale' },
    // Guards: honest data well inside the limit stays current.
    { name: 'guard: 10 days old, maxAgeDays 90', verifiedAt: '2026-07-23', maxAgeDays: 90, expected: 'current' },
    { name: 'guard: 89d 23h old, maxAgeDays 90', verifiedAt: ago(89 * MS_PER_DAY + 23 * HOUR), maxAgeDays: 90, expected: 'current' },
    { name: 'guard: 1.2 days old, maxAgeDays 1.5', verifiedAt: ago(1.2 * MS_PER_DAY), maxAgeDays: 1.5, expected: 'current' },
    { name: 'guard: 11h old, maxAgeDays 0.5', verifiedAt: ago(11 * HOUR), maxAgeDays: 0.5, expected: 'current' },
    { name: 'guard: 1 day old, maxAgeDays 365', verifiedAt: '2026-08-01', maxAgeDays: 365, expected: 'current' },
    { name: 'guard: 200 days old, maxAgeDays 90 is still stale', verifiedAt: '2026-01-14', maxAgeDays: 90, expected: 'stale' },
  ];

  it.each(cases)('$name -> $expected', (c) => {
    expect(verdict(c)).toBe(c.expected);
  });

  it('keeps ageDays floored for display while the verdict uses elapsed time', () => {
    const result = evaluateClaim(
      claim({ verifiedAt: ago(90 * MS_PER_DAY + 23 * HOUR + 59 * MINUTE) }),
      90,
      NOW,
    );
    expect(result.status).toBe('stale');
    expect(result.ageDays).toBe(90);
  });

  it('applies the same threshold in checkStaleness and generateClaimsReport', () => {
    const late = claim({ id: 'late', verifiedAt: ago(90 * MS_PER_DAY + 23 * HOUR) });
    const onTime = claim({ id: 'on-time', verifiedAt: ago(90 * MS_PER_DAY) });
    expect(checkStaleness([late, onTime], 90, NOW).map((c) => c.id)).toEqual(['late']);
    const report = generateClaimsReport([late, onTime], 90, NOW);
    expect(report.stale.map((c) => c.id)).toEqual(['late']);
    expect(report.current.map((c) => c.id)).toEqual(['on-time']);
  });
});

describe('verdict table: zones, DST, leap days and future dates keep their documented verdicts', () => {
  const cases: Case[] = [
    // The same instant written with an offset: exactly 90 days before NOW.
    { name: 'offset -04:00 timestamp exactly at the limit', verifiedAt: '2026-05-03T20:00:00-04:00', maxAgeDays: 90, expected: 'current' },
    { name: 'offset -04:00 timestamp one second past the limit', verifiedAt: '2026-05-03T19:59:59-04:00', maxAgeDays: 90, expected: 'stale' },
    { name: 'offset +14:00 timestamp exactly at the limit', verifiedAt: '2026-05-04T14:00:00+14:00', maxAgeDays: 90, expected: 'current' },
    { name: 'offset +05:30 timestamp one minute past the limit', verifiedAt: '2026-05-04T05:29:00+05:30', maxAgeDays: 90, expected: 'stale' },
    // Leap day: 2028-02-28 to 2028-03-01 is two days; 2027-02-28 to 2027-03-01 is one.
    { name: 'leap year: 2028-02-28 is 2 days before 2028-03-01, maxAgeDays 2', verifiedAt: '2028-02-28', maxAgeDays: 2, expected: 'current', now: new Date('2028-03-01T00:00:00Z') },
    { name: 'leap year: one second past 2 days', verifiedAt: '2028-02-28', maxAgeDays: 2, expected: 'stale', now: new Date('2028-03-01T00:00:01Z') },
    { name: 'common year: 2027-02-28 is 1 day before 2027-03-01, maxAgeDays 1', verifiedAt: '2027-02-28', maxAgeDays: 1, expected: 'current', now: new Date('2027-03-01T00:00:00Z') },
    { name: 'common year: one second past 1 day', verifiedAt: '2027-02-28', maxAgeDays: 1, expected: 'stale', now: new Date('2027-03-01T00:00:01Z') },
    { name: 'leap day itself is a valid verifiedAt', verifiedAt: '2028-02-29', maxAgeDays: 90, expected: 'current', now: new Date('2028-03-15T00:00:00Z') },
    { name: 'a leap day in a common year is unparseable, so stale', verifiedAt: '2027-02-29', maxAgeDays: 90, expected: 'stale' },
    // DST: elapsed time is UTC milliseconds, never wall-clock days.
    { name: 'across US spring-forward: exactly 48h old, maxAgeDays 2', verifiedAt: '2026-03-07T12:00:00Z', maxAgeDays: 2, expected: 'current', now: new Date('2026-03-09T12:00:00Z') },
    { name: 'across US spring-forward: 48h and 1 ms old, maxAgeDays 2', verifiedAt: '2026-03-07T11:59:59.999Z', maxAgeDays: 2, expected: 'stale', now: new Date('2026-03-09T12:00:00Z') },
    { name: 'across US fall-back: exactly 48h old, maxAgeDays 2', verifiedAt: '2026-10-31T12:00:00Z', maxAgeDays: 2, expected: 'current', now: new Date('2026-11-02T12:00:00Z') },
    { name: 'across US fall-back: 48h and 1 ms old, maxAgeDays 2', verifiedAt: '2026-10-31T11:59:59.999Z', maxAgeDays: 2, expected: 'stale', now: new Date('2026-11-02T12:00:00Z') },
    // Future dates, as documented: bare date 14h grace, explicit timestamp none.
    { name: 'future: bare date 10h ahead is current', verifiedAt: '2026-08-02', maxAgeDays: 90, expected: 'current', now: new Date('2026-08-01T14:00:00Z') },
    { name: 'future: bare date exactly 14h ahead is current', verifiedAt: '2026-08-02', maxAgeDays: 90, expected: 'current', now: new Date('2026-08-01T10:00:00Z') },
    { name: 'future: bare date 14h and 1 ms ahead is stale', verifiedAt: '2026-08-02', maxAgeDays: 90, expected: 'stale', now: new Date('2026-08-01T09:59:59.999Z') },
    { name: 'future: explicit timestamp 1 ms ahead is stale', verifiedAt: '2026-08-02T00:00:00.001Z', maxAgeDays: 90, expected: 'stale' },
    { name: 'future: explicit timestamp exactly now is current', verifiedAt: '2026-08-02T00:00:00.000Z', maxAgeDays: 90, expected: 'current' },
    { name: 'future: a year typo (2062) is stale', verifiedAt: '2062-08-01', maxAgeDays: 90, expected: 'stale' },
  ];

  it.each(cases)('$name -> $expected', (c) => {
    expect(verdict(c)).toBe(c.expected);
  });

  it.each(['UTC', 'America/New_York', 'Pacific/Kiritimati', 'Australia/Lord_Howe', 'Asia/Kolkata'])(
    'gives the same threshold verdicts when the process zone is %s',
    (tz) => {
      const run = (verifiedAt: string, maxAgeDays: number, now: Date): ClaimStatus =>
        withTimeZone(tz, () => evaluateClaim(claim({ verifiedAt }), maxAgeDays, now).status);
      expect(run('2026-05-04', 90, NOW)).toBe('current');
      expect(run('2026-05-03T23:59:59Z', 90, NOW)).toBe('stale');
      expect(run('2026-03-07T12:00:00Z', 2, new Date('2026-03-09T12:00:00Z'))).toBe('current');
      expect(run('2026-03-07T11:59:59Z', 2, new Date('2026-03-09T12:00:00Z'))).toBe('stale');
      expect(run(ago(20 * HOUR), 0.5, NOW)).toBe('stale');
    },
  );
});

describe('verdict table: placeholder evidence refs are no evidence', () => {
  const statusOf = (evidenceRef: unknown): ClaimStatus =>
    evaluateClaim(looseClaim({ evidenceRef }), 90, NOW).status;

  it.each([
    ['TODO'],
    ['TBD'],
    ['N/A'],
    ['none'],
    ['-'],
    ['see above'],
    ['todo'],
    ['Tbd'],
    ['n/a'],
    ['NONE'],
    ['None'],
    ['SEE ABOVE'],
    ['See Above'],
    ['  TODO  '],
    ['\tN/A\n'],
    ['  -  '],
    ['\u00a0none\u00a0'],
    ['T\u200bODO'],
    ['see   above'],
    ['see\u00a0above'],
  ])('placeholder %j is unverified', (evidenceRef) => {
    expect(statusOf(evidenceRef)).toBe('unverified');
  });

  it.each([
    [['TODO']],
    [['TODO', 'TBD', '-']],
    [[['n/a'], ['none']]],
    [['', 'see above']],
  ])('a list holding only placeholders %j is unverified', (evidenceRef) => {
    expect(statusOf(evidenceRef)).toBe('unverified');
  });

  it('a placeholder outranks a fresh verifiedAt in every entry point', () => {
    const todo = claim({ id: 'todo', evidenceRef: 'TODO', verifiedAt: '2026-08-02' });
    expect(evaluateClaim(todo, 90, NOW).status).toBe('unverified');
    expect(checkEvidenceLinked([todo], NOW).map((c) => c.id)).toEqual(['todo']);
    expect(checkStaleness([todo], 90, NOW)).toHaveLength(0);
    expect(generateClaimsReport([todo], 90, NOW).counts).toEqual({
      current: 0,
      stale: 0,
      unverified: 1,
      total: 1,
    });
  });

  it('a placeholder is unverified even with an unparseable or ancient verifiedAt', () => {
    expect(evaluateClaim(claim({ evidenceRef: 'TBD', verifiedAt: 'soon' }), 90, NOW).status).toBe('unverified');
    expect(evaluateClaim(claim({ evidenceRef: 'TBD', verifiedAt: '2001-01-01' }), 90, NOW).status).toBe('unverified');
  });

  // Guards: real references that merely contain a placeholder word stay linked.
  it.each([
    ['https://example.com/todo-list'],
    ['https://example.com/none'],
    ['none-such-ref-123'],
    ['TODO.md'],
    ['docs/TBD.md'],
    ['src/n/a/handler.ts'],
    ['see above and docs/a.md'],
    ['see docs/a.md'],
    ['N/A-123'],
    ['n/a for EU; see docs/eu.md'],
    ['TODO: link the SOC 2 report'],
    ['None of the above, see audit-2026.pdf'],
    ['nonexistent'],
    ['to-do'],
    ['--'],
    ['-x'],
    ['--flag'],
    ['tbd2'],
    ['a-todo'],
    ['see-above'],
    ['todoist'],
    ['TEST-TODO-1'],
    ['docs/a.md'],
  ])('real reference %j stays linked (current)', (evidenceRef) => {
    expect(statusOf(evidenceRef)).toBe('current');
  });

  it.each([
    [['TODO', 'docs/a.md']],
    [['-', ['none'], 'https://example.com/todo-list']],
    [{ kind: 'test', ref: 'TODO' }],
    [{ kind: 'url', ref: '-' }],
    [[{ ref: 'TBD' }]],
  ])('%j counts as present (opaque objects and any real list entry)', (evidenceRef) => {
    expect(statusOf(evidenceRef)).toBe('current');
  });
});

describe('verdict table: look-alike duplicate ids are rejected by the registry', () => {
  function secondThrows(first: string, second: string): void {
    const registry = createClaimsRegistry();
    registry.registerClaim(claim({ id: first }));
    expect(() => {
      registry.registerClaim(claim({ id: second }));
    }).toThrow(/looks the same as the already registered id/);
    expect(registry.getClaims().map((c) => c.id)).toEqual([first]);
  }

  it.each([
    ['a trailing space', 'sync', 'sync '],
    ['a leading space', 'sync', ' sync'],
    ['surrounding tabs and newlines', 'sync', '\tsync\n'],
    ['a non-breaking space', 'sync', 'sync\u00a0'],
    ['a zero-width space inside', 'sync', 's\u200bync'],
    ['a trailing zero-width space', 'sync', 'sync\u200b'],
    ['a trailing zero-width joiner', 'sync', 'sync\u200d'],
    ['a trailing soft hyphen', 'sync', 'sync\u00ad'],
    ['a leading byte-order mark', 'sync', '\ufeffsync'],
    ['a bidi mark', 'sync', 'sync\u200e'],
    ['a bidi isolate', 'sync', '\u2066sync\u2069'],
    ['a variation selector', 'heart\u2764', 'heart\u2764\ufe0f'],
    ['a Hangul filler', 'sync', 'sync\u3164'],
    ['NFD vs NFC (precomposed e-acute)', 'caf\u00e9', 'cafe\u0301'],
    ['NFC vs NFD (the reverse order)', 'cafe\u0301', 'caf\u00e9'],
    ['NFD with a trailing space', 'caf\u00e9', 'cafe\u0301 '],
    ['Hangul syllable vs conjoining jamo', '\ud55c', '\u1112\u1161\u11ab'],
    ['the earlier spelling already had the invisible character', 's\u200bync', 'sync'],
  ])('%s', (_label, first, second) => {
    secondThrows(first, second);
  });

  it('names both spellings, with invisible characters spelled out', () => {
    const registry = createClaimsRegistry();
    registry.registerClaim(claim({ id: 'sync' }));
    let message = '';
    try {
      registry.registerClaim(claim({ id: 'sync\u200b' }));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('"sync\\u200b"');
    expect(message).toContain('"sync"');
    expect(message).not.toContain('\u200b');
  });

  it('still reports an exact duplicate with the original message', () => {
    const registry = createClaimsRegistry();
    registry.registerClaim(claim({ id: 'sync' }));
    expect(() => {
      registry.registerClaim(claim({ id: 'sync' }));
    }).toThrow('claims-registry-kit: a claim with id "sync" is already registered');
  });

  // Guards: ids that are really different stay registrable.
  it.each([
    ['different words', 'sync', 'uptime'],
    ['an inner space is a character', 'a b', 'ab'],
    ['case matters', 'Sync', 'sync'],
    ['a hyphen matters', 'a-1', 'a1'],
    ['a composed letter differs from its base letter', 'caf\u00e9', 'cafe'],
    ['a Cyrillic letter is not a Latin letter', 'sync', 's\u0443nc'],
    ['a doubled inner space is a different id', 'a b', 'a  b'],
    ['digits differ', 'claim-1', 'claim-2'],
  ])('%s', (_label, first, second) => {
    const registry = createClaimsRegistry();
    registry.registerClaim(claim({ id: first }));
    expect(() => {
      registry.registerClaim(claim({ id: second }));
    }).not.toThrow();
    expect(registry.getClaims().map((c) => c.id)).toEqual([first, second]);
  });

  it('clear() forgets the normalized keys too', () => {
    const registry = createClaimsRegistry();
    registry.registerClaim(claim({ id: 'sync' }));
    registry.clear();
    expect(() => {
      registry.registerClaim(claim({ id: 'sync ' }));
    }).not.toThrow();
  });

  it('getClaim stays an exact lookup', () => {
    const registry = createClaimsRegistry();
    registry.registerClaim(claim({ id: 'sync' }));
    expect(registry.getClaim('sync ')).toBeUndefined();
    expect(registry.getClaim('sync')?.id).toBe('sync');
  });
});

// Probes found by trying to break the fix: each one was a realistic input a
// first implementation could get wrong in one direction (false PASS: a bad
// claim reads fine; false FAIL: an honest claim is flagged).
describe('verdict table: self-hunt probes', () => {
  const statusOf = (evidenceRef: unknown): ClaimStatus =>
    evaluateClaim(looseClaim({ evidenceRef }), 90, NOW).status;

  // False FAIL: fractional policies times 86,400,000 are not always whole
  // numbers (0.7 * 86400000 is 60479999.99999999), so a claim exactly at the
  // limit could read stale. Every thousandth of a day must be exact.
  it.each([0.007, 0.009, 0.035, 0.07, 0.7, 1.1, 2.3, 33.33, 90.001])(
    'a claim exactly maxAgeDays=%s old is current and 1 ms older is stale',
    (maxAgeDays) => {
      const ms = Math.round(maxAgeDays * 1000) * 86_400;
      expect(verdict({ name: '', verifiedAt: ago(ms), maxAgeDays, expected: 'current' })).toBe('current');
      expect(verdict({ name: '', verifiedAt: ago(ms + 1), maxAgeDays, expected: 'stale' })).toBe('stale');
    },
  );

  it('a policy with no whole-millisecond meaning is compared exactly (1/3 day)', () => {
    const third = 1 / 3;
    expect(verdict({ name: '', verifiedAt: ago(28_800_000), maxAgeDays: third, expected: 'current' })).toBe('current');
    expect(verdict({ name: '', verifiedAt: ago(28_800_001), maxAgeDays: third, expected: 'stale' })).toBe('stale');
  });

  it('a huge policy never makes an old claim stale and never throws', () => {
    expect(evaluateClaim(claim({ verifiedAt: '1970-01-01' }), Number.MAX_VALUE, NOW).status).toBe('current');
    expect(evaluateClaim(claim({ verifiedAt: '1970-01-01' }), 1e9, NOW).status).toBe('current');
  });

  it('a tiny policy is real: 1e-9 days is under a millisecond', () => {
    expect(verdict({ name: '', verifiedAt: NOW.toISOString(), maxAgeDays: 1e-9, expected: 'current' })).toBe('current');
    expect(verdict({ name: '', verifiedAt: ago(1), maxAgeDays: 1e-9, expected: 'stale' })).toBe('stale');
  });

  // False PASS: a placeholder dressed up so it does not match byte for byte.
  it.each([
    ['full-width letters', '\uff34\uff2f\uff24\uff2f'],
    ['a full-width hyphen', '\uff0d'],
    ['a zero-width joiner inside', 'N\u200d/A'],
    ['a bidi mark around it', '\u200eTBD\u200f'],
    ['a newline inside the phrase', 'see\nabove'],
    ['a leading soft hyphen', '\u00adnone'],
    ['mixed case with padding', ' \tNoNe \n'],
  ])('a placeholder with %s is still unverified', (_label, evidenceRef) => {
    expect(statusOf(evidenceRef)).toBe('unverified');
  });

  // False FAIL: honest references that start with, end with or contain a
  // placeholder word or the dash must stay linked.
  it.each([
    ['a markdown bullet with a path', '- docs/a.md'],
    ['a dash-prefixed flag', '-x'],
    ['a phrase that starts with none', 'none yet, tracked in ISSUE-42'],
    ['a version with n/a in a path', 'releases/n/a.txt'],
    ['a sentence ending in see above', 'details: see above table in docs/pricing.md'],
    ['a URL with a fragment of a placeholder', 'https://example.com/docs#todo'],
    ['a test name', 'test: handles TBD dates'],
    ['an id that is a number', 42],
  ])('%s stays linked', (_label, evidenceRef) => {
    expect(statusOf(evidenceRef)).toBe('current');
  });

  it('a very long reference is judged in reasonable time', () => {
    const started = Date.now();
    expect(statusOf('docs/' + 'a'.repeat(5_000_000))).toBe('current');
    expect(statusOf(' '.repeat(2_000_000) + 'TODO' + ' '.repeat(2_000_000))).toBe('unverified');
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  // The registry: ids that are the same after the look-alike rule, in the
  // positions a first implementation tends to miss.
  it('catches a look-alike id registered third, after unrelated ids', () => {
    const registry = createClaimsRegistry();
    registry.registerClaim(claim({ id: 'alpha' }));
    registry.registerClaim(claim({ id: 'beta' }));
    expect(() => {
      registry.registerClaim(claim({ id: 'beta\u200b' }));
    }).toThrow(/looks the same as the already registered id "beta"/);
    expect(registry.getClaims()).toHaveLength(2);
  });

  it('spells a leading and trailing plain space out, but keeps an inner one readable', () => {
    const registry = createClaimsRegistry();
    registry.registerClaim(claim({ id: 'my claim' }));
    let message = '';
    try {
      registry.registerClaim(claim({ id: ' my claim ' }));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('"\\u0020my claim\\u0020"');
    expect(message).toContain('already registered id "my claim"');
  });

  it('spells combining marks out so NFC and NFD read differently', () => {
    const registry = createClaimsRegistry();
    registry.registerClaim(claim({ id: 'caf\u00e9' }));
    let message = '';
    try {
      registry.registerClaim(claim({ id: 'cafe\u0301' }));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('"cafe\\u0301"');
    expect(message).toContain('"caf\u00e9"');
  });

  it('does not let a failed look-alike registration poison later ones', () => {
    const registry = createClaimsRegistry();
    registry.registerClaim(claim({ id: 'sync' }));
    expect(() => {
      registry.registerClaim(claim({ id: 'sync ' }));
    }).toThrow();
    expect(() => {
      registry.registerClaim(claim({ id: 'uptime' }));
    }).not.toThrow();
    expect(() => {
      registry.registerClaim(claim({ id: 'sync\u200b' }));
    }).toThrow();
    expect(registry.getClaims().map((c) => c.id)).toEqual(['sync', 'uptime']);
  });

  // False FAIL: ids that look related but are different claims.
  it.each([
    ['numbered ids', 'claim-10', 'claim-1'],
    ['an inner tab and an inner space', 'a\tb', 'a b'],
    ['a prefix', 'sync', 'sync-v2'],
    ['two scripts', '\u0441laim', 'claim'],
    ['a ligature and its letters', '\ufb01le', 'file'],
  ])('%s are different ids', (_label, first, second) => {
    const registry = createClaimsRegistry();
    registry.registerClaim(claim({ id: first }));
    expect(() => {
      registry.registerClaim(claim({ id: second }));
    }).not.toThrow();
  });
});

// Pathological shapes. The first draft trimmed ids with /^\s+|\s+$/g, which
// retries the trailing alternative at every position of an inner whitespace
// run: an id of 40,000 inner spaces blocked registerClaim for about 37 seconds
// (under 1 ms on the base). Every normalization and trimming step must be
// linear in the input, whatever the shape.
describe('verdict table: pathological shapes stay linear', () => {
  function timed(fn: () => void): number {
    const started = Date.now();
    fn();
    return Date.now() - started;
  }

  function register(id: string, claimsRegistry = createClaimsRegistry()): number {
    return timed(() => {
      claimsRegistry.registerClaim(claim({ id }));
    });
  }

  it('registers an id with a 40,000-space inner run in well under a second', () => {
    expect(register('a' + ' '.repeat(40_000) + 'b')).toBeLessThan(200);
  });

  it('keeps inner spacing distinct at that size: 40,000 and 39,999 inner spaces are different ids', () => {
    const registry = createClaimsRegistry();
    registry.registerClaim(claim({ id: 'a' + ' '.repeat(40_000) + 'b' }));
    expect(() => {
      registry.registerClaim(claim({ id: 'a' + ' '.repeat(39_999) + 'b' }));
    }).not.toThrow();
    expect(() => {
      registry.registerClaim(claim({ id: 'a' + ' '.repeat(40_000) + 'b\u200b' }));
    }).toThrow(/looks the same/);
  });

  it.each([
    ['many mixed invisible and space characters inside', 'a' + ' \t\u200b\u00ad\u2003\u3164'.repeat(20_000) + 'b'],
    ['alternating spaces and zero-width spaces inside', 'a' + ' \u200b'.repeat(40_000) + 'b'],
    ['alternating zero-width joiners and no-break spaces inside', 'a' + '\u200d\u00a0'.repeat(40_000) + 'b'],
    ['a long leading run of whitespace', ' '.repeat(200_000) + 'a'],
    ['a long trailing run of whitespace', 'a' + ' '.repeat(200_000)],
    ['long runs at both ends and inside', ' '.repeat(100_000) + 'a' + ' '.repeat(100_000) + 'b' + ' '.repeat(100_000)],
    ['a long trailing run of invisible characters', 'a' + '\u200b'.repeat(200_000)],
    ['a long run of combining marks', 'e' + '\u0301'.repeat(100_000)],
    ['an id that is almost all whitespace with one visible character at the end', ' '.repeat(200_000) + '.'],
  ])('registers %s quickly, and a look-alike of it is rejected quickly', (_label, id) => {
    const registry = createClaimsRegistry();
    expect(register(id, registry)).toBeLessThan(1_000);
    const lookAlike = id + '\u200b';
    const elapsed = timed(() => {
      expect(() => {
        registry.registerClaim(claim({ id: lookAlike }));
      }).toThrow(/looks the same/);
    });
    expect(elapsed).toBeLessThan(1_000);
  });

  it('builds the look-alike error for long ids quickly', () => {
    const registry = createClaimsRegistry();
    registry.registerClaim(claim({ id: 'a' + ' '.repeat(40_000) + 'b' }));
    expect(
      timed(() => {
        expect(() => {
          registry.registerClaim(claim({ id: 'a' + ' '.repeat(40_000) + 'b\u200b' }));
        }).toThrow(/looks the same/);
      }),
    ).toBeLessThan(1_000);
  });

  it('generateClaimsReport validates and formats a 40,000-space id quickly', () => {
    const id = 'a' + ' '.repeat(40_000) + 'b';
    expect(
      timed(() => {
        const report = generateClaimsReport([claim({ id })], 90, NOW);
        expect(report.counts.total).toBe(1);
      }),
    ).toBeLessThan(1_000);
  });

  it.each([
    ['a placeholder with a 200,000-space inner run', 'see' + ' '.repeat(200_000) + 'above', 'unverified'],
    ['a placeholder padded by alternating spaces and zero-width spaces', 'TODO' + ' \u200b'.repeat(100_000), 'unverified'],
    ['a placeholder with invisible characters at both ends', '\u200b'.repeat(200_000) + 'tbd' + '\u200b'.repeat(200_000), 'unverified'],
    ['a real reference with a 200,000-space inner run', 'docs' + ' '.repeat(200_000) + 'a.md', 'current'],
    ['a real reference after a long whitespace and invisible run', ' \u200b'.repeat(100_000) + 'docs/a.md', 'current'],
    ['a real reference with many mixed invisible characters', 'docs' + '\u00ad\t\u2003'.repeat(100_000) + 'a.md', 'current'],
    ['a 5,000,000-character reference of one repeated letter', 'x'.repeat(5_000_000), 'current'],
    ['a 5,000,000-character run of spaces then a placeholder', ' '.repeat(5_000_000) + 'none', 'unverified'],
    ['a long run of hyphens (not the single-dash placeholder)', '-'.repeat(1_000_000), 'current'],
  ])('judges %s quickly', (_label, evidenceRef, expected) => {
    let status = '';
    const elapsed = timed(() => {
      status = evaluateClaim(looseClaim({ evidenceRef }), 90, NOW).status;
    });
    expect(status).toBe(expected);
    expect(elapsed).toBeLessThan(2_000);
  });

  it('judges a configured placeholder list with long entries quickly', () => {
    const options = { placeholderRefs: ['x' + ' '.repeat(100_000) + 'y', ' \u200b'.repeat(100_000)] };
    const elapsed = timed(() => {
      expect(evaluateClaim(looseClaim({ evidenceRef: 'x y' }), 90, NOW, options).status).toBe('unverified');
    });
    expect(elapsed).toBeLessThan(2_000);
  });
});
