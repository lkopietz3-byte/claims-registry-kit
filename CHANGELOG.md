# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-09-27

### Changed (breaking)

- **A `verifiedAt` timestamp with a time-of-day but no explicit zone (e.g.
  `'2026-01-01T12:00:00'`) is now unparseable, not silently read as UTC.**
  It gets the same fail-safe treatment as any other unparseable value:
  `status: 'stale'` and `ageDays: null`. This matches `freshness-kit`, which
  already requires an explicit zone once there's a time-of-day to be
  ambiguous about. A bare `'YYYY-MM-DD'` date is unaffected — it has no
  time-of-day, so it's still read as UTC midnight. If you have callers
  passing zoneless timestamps today, add `Z` (or the correct offset) to each
  one; a bare date is the simpler fix if the time-of-day wasn't meaningful.
- **A claim with no `id` (missing, `null`, not a string, or blank after
  trimming) is now rejected.** `generateClaimsReport` throws `TypeError`
  naming the offending claim's index (`claims[2].id must be a non-empty
  string...`), and `createClaimsRegistry().registerClaim` throws the same
  way. `evaluateClaim`, `checkStaleness`, and `checkEvidenceLinked` are
  unchanged — an idless claim isn't stored or displayed by name there, so it
  wasn't silently broken the same way.

### Fixed

- The shipped `.js.map` pointed at `../src/*.ts`, which isn't in the
  published tarball. `tsconfig.build.json` now sets `inlineSources`, so the
  map embeds the original source. `.d.ts.map` generation is turned off
  instead of shipping `src/`.
- README line ~234 still called `grounding-kit` "a sibling kit, not yet
  public" — it's published; now linked directly.
- README "Start here" showed the contributor `npm ci` workflow before the
  plain `npm install claims-registry-kit` line a new reader actually wants
  first.

### Added

- CommonJS `require()` support: `package.json` `exports` now has a
  `"default"` condition alongside `"import"`, so
  `require("claims-registry-kit")` works on Node versions that support
  `require(esm)` (>=20.19.0, >=22.12.0). `scripts/consumer-probe.cjs`, run by
  `verify-package.mjs`, guards it in CI.
- Documented plainly (README and TSDoc) that an unparseable `verifiedAt`
  always yields `status: 'stale'` with `ageDays: null` — the fail-safe
  direction, never guessed at and never `'current'`.

## [0.1.0] - 2026-09-27

First release.

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
