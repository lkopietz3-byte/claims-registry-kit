import type { Claim, ClaimStatus, EvaluatedClaim } from './types.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function computeAgeDays(verifiedAt: string, now: Date): number | null {
  const verifiedDate = new Date(verifiedAt);
  if (Number.isNaN(verifiedDate.getTime())) return null;
  return Math.floor((now.getTime() - verifiedDate.getTime()) / MS_PER_DAY);
}

/**
 * Purely structural presence check — does this evidenceRef contain
 * anything at all? A string is "present" if it has non-whitespace content;
 * an array is "present" if it's non-empty; any other non-nullish value
 * (a caller-defined evidence object, for example) is treated as present,
 * since this library doesn't know its shape.
 */
function hasEvidence(evidenceRef: unknown): boolean {
  if (evidenceRef == null) return false;
  if (typeof evidenceRef === 'string') return evidenceRef.trim().length > 0;
  if (Array.isArray(evidenceRef)) return evidenceRef.length > 0;
  return true;
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
 */
export function evaluateClaim<EvidenceRef = string>(
  claim: Claim<EvidenceRef>,
  maxAgeDays: number,
  now: Date = new Date(),
): EvaluatedClaim<EvidenceRef> {
  const ageDays = computeAgeDays(claim.verifiedAt, now);

  let status: ClaimStatus;
  if (!hasEvidence(claim.evidenceRef)) {
    status = 'unverified';
  } else if (ageDays === null || ageDays > maxAgeDays) {
    status = 'stale';
  } else {
    status = 'current';
  }

  return { ...claim, status, ageDays };
}

/**
 * Which claims have gone stale: `evidenceRef` is present, but `verifiedAt`
 * is older than `maxAgeDays` (or unparseable as a date, treated
 * conservatively as stale so a malformed date can't hide a claim from
 * review).
 *
 * Claims with a missing `evidenceRef` are never included here, even if
 * their `verifiedAt` is ancient — that's `checkEvidenceLinked`'s job. Each
 * claim gets exactly one bucket via `evaluateClaim`, never two.
 */
export function checkStaleness<EvidenceRef = string>(
  claims: Claim<EvidenceRef>[],
  maxAgeDays: number,
  now: Date = new Date(),
): EvaluatedClaim<EvidenceRef>[] {
  return claims
    .map((claim) => evaluateClaim(claim, maxAgeDays, now))
    .filter((evaluated) => evaluated.status === 'stale');
}

/**
 * Purely structural: does every claim have a non-empty `evidenceRef`?
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
 * `ageDays` is still computed on the returned claims for convenience (a
 * claim missing evidence AND overdue for review is worth knowing at a
 * glance), but it plays no role in the `'unverified'` classification here.
 */
export function checkEvidenceLinked<EvidenceRef = string>(
  claims: Claim<EvidenceRef>[],
  now: Date = new Date(),
): EvaluatedClaim<EvidenceRef>[] {
  return claims
    .filter((claim) => !hasEvidence(claim.evidenceRef))
    .map((claim) => ({
      ...claim,
      status: 'unverified' as const,
      ageDays: computeAgeDays(claim.verifiedAt, now),
    }));
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
 */
export function generateClaimsReport<EvidenceRef = string>(
  claims: Claim<EvidenceRef>[],
  maxAgeDays: number,
  now: Date = new Date(),
): ClaimsReport<EvidenceRef> {
  const evaluated = claims.map((claim) => evaluateClaim(claim, maxAgeDays, now));

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
      const age = claim.ageDays === null ? 'unparseable verifiedAt' : `${claim.ageDays}d old`;
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
