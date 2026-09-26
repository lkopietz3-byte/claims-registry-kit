// Core types for claims-registry-kit.
//
// The pattern: every public-facing product claim ("we do X", "our data is
// Y") is stored as a structured record BESIDE a reference to whatever
// proves it — a file path, a URL, a test name, a doc id, anything the
// caller's own system already uses to point at evidence — plus the date
// someone last checked that the reference still holds. Marketing copy that
// lives disconnected from the thing that makes it true goes stale silently,
// often right after a refactor quietly deletes the feature it described.
//
// This library doesn't stop that drift by itself; it makes it impossible to
// miss once someone looks. See the README for the SOC2-control-evidence
// comparison this is modeled on, and for what this library deliberately
// does NOT check.

/**
 * ISO 8601 date string, e.g. `'2026-07-28'` or a full timestamp such as
 * `'2026-07-28T14:30:00Z'`. A timestamp with no UTC offset is read as UTC,
 * never as the machine's local time zone. Values this library cannot parse
 * as one of these forms (a month name, a slash-separated date, an
 * impossible calendar day) are treated as missing, not guessed at — see
 * `ClaimStatus`.
 */
export type IsoDateString = string;

/**
 * A single public-facing product claim, tied to the evidence that backs it.
 *
 * `EvidenceRef` is generic and deliberately opaque: this library does not
 * assume evidence is a file path, a URL, a test id, or anything else. It is
 * whatever your own system already uses to point at proof — a plain string
 * by default, or a richer caller-defined type if you supply one. Nothing in
 * this library dereferences, fetches, or validates that reference — see
 * `checkEvidenceLinked`'s doc comment and the README's limits section for
 * why that's a deliberate boundary, not an oversight.
 */
export interface Claim<EvidenceRef = string> {
  /** Stable identifier for this claim, unique within your registry. */
  id: string;
  /** The actual public-facing sentence, verbatim — what a user or visitor reads. */
  text: string;
  /** A caller-defined reference to whatever proves this claim true. */
  evidenceRef: EvidenceRef;
  /** ISO 8601 date this claim's evidence was last confirmed to still hold. */
  verifiedAt: IsoDateString;
  /**
   * Optional: who or what last verified this claim — a person's name,
   * `'automated-test'`, an agent id, whatever your process uses.
   */
  verifiedBy?: string;
}

/**
 * The three states a claim can be in. This is always COMPUTED from a Claim
 * plus a staleness policy (`maxAgeDays`) and the current date — it is never
 * stored on the Claim itself, so there is no risk of a persisted status
 * drifting out of sync with the date math that produced it.
 *
 * - `'unverified'` — `evidenceRef` is missing or empty. This takes priority
 *   over staleness: a claim with no evidence is unverified regardless of
 *   how recent `verifiedAt` is. A fresh date next to an empty reference
 *   isn't evidence of anything.
 * - `'stale'` — `evidenceRef` is present, but `verifiedAt` is older than
 *   the caller's `maxAgeDays` policy, more than a day in the future (a
 *   likely typo — see `evaluateClaim`), or doesn't parse as a date at all.
 *   All three are treated conservatively as stale so a bad date can't hide
 *   a claim from review.
 * - `'current'` — `evidenceRef` is present and `verifiedAt` is within
 *   policy (including up to a day in the future, read as clock skew).
 */
export type ClaimStatus = 'current' | 'stale' | 'unverified';

/** A Claim plus its computed status and age, as produced by `evaluateClaim`. */
export interface EvaluatedClaim<EvidenceRef = string> extends Claim<EvidenceRef> {
  status: ClaimStatus;
  /**
   * Whole elapsed 24-hour periods between `verifiedAt` and the evaluation's
   * `now`. `null` when `verifiedAt` fails to parse as a date. Negative when
   * `verifiedAt` is far enough in the future to be treated as a typo rather
   * than clock skew (see `evaluateClaim`) — the status is `'stale'` in that
   * case, never `'current'`.
   */
  ageDays: number | null;
}
