import { parseIsoInstant } from './dates.js';
import type { Claim, ClaimStatus, EvaluatedClaim } from './types.js';
import { assertClaimList, assertClaimObject, assertMaxAgeDays, assertNow } from './validate.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * How far past `now` a bare `YYYY-MM-DD` `verifiedAt` may be before it stops
 * looking like a date written in a zone ahead of UTC and starts looking like
 * a typo. UTC+14:00 (for example Pacific/Kiritimati) is the furthest-ahead
 * civil time zone in the IANA database, so a bare date is already "today"
 * somewhere on Earth up to 14 hours before UTC agrees. This matches
 * freshness-kit's bare-date rule (see its README's "Relationship to
 * claims-registry-kit" section).
 *
 * An explicit timestamp (anything with a time component, offset or not)
 * names an exact instant and gets none of this grace: even one millisecond
 * past `now` is a typo, not clock skew.
 */
const MAX_BARE_DATE_FUTURE_TOLERANCE_MS = 14 * 60 * 60 * 1000;

interface Age {
  /** Whole elapsed 24-hour periods; `null` when `verifiedAt` is unparseable. */
  ageDays: number | null;
  /** False when `verifiedAt` is unparseable or too far in the future to count as a verification. */
  usable: boolean;
}

function computeAge(verifiedAt: unknown, now: Date): Age {
  const parsed = parseIsoInstant(verifiedAt);
  if (parsed === null) return { ageDays: null, usable: false };
  const tolerance = parsed.dateOnly ? MAX_BARE_DATE_FUTURE_TOLERANCE_MS : 0;
  const elapsedMs = now.getTime() - parsed.instant;
  if (elapsedMs < -tolerance) {
    return { ageDays: Math.floor(elapsedMs / MS_PER_DAY), usable: false };
  }
  // Within tolerance a slightly-future date reads as "just now", never as -1.
  return { ageDays: Math.max(0, Math.floor(elapsedMs / MS_PER_DAY)), usable: true };
}

// Invisible-but-not-whitespace characters that a reader would still see as a
// blank string: zero-width space/joiners, word joiner, soft hyphen, bidi
// controls, and C0/DEL. JS's built-in `\s` already covers ordinary
// whitespace, NBSP, and the BOM, so those don't need to be listed here.
// eslint-disable-next-line no-control-regex -- matching control characters (\u0000-\u001f, \u007f) is the point
const INVISIBLE_CHARS = /[\u0000-\u001f\u007f\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u2064]/gu;

function isBlankString(value: string): boolean {
  return value.replace(INVISIBLE_CHARS, '').trim().length === 0;
}

/**
 * Purely structural presence check — does this evidenceRef contain anything
 * at all?
 *
 * - A string is "present" if, once whitespace and invisible formatting
 *   characters (zero-width spaces, bidi marks, control characters, ...) are
 *   stripped, anything is left. `'TODO'` and `'n/a'` count as present —
 *   this function cannot tell a placeholder from a real reference, only
 *   whether one was typed.
 * - An array is "present" if at least one of its elements is, checked
 *   recursively (a list of evidence refs, or a list of lists). Repeated or
 *   cyclic sub-arrays are each visited only once, so this always terminates
 *   and never grows the call stack with input depth.
 * - Any other non-nullish value (a caller-defined evidence object, for
 *   example) is treated as present, since this library doesn't know its
 *   shape — see `Claim`'s doc comment.
 */
function hasEvidence(evidenceRef: unknown): boolean {
  if (evidenceRef == null) return false;
  if (typeof evidenceRef === 'string') return !isBlankString(evidenceRef);
  if (!Array.isArray(evidenceRef)) return true;

  const stack: unknown[] = [evidenceRef];
  const visitedArrays = new Set<unknown[]>();
  while (stack.length > 0) {
    const item = stack.pop();
    if (item == null) continue;
    if (typeof item === 'string') {
      if (!isBlankString(item)) return true;
      continue;
    }
    if (!Array.isArray(item)) return true;
    if (visitedArrays.has(item)) continue;
    visitedArrays.add(item);
    for (const child of item) stack.push(child);
  }
  return false;
}

