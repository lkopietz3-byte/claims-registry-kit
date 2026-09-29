import { describe, expect, it } from 'vitest';
import {
  checkEvidenceLinked,
  checkStaleness,
  createClaimsRegistry,
  evaluateClaim,
  generateClaimsReport,
  type Claim,
} from '../src/index.js';
import { NOW, claim, looseClaim } from './helpers.js';

// Input-handling classes from the audit sweep: caller input read more than
// once, non-plain objects read as empty, blank identity, holes, and error
// messages that must never throw or print raw control characters.

/** A claim whose named field is a getter that counts how often it is read. */
function countingClaim(
  field: 'id' | 'evidenceRef' | 'verifiedAt' | 'text',
  values: readonly unknown[],
): { claim: Claim; reads: () => number } {
  let reads = 0;
  const base = claim();
  const target: Record<string, unknown> = { ...base };
  Object.defineProperty(target, field, {
    enumerable: true,
    configurable: true,
    get() {
      const value = values[Math.min(reads, values.length - 1)];
      reads += 1;
      return value;
    },
  });
  return { claim: target as unknown as Claim, reads: () => reads };
}

describe('caller input is read once (class 1)', () => {
  it('evaluateClaim reads evidenceRef and verifiedAt once and returns what it judged', () => {
    const evidence = countingClaim('evidenceRef', ['', 'src/late.ts']);
    const result = evaluateClaim(evidence.claim, 90, NOW);
    expect(evidence.reads()).toBe(1);
    // The status was decided from the value that is returned, not a later one.
    expect(result.evidenceRef).toBe('');
    expect(result.status).toBe('unverified');

    const date = countingClaim('verifiedAt', ['2026-07-20', '2020-01-01']);
    const dated = evaluateClaim(date.claim, 90, NOW);
    expect(date.reads()).toBe(1);
    expect(dated.verifiedAt).toBe('2026-07-20');
    expect(dated.status).toBe('current');
  });

  it('checkStaleness and checkEvidenceLinked read each field once', () => {
    const a = countingClaim('evidenceRef', ['', 'x']);
    expect(checkEvidenceLinked([a.claim], NOW).map((c) => c.evidenceRef)).toEqual(['']);
    expect(a.reads()).toBe(1);

    const b = countingClaim('verifiedAt', ['2020-01-01', '2026-08-01']);
    expect(checkStaleness([b.claim], 90, NOW).map((c) => c.verifiedAt)).toEqual(['2020-01-01']);
    expect(b.reads()).toBe(1);
  });

  it('generateClaimsReport validates and returns the same id, read once', () => {
    const named = countingClaim('id', ['first-id', '', 42]);
    const report = generateClaimsReport([named.claim], 90, NOW);
    expect(named.reads()).toBe(1);
    expect(report.current[0]?.id).toBe('first-id');
  });

  it('a claim whose id changes after the first read cannot be validated as one id and reported as another', () => {
    const named = countingClaim('id', ['ok', undefined]);
    const report = generateClaimsReport([named.claim], 90, NOW);
    expect(report.counts.total).toBe(1);
    expect(report.current[0]?.id).toBe('ok');
  });

  it('a claims array that changes after it was validated cannot smuggle in a bad entry', () => {
    const good = claim({ id: 'good' });
    const reads: Record<string, number> = {};
    const flaky = new Proxy([good], {
      get(target, key, receiver) {
        const name = String(key);
        reads[name] = (reads[name] ?? 0) + 1;
        if (key === '0' && reads[name] > 1) return null; // the second read would be invalid
        return Reflect.get(target, key, receiver) as unknown;
      },
    });
    const report = generateClaimsReport(flaky, 90, NOW);
    expect(report.current.map((c) => c.id)).toEqual(['good']);
    expect(reads['0']).toBe(1);
    expect(reads['length']).toBe(1);
  });

  it('the clock is read once through the Date intrinsics, not through overridable methods', () => {
    class LyingDate extends Date {
      override getTime(): number {
        return 0;
      }
      override toISOString(): string {
        return 'not-a-timestamp';
      }
    }
    const lying = new LyingDate(NOW.getTime());
    // 13 days old at NOW; a clock read through getTime() would say 20,000+ days.
    const result = evaluateClaim(claim({ verifiedAt: '2026-07-20' }), 90, lying);
    expect(result.ageDays).toBe(13);
    expect(generateClaimsReport([claim()], 90, lying).generatedAt).toBe(NOW.toISOString());
  });

  it('an object that only claims to be a Date is rejected (Symbol.toStringTag spoof)', () => {
    const spoof = { [Symbol.toStringTag]: 'Date', getTime: () => 0, toISOString: () => 'x' };
    expect(() => evaluateClaim(claim(), 90, spoof as unknown as Date)).toThrow(TypeError);
    expect(() => generateClaimsReport([claim()], 90, spoof as unknown as Date)).toThrow(/now/);
  });

  it('a Date from another realm is accepted', async () => {
    const vm = await import('node:vm');
    const foreign = vm.runInNewContext('new Date(1785628800000)') as Date; // 2026-08-02T00:00:00Z
    expect(foreign instanceof Date).toBe(false);
    expect(evaluateClaim(claim({ verifiedAt: '2026-07-20' }), 90, foreign).ageDays).toBe(13);
  });

  it('the registry stores a claim under the id it validated', () => {
    const registry = createClaimsRegistry();
    let n = 0;
    const flaky = {
      ...claim(),
      get id(): string {
        n += 1;
        return `id-${String(n)}`;
      },
    };
    registry.registerClaim(flaky);
    const [stored] = registry.getClaims();
    expect(stored?.id).toBe('id-1');
    expect(registry.getClaim('id-1')?.id).toBe('id-1');
    expect(n).toBe(1);
  });
});

