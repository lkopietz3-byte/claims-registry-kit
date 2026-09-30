// Argument checks shared by the public functions. Internal: not exported from index.ts.
//
// The rule behind every check here: a bad argument must throw, never fall
// through into date math. `x > NaN` is false, so an unchecked NaN policy or an
// Invalid Date clock would classify every claim as 'current': a review gate
// that fails open.
//
// The second rule: read caller input ONCE. A getter, a Proxy or a sparse array
// can answer differently the second time it is asked, so a claim or a claims
// list is copied a single time (`snapshotClaim`, `snapshotClaimList`) and every
// later check, computation and returned object uses that copy.

import type { Claim } from './types.js';
import { isVisiblyBlank } from './text.js';

const PREFIX = 'claims-registry-kit: ';

/**
 * Name a received value for an error message. Never calls into the value
 * (no `toString`, `toJSON` or getters), so a hostile value cannot break or
 * change the error that reports it.
 */
function describe(value: unknown): string {
  if (typeof value === 'number') return String(value);
  if (value === null) return 'null';
  if (typeof value !== 'object') return typeof value;
  try {
    if (Array.isArray(value)) return 'an array';
  } catch {
    return 'an object'; // a revoked proxy makes Array.isArray throw
  }
  return isPlainObject(value) ? 'an object' : 'a non-plain object';
}

/**
 * A claim's top-level `evidenceRef` must be `null`, `undefined` or `false` (no
 * evidence), a string, or an array. Anything else (a number, `true`, an
 * object, a function, a symbol, a bigint) is neither "no evidence" nor a
 * reference this library can read, so it must fail loudly: read as "present",
 * `evidenceRef: 0` or `NaN` would turn a claim with no evidence `'current'`.
 */
export function assertEvidenceRefType(value: unknown): void {
  if (value == null || value === false || typeof value === 'string') return;
  let isArray = false;
  try {
    isArray = Array.isArray(value);
  } catch {
    // a revoked proxy makes Array.isArray throw; fall through to the error
  }
  if (isArray) return;
  throw new TypeError(
    `${PREFIX}evidenceRef must be a string or an array of strings (null, undefined and false mean no evidence; received ${describe(value)})`,
  );
}

/** `maxAgeDays` must be a finite number >= 0. */
export function assertMaxAgeDays(value: unknown): asserts value is number {
  if (typeof value !== 'number') {
    throw new TypeError(`${PREFIX}maxAgeDays must be a number (received ${describe(value)})`);
  }
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(
      `${PREFIX}maxAgeDays must be a finite number >= 0 (received ${String(value)})`,
    );
  }
}

/**
 * Read `now` once, through the `Date` intrinsics, and return epoch
 * milliseconds. A Date subclass that overrides `getTime`, an object that
 * fakes `Symbol.toStringTag`, or a Date-like from anywhere else cannot change
 * the answer between reads: only a real Date (including one from another
 * realm) is accepted, and an Invalid Date is rejected.
 */
export function readNow(value: unknown): number {
  let ms: number;
  try {
    ms = Date.prototype.getTime.call(value);
  } catch {
    throw new TypeError(`${PREFIX}now must be a Date (received ${describe(value)})`);
  }
  if (Number.isNaN(ms)) {
    throw new RangeError(`${PREFIX}now must be a valid Date (received an Invalid Date)`);
  }
  return ms;
}

/** A plain object or a null-prototype object: not an array, Map, Set, Date, RegExp or class instance. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  try {
    if (typeof value !== 'object' || value === null) return false;
    const proto: unknown = Object.getPrototypeOf(value);
    // `Object.getPrototypeOf(proto) === null` also accepts Object.prototype
    // from another realm, whose identity differs from ours.
    return proto === null || Object.getPrototypeOf(proto) === null;
  } catch {
    return false; // a revoked proxy throws here
  }
}

/**
 * Copy one claim, once. It must be a plain or null-prototype object: a Map,
 * Date, array or class instance would otherwise be spread into `{}` and read
 * as a claim with no fields. `label` names it in the message.
 */
export function snapshotClaim<EvidenceRef>(value: unknown, label: string): Claim<EvidenceRef> {
  if (!isPlainObject(value)) {
    throw new TypeError(
      `${PREFIX}${label} must be an object (a plain or null-prototype object; received ${describe(value)})`,
    );
  }
  return { ...value } as unknown as Claim<EvidenceRef>;
}

/**
 * Copy a claims list in ONE indexed pass, refusing a non-array, a hole and any
 * entry that is not a plain claim object. Validation and later processing
 * both use the returned dense copy, so a sparse array (skipped by `map`,
 * visited by `for...of`) or a Proxy cannot be validated one way and processed
 * another. Each entry and the length are read exactly once.
 */
export function snapshotClaimList<EvidenceRef>(value: unknown): Claim<EvidenceRef>[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${PREFIX}claims must be an array (received ${describe(value)})`);
  }
  const length = (value as unknown[]).length;
  const copy: Claim<EvidenceRef>[] = [];
  for (let i = 0; i < length; i += 1) {
    copy.push(snapshotClaim<EvidenceRef>((value as unknown[])[i], `claims[${String(i)}]`));
  }
  return copy;
}

/**
 * A claim's `id` must be a string that shows something: not empty, not
 * whitespace only, and not made only of invisible characters (zero-width
 * spaces, bidi controls, ...). `label` names the offending claim in the
 * message.
 *
 * `id` is how a caller finds "the same claim" again across runs (the
 * registry's duplicate-detection key, and what a report's text output names
 * a stale/unverified claim by). A missing or blank id isn't a smaller
 * version of a valid claim; it's a claim this library can never point back
 * to, so it must be rejected rather than silently accepted with a blank or
 * `undefined` label.
 */
export function assertClaimId(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string') {
    throw new TypeError(
      `${PREFIX}${label}.id must be a non-empty string (received ${describe(value)})`,
    );
  }
  if (isVisiblyBlank(value)) {
    throw new TypeError(
      `${PREFIX}${label}.id must be a non-empty string (received a blank string: empty, whitespace or invisible characters only)`,
    );
  }
}
