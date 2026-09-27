# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-09-27

First release. Not yet published to npm; install from GitHub (see README).

### Added

- `Claim`, `IsoDateString`, `ClaimStatus`, and `EvaluatedClaim` types.
- `evaluateClaim`, `checkStaleness`, `checkEvidenceLinked`,
  `generateClaimsReport`, and `formatClaimsReportAsText` for computing and
  reporting a claim's status against a staleness policy.
- `createClaimsRegistry` for an optional, in-memory way to collect claims
  from several call sites into one array.
- `verifiedAt` is parsed as strict ISO 8601 in UTC: a bare date or an
  offset-free timestamp is never read as the machine's local time zone, and
  anything outside that format is treated as unparseable rather than
  guessed at.
- A future `verifiedAt` is treated as a likely typo and reported `'stale'`,
  not `'current'`, once it is further ahead than its format can honestly
  explain: a bare `YYYY-MM-DD` date gets up to 14 hours (it may already be
  "today" in a zone ahead of UTC), while an explicit timestamp — an exact,
  zoned instant — gets no grace period at all.
- `evaluateClaim`, `checkStaleness`, `checkEvidenceLinked`, and
  `generateClaimsReport` validate their arguments and throw
  `TypeError`/`RangeError` on a malformed `claims` array, `maxAgeDays`, or
  `now`, instead of silently returning a wrong answer.
- Zero runtime dependencies. ESM only.