describe('only plain objects are accepted as claims (class 6)', () => {
  class Instance {
    id = 'c1';
    text = 't';
    evidenceRef = 'x';
    verifiedAt = '2026-07-20';
  }

  const nonPlain: [string, unknown][] = [
    ['a Map', new Map([['id', 'c1']])],
    ['a Set', new Set()],
    ['a Date', new Date(NOW.getTime())],
    ['a RegExp', /c1/u],
    ['an array', [claim()]],
    ['a class instance with all the right fields', new Instance()],
    ['a boxed String', new String('c1')],
    ['a boxed Number', new Number(1)],
    ['a WeakMap', new WeakMap()],
    ['a Promise', Promise.resolve(claim())],
    ['an Error', new Error('c1')],
  ];

  it.each(nonPlain)('rejects %s, in every entry point', (_label, bad) => {
    const notAClaim = bad as Claim;
    expect(() => evaluateClaim(notAClaim, 90, NOW)).toThrow(TypeError);
    expect(() => evaluateClaim(notAClaim, 90, NOW)).toThrow(/claim must be an object/);
    expect(() => checkStaleness([claim(), notAClaim], 90, NOW)).toThrow(/claims\[1\] must be an object/);
    expect(() => checkEvidenceLinked([notAClaim], NOW)).toThrow(TypeError);
    expect(() => generateClaimsReport([notAClaim], 90, NOW)).toThrow(TypeError);
    expect(() => createClaimsRegistry().registerClaim(notAClaim)).toThrow(TypeError);
  });

  it('names what it received', () => {
    expect(() => evaluateClaim([] as unknown as Claim, 90, NOW)).toThrow(/received an array/);
    expect(() => evaluateClaim(new Map() as unknown as Claim, 90, NOW)).toThrow(
      /received a non-plain object/,
    );
  });

  it('accepts a null-prototype object and a plain object from Object.create(Object.prototype)', () => {
    const bare = Object.assign(Object.create(null) as Record<string, unknown>, claim());
    expect(evaluateClaim(bare as unknown as Claim, 90, NOW).status).toBe('current');
    expect(generateClaimsReport([bare as unknown as Claim], 90, NOW).counts.current).toBe(1);
    const explicit = Object.assign(Object.create(Object.prototype) as Record<string, unknown>, claim());
    expect(evaluateClaim(explicit as unknown as Claim, 90, NOW).status).toBe('current');
  });

  it('accepts a plain object from another realm', async () => {
    const vm = await import('node:vm');
    const foreign = vm.runInNewContext(
      '({ id: "c1", text: "t", evidenceRef: "x", verifiedAt: "2026-07-20" })',
    ) as Claim;
    expect(Object.getPrototypeOf(foreign)).not.toBe(Object.prototype);
    expect(evaluateClaim(foreign, 90, NOW).status).toBe('current');
  });

  it('a revoked proxy is a clear TypeError, not a crash from inside the library', () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    expect(() => evaluateClaim(proxy as unknown as Claim, 90, NOW)).toThrow(/claim must be an object/);
    expect(() => checkStaleness([proxy as unknown as Claim], 90, NOW)).toThrow(/claims\[0\]/);
  });
});

