// Argument checks shared by the public functions. Internal: not exported from index.ts.
//
// The rule behind every check here: a bad argument must throw, never fall
// through into date math. `x > NaN` is false, so an unchecked NaN policy or an
// Invalid Date clock would classify every claim as 'current': a review gate
// that fails open.

const PREFIX = 'claims-registry-kit: ';

function describe(value: unknown): string {
  if (typeof value === 'number') return String(value);
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return typeof value;
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

/** `now` must be a valid Date instance (an Invalid Date is rejected). */
export function assertNow(value: unknown): asserts value is Date {
  if (Object.prototype.toString.call(value) !== '[object Date]') {
    throw new TypeError(`${PREFIX}now must be a Date (received ${describe(value)})`);
  }
  if (Number.isNaN((value as Date).getTime())) {
    throw new RangeError(`${PREFIX}now must be a valid Date (received an Invalid Date)`);
  }
}

/** A single claim must be a non-null object. `label` names it in the message. */
export function assertClaimObject(value: unknown, label: string): asserts value is object {
  if (value === null || typeof value !== 'object') {
    throw new TypeError(`${PREFIX}${label} must be an object (received ${describe(value)})`);
  }
}

/**
 * A claim's `id` must be a non-empty (after trimming) string. `label` names
 * the offending claim in the message.
 *
 * `id` is how a caller finds "the same claim" again across runs (the
 * registry's duplicate-detection key, and what a report's text output names
 * a stale/unverified claim by). A missing or blank id isn't a smaller
 * version of a valid claim; it's a claim this library can never point back
 * to, so it must be rejected rather than silently accepted with a blank or
 * `undefined` label.
 */
export function assertClaimId(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${PREFIX}${label}.id must be a non-empty string (received ${describe(value)})`);
  }
}

/** `claims` must be an array whose every entry (holes included) is a claim object. */
export function assertClaimList(value: unknown): asserts value is readonly object[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${PREFIX}claims must be an array (received ${describe(value)})`);
  }
  for (let i = 0; i < value.length; i += 1) {
    assertClaimObject(value[i], `claims[${String(i)}]`);
  }
}
