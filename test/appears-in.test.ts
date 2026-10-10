import { describe, expect, it } from 'vitest';
import {
  assertAppearsIn,
  checkAppearsIn,
  createClaimsRegistry,
  type AppearsInVerdict,
  type Claim,
} from '../src/index.js';
import { NOW, claim } from './helpers.js';

// Verdict table for "does this published text show the registered wording?".
// Each row is one input and the verdict it must get. Rules pinned here:
//   - present: the claim's current text is in the page (after NFKC, folded
//     whitespace/quotes/dashes, invisible characters dropped), on word boundaries.
//   - stale: the wording is on the page but the registry no longer calls the
//     claim current. Showing it is the problem.
//   - missing: not on the page (or only inside a longer word or number).
//   - unknown-id: no claim registered under exactly that id.

const OPTS = { maxAgeDays: 90, now: NOW };

function registryWith(...claims: Claim[]) {
  const registry = createClaimsRegistry();
  for (const c of claims) registry.registerClaim(c);
  return registry;
}

function verdictOf(
  text: string,
  claimText: string,
  extra: Partial<Claim> = {},
  options: Record<string, unknown> = {},
): AppearsInVerdict {
  const registry = registryWith(claim({ id: 'c', text: claimText, ...extra }));
  const result = checkAppearsIn(registry, text, ['c'], { ...OPTS, ...options });
  return result.results[0].verdict;
}

interface Row {
  name: string;
  text: string;
  claimText: string;
  expected: AppearsInVerdict;
  claimExtra?: Partial<Claim>;
  options?: Record<string, unknown>;
}

