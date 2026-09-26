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
