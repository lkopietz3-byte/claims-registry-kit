# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.0] - unreleased

### Breaking changes

Each of these can change a verdict or throw where 0.3.1 did not. Re-run your
report or CI check after upgrading and read the diff.

- **Claims up to 24 hours past `maxAgeDays` are now `'stale'`.** Migration: if
  a claim now flips at the boundary and you want the old cutoff, pass
  `maxAgeDays + 1`; otherwise re-verify the claim.
- **A placeholder `evidenceRef` (`TODO`, `TBD`, `N/A`, `none`, `-`, `see above`)
  is now `'unverified'`, not `'current'` or `'stale'`.** Migration: replace the
  placeholder with a real reference, or pass `{ placeholderRefs: false }` to
  switch the rule off, or your own list to change it.
- **`registerClaim` throws for an id that only looks like a registered one**
  (trailing or leading space, invisible character, NFC versus NFD). It used to
  register a second claim. Migration: clean the id at the source, or catch the
  error and decide which spelling is right. `getClaim` stays an exact lookup.

### Added

- **`checkAppearsIn` and `assertAppearsIn`.** Check that published text (a pricing
  or disclosure page) contains the current wording of registered claims.
  Verdicts per claim: `present`, `stale` (shown, but the claim is no longer
  current), `missing` and `unknown-id`. Text is compared after NFKC, whitespace
  folding, dropping invisible characters and folding quotes and dashes; case
  matters unless `ignoreCase` is set; matches must sit on word and number
  boundaries. One linear pass for all claims. Also exports the types
  `AppearsInVerdict`, `AppearsInResult`, `AppearsInReport`, `AppearsInOptions`
  and `ClaimLookup`.
  Invisible characters are removed before normalization, so a zero-width
  character between a letter and its accent no longer blocks a match;
  control-only claim text never matches; `now: null` and an invalid id-list
  length throw; the placeholder policy is read once per call.

### Fixed

- **A claim could stay `'current'` up to 24 hours past `maxAgeDays`.** The age
  limit was compared against whole days rounded down, so a claim 90 days and 23
  hours old passed a 90-day policy, and a fractional `maxAgeDays` gave the wrong
  verdict (`1.5` at 1.9 days, `0.5` at 20 hours and `0` at 23 hours 59 minutes
  were all `'current'`). The limit is now compared in exact milliseconds.
- **Look-alike duplicate ids were accepted by `createClaimsRegistry`.** An id
  that differs from a registered one only by a trailing or leading space, a
  zero-width or other invisible character, or NFC versus NFD normalization is
  now rejected with an error that names both spellings.
- **A placeholder `evidenceRef` counted as linked evidence.** `TODO`, `TBD`,
  `N/A`, `none`, `-` and `see above` gave `'current'` with a fresh date. They
  are now `'unverified'`.

### Changed

- **Behavior change: the age rule.** A claim is `'stale'` when MORE than
  `maxAgeDays` x 24 hours have elapsed; exactly at the limit is still
  `'current'` (inclusive), as before. Claims between the old and new cutoff
  (up to 24 hours past it) move from `'current'` to `'stale'`. A bare
  `YYYY-MM-DD` counts from UTC midnight. `ageDays` is unchanged: whole elapsed
  days, rounded down, for display only.
- **Behavior change: placeholder references.** A claim whose `evidenceRef` is
  exactly a placeholder (ignoring case, surrounding and repeated whitespace,
  invisible characters and full-width letters) moves from `'current'` or
  `'stale'` to `'unverified'`. References that merely contain those words
  (`https://example.com/todo-list`, `none-such-ref-123`) are unaffected.
  Switch it off with `{ placeholderRefs: false }` or supply your own list.
- **Behavior change: the registry.** `registerClaim` now throws for a look-alike
  id where it used to register a second claim. `getClaim` stays an exact lookup.
- New optional last argument `options?: EvidenceOptions` on `evaluateClaim`,
  `checkStaleness`, `checkEvidenceLinked` and `generateClaimsReport`, and a new
  export `DEFAULT_PLACEHOLDER_REFS` (the type `EvidenceOptions` is also
  exported). Existing calls are unchanged.
- Two tests in `test/evidence.test.ts` asserted that `'TODO'` and `'n/a'` count
  as present; they now assert the new behavior.

### Documented

- **Getting page text from HTML.** The README has a short `htmlToText` recipe
  (tags become spaces, entities are decoded, scripts, styles, comments and
  hidden elements are dropped). It is tested here, linear in page size, and not
  part of the package. The README now says plainly that `checkAppearsIn` matches
  exact approved wording, not paraphrase, that `present` means the text is in
  the string you passed (not that a visitor sees it), that numbers match
  literally (`$25` is not `$25.00`), and that `'current'` is not "approved".
- The age limit is inclusive and `ageDays` is display-only, so a report can show
  `90d old` for a claim that is stale under `maxAgeDays: 90`.
- `generateClaimsReport` and the checks still do not look for duplicate ids,
  exact or look-alike; only the registry does.
- The look-alike rule does not cover case, inner spacing, or homoglyph letters
  from another script. Only the six default placeholders are matched; `TBA`,
  `pending`, `?`, `...` and dashes such as an em dash still count as present
  unless you add them.

## [0.3.1] - 2026-10-07

No change to the library's behavior or API.

### Changed

- The README links to the [in-browser playground](https://lkopietz3-byte.github.io/honesty-kits/#claims-registry-kit) and the honesty kits family, and the npm homepage now points to the playground.
- Added the `honesty-kits` npm keyword so the family shows up together in search.

### Security

- Development lockfile: `source-map-js` 1.2.2 (GHSA-68fv-2mgg-jv7q). Development tooling only; the published package has no runtime dependencies.

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
  ambiguous about. A bare `'YYYY-MM-DD'` date is unaffected: it has no
  time-of-day, so it's still read as UTC midnight. If you have callers
  passing zoneless timestamps today, add `Z` (or the correct offset) to each
  one; a bare date is the simpler fix if the time-of-day wasn't meaningful.
- **A claim with no `id` (missing, `null`, not a string, or blank after
  trimming) is now rejected.** `generateClaimsReport` throws `TypeError`
  naming the offending claim's index (`claims[2].id must be a non-empty
  string...`), and `createClaimsRegistry().registerClaim` throws the same
  way. `evaluateClaim`, `checkStaleness`, and `checkEvidenceLinked` are
  unchanged, because an idless claim isn't stored or displayed by name there, so it
  wasn't silently broken the same way.

### Fixed

- The shipped `.js.map` pointed at `../src/*.ts`, which isn't in the
  published tarball. `tsconfig.build.json` now sets `inlineSources`, so the
  map embeds the original source. `.d.ts.map` generation is turned off
  instead of shipping `src/`.
- README line ~234 still called `grounding-kit` "a sibling kit, not yet
  public"; it's published; now linked directly.
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
  always yields `status: 'stale'` with `ageDays: null`, the fail-safe
  direction: never guessed at and never `'current'`.

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
  "today" in a zone ahead of UTC), while an explicit timestamp (an exact,
  zoned instant) gets no grace period at all.
- `evaluateClaim`, `checkStaleness`, `checkEvidenceLinked`, and
  `generateClaimsReport` validate their arguments and throw
  `TypeError`/`RangeError` on a malformed `claims` array, `maxAgeDays`, or
  `now`, instead of silently returning a wrong answer.
- Zero runtime dependencies. ESM only.
