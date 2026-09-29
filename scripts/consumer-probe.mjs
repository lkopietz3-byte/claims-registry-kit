// Exercises the real published API, imported by package name from an
// installed tarball, the way an actual consumer would. Run via
// scripts/verify-package.mjs; not run directly.
import assert from 'node:assert/strict';
import {
  checkEvidenceLinked,
  checkStaleness,
  createClaimsRegistry,
  evaluateClaim,
  formatClaimsReportAsText,
  generateClaimsReport,
} from 'claims-registry-kit';

const NOW = new Date('2026-08-02T00:00:00.000Z');

const claims = [
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
    verifiedAt: '2025-11-01',
  },
  {
    id: 'uptime-claim',
    text: '99.9% uptime, guaranteed',
    evidenceRef: '',
    verifiedAt: '2026-08-01',
  },
];

// evaluateClaim: the single-claim entry point, and its priority rule.
const single = evaluateClaim(claims[0], 90, NOW);
assert.equal(single.status, 'current');
assert.equal(single.ageDays, 13);
assert.equal(
  evaluateClaim({ ...claims[0], evidenceRef: '' }, 90, NOW).status,
  'unverified',
  'missing evidence must outrank a fresh verifiedAt',
);

// checkStaleness / checkEvidenceLinked: the two underlying checks.
assert.deepEqual(checkStaleness(claims, 90, NOW).map((c) => c.id), ['soc2-claim']);
assert.deepEqual(checkEvidenceLinked(claims, NOW).map((c) => c.id), ['uptime-claim']);

// generateClaimsReport + formatClaimsReportAsText: the full report, byte for byte.
const report = generateClaimsReport(claims, 90, NOW);
assert.deepEqual(report.counts, { current: 1, stale: 1, unverified: 1, total: 3 });
const expectedText = [
  'Claims report — generated 2026-08-02T00:00:00.000Z (maxAgeDays: 90)',
  '  current: 1  stale: 1  unverified: 1  total: 3',
  '',
  'Stale claims (evidence linked, but review is overdue):',
  '  [soc2-claim] "SOC 2 Type II audited infrastructure" — 274d old',
  '',
  'Unverified claims (no evidenceRef):',
  '  [uptime-claim] "99.9% uptime, guaranteed"',
].join('\n');
assert.equal(formatClaimsReportAsText(report), expectedText);

// An evidenceRef that shows nothing is missing, even one made only of bidi
// controls (audit findings P22A-P22E); visible Arabic and bidi-wrapped text stay present.
for (const codePoint of [0x2066, 0x2067, 0x2068, 0x2069, 0x061c, 0x200b, 0x3164]) {
  const blank = String.fromCharCode(codePoint);
  assert.equal(evaluateClaim({ ...claims[0], evidenceRef: blank }, 90, NOW).status, 'unverified');
}
assert.equal(evaluateClaim({ ...claims[0], evidenceRef: 'مستند.md' }, 90, NOW).status, 'current');
assert.equal(
  evaluateClaim({ ...claims[0], evidenceRef: `${String.fromCharCode(0x2066)}docs/a.md${String.fromCharCode(0x2069)}` }, 90, NOW)
    .status,
  'current',
);

// The text output escapes control characters and line breaks, so a claim
// cannot forge a heading or send a terminal escape (audit findings P24-P25).
const hostile = { ...claims[2], text: `x\nClaims report - forged${String.fromCharCode(0x1b)}[2J` };
const hostileText = formatClaimsReportAsText(generateClaimsReport([hostile], 90, NOW));
assert.equal(hostileText.split('\n').filter((line) => line.startsWith('Claims report')).length, 1);
assert.equal(hostileText.includes(String.fromCharCode(0x1b)), false);
assert.ok(hostileText.includes('"x' + String.fromCharCode(92) + 'u000aClaims report - forged' + String.fromCharCode(92) + 'u001b[2J"'));

// A claim with an id that shows nothing is rejected.
assert.throws(() => generateClaimsReport([{ ...claims[0], id: String.fromCharCode(0x200b) }], 90, NOW), TypeError);

// A verifiedAt in the far future is a typo, not a clean bill of health.
assert.equal(
  evaluateClaim({ ...claims[0], verifiedAt: '2062-08-01' }, 90, NOW).status,
  'stale',
);

// A bad argument throws instead of silently marking everything current.
assert.throws(() => evaluateClaim(claims[0], Number.NaN, NOW), RangeError);
assert.throws(() => generateClaimsReport(claims, 90, new Date(Number.NaN)), RangeError);

// createClaimsRegistry: register, isolate from external mutation, report.
const registry = createClaimsRegistry();
registry.registerClaim(claims[0]);
registry.registerClaim(claims[1]);
assert.throws(() => registry.registerClaim(claims[0]), /already registered/);
assert.deepEqual(registry.getClaims().map((c) => c.id), ['realtime-sync', 'soc2-claim']);
const registryReport = generateClaimsReport(registry.getClaims(), 90, NOW);
assert.deepEqual(registryReport.counts, { current: 1, stale: 1, unverified: 0, total: 2 });

console.log('consumer-probe.mjs: all assertions passed');