/**
 * Evaluate a single claim's status against a staleness policy.
 *
 * This is the one place status gets decided — `checkStaleness`,
 * `checkEvidenceLinked`, and `generateClaimsReport` all funnel through it,
 * so a claim is always bucketed the same way no matter which entry point
 * you call. Priority order: missing evidence always wins as `'unverified'`,
 * even for a claim `verifiedAt` an hour ago — see `ClaimStatus` in
 * `types.ts` for why.
 *
 * `verifiedAt` is parsed as strict ISO 8601 in UTC (a bare date or an
 * offset-free timestamp is never read as local time), so the result does
 * not depend on the machine's time zone. A future `verifiedAt` is treated as
 * a typo and reported `'stale'`, not `'current'`, once it is further ahead
 * than its format can honestly explain: a bare `YYYY-MM-DD` gets up to 14
 * hours (it could already be "today" in a zone ahead of UTC), while an
 * explicit timestamp — an exact, zoned instant — gets none. Either way, a
 * wrong future date can't hide a claim from review.
 *
 * @throws {TypeError} if `claim` is not an object, `maxAgeDays` is not a
 * number, or `now` is not a `Date`.
 * @throws {RangeError} if `maxAgeDays` is negative or non-finite, or `now`
 * is an Invalid Date. A bad policy or clock must fail loudly here rather
 * than silently marking every claim `'current'`.
 */
export function evaluateClaim<EvidenceRef = string>(
  claim: Claim<EvidenceRef>,
  maxAgeDays: number,
  now: Date = new Date(),
): EvaluatedClaim<EvidenceRef> {
  assertClaimObject(claim, 'claim');
  assertMaxAgeDays(maxAgeDays);
  assertNow(now);
  return evaluate(claim, maxAgeDays, now);
}

/** The single place a status is decided. Callers have already validated their arguments. */
function evaluate<EvidenceRef>(
  claim: Claim<EvidenceRef>,
  maxAgeDays: number,
  now: Date,
): EvaluatedClaim<EvidenceRef> {
  const { ageDays, usable } = computeAge(claim.verifiedAt, now);

  let status: ClaimStatus;
  if (!hasEvidence(claim.evidenceRef)) {
    status = 'unverified';
  } else if (!usable || ageDays === null || ageDays > maxAgeDays) {
    status = 'stale';
  } else {
    status = 'current';
  }

  return { ...claim, status, ageDays };
}

/**
 * Which claims have gone stale: `evidenceRef` is present, but `verifiedAt`
 * is older than `maxAgeDays`, further in the future than its format's
 * tolerance, or unparseable — see `evaluateClaim` for exactly how each is
 * decided.
 *
 * Claims with a missing `evidenceRef` are never included here, even if
 * their `verifiedAt` is ancient — that's `checkEvidenceLinked`'s job. Each
 * claim gets exactly one bucket via `evaluateClaim`, never two. Results are
 * in the same order as `claims`.
 *
 * @throws {TypeError} if `claims` is not an array (or contains a non-object
 * entry), `maxAgeDays` is not a number, or `now` is not a `Date`.
 * @throws {RangeError} if `maxAgeDays` is negative or non-finite, or `now`
 * is an Invalid Date.
 */
export function checkStaleness<EvidenceRef = string>(
  claims: readonly Claim<EvidenceRef>[],
  maxAgeDays: number,
  now: Date = new Date(),
): EvaluatedClaim<EvidenceRef>[] {
  assertClaimList(claims);
  assertMaxAgeDays(maxAgeDays);
  assertNow(now);
  return claims
    .map((claim) => evaluate(claim, maxAgeDays, now))
    .filter((evaluated) => evaluated.status === 'stale');
}

/**
 * Purely structural: which claims are missing an `evidenceRef`?
 *
 * This is the boundary this library draws on purpose. It answers "is there
 * a reference here at all" — never "does the thing at that reference still
 * actually prove the claim's text." Confirming a linked file, test, or URL
 * still supports what the claim says is a domain-specific, often semantic
 * judgment (does this test actually cover this sentence? does this page
 * still say what we think it says?) that this library does not attempt to
 * reimplement. Pair it with a grounding/citation-verification tool for
 * that — see the README's limits section.
 *
 * A string `evidenceRef` counts as present once whitespace and invisible
 * formatting characters are stripped; an array counts as present if any of
 * its elements do, checked recursively. See `Claim`'s doc comment for why
 * any other value (an object, for a caller-defined evidence type) always
 * counts as present.
 *
 * `ageDays` is still computed on the returned claims for convenience (a
 * claim missing evidence AND overdue for review is worth knowing at a
 * glance), but it plays no role in the `'unverified'` classification here.
 * Results are in the same order as `claims`.
 *
 * @throws {TypeError} if `claims` is not an array (or contains a non-object
 * entry) or `now` is not a `Date`.
 * @throws {RangeError} if `now` is an Invalid Date.
 */
