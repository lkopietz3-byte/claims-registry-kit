# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-09-28

Minor release: some inputs that used to be accepted now throw or get a
different status, and the text from `formatClaimsReportAsText` is different
for claims that contain control or bidi characters. The exports, the report
shape and the status rules are unchanged.

### Changed (breaking)

- **A reference that shows nothing is now `'unverified'` (CRK-F01).** Blank
  used to be a hand-written list of characters that missed U+061C (Arabic
  letter mark) and the isolate controls U+2066-2069, so an `evidenceRef` made
  only of those came back `'current'` with a fresh date. Blank now means only
  whitespace, control characters (C0, DEL and C1) and
  `Default_Ignorable_Code_Point` characters, which also adds variation
  selectors on their own (U+FE00-FE0F), the Hangul fillers (U+115F, U+1160,
  U+3164, U+FFA0), U+034F and U+180B-180F. Visible Arabic, Japanese, emoji and
  bidi-wrapped visible text stay present. Stored references are never altered.
- **`formatClaimsReportAsText` escapes what it prints (CRK-F02).** Control
  characters (C0, DEL, C1, including CR, LF and ESC), U+2028, U+2029 and bidi
  formatting characters (U+061C, U+200E, U+200F, U+202A-202E, U+2066-2069) in
  ids, claim text and the other printed fields become visible escapes such as
  `\u001b`. A newline in a claim can no longer forge a second report line or
  heading and an ESC byte no longer reaches the terminal. Quotes, square
  brackets and other invisible characters are not escaped (see the README's
  Honest limits), so this stops new lines and headings, not every way a claim
  can make its own line read differently. Visible text is unchanged,
  nothing is truncated, and the report object stays raw. String ids and text
  with no such characters print exactly as before.
- **A falsy `evidenceRef` is missing evidence.** `false`, `0`, `-0`, `NaN` and
  `0n` now mean no evidence, like `null`, `undefined`, an empty string and a
  blank string, so the claim is `'unverified'`. Before, only `null`,
  `undefined` and blank strings did, so `evidenceRef: false` or `0` with a fresh
  date came back `'current'`. The same rule applies to each element inside a
  list: `[false]`, `[0]` and `['']` are missing, and a list with no present
  element is missing. Every other value still counts as present and is never
  inspected: an object (`Claim<{ kind, ref }>`), `true`, a non-zero number, a
  function, a symbol. No evidence type throws.
- **A claim must be a plain object.** A `Map`, `Set`, `Date`, `RegExp`, array
  or class instance (or a boxed primitive) passed as a claim now throws a
  `TypeError` in `evaluateClaim`, `checkStaleness`, `checkEvidenceLinked`,
  `generateClaimsReport` and `registerClaim`. Before, it was spread into an
  empty claim and reported as missing evidence or a bad date. Plain objects,
  null-prototype objects and plain objects from another realm are accepted.
- **A claim `id` that shows nothing is rejected.** `generateClaimsReport` and
  `registerClaim` now throw a `TypeError` for an id made only of whitespace,
  control characters or invisible characters (a zero-width space, an isolate),
  not just an empty or whitespace-only one.
- **`now` must be a real `Date`.** It is read through the `Date` intrinsics: a
  `Date` subclass and a `Date` from another realm work, but an object that only
  fakes `Symbol.toStringTag` is now a `TypeError`.
- The duplicate-id error from `registerClaim` prints the id with control
  characters escaped, and the `TypeError` messages for a non-plain claim and a
  blank id say what was received. Error types are unchanged.

### Fixed

- **Caller input is read once.** Each claim, the `claims` array and `now` are
  copied or read a single time and every check, status decision and returned
  object uses that copy. Before, a getter could pass the evidence check with
  one `evidenceRef` and return another, `registerClaim` could store a claim
  under a key that differs from its own `id`, and a Proxy array could be
  validated with one entry and processed with another.
- A hole in `claims` is refused by the same single indexed pass that produces
  the dense copy the functions then use.
- Error messages never call into the offending value (`toString`, `toJSON`,
  getters) and cope with a revoked Proxy.

### Docs

- README: an ESM and CommonJS compatibility table (`require()` works on Node
  20.19+ and 22.12+), Node support consistent with ENGINEERING (22 and 24 LTS
  recommended, 26 current, 20 is end-of-life and compatibility-tested only),
  and a pinned clock in the example so its output does not drift.
- README and TSDoc: the registry's copy is shallow (a nested `evidenceRef`
  array or object is shared); duplicate ids are only caught by the registry;
  what the text escaping does and does not cover.
- README: corrected the sibling-kit statements. `freshness-kit` shares the
  time-zone and future-date thresholds but throws a `RangeError` where this
  library reports `'stale'`, and its date grammar is stricter. `grounding-kit`
  is described as a citation-marker checker, not a verifier for these claims.
- TSDoc for `createClaimsRegistry`; `PROJECT_CONTEXT.md`'s purpose line no
  longer says "unsupported" claims are flagged (it flags missing references
  and overdue reviews, not unsupported claims).
- Tests: `formatClaimsReportAsText`, the read-once and plain-object rules, and
  blank ids and references are covered; a nested non-string evidence item now
  has a test.

### CI

- `verify.yml`: the compatibility job also runs Node 20.19.0 and 22.12.0
  (the exact `require(esm)` floors) with the tests and `verify-package.mjs`.
- `release.yml`: runs `audit:dependencies`, `verify` and `attw`; both triggers
  must run on a `v*` tag that matches `package.json`; only a confirmed E404
  counts as "not published" and any other registry error fails the job.

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