const rows: Row[] = [
  { name: 'exact text on the page', text: 'Pricing: Up to 20% off for teams. Cancel anytime.', claimText: 'Up to 20% off for teams', expected: 'present' },
  { name: 'present but the claim is stale (verified long ago)', text: 'Up to 20% off for teams', claimText: 'Up to 20% off for teams', claimExtra: { verifiedAt: '2025-01-01' }, expected: 'stale' },
  { name: 'present but the claim has no evidence (unverified)', text: 'Up to 20% off for teams', claimText: 'Up to 20% off for teams', claimExtra: { evidenceRef: 'TODO' }, expected: 'stale' },
  { name: 'text absent', text: 'Welcome to our pricing page.', claimText: 'Up to 20% off for teams', expected: 'missing' },
  { name: 'stale and absent is missing (nothing is shown)', text: 'Nothing here', claimText: 'Up to 20% off for teams', claimExtra: { verifiedAt: '2025-01-01' }, expected: 'missing' },
  { name: 'page text in NFD, claim in NFC', text: 'Café included'.normalize('NFD'), claimText: 'Café included', expected: 'present' },
  { name: 'claim in NFD, page in NFC', text: 'Café included', claimText: 'Café included', expected: 'present' },
  { name: 'claim split by a line break', text: 'Up to 20% off\nfor teams', claimText: 'Up to 20% off for teams', expected: 'present' },
  { name: 'claim split by a tab and CRLF', text: 'Up to 20%\r\n\toff   for teams', claimText: 'Up to 20% off for teams', expected: 'present' },
  { name: 'extra spaces and a no-break space', text: 'Up  to 20% off for  teams', claimText: 'Up to 20% off for teams', expected: 'present' },
  { name: 'soft hyphen / zero-width space inside the page text', text: 'Up to 20% off for te­ams​', claimText: 'Up to 20% off for teams', expected: 'present' },
  { name: 'near miss: 25 instead of 20', text: 'Up to 25% off for teams', claimText: 'Up to 20% off for teams', expected: 'missing' },
  { name: 'near miss: one word dropped', text: 'Up to 20% off teams', claimText: 'Up to 20% off for teams', expected: 'missing' },
  { name: 'case differs, default is case-sensitive', text: 'UP TO 20% OFF FOR TEAMS', claimText: 'Up to 20% off for teams', expected: 'missing' },
  { name: 'case differs, ignoreCase on', text: 'UP TO 20% OFF FOR TEAMS', claimText: 'Up to 20% off for teams', options: { ignoreCase: true }, expected: 'present' },
  { name: 'curly apostrophe on the page, straight in the claim', text: 'It’s free for you', claimText: "It's free for you", expected: 'present' },
  { name: 'straight quotes on the page, curly in the claim', text: '"Free" for you', claimText: '“Free” for you', expected: 'present' },
  { name: 'en dash on the page, hyphen in the claim', text: 'Plans from $5–$10', claimText: 'Plans from $5-$10', expected: 'present' },
  { name: 'em dash on the page, minus sign in the claim', text: 'No setup — no fees', claimText: 'No setup − no fees', expected: 'present' },
  { name: 'full-width digits (NFKC)', text: 'Up to ２０% off', claimText: 'Up to 20% off', expected: 'present' },
  { name: 'inside a longer word after: "uptimes"', text: 'We report 99.9% uptimes weekly', claimText: '99.9% uptime', expected: 'missing' },
  { name: 'inside a longer word before: "xfree"', text: 'This is notfree today', claimText: 'free today', expected: 'missing' },
  { name: 'inside a longer number: 20 inside 20.5', text: 'Save up to 20.5% today', claimText: 'Save up to 20', expected: 'missing' },
  { name: 'inside a longer number: 20 inside 120', text: 'Save 120', claimText: '20', expected: 'missing' },
  { name: 'inside a longer number: 20 inside 1.20', text: 'Costs 1.20', claimText: '20', expected: 'missing' },
  { name: 'at a sentence end: "20." is not a longer number', text: 'You save up to 20. Enjoy.', claimText: 'You save up to 20', expected: 'present' },
  { name: 'next to punctuation is a boundary', text: '(Free for teams),', claimText: 'Free for teams', expected: 'present' },
  { name: 'claim that ends in a symbol needs no trailing boundary', text: 'Up to 20%off', claimText: 'Up to 20%', expected: 'present' },
  { name: 'later occurrence is valid after a bad one', text: 'xfree for teams, then free for teams', claimText: 'free for teams', expected: 'present' },
  { name: 'astral letter before the claim is a word character', text: '\u{1d41a}free', claimText: 'free', expected: 'missing' },
  { name: 'self-hunt: 20 inside 20,000', text: 'Save 20,000 today', claimText: 'Save 20', expected: 'missing' },
  { name: 'self-hunt: 20 before a comma and space', text: 'Save 20, then 30', claimText: 'Save 20', expected: 'present' },
  { name: 'self-hunt: 20% inside 120%', text: 'Save 120% today', claimText: '20% today', expected: 'missing' },
  { name: 'self-hunt: ligature on the page (NFKC)', text: 'Our \ufb01rst plan is free', claimText: 'Our first plan is free', expected: 'present' },
  { name: 'self-hunt: Turkish dotted capital I, ignoreCase', text: 'B\u0130G SAVINGS', claimText: 'big savings', options: { ignoreCase: true }, expected: 'missing' },
  { name: 'self-hunt: ignoreCase keeps word boundaries', text: 'UPTIMES', claimText: 'uptime', options: { ignoreCase: true }, expected: 'missing' },
  { name: 'self-hunt: negation is not understood (documented limit)', text: 'We do not offer free trials', claimText: 'free trials', expected: 'present' },
  { name: 'self-hunt: tags between words are not folded (HTML-free input only)', text: 'Free <b>for</b> teams', claimText: 'Free for teams', expected: 'missing' },
  { name: 'blank claim text never matches', text: 'anything', claimText: '   ', expected: 'missing' },
  { name: 'zero-width-only claim text never matches', text: 'anything', claimText: '​​', expected: 'missing' },
  { name: 'empty page text', text: '', claimText: 'Free for teams', expected: 'missing' },
];

describe('verdict table: appearsIn', () => {
  for (const row of rows) {
    it(row.name, () => {
      expect(verdictOf(row.text, row.claimText, row.claimExtra, row.options)).toBe(row.expected);
    });
  }

  it('claimStatus is reported next to the verdict', () => {
    const registry = registryWith(
      claim({ id: 'a', text: 'Alpha wording' }),
      claim({ id: 'b', text: 'Beta wording', verifiedAt: '2025-01-01' }),
      claim({ id: 'u', text: 'Gamma wording', evidenceRef: '' }),
    );
    const r = checkAppearsIn(registry, 'Alpha wording. Beta wording. Gamma wording.', ['a', 'b', 'u'], OPTS);
    expect(r.results).toEqual([
      { id: 'a', verdict: 'present', claimStatus: 'current' },
      { id: 'b', verdict: 'stale', claimStatus: 'stale' },
      { id: 'u', verdict: 'stale', claimStatus: 'unverified' },
    ]);
    expect(r.ok).toBe(false);
  });
});

