# Engineering contract

## Invariants this package holds

- **Zero runtime dependencies.** `dependencies` in `package.json` stays
  empty. Dev tooling only.
- **Pure functions, no hidden state.** `evaluateClaim`, `checkStaleness`,
  `checkEvidenceLinked`, and `generateClaimsReport` never mutate their
  `claims` argument or the `Claim` objects in it, and never read the system
  clock unless `now` is omitted. Same inputs, same outputs, every time.
- **`createClaimsRegistry` owns its data.** `registerClaim`, `getClaims`,
  and `getClaim` shallow-copy the claim in and out, so mutating an object
  before or after it crosses that boundary never changes what the registry
  holds. (The copy is shallow: a nested `evidenceRef` array or object is
  still shared with the caller.)
- **`verifiedAt` is strict ISO 8601, read as UTC.** No locale parsing, no
  reading a bare timestamp as the machine's local time zone. A value that
  doesn't match, or a date/time that doesn't exist (`2026-02-30`, hour 24),
  is unparseable — `ageDays: null`, status `'stale'` — never guessed at.
- **Future-date tolerance matches what the format can honestly explain.** A
  bare `YYYY-MM-DD` gets up to 14 hours (UTC+14 is the furthest-ahead civil
  zone, so it may already be "today" there); an explicit timestamp is an
  exact instant and gets none. Past that, `'stale'`, never `'current'`.
- **Missing evidence always outranks staleness.** A claim with no usable
  `evidenceRef` is `'unverified'`, regardless of how fresh `verifiedAt` is.
- **Bad arguments throw, they don't fail open.** A non-finite/negative
  `maxAgeDays`, an Invalid Date `now`, or a malformed `claims` array raises
  `TypeError`/`RangeError` rather than silently marking every claim
  `'current'`.

## Setup and verification

```bash
npm ci
npm run verify   # lint + typecheck + test + build + verify:package
```

`npm run verify:package` packs the tarball a consumer would actually
install, installs it into a clean temp project offline, imports it by
package name, diffs the exported names against `api-surface.json`, and runs
`scripts/consumer-probe.mjs` (and `.mts`, if present) against the installed
declarations. Run `node scripts/verify-package.mjs --update-api` after an
intentional export change and review the `api-surface.json` diff.

`.github/workflows/verify.yml` runs the same `verify` script on every push
and PR, plus a Node 20/22/24 compatibility job.

## What is NOT certified

- That a linked `evidenceRef` still proves the claim's text — this package
  checks presence, never truth. See the README's Honest limits.
- That `verifiedAt` reflects a real check someone did.
- Behavior on Node < 20 (the `engines` field's floor; untested below it).

## Release and rollback

Not yet published to npm (see README install instructions). Version stays
`0.1.0` until a real release; `CHANGELOG.md` gets one dated entry per
release from then on. There is no running service to roll back — a bad
release is simply not tagged/installed, and the previous git commit is the
rollback.
