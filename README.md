# claims-registry-kit

A tiny, zero-dependency library that keeps public-facing product claims
honest over time by tying each one to an evidence reference and a
last-verified date — so a claim can't quietly drift away from what the
codebase actually does without something noticing.

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

**This is the same idea SOC2/compliance tools like Vanta or Drata use for
mapping controls to evidence** — a compliance control ("we encrypt data at
rest") is stored next to a pointer to the artifact that proves it, with a
last-checked date, so an auditor can see at a glance what's covered and
what's gone stale. This library applies that exact structure to ordinary
product and marketing claims instead of compliance controls. That's a fair
comparison, not a stretch — the data shape and the staleness discipline are
genuinely the same pattern; this library just doesn't do compliance-grade
things like audit trails, control frameworks, or attestation workflows. See
**Honest limits** below for the rest of what it doesn't do.

## Install

```bash
npm install
npm test           # vitest
npm run typecheck  # tsc --noEmit
npm run build       # emits dist/ (ESM + .d.ts)
```

Zero runtime dependencies. ESM only (`"type": "module"`). MIT licensed.

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

## Honest limits

- **This checks that a claim HAS a linked evidence reference, and whether
  that check is stale. It does NOT verify the evidence still actually
  proves the claim.** `checkEvidenceLinked` is a structural, one-line
  presence check (is `evidenceRef` non-empty?) — it never opens the file,
  fetches the URL, or runs the test named in `evidenceRef`. A claim can
  point at a file that was gutted in last week's refactor and still read
  as `'current'` here, as long as someone bumped `verifiedAt`. Verifying
  that the evidence *still supports the claim's text* is a separate, much
  harder, domain-specific problem — it requires understanding both the
  claim and the artifact well enough to judge whether one still proves the
  other. That's out of scope on purpose. Pair this library with a
  grounding/citation-verification tool for that half of the problem (for
  example, a sentence-level grounding checker that classifies text against
  a set of evidence) — this library deliberately does not attempt to
  reimplement that job.
- **`verifiedAt` is only as honest as whoever sets it.** Nothing stops a
  person (or a bot) from bumping the date without actually re-checking the
  evidence. This library can tell you a claim hasn't been looked at in 200
  days; it can't tell you whether the last "verification" was real.
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
  Whatever shape you choose, this library only ever checks whether it's
  present, never what it points to.

## Files

```
src/
  types.ts       Claim, ClaimStatus, EvaluatedClaim
  registry.ts     createClaimsRegistry() — minimal in-memory registration
  checks.ts       evaluateClaim, checkStaleness, checkEvidenceLinked,
                   generateClaimsReport, formatClaimsReportAsText
  index.ts        Barrel export
test/
  claims.test.ts  Toy SaaS ("TaskFlow") example exercising every function
```
