# Claims Registry Kit

**[Try it in your browser →](https://lkopietz3-byte.github.io/honesty-kits/#claims-registry-kit)** · Part of [honesty kits](https://github.com/lkopietz3-byte/honesty-kits), a family of small checks for the claims an AI product makes.

Claims Registry Kit is a small, dependency-free TypeScript library for
tracking public-facing claims alongside an evidence reference and a
last-verified date. It catches the structural problems that let product copy
quietly drift: claims with no linked evidence (including a reference that is
only a placeholder such as `TODO`) and claims whose review is overdue.

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

Zero runtime dependencies. Ships TypeScript declarations. Or build from
source: clone the repository and run `npm install && npm run build`.

It is an ESM package (`"type": "module"`). `import` is the supported way to
load it. `require()` also works where Node can `require(esm)`:

| How you load it | Node 20.19+ | Node 22.12+ | Node 24 and 26 | Older Node 20 or 22 |
| --- | --- | --- | --- | --- |
| `import { evaluateClaim } from 'claims-registry-kit'` | works | works | works | works |
| `require('claims-registry-kit')` | works | works | works | fails (no `require(esm)`); use `import()` |

Recommended runtimes are Node 22 and 24 (LTS) and Node 26 (current). Node 20 is
end-of-life. CI still runs the tests and the installed-package probes on Node
20.19.0 and 22.12.0 (the `require(esm)` floors) to catch regressions, but that
is compatibility testing, not a recommendation. `engines` in `package.json` is
`>=20`.

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

// Pin the clock so this example prints the same thing on any day. In real use,
// leave `now` out and the current time is used.
const NOW = new Date('2026-08-02T00:00:00.000Z');

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

const report = generateClaimsReport(claims, /* maxAgeDays */ 90, NOW);

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
checkStaleness(claims, 90, NOW);   // => [ soc2-claim, evaluated with status: 'stale' ]
checkEvidenceLinked(claims, NOW);  // => [ uptime-claim, evaluated with status: 'unverified' ]
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
objects wherever they already keep config and skip this entirely. The
registry copies each claim object on the way in and out, but the copy is
shallow: if `evidenceRef` is an array or an object, the registry and you still
share that inner value (see [Honest limits](#honest-limits)).

```ts
import { createClaimsRegistry, generateClaimsReport } from 'claims-registry-kit';

const registry = createClaimsRegistry();
registry.registerClaim(claims[0]);
registry.registerClaim(claims[1]);

const report = generateClaimsReport(registry.getClaims(), 90, NOW);
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

### Checking that a page shows the registered wording

`checkAppearsIn` answers one question: does this published text contain the
current wording of these registered claims? Use it on a pricing or disclosure
page so the copy cannot drift from the registry.

```ts
import { assertAppearsIn, checkAppearsIn } from 'claims-registry-kit';

// In a test or CI step: throws an Error that lists every claim that is not shown.
assertAppearsIn(registry, pricingPageText, ['uptime', 'refund-window'], { maxAgeDays: 90 });

// Or read the verdicts yourself.
const { ok, results } = checkAppearsIn(registry, pricingPageText, ['uptime'], { maxAgeDays: 90 });
// results: [{ id: 'uptime', verdict: 'present', claimStatus: 'current' }]
```

Each distinct id gets one verdict, in first-seen order:

| Verdict | Meaning |
| --- | --- |
| `present` | The claim's text is on the page and the claim is `'current'`. |
| `stale` | The text is on the page, but the claim is not `'current'` (`claimStatus` says `'stale'` or `'unverified'`). Showing it is the problem. |
| `missing` | The text is not on the page (or only inside a longer word or number), or the claim's text is not a string or is blank. |
| `unknown-id` | No claim is registered under exactly that id. A look-alike spelling (trailing space, zero-width character, other case) is unknown, not matched. |

`ok` is true only when every verdict is `present`. An empty id list throws a
`RangeError`, because it would pass having checked nothing. `maxAgeDays` is
required, and `now` and `placeholderRefs` work as in `evaluateClaim`.

How text is compared: both sides are NFKC-normalized, runs of whitespace
(including line breaks and no-break spaces) become one space, invisible
characters such as zero-width spaces and soft hyphens are dropped, curly quotes
become straight quotes, and dash and minus variants become `-`. Case matters
unless you pass `ignoreCase: true`. A match has to stand on word boundaries:
`uptime` is not found in `uptimes`, and `20` is not found in `120`, `20.5`,
`20,000` or `1.20`. A hyphen, slash or apostrophe counts as a boundary, so
`free` is found inside `free-trial`. All claims are searched in one pass, and a claim stops costing anything once
it is found. Cost is linear in the page text plus the claim texts for ordinary
and for nested wordings (`a`, `a a`, `a a a`, ... or `a`, `aa`, `aaa`, ...). One
shape is not strictly linear: claims whose texts are suffixes of each other, all
ending in punctuation, against a page where they keep failing the start
boundary. The extra work per page character is then at most the number of such
nested claims, which you control through what you register.

Not covered: placeholders such as `{rate}`. The registry stores no value beside
a claim's text, so there is nothing to substitute; register the final wording,
or one claim per rendered variant. Also not covered: HTML (strip tags first,
or `<b>` between words will make a claim `missing`), meaning (a page that says
"we do not offer free trials" still shows the words `free trials`), and where
on the page the text appears.

## API reference

Every export, briefly. Full behavior and edge cases are in each function's
TSDoc in [`src/checks.ts`](src/checks.ts), [`src/registry.ts`](src/registry.ts),
and [`src/types.ts`](src/types.ts) — read those for the exact rules; this is
a map, not the whole story.

### Types

- **`Claim<EvidenceRef = string>`** — `{ id, text, evidenceRef, verifiedAt, verifiedBy? }`.
  The record you build; `EvidenceRef` defaults to `string` but can be any
  shape you supply (a value that is falsy or blank counts as no evidence, see
  Honest limits). A claim must be a plain object (or one with a `null`
  prototype): a `Map`, `Date`, array or class instance is rejected with a
  `TypeError` instead of being read as a claim with no fields.
- **`IsoDateString`** — a `string` alias for `verifiedAt`: a bare
  `'YYYY-MM-DD'` (read as UTC midnight), or a full ISO 8601 timestamp that
  MUST carry an explicit `Z` or `+HH:mm`/`-HH:mm` offset. A timestamp with a
  time-of-day but no zone (e.g. `'2026-01-01T12:00:00'`) is treated as
  unparseable, not silently read as UTC — see "Honest limits".
- **`ClaimStatus`** — `'current' | 'stale' | 'unverified'`, always computed,
  never stored.
- **`EvaluatedClaim<EvidenceRef>`** — a `Claim` plus `status` and `ageDays`
  (elapsed time rounded down to whole days, for display only, or `null` if
  `verifiedAt` didn't parse). The status never reads `ageDays`; see
  [the threshold rule](#honest-limits).
- **`EvidenceOptions`**: `{ placeholderRefs?: readonly string[] | false }`,
  an optional last argument to `evaluateClaim`, `checkStaleness`,
  `checkEvidenceLinked` and `generateClaimsReport` that changes or switches
  off the placeholder list (below).

### Functions

- **`evaluateClaim(claim, maxAgeDays, now?, options?)`** → `EvaluatedClaim` —
  decide one claim's status. Every other function funnels through this, so a
  claim is always bucketed the same way. Defaults `now` to `new Date()`.
- **`checkStaleness(claims, maxAgeDays, now?, options?)`** → `EvaluatedClaim[]`
  — only the claims that are `'stale'`, in input order.
- **`checkEvidenceLinked(claims, now?, options?)`** → `EvaluatedClaim[]` — only
  the claims that are `'unverified'` (no usable `evidenceRef`), in input order.
- **`generateClaimsReport(claims, maxAgeDays, now?, options?)`** →
  `ClaimsReport` — all three buckets plus counts and a `generatedAt`
  timestamp, in one call.
- **`DEFAULT_PLACEHOLDER_REFS`**: the frozen default placeholder list:
  `TODO`, `TBD`, `N/A`, `none`, `-` and `see above`. Spread it to extend it.
- **`formatClaimsReportAsText(report)`** → `string` — a `ClaimsReport`
  rendered as plain text for a terminal or a CI job summary. Claim ids and
  text are caller strings, so control characters (including CR, LF and ESC),
  line and paragraph separators and bidi formatting characters are printed as
  visible `\uXXXX` escapes: a newline in a claim cannot forge a heading, and
  an ESC byte cannot reach a terminal. Visible text in any script is left
  alone and nothing is truncated. The `report` object itself stays raw, so
  read ids and text from it, not from the printed string, for anything other
  than showing to a person. The escaping is not reversible.
- **`checkAppearsIn(registry, text, claimIds, options)`** → `{ ok, results }` and
  **`assertAppearsIn(...)`** (same arguments, throws an `Error` listing each
  claim that is not `present`, returns the report otherwise): see "Checking that
  a page shows the registered wording". `registry` only needs `getClaim(id)`.
- **`createClaimsRegistry<EvidenceRef>()`** → `ClaimsRegistry` — an optional
  in-memory store: `registerClaim` (throws on a duplicate `id`, or on one that
  only looks the same), `getClaims`,
  `getClaim(id)`, `clear()`. Copies the top level of each claim in and out, so
  replacing a field on an object you registered or got back never changes what
  the registry holds. The copy is shallow: an `evidenceRef` that is an array
  or an object is shared, not cloned.

`evaluateClaim`, `checkStaleness`, `checkEvidenceLinked`, and
`generateClaimsReport` throw `TypeError`/`RangeError` on a malformed
argument (a non-array `claims`, a hole in it, a claim that is not a plain
object, a negative or non-numeric `maxAgeDays`, an Invalid Date `now`) rather
than silently returning a wrong answer — see their TSDoc for the exact
conditions. Each claim, the `claims` array and `now` are read once, then
validated and used from that one copy, so a getter or Proxy that answers
differently the second time cannot make the returned claim differ from the
one that was judged. `now` must be a real `Date` (a `Date` subclass works; an
object that only claims to be one does not).

`generateClaimsReport` and `registerClaim` also reject a claim `id` that is not
a string or shows nothing (empty, whitespace only, or only invisible
characters).

## Honest limits

- **How old is too old.** A claim is `'stale'` when MORE than
  `maxAgeDays` x 24 hours have elapsed since `verifiedAt`, compared in exact
  milliseconds. The limit is inclusive: a claim exactly `maxAgeDays` old is
  still `'current'`, and one millisecond older is `'stale'`. `maxAgeDays` can
  be fractional (`0.5` is 12 hours) or `0` (only a claim verified this very
  instant is current). `ageDays` is that elapsed time rounded down to whole
  days, for display only: a claim 90 days and 23 hours old shows
  `ageDays: 90` and is `'stale'` under `maxAgeDays: 90`, so a report can print
  `90d old` under a `maxAgeDays: 90` heading. A bare `YYYY-MM-DD` counts from
  UTC midnight, so it goes stale at the start of day `maxAgeDays` + 1 UTC, not
  at the end of it. Earlier versions compared the rounded-down day count, which
  let a claim stay `'current'` for up to 24 hours past the limit.
- **This checks that a claim HAS a linked evidence reference, and whether
  that check is stale. It does NOT verify the evidence still actually
  proves the claim.** `checkEvidenceLinked` is a structural presence check —
  is `evidenceRef` non-blank (or, for a list, does at least one of its
  entries qualify) — and it never opens the file, fetches the URL, or runs the
  test named in `evidenceRef`. Blank means only whitespace, control characters
  and `Default_Ignorable_Code_Point` characters (zero-width spaces and joiners,
  bidi controls such as U+061C and U+2066–2069, variation selectors, Hangul
  fillers and similar). Visible text in any script, emoji, and visible text
  wrapped in bidi controls all count as present. A reference that draws
  something but means nothing (a Braille blank) also counts as present. A
  claim can point at a file that was gutted in last week's
  refactor and still read as `'current'` here, as long as someone bumped
  `verifiedAt`. Verifying that the evidence *still supports the claim's
  text* is a separate, much harder, domain-specific problem — it requires
  understanding both the claim and the artifact well enough to judge
  whether one still proves the other. That's out of scope on purpose, and no kit
  in this family does it for you (see [Relationship to sibling
  kits](#relationship-to-sibling-kits)).
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
  `status: 'stale'` and `ageDays: null`. `freshness-kit` has the same zone
  requirement but throws a `RangeError` there, where this library reports
  `'stale'`.
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
  `freshness-kit` uses the same two thresholds (14 hours for a bare date, none
  for a timestamp) but throws a `RangeError` past them instead of reporting
  `'stale'`. This library's date grammar is also a little looser than
  `freshness-kit`'s: it accepts a space instead of `T`, lowercase `t` and `z`,
  a timestamp without seconds, an offset such as `+01` or `+0100`, and up to
  nine fractional digits.
- **Placeholder references are no evidence, by default.** An `evidenceRef`
  that is exactly `TODO`, `TBD`, `N/A`, `none`, `-` or `see above` means the
  field is saying there is no evidence, so the claim is `'unverified'` even
  with a fresh `verifiedAt`. The match is on the whole string, ignoring case,
  surrounding and repeated whitespace and invisible characters (and full-width
  letters): `https://example.com/todo-list`, `none-such-ref-123` and
  `- docs/a.md` are real references and stay linked. Inside a list, a
  placeholder entry is skipped like a blank one. Only this short list is
  matched; other stand-ins (`TBA`, `pending`, `?`, `...`, an em dash) still
  count as present. Pass `{ placeholderRefs: [...DEFAULT_PLACEHOLDER_REFS,
  'wip'] }` as the last argument to add your own, a different list to replace
  the defaults, or `{ placeholderRefs: false }` to switch matching off (only
  blank references are then missing). An object-shaped `evidenceRef` is never
  inspected, so `{ ref: 'TODO' }` counts as present. This is a behavior change
  from 0.3.1, where `TODO` counted as present.
- **Duplicate ids are only caught by the registry.** `createClaimsRegistry`
  rejects a second claim with the same `id`, and also one that only looks the
  same: after dropping invisible characters (zero-width spaces and joiners,
  bidi marks, the soft hyphen, variation selectors), normalizing to Unicode
  NFC and trimming surrounding whitespace, the two are equal. It throws an
  `Error` naming both spellings, with the invisible parts spelled out as
  `\uXXXX`, and never merges them. Ids that differ in case, in inner spacing
  (`a b` and `a  b`), or by a look-alike letter from another script (Cyrillic
  `а` for Latin `a`) are different ids and are not caught; `getClaim(id)` is
  an exact lookup. `generateClaimsReport` and the checks take a plain array
  and check none of this: two claims with the same `id`, or look-alike ids,
  can land in different buckets of one report. Keep ids unique, or go through
  the registry.
- **The registry's copy is shallow.** `registerClaim`, `getClaims` and
  `getClaim` copy the claim object, not what its fields point at. If
  `evidenceRef` is an array or an object, the registry and the caller share
  it: changing it in place after registering changes the registry's claim and
  can change its status. There is no automatic deep clone, freeze or
  serialization. Copy it yourself first if that matters.
- **The text escaping is display-only.** `formatClaimsReportAsText` escapes
  control, line-break and bidi formatting characters, so a claim cannot start
  a new line, forge a report heading or send a terminal escape. That is all it
  does. Quotes are not escaped: a claim's text is printed inside double quotes
  and can contain its own quote and text such as ` — 1d old`, so one claim line
  can be made to read as if it said something else. Square brackets in an id
  are not escaped either. Invisible characters that are not on the escaped
  list are left alone (a zero-width space in an id still prints as nothing),
  and a string that literally contains `\u001b` reads the same as one that
  contains ESC. It is not an HTML or Markdown escaper: escape it again for
  whatever renders it.
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
  It never opens, fetches or interprets the value. Only these are read as
  no evidence: `null`, `undefined`, `false`, `0`, `-0`, `NaN`, `0n`, an empty
  or visibly blank string, a placeholder string (see above), and a list with
  no present entry. The same rule applies to each entry inside a
  list, so `[false]`, `[0]` and `['']` are missing. Every other value (an
  object, `true`, a non-zero number, a function, a symbol) counts as present
  without inspection, so an object whose `ref` field is empty still counts as
  present: this library doesn't know its shape.

## Relationship to sibling kits

- [`freshness-kit`](https://github.com/lkopietz3-byte/freshness-kit) turns a
  review date into a graduated `fresh` / `aging` / `stale` signal and rejects
  a bad or future date with a `RangeError`. This library uses the same date
  rules for time zones and future dates but has one cutoff and reports a bad
  date as `'stale'` instead of throwing (see Honest limits).
- [`grounding-kit`](https://github.com/lkopietz3-byte/grounding-kit) checks
  that sentences of AI-generated text carry citation markers that point into an
  evidence map you supply. It is not a verifier for the claims tracked here:
  its own README says its default support check is naive word overlap, not
  entailment. Neither kit checks that a linked reference proves a claim's
  text.

## Files

```
src/
  types.ts        Claim, IsoDateString, ClaimStatus, EvaluatedClaim
  registry.ts     createClaimsRegistry() — minimal in-memory registration
  appears.ts      checkAppearsIn, assertAppearsIn (page text vs registered wording)
  checks.ts       evaluateClaim, checkStaleness, checkEvidenceLinked,
                  generateClaimsReport, formatClaimsReportAsText
  placeholders.ts DEFAULT_PLACEHOLDER_REFS and the internal placeholder matcher
  dates.ts        internal: strict ISO 8601 parsing (not exported)
  text.ts         internal: blank-string check and display escaping (not exported)
  validate.ts     internal: argument checks and one-time input copies (not exported)
  index.ts        Barrel export
test/
  claims.test.ts     Toy SaaS ("TaskFlow") example exercising every function
  validation.test.ts argument validation (maxAgeDays, now, claims)
  dates.test.ts      verifiedAt parsing, formats, and time zone/DST behavior
  future.test.ts     a verifiedAt ahead of now
  evidence.test.ts   what counts as a present vs. missing evidenceRef
  placeholders.test.ts  the placeholderRefs option and its validation
  verdict-table.test.ts one named case per verdict finding: the age threshold,
                        placeholder refs, look-alike ids, and the probes
  formatter.test.ts  formatClaimsReportAsText output and its escaping
  inputs.test.ts     read-once snapshots, plain-object claims, blank ids
  registry.test.ts   createClaimsRegistry copy-in/copy-out isolation
  helpers.ts         shared fixtures (not a test file itself)
```
