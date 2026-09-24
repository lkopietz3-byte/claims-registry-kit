import type { Claim } from '../src/index.js';

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
