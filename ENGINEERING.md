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

## Are the types wrong? (attw)

CI runs [`arethetypeswrong`](https://github.com/arethetypeswrong/arethetypeswrong.github.io)
(`npm run attw`, which is `attw --pack . --ignore-rules cjs-resolves-to-esm`)
against the packed tarball after the build step. The `cjs-resolves-to-esm` rule is ignored on
purpose: this is an ESM-only package (`"type": "module"`, no `require` entry point), so a
CommonJS consumer must use Node's `require(esm)` support (Node >=20.19 or >=22.12 — see
"Runtime support policy" below) rather than a native `require`. A dual CJS+ESM build was
rejected to avoid the dual-package hazard (two separately-identified copies of the same module,
with broken `instanceof` checks and duplicated module state across the CJS and ESM entry
points).

## Release and rollback

`npm run verify` (lint, typecheck, test, build, verify:package) runs automatically before
publish via the `prepublishOnly` script, so a broken build cannot reach the registry by
accident. To release: add a dated entry to `CHANGELOG.md`, bump `version` in
`package.json`, commit, and push a `vX.Y.Z` tag that matches the new version, then let
`.github/workflows/release.yml` install, verify, and publish it. (You can also run
`npm publish` locally; `prepublishOnly` still guards it.)

npm's unpublish policy is deliberately narrow. Within 72 hours of publishing, a version can be
unpublished only if no other published package depends on it. After 72 hours, unpublishing also
requires fewer than 300 downloads in the last week and a single maintainer — most released
versions won't qualify either way. A given `name@version` can never be reused, published or
not, even after an unpublish. Treat unpublish as unavailable: prefer fixing forward with a new
patch version, and use `npm deprecate <name>@"<range>" "<message>"` to warn consumers off a
bad release while it stays installable for anyone already pinned to it.

### Runtime support policy

- **Supported (recommended for production):** Node 22 and 24 LTS; Node 26 current.
- **Compatibility-tested:** Node 20. Node 20 is end-of-life — nodejs.org's release page
  (<https://nodejs.org/en/about/previous-releases>) lists it as `EOL`, with its final release
  dated Mar 24, 2026. The `compat` job in `verify.yml` still runs on Node 20 to catch
  regressions, but that runtime gets no security fixes upstream; don't run production traffic
  on it.
- CommonJS `require()` of this package needs Node >=20.19 or >=22.12 (`require(esm)`
  support). ESM `import` works on every version this package tests (20, 22, 24).
- `engines` in `package.json` is unchanged by this policy.

### Publishing with provenance

`.github/workflows/release.yml` publishes using npm trusted publishing: it triggers on
`workflow_dispatch` or a pushed `v*` tag, requests a short-lived OIDC token instead of
reading a stored npm token (`permissions: id-token: write`), and runs a plain `npm publish`
with no token and no `--provenance` flag, because provenance attestation is generated
automatically under trusted publishing. Before publishing, the workflow confirms the tag
matches `package.json`'s `version` and checks whether that version is already on the
registry, so re-running it on a version that's already published is a no-op rather than an
error. Trusted publishing must be configured for this package on npmjs.com (linking it to this
GitHub repository and the `release.yml` workflow) before the first automated release will
work.