describe('verdict table: ids', () => {
  const registry = registryWith(claim({ id: 'sync', text: 'Changes sync in real time' }));
  const page = 'Changes sync in real time';

  it('unknown id', () => {
    const r = checkAppearsIn(registry, page, ['nope'], OPTS);
    expect(r.results).toEqual([{ id: 'nope', verdict: 'unknown-id' }]);
    expect(r.ok).toBe(false);
  });

  it('look-alike ids are unknown, never matched to the registered claim', () => {
    for (const id of ['sync ', ' sync', 'sync​', 'Sync', 'sуnc' /* Cyrillic у */, 'synć']) {
      expect(checkAppearsIn(registry, page, [id], OPTS).results[0].verdict).toBe('unknown-id');
    }
  });

  it('inherited object keys are not claims', () => {
    for (const id of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(checkAppearsIn(registry, page, [id], OPTS).results[0].verdict).toBe('unknown-id');
    }
  });

  it('ok is true only when every claim is present', () => {
    expect(checkAppearsIn(registry, page, ['sync'], OPTS).ok).toBe(true);
    expect(checkAppearsIn(registry, page, ['sync', 'nope'], OPTS).ok).toBe(false);
  });

  it('duplicate ids give one result, in first-seen order', () => {
    const r = checkAppearsIn(registry, page, ['sync', 'nope', 'sync'], OPTS);
    expect(r.results.map((x) => x.id)).toEqual(['sync', 'nope']);
  });

  it('an empty id list throws instead of passing', () => {
    expect(() => checkAppearsIn(registry, page, [], OPTS)).toThrow(RangeError);
    expect(() => assertAppearsIn(registry, page, [], OPTS)).toThrow(RangeError);
  });
});

