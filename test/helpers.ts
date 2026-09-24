import type { Claim } from '../src/index.js';

// The suite deliberately avoids a @types/node dependency; this is the one
// Node global it needs (to switch the process time zone in tests).
declare const process: { env: Record<string, string | undefined> };

/** Fixed clock used across the suite. Every test injects it; none mocks globals. */
export const NOW = new Date('2026-08-02T00:00:00.000Z');

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** A claim that is present, linked, and verified on the given ISO string. */
export function claim(overrides: Partial<Claim> = {}): Claim {
  return {
    id: 'c1',
    text: 'Changes sync across your team in real time',
    evidenceRef: 'src/sync/broadcast.ts',
    verifiedAt: '2026-07-20',
    ...overrides,
  };
}

/**
 * Build a claim with fields the types would reject (undefined, wrong type),
 * the way a JSON file or a JavaScript caller could hand one in.
 */
export function looseClaim(overrides: Record<string, unknown>): Claim {
  return Object.assign(claim(), overrides);
}

/** Recursively freeze so any in-place write throws under ESM strict mode. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/**
 * Run `fn` with the process time zone set to `tz`, then restore it. Used to
 * prove results do not depend on the machine's zone or its DST rules.
 */
export function withTimeZone<T>(tz: string, fn: () => T): T {
  const previous = process.env.TZ;
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}