export function checkEvidenceLinked<EvidenceRef = string>(
  claims: readonly Claim<EvidenceRef>[],
  now: Date = new Date(),
): EvaluatedClaim<EvidenceRef>[] {
  assertClaimList(claims);
  assertNow(now);
  // The policy is irrelevant here (evidence presence outranks age), so an
  // unlimited one keeps this on the same code path as every other entry point.
  return claims
    .map((claim) => evaluate(claim, Number.POSITIVE_INFINITY, now))
    .filter((evaluated) => evaluated.status === 'unverified');
}

/** Summary produced by `generateClaimsReport`. */
export interface ClaimsReport<EvidenceRef = string> {
  /** ISO timestamp of when this report was generated. */
  generatedAt: string;
  /** The staleness policy this report was evaluated against. */
  maxAgeDays: number;
  counts: {
    current: number;
    stale: number;
    unverified: number;
    total: number;
  };
  current: EvaluatedClaim<EvidenceRef>[];
  stale: EvaluatedClaim<EvidenceRef>[];
  unverified: EvaluatedClaim<EvidenceRef>[];
}

/**
 * A plain summary of a whole claims set: current / stale / unverified
 * counts, plus the specific offending claims in each bucket.
 *
 * Designed for a periodic manual review — a "Monday-morning" pass where a
 * person, or a CI check gating a PR, reads the stale and unverified lists
 * and decides what to fix — not for a live/always-on cron. Nothing in this
 * library schedules itself or watches anything; it computes an answer for
 * the claims and `now` you hand it, once, when you call it.
 *
 * `current`, `stale`, and `unverified` each preserve the order claims
 * appear in the input array.
 *
 * @throws {TypeError} if `claims` is not an array (or contains a non-object
 * entry), `maxAgeDays` is not a number, or `now` is not a `Date`.
 * @throws {RangeError} if `maxAgeDays` is negative or non-finite, or `now`
 * is an Invalid Date.
 */
export function generateClaimsReport<EvidenceRef = string>(
  claims: readonly Claim<EvidenceRef>[],
  maxAgeDays: number,
  now: Date = new Date(),
): ClaimsReport<EvidenceRef> {
  assertClaimList(claims);
  assertMaxAgeDays(maxAgeDays);
  assertNow(now);
  const evaluated = claims.map((claim) => evaluate(claim, maxAgeDays, now));

  const current = evaluated.filter((c) => c.status === 'current');
  const stale = evaluated.filter((c) => c.status === 'stale');
  const unverified = evaluated.filter((c) => c.status === 'unverified');

  return {
    generatedAt: now.toISOString(),
    maxAgeDays,
    counts: {
      current: current.length,
      stale: stale.length,
      unverified: unverified.length,
      total: evaluated.length,
    },
    current,
    stale,
    unverified,
  };
}

/**
 * Render a `ClaimsReport` as plain, readable text — good enough to paste
 * into a CI job summary or print during a manual review pass. Optional
 * convenience; the report object itself has everything a caller needs to
 * build their own formatting.
 */
export function formatClaimsReportAsText<EvidenceRef = string>(
  report: ClaimsReport<EvidenceRef>,
): string {
  const lines: string[] = [];
  lines.push(
    `Claims report — generated ${report.generatedAt} (maxAgeDays: ${report.maxAgeDays})`,
  );
  lines.push(
    `  current: ${report.counts.current}  stale: ${report.counts.stale}  unverified: ${report.counts.unverified}  total: ${report.counts.total}`,
  );

  if (report.stale.length > 0) {
    lines.push('');
    lines.push('Stale claims (evidence linked, but review is overdue):');
    for (const claim of report.stale) {
      let age: string;
      if (claim.ageDays === null) age = 'unparseable verifiedAt';
      else if (claim.ageDays < 0) age = 'verifiedAt is in the future';
      else age = `${claim.ageDays}d old`;
      lines.push(`  [${claim.id}] "${claim.text}" — ${age}`);
    }
  }

  if (report.unverified.length > 0) {
    lines.push('');
    lines.push('Unverified claims (no evidenceRef):');
    for (const claim of report.unverified) {
      lines.push(`  [${claim.id}] "${claim.text}"`);
    }
  }

  return lines.join('\n');
}