describe('assertAppearsIn', () => {
  const registry = registryWith(
    claim({ id: 'ok', text: 'Free for teams' }),
    claim({ id: 'old', text: 'Hosted in the US', verifiedAt: '2025-01-01' }),
    claim({ id: 'gone', text: 'Cancel anytime' }),
  );
  const page = 'Free for teams. Hosted in the US.';

  it('returns the result when everything is present', () => {
    expect(assertAppearsIn(registry, page, ['ok'], OPTS).ok).toBe(true);
  });

  it('throws an Error that lists each failing claim and why', () => {
    let message = '';
    try {
      assertAppearsIn(registry, page, ['ok', 'old', 'gone', 'nope'], OPTS);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      message = (error as Error).message;
    }
    expect(message).toContain('"old" (stale)');
    expect(message).toContain('"gone" (missing)');
    expect(message).toContain('"nope" (unknown-id)');
    expect(message).not.toContain('"ok"');
  });

  it('escapes control characters in ids and caps a long list', () => {
    const ids = Array.from({ length: 50 }, (_, i) => `x\u001b${String(i)}`);
    let message = '';
    try {
      assertAppearsIn(registry, page, ids, OPTS);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toContain('\u001b');
    expect(message).toContain('\\u001b');
    expect(message).toContain('and 30 more');
  });
});

describe('argument checks', () => {
  const registry = registryWith(claim({ id: 'a', text: 'Alpha' }));
  it('requires maxAgeDays', () => {
    expect(() => checkAppearsIn(registry, 'Alpha', ['a'], {} as never)).toThrow(TypeError);
    expect(() => checkAppearsIn(registry, 'Alpha', ['a'], { maxAgeDays: -1 })).toThrow(RangeError);
    expect(() => checkAppearsIn(registry, 'Alpha', ['a'], { maxAgeDays: Number.NaN })).toThrow(RangeError);
    expect(() => checkAppearsIn(registry, 'Alpha', ['a'], undefined as never)).toThrow(TypeError);
  });
  it('rejects a bad now, text, ids and registry', () => {
    expect(() => checkAppearsIn(registry, 'Alpha', ['a'], { maxAgeDays: 1, now: new Date('x') })).toThrow(RangeError);
    expect(() => checkAppearsIn(registry, 5 as never, ['a'], OPTS)).toThrow(TypeError);
    expect(() => checkAppearsIn(registry, 'Alpha', 'a' as never, OPTS)).toThrow(TypeError);
    expect(() => checkAppearsIn(registry, 'Alpha', [5 as never], OPTS)).toThrow(TypeError);
    expect(() => checkAppearsIn({} as never, 'Alpha', ['a'], OPTS)).toThrow(TypeError);
    expect(() => checkAppearsIn(null as never, 'Alpha', ['a'], OPTS)).toThrow(TypeError);
  });
  it('rejects a non-boolean ignoreCase', () => {
    expect(() => checkAppearsIn(registry, 'Alpha', ['a'], { ...OPTS, ignoreCase: 'yes' as never })).toThrow(TypeError);
  });
  it('honors placeholderRefs like the other checks', () => {
    const r = registryWith(claim({ id: 'p', text: 'Alpha', evidenceRef: 'pending' }));
    expect(checkAppearsIn(r, 'Alpha', ['p'], OPTS).results[0].verdict).toBe('present');
    expect(checkAppearsIn(r, 'Alpha', ['p'], { ...OPTS, placeholderRefs: ['pending'] }).results[0].verdict).toBe('stale');
  });
});

describe('hostile inputs', () => {
  it('a registry entry that is a Proxy is read through, text once', () => {
    let reads = 0;
    const target = claim({ id: 'p', text: 'Free for teams' });
    const proxy = new Proxy(target, {
      get(t, key, receiver) {
        if (key === 'text') reads += 1;
        return Reflect.get(t, key, receiver) as unknown;
      },
    });
    const fake = { getClaim: () => proxy };
    expect(checkAppearsIn(fake, 'Free for teams', ['p'], OPTS).results[0].verdict).toBe('present');
    expect(reads).toBe(1);
  });

  it('a getter for text is read once per id', () => {
    let reads = 0;
    const entry = claim({ id: 'g' });
    Object.defineProperty(entry, 'text', {
      enumerable: true,
      get() {
        reads += 1;
        return reads === 1 ? 'Free for teams' : 'something else';
      },
    });
    const fake = { getClaim: () => entry };
    expect(checkAppearsIn(fake, 'Free for teams', ['g'], OPTS).results[0].verdict).toBe('present');
    expect(reads).toBe(1);
  });

  it('a registry entry whose trap throws propagates that error', () => {
    const proxy = new Proxy(claim(), {
      ownKeys() {
        throw new Error('boom');
      },
    });
    expect(() => checkAppearsIn({ getClaim: () => proxy }, 'x', ['p'], OPTS)).toThrow('boom');
  });

  it('a registry entry that is not a plain object is a TypeError', () => {
    for (const bad of [new Map(), [], new Date(), 'text', 5]) {
      expect(() => checkAppearsIn({ getClaim: () => bad as never }, 'x', ['p'], OPTS)).toThrow(TypeError);
    }
  });

  it('claim text that is not a string never matches', () => {
    for (const text of [undefined, null, 5, {}, ['Free']]) {
      const fake = { getClaim: () => claim({ id: 'p', text: text as never }) };
      expect(checkAppearsIn(fake, 'Free 5 [object Object] null undefined', ['p'], OPTS).results[0].verdict).toBe('missing');
    }
  });

  it('an own toJSON or then on the claim is never called', () => {
    const entry = Object.assign(claim({ id: 'p', text: 'Free' }), {
      toJSON() { throw new Error('toJSON called'); },
      then() { throw new Error('then called'); },
    });
    expect(checkAppearsIn({ getClaim: () => entry }, 'Free', ['p'], OPTS).results[0].verdict).toBe('present');
  });

  it('a null-prototype claim and a lone-surrogate page both work', () => {
    const entry = Object.assign(Object.create(null) as Record<string, unknown>, claim({ id: 'p', text: 'Free' }));
    const r = checkAppearsIn({ getClaim: () => entry as unknown as Claim }, 'x\ud800 Free \udc00y', ['p'], OPTS);
    expect(r.results[0].verdict).toBe('present');
  });

  it('a needle never matches half of a surrogate pair', () => {
    const fake = { getClaim: () => claim({ id: 'p', text: '\ude00' }) };
    expect(checkAppearsIn(fake, 'a \u{1f600} b', ['p'], OPTS).results[0].verdict).toBe('missing');
  });

  it('a sparse or huge id list is walked by index, never spread', () => {
    const registry = registryWith(claim({ id: 'a', text: 'Alpha' }));
    const sparse = new Array<string>(3);
    sparse[0] = 'a';
    expect(() => checkAppearsIn(registry, 'Alpha', sparse, OPTS)).toThrow(TypeError);
    const ids = new Array<string>(200_000).fill('a');
    expect(checkAppearsIn(registry, 'Alpha', ids, OPTS).results).toHaveLength(1);
  });

  it('does not mutate its inputs', () => {
    const registry = registryWith(claim({ id: 'a', text: 'Alpha' }));
    const ids = Object.freeze(['a']);
    expect(checkAppearsIn(registry, 'Alpha', ids, Object.freeze({ ...OPTS })).ok).toBe(true);
  });
});

// CPU time, so a busy machine does not skew the ratio.
declare const process: { cpuUsage(): { user: number; system: number } };
function cpuMs<T>(fn: () => T): { value: T; ms: number } {
  const before = process.cpuUsage();
  const value = fn();
  const after = process.cpuUsage();
  return { value, ms: (after.user - before.user + (after.system - before.system)) / 1000 };
}

describe('scaling', () => {
  it('1 MB of text with a worst-case needle for naive search', () => {
    const needle = `${'a'.repeat(2000)}b`;
    const registry = registryWith(claim({ id: 'w', text: needle }));
    const page = 'a'.repeat(1_000_000);
    const { value, ms } = cpuMs(() => checkAppearsIn(registry, page, ['w'], OPTS));
    expect(value.results[0].verdict).toBe('missing');
    expect(ms).toBeLessThan(3000);
  });

  it('time grows linearly with text length (20k vs 80k vs 1M)', () => {
    const registry = registryWith(claim({ id: 'w', text: `${'ab '.repeat(300)}end` }));
    const make = (n: number) => 'ab '.repeat(Math.floor(n / 3));
    checkAppearsIn(registry, make(20_000), ['w'], OPTS); // warm up
    const small = cpuMs(() => { for (let i = 0; i < 20; i += 1) checkAppearsIn(registry, make(20_000), ['w'], OPTS); });
    const large = cpuMs(() => { for (let i = 0; i < 20; i += 1) checkAppearsIn(registry, make(80_000), ['w'], OPTS); });
    expect(large.ms / Math.max(small.ms, 1)).toBeLessThan(10);
    const big = cpuMs(() => checkAppearsIn(registry, make(1_000_000), ['w'], OPTS));
    expect(big.ms).toBeLessThan(3000);
  });

  it('whitespace runs and invisible-only text stay linear', () => {
    const registry = registryWith(claim({ id: 'w', text: 'Free for teams' }));
    const spaces = ` ${' '.repeat(1_000_000)}x`;
    const invisibles = '​'.repeat(1_000_000);
    expect(cpuMs(() => checkAppearsIn(registry, spaces, ['w'], OPTS)).ms).toBeLessThan(3000);
    expect(cpuMs(() => checkAppearsIn(registry, invisibles, ['w'], OPTS)).ms).toBeLessThan(3000);
  });

  it('10,000 claim ids against 1 MB of text', () => {
    const registry = createClaimsRegistry();
    const ids: string[] = [];
    const parts: string[] = [];
    for (let i = 0; i < 10_000; i += 1) {
      const id = `claim-${String(i)}`;
      ids.push(id);
      registry.registerClaim(claim({ id, text: `Claim number ${String(i)} is stated here` }));
      if (i % 2 === 0) parts.push(`Claim number ${String(i)} is stated here.`);
    }
    const page = parts.join('\n').padEnd(1_000_000, ' filler');
    const { value, ms } = cpuMs(() => checkAppearsIn(registry, page, ids, OPTS));
    expect(value.results).toHaveLength(10_000);
    expect(value.results.filter((r) => r.verdict === 'present')).toHaveLength(5_000);
    expect(value.results.filter((r) => r.verdict === 'missing')).toHaveLength(5_000);
    expect(value.results[0].verdict).toBe('present');
    expect(value.results[1].verdict).toBe('missing');
    expect(ms).toBeLessThan(5000);
  });

  it('many nested claim texts do not blow up (a, aa, aaa ...); only the whole word matches', () => {
    const registry = createClaimsRegistry();
    const ids: string[] = [];
    for (let i = 1; i <= 300; i += 1) {
      registry.registerClaim(claim({ id: `n${String(i)}`, text: 'a'.repeat(i) }));
      ids.push(`n${String(i)}`);
    }
    const r = cpuMs(() => checkAppearsIn(registry, `${'a'.repeat(200)}`, ids, OPTS));
    expect(r.value.results.filter((x) => x.verdict === 'present').map((x) => x.id)).toEqual(['n200']);
    expect(r.ms).toBeLessThan(2000);
  });
});

describe('review round: verdict rows', () => {
  const registry = registryWith(claim({ id: 'a', text: 'Alpha' }));

  it('R1: an explicit now of null, a string or a number throws like evaluateClaim', () => {
    for (const now of [null, 'x', 5]) {
      expect(() => checkAppearsIn(registry, 'Alpha', ['a'], { maxAgeDays: 1, now: now as never })).toThrow(TypeError);
    }
    expect(checkAppearsIn(registry, 'Alpha', ['a'], { maxAgeDays: 100000, now: undefined }).ok).toBe(true);
  });

  it('R2: placeholderRefs entries are read once, not once per claim', () => {
    const r = registryWith(
      claim({ id: 'p1', text: 'One', evidenceRef: 'pending' }),
      claim({ id: 'p2', text: 'Two', evidenceRef: 'pending' }),
    );
    let reads = 0;
    const refs = new Proxy(['pending'], {
      get(t, key, receiver) {
        if (key === '0') {
          reads += 1;
          return reads === 1 ? 'pending' : 'unused';
        }
        return Reflect.get(t, key, receiver) as unknown;
      },
    });
    const out = checkAppearsIn(r, 'One Two', ['p1', 'p2'], { ...OPTS, placeholderRefs: refs });
    expect(out.results.map((x) => x.verdict)).toEqual(['stale', 'stale']);
  });

  it('R3: an id list whose length is negative, NaN or undefined throws', () => {
    for (const bad of [-1, Number.NaN, undefined, 1.5, Infinity]) {
      const ids = new Proxy(['a'], {
        get(t, key, receiver) {
          if (key === 'length') return bad;
          return Reflect.get(t, key, receiver) as unknown;
        },
      });
      expect(() => checkAppearsIn(registry, 'Alpha', ids, OPTS)).toThrow();
      expect(() => assertAppearsIn(registry, 'Alpha', ids, OPTS)).toThrow();
    }
  });

  it('R5: control-only claim text is missing', () => {
    for (const t of ['\u0000', '\u0001\u0002', '\u007f', '\u0000 ​']) {
      const fake = { getClaim: () => claim({ id: 'p', text: t }) };
      expect(checkAppearsIn(fake, `x ${t} y`, ['p'], OPTS).results[0].verdict).toBe('missing');
    }
  });

  it('R6: an invisible character between a letter and its combining mark', () => {
    expect(verdictOf('Cafe​́ included', 'Café included')).toBe('present');
    expect(verdictOf('Café included', 'Cafe​́ included')).toBe('present');
    expect(verdictOf('Cafe­́ included', 'Café included')).toBe('present');
  });
});

describe('review round: nested claims scale linearly', () => {
  function nested(count: number, sep: string) {
    const registry = createClaimsRegistry();
    const ids: string[] = [];
    for (let i = 1; i <= count; i += 1) {
      registry.registerClaim(claim({ id: `n${String(i)}`, text: Array.from({ length: i }, () => 'a').join(sep) }));
      ids.push(`n${String(i)}`);
    }
    return { registry, ids };
  }

  it('600 nested claims against a long uninterrupted run (100k and 400k)', () => {
    const { registry, ids } = nested(600, '');
    const small = cpuMs(() => checkAppearsIn(registry, 'a'.repeat(100_000), ids, OPTS));
    const large = cpuMs(() => checkAppearsIn(registry, 'a'.repeat(400_000), ids, OPTS));
    expect(small.ms).toBeLessThan(1500);
    expect(large.ms).toBeLessThan(3000);
    expect(small.value.results.filter((x) => x.verdict === 'present')).toHaveLength(0);
  });

  it('600 nested space-separated claims against "a a a ..." (100k)', () => {
    const { registry, ids } = nested(600, ' ');
    const page = 'a '.repeat(50_000);
    const { value, ms } = cpuMs(() => checkAppearsIn(registry, page, ids, OPTS));
    expect(ms).toBeLessThan(1500);
    expect(value.results.every((x) => x.verdict === 'present')).toBe(true);
  });
});