describe('a blank claim id is rejected, whatever makes it blank (class 7)', () => {
  it.each([
    ['a zero-width space', '\u200b'],
    ['an isolate', '\u2066'],
    ['an Arabic letter mark', '\u061c'],
    ['a Hangul filler', '\u3164'],
    ['a variation selector', '\ufe0f'],
    ['a control character', '\u0007'],
    ['a mix of whitespace and invisibles', ' \u2067\u200e\t '],
  ])('generateClaimsReport and registerClaim reject an id that is %s', (_label, id) => {
    const bad = claim({ id });
    expect(() => generateClaimsReport([bad], 90, NOW)).toThrow(/claims\[0\]\.id must be a non-empty string/);
    const registry = createClaimsRegistry();
    expect(() => registry.registerClaim(bad)).toThrow(/claim\.id must be a non-empty string/);
    expect(registry.getClaims()).toHaveLength(0);
  });

  it('two blank-looking ids cannot both be registered as different claims', () => {
    const registry = createClaimsRegistry();
    registry.registerClaim(claim({ id: 'real' }));
    expect(() => registry.registerClaim(claim({ id: '\u200b' }))).toThrow(TypeError);
    expect(() => registry.registerClaim(claim({ id: '\u2066' }))).toThrow(TypeError);
    expect(registry.getClaims().map((c) => c.id)).toEqual(['real']);
  });

  it.each([
    ['visible Arabic', 'ادعاء-١'],
    ['Japanese', '主張-1'],
    ['an emoji', '📄'],
    ['visible text wrapped in isolates', '\u2066claim-1\u2069'],
  ])('still accepts an id that is %s', (_label, id) => {
    expect(generateClaimsReport([claim({ id })], 90, NOW).current[0]?.id).toBe(id);
    expect(() => createClaimsRegistry().registerClaim(claim({ id }))).not.toThrow();
  });
});

describe('sparse arrays are refused by one indexed pass (class 2)', () => {
  it('rejects a hole in every entry point, naming its index', () => {
    // eslint-disable-next-line no-sparse-arrays -- a hole is exactly the malformed input under test
    const holey = [claim(), , claim({ id: 'c3' })] as unknown as Claim[];
    expect(() => checkStaleness(holey, 90, NOW)).toThrow(/claims\[1\]/);
    expect(() => checkEvidenceLinked(holey, NOW)).toThrow(/claims\[1\]/);
    expect(() => generateClaimsReport(holey, 90, NOW)).toThrow(/claims\[1\]/);
  });

  it('rejects an array that is all holes, and one with a trailing hole', () => {
    expect(() => checkStaleness(new Array<Claim>(3), 90, NOW)).toThrow(/claims\[0\]/);
    const trailing = [claim()];
    trailing.length = 2;
    expect(() => checkStaleness(trailing, 90, NOW)).toThrow(/claims\[1\]/);
  });

  it('a claim with no id never matches another claim with no id', () => {
    const registry = createClaimsRegistry();
    expect(() => registry.registerClaim(looseClaim({ id: undefined }))).toThrow(TypeError);
    expect(() => registry.registerClaim(looseClaim({ id: undefined }))).toThrow(TypeError);
    expect(registry.getClaim(undefined as unknown as string)).toBeUndefined();
  });
});

