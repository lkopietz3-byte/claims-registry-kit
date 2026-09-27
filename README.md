# Claims Registry Kit

Claims Registry Kit is a small, dependency-free TypeScript library for
tracking public-facing claims alongside an evidence reference and a
last-verified date. It catches the structural problems that let product copy
quietly drift: claims with no linked evidence and claims whose review is
overdue.

## Start here

```bash
npm install claims-registry-kit
```

Working on this repo instead? Clone it, then:

```bash
npm ci
npm test
npm run typecheck
npm run build
```

The package is MIT licensed. The [test suite](test/) is the shortest path
through every status and edge case.

## When to use this, and when not to

Use it when you already publish claims about your product (a landing page, a
pricing table, a pitch deck, a status page) and want a cheap, automatable way
to notice when one has gone unlinked or stale — a CI check, a pre-launch
script, a periodic manual pass.

Don't reach for this if you need any of the following; it doesn't do them:

- **Verifying a claim is actually true.** This library never opens the file,
  fetches the URL, or runs the test named in `evidenceRef`. See
  [Honest limits](#honest-limits).
- **A live monitor, cron, or dashboard.** There's no scheduler, no webhook,
  no persistence beyond the process. You call a function, you get an answer
  for that moment; wiring it into a schedule is your job.
- **Storage.** `createClaimsRegistry` is an in-memory list, not a database.
  Bring your own storage for anything that needs to survive a restart.

## The idea, plainly

Marketing copy ("we support real-time sync", "your data is encrypted at
rest", "SOC 2 audited") almost always lives somewhere disconnected from the
code that makes it true — a landing page, a pricing table, an FAQ, a pitch
deck. The code underneath a claim can change or get deleted in a refactor
six months later, and nothing forces anyone to notice that the sentence is
now false. The claim doesn't break loudly; it just sits there, still
published, quietly wrong.

The fix this library encodes: store each claim as a small structured
record, not a loose sentence — `{ text, evidenceRef, verifiedAt }` — where
`evidenceRef` points at whatever actually proves the claim (a file, a URL, a
test name, a doc id — you decide) and `verifiedAt` is the date someone last
confirmed that reference still holds. Once claims live in that shape, two
cheap checks become possible that weren't possible before: "does this claim
even have a linked reference" and "how long has it been since anyone
checked it." Neither check requires understanding what the claim means.

The result is a short review queue: which claims need evidence, which need
another look, and which meet the supplied review-date policy. A person still
needs to decide whether the evidence supports the words being published.

## Use it in a project

```bash
npm install claims-registry-kit
```

Zero runtime dependencies. ESM only (`"type": "module"`).

Or build from source: clone the repository and run `npm install && npm run build`.

## Example: a toy SaaS product

Say you're building "TaskFlow", a project-management tool, and your landing
page makes three claims:

```ts
import {
  type Claim,
  checkEvidenceLinked,
  checkStaleness,
  generateClaimsReport,
  formatClaimsReportAsText,
} from 'claims-registry-kit';

const claims: Claim[] = [
  {
    id: 'realtime-sync',
    text: 'Changes sync across your team in real time',
    evidenceRef: 'src/sync/websocketBroadcast.ts: broadcastChange fans out every mutation',
    verifiedAt: '2026-07-20',
    verifiedBy: 'automated-test',
  },
  {
    id: 'soc2-claim',
    text: 'SOC 2 Type II audited infrastructure',
    evidenceRef: 'docs/compliance/soc2-report-2025.pdf',
    verifiedAt: '2025-11-01', // nobody has re-checked this in months
  },
  {
    id: 'uptime-claim',
    text: '99.9% uptime, guaranteed',
    evidenceRef: '', // nothing backs this up in the codebase
    verifiedAt: '2026-08-01',
  },
];

const report = generateClaimsReport(claims, /* maxAgeDays */ 90);

console.log(formatClaimsReportAsText(report));
// Claims report — generated 2026-08-02T00:00:00.000Z (maxAgeDays: 90)
//   current: 1  stale: 1  unverified: 1  total: 3
//
// Stale claims (evidence linked, but review is overdue):
//   [soc2-claim] "SOC 2 Type II audited infrastructure" — 274d old
//
// Unverified claims (no evidenceRef):
//   [uptime-claim] "99.9% uptime, guaranteed"
```

You can also run the two underlying checks directly:

```ts
checkStaleness(claims, 90);       // => [ soc2-claim, evaluated with status: 'stale' ]
checkEvidenceLinked(claims);      // => [ uptime-claim, evaluated with status: 'unverified' ]
```

Both `checkStaleness` and `checkEvidenceLinked` — and `generateClaimsReport`
— funnel through the same `evaluateClaim(claim, maxAgeDays, now)` function,
so a claim is always bucketed the same way no matter which entry point you
call: **missing evidence always wins as `'unverified'`**, even if
`verifiedAt` is today. A fresh date next to an empty reference isn't
evidence of anything.

### Optional: a tiny in-memory registry

If it's convenient for several config modules to each register a claim at
load time, `createClaimsRegistry` gives you one array to run checks
against. It's optional — most callers will just keep an array of `Claim`
objects wherever they already keep config and skip this entirely.

```ts
import { createClaimsRegistry, generateClaimsReport } from 'claims-registry-kit';

const registry = createClaimsRegistry();
registry.registerClaim(claims[0]);
registry.registerClaim(claims[1]);

const report = generateClaimsReport(registry.getClaims(), 90);
```

### Running this as a CI check

```ts
// scripts/check-claims.ts
import { generateClaimsReport, formatClaimsReportAsText } from 'claims-registry-kit';
import { claims } from '../src/config/productClaims.js'; // wherever yours live

const report = generateClaimsReport(claims, 90);
console.log(formatClaimsReportAsText(report));

if (report.counts.stale > 0 || report.counts.unverified > 0) {
  process.exit(1);
}
```

This is meant to run as a **manual or periodic pass** — a Monday-morning
review someone runs before a launch, or a CI job that gates a PR — not as a
live/always-on cron. Nothing in this library schedules itself or watches
anything in the background; it computes an answer for the claims and `now`
you hand it, once, when you call it. If you want it on a schedule, wire the
script above into whatever scheduler you already use — that's outside this
library's job.

## API reference

Every export, briefly. Full behavior and edge cases are in each function's
TSDoc in [`src/checks.ts`](src/checks.ts), [`src/registry.ts`](src/registry.ts),
and [`src/types.ts`](src/types.ts) — read those for the exact rules; this is
a map, not the whole story.

### Types

- **`Claim<EvidenceRef = string>`** — `{ id, text, evidenceRef, verifiedAt, verifiedBy? }`.
  The record you build; `EvidenceRef` defaults to `string` but can be any
  shape you supply.
- **`IsoDateString`** — a `string` alias for `verifiedAt`: a bare
  `'YYYY-MM-DD'` (read as UTC midnight), or a full ISO 8601 timestamp that
  MUST carry an explicit `Z` or `+HH:mm`/`-HH:mm` offset. A timestamp with a
  time-of-day but no zone (e.g. `'2026-01-01T12:00:00'`) is treated as
  unparseable, not silently read as UTC — see "Honest limits".
- **`ClaimStatus`** — `'current' | 'stale' | 'unverified'`, always computed,
  never stored.
- **`EvaluatedClaim<EvidenceRef>`** — a `Claim` plus `status` and `ageDays`
  (whole elapsed days, or `null` if `verifiedAt` didn't parse).

### Functions

- **`evaluateClaim(claim, maxAgeDays, now?)`** → `EvaluatedClaim` — decide
  one claim's status. Every other function funnels through this, so a claim
  is always bucketed the same way. Defaults `now` to `new Date()`.
- **`checkStaleness(claims, maxAgeDays, now?)`** → `EvaluatedClaim[]` — only
  the claims that are `'stale'`, in input order.
- **`checkEvidenceLinked(claims, now?)`** → `EvaluatedClaim[]` — only the
  claims that are `'unverified'` (no usable `evidenceRef`), in input order.
- **`generateClaimsReport(claims, maxAgeDays, now?)`** → `ClaimsReport` — all
  three buckets plus counts and a `generatedAt` timestamp, in one call.
- **`formatClaimsReportAsText(report)`** → `string` — a `ClaimsReport`
  rendered as plain text for a terminal or a CI job summary.
- **`createClaimsRegistry<EvidenceRef>()`** → `ClaimsRegistry` — an optional
  in-memory store: `registerClaim` (throws on a duplicate `id`), `getClaims`,
  `getClaim(id)`, `clear()`. Copies claims in and out, so mutating an object
  you registered or one you got back never changes what the registry holds.

`evaluateClaim`, `checkStaleness`, `checkEvidenceLinked`, and
`generateClaimsReport` throw `TypeError`/`RangeError` on a malformed
argument (a non-array `claims`, a negative or non-numeric `maxAgeDays`, an
Invalid Date `now`) rather than silently returning a wrong answer — see
their TSDoc for the exact conditions.

## Honest limits

- **This checks that a claim HAS a linked evidence reference, and whether
  that check is stale. It does NOT verify the evidence still actually
  proves the claim.** `checkEvidenceLinked` is a structural presence check —
  is `evidenceRef` non-blank once whitespace and invisible formatting
  characters are stripped (or, for a list, does at least one of its entries
  qualify) — and it never opens the file, fetches the URL, or runs the test
  named in `evidenceRef`. A claim can point at a file that was gutted in last week's
  refactor and still read as `'current'` here, as long as someone bumped
  `verifiedAt`. Verifying that the evidence *still supports the claim's
  text* is a separate, much harder, domain-specific problem — it requires
  understanding both the claim and the artifact well enough to judge
  whether one still proves the other. That's out of scope on purpose. Pair
  this library with a grounding/citation-verification tool for that half of
  the problem —
  [`grounding-kit`](https://github.com/lkopietz3-byte/grounding-kit), a
  sibling project, classifies AI-generated text against the evidence it
  cites; this library deliberately does not attempt to reimplement that job
  for any kind of claim.
- **`verifiedAt` is only as honest as whoever sets it.** Nothing stops a
  person (or a bot) from bumping the date without actually re-checking the
  evidence. This library can tell you a claim hasn't been looked at in 200
  days; it can't tell you whether the last "verification" was real.
- **Dates are strict ISO 8601, not "whatever `new Date()` accepts" — and an
  unparseable `verifiedAt` fails safe to `'stale'` with `ageDays: null`.**
  `verifiedAt` must be either a bare `'YYYY-MM-DD'` (read as UTC midnight —
  it has no time-of-day, so there's nothing to be ambiguous about) or a full
  timestamp that carries an explicit `Z` or `+HH:mm`/`-HH:mm` offset. **A
  timestamp with a time-of-day but no zone, like `'2026-01-01T12:00:00'`, is
  NOT read as UTC** — it's treated exactly like any other unparseable value:
  `status: 'stale'` and `ageDays: null`, matching `freshness-kit`'s rule that
  a zone is required once there's a time-of-day for it to disambiguate.
  Guessing UTC for a zoneless timestamp would give the same string a
  different (and silently wrong) age depending on where it was evaluated;
  failing to `'stale'` instead means the worst a bad or ambiguous date can do
  is get a claim reviewed again, never hide it as `'current'`. The same
  fail-safe rule applies to any other value outside the accepted formats (a
  month name, `MM/DD/YYYY`, an impossible calendar day like `2026-02-30`) —
  always `'stale'`/`null`, never guessed at, never `'current'`.
- **A future `verifiedAt` gets a grace period sized to what its format can
  honestly explain, then reads as a typo.** A bare `'YYYY-MM-DD'` carries no
  time zone, so it may be up to 14 hours ahead of UTC before it's treated as
  a typo rather than clock skew — it can already be "today" in a zone ahead
  of UTC (UTC+14, e.g. Pacific/Kiritimati, is the furthest-ahead civil zone).
  An explicit timestamp names an exact, zoned instant and gets none of that
  slack: even one millisecond past `now` reads `'stale'`, not `'current'`.
  This matches the future-date rule in the sibling `freshness-kit` library.
- **No persistence, no scheduling, no notifications.** `createClaimsRegistry`
  is in-memory only and resets on restart. There's no built-in file
  format, database schema, cron, Slack webhook, or dashboard. Bring your
  own storage (a config module, a JSON file, a database table — anything
  that produces a `Claim[]`) and your own trigger (a CI step, a manual
  script run, a scheduled task in whatever system you already use).
- **`evidenceRef` is an opaque generic on purpose.** This library doesn't
  assume it's a file path, a URL, or anything specific — `Claim<EvidenceRef
  = string>` lets you supply a richer type (e.g. `{ kind: 'test' | 'url'
  | 'file'; ref: string }`) if a plain string isn't enough for your system.
  A non-string, non-array value (your own evidence object, for example) is
  always treated as present without inspecting it, since this library
  doesn't know its shape.

## Files

```
src/
  types.ts        Claim, IsoDateString, ClaimStatus, EvaluatedClaim
  registry.ts     createClaimsRegistry() — minimal in-memory registration
  checks.ts       evaluateClaim, checkStaleness, checkEvidenceLinked,
                  generateClaimsReport, formatClaimsReportAsText
  dates.ts        internal: strict ISO 8601 parsing (not exported)
  validate.ts     internal: argument checks shared by checks.ts (not exported)
  index.ts        Barrel export
test/
  claims.test.ts     Toy SaaS ("TaskFlow") example exercising every function
  validation.test.ts argument validation (maxAgeDays, now, claims)
  dates.test.ts      verifiedAt parsing, formats, and time zone/DST behavior
  future.test.ts     a verifiedAt ahead of now
  evidence.test.ts   what counts as a present vs. missing evidenceRef
  registry.test.ts   createClaimsRegistry copy-in/copy-out isolation
  helpers.ts         shared fixtures (not a test file itself)
```