describe('error messages are safe to build (class 3) and safe to print (class 8)', () => {
  it('describes a bigint, a symbol and a hostile object without throwing', () => {
    const hostile = {
      toString() {
        throw new Error('toString called');
      },
      toJSON() {
        throw new Error('toJSON called');
      },
    };
    for (const bad of [1n, Symbol('x'), hostile, () => 1]) {
      expect(() => evaluateClaim(claim(), bad as unknown as number, NOW)).toThrow(TypeError);
      expect(() => evaluateClaim(claim(), 90, bad as unknown as Date)).toThrow(/now must be a Date/);
    }
    for (const bad of [1n, Symbol('x'), () => 1]) {
      expect(() => evaluateClaim(bad as unknown as Claim, 90, NOW)).toThrow(TypeError);
    }
    expect(() => evaluateClaim(claim(), 1n as unknown as number, NOW)).toThrow(/received bigint/);
  });

  it('a bad id message does not throw for a hostile id and names the kind', () => {
    const hostile = {
      toString() {
        throw new Error('toString called');
      },
    };
    expect(() => generateClaimsReport([claim({ id: hostile as unknown as string })], 90, NOW)).toThrow(
      /claims\[0\]\.id must be a non-empty string \(received an object\)/,
    );
  });

  it('a duplicate-id error shows control characters as visible escapes', () => {
    const registry = createClaimsRegistry();
    const id = 'a\nclaims-registry-kit: FORGED\u001b[2J\u202e';
    registry.registerClaim(claim({ id }));
    let message = '';
    try {
      registry.registerClaim(claim({ id }));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe(
      'claims-registry-kit: a claim with id "a\\u000aclaims-registry-kit: FORGED\\u001b[2J\\u202e" is already registered',
    );
    for (const raw of ['\n', '\u001b', '\u202e']) expect(message).not.toContain(raw);
  });
});

describe('registry lookup is strict about its key (class 10)', () => {
  it('getClaim finds only a string id', () => {
    const registry = createClaimsRegistry();
    registry.registerClaim(claim({ id: 'c1' }));
    expect(registry.getClaim('c1')?.id).toBe('c1');
    expect(registry.getClaim(new String('c1') as unknown as string)).toBeUndefined();
    expect(registry.getClaim(['c1'] as unknown as string)).toBeUndefined();
    expect(registry.getClaim({ toString: () => 'c1' } as unknown as string)).toBeUndefined();
    expect(registry.getClaim(1 as unknown as string)).toBeUndefined();
    expect(registry.getClaim(null as unknown as string)).toBeUndefined();
  });

  it('an id such as __proto__ or constructor is an ordinary key', () => {
    const registry = createClaimsRegistry();
    expect(registry.getClaim('__proto__')).toBeUndefined();
    expect(registry.getClaim('constructor')).toBeUndefined();
    registry.registerClaim(claim({ id: '__proto__' }));
    expect(registry.getClaim('__proto__')?.id).toBe('__proto__');
    expect(registry.getClaims()).toHaveLength(1);
  });
});

describe('the registry copy is shallow (CRK-F03)', () => {
  it('a nested evidenceRef array is shared with the caller, both ways', () => {
    const registry = createClaimsRegistry<string[]>();
    const refs = ['docs/a.md'];
    registry.registerClaim({ ...claim(), evidenceRef: refs });
    refs.push('docs/b.md'); // the caller mutates the inner array it handed in
    expect(registry.getClaim('c1')?.evidenceRef).toEqual(['docs/a.md', 'docs/b.md']);
    const back = registry.getClaim('c1');
    back?.evidenceRef.pop(); // and the array handed back is the same one
    expect(refs).toEqual(['docs/a.md']);
    // Only the top level is copied: replacing a field never reaches the registry.
    if (back) back.evidenceRef = [];
    expect(registry.getClaim('c1')?.evidenceRef).toEqual(['docs/a.md']);
  });
});
