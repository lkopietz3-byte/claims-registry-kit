// Strict NodeNext type probe: compiled (never run) by scripts/verify-package.mjs
// against the installed .d.ts files, the way a TypeScript consumer's own
// tsconfig (strict, NodeNext) would see this package. No @types/node here
// (this kit has none as a dev dependency), so no `node:` imports — a tiny
// local assert stands in.
import {
  checkEvidenceLinked,
  checkStaleness,
  createClaimsRegistry,
  evaluateClaim,
  formatClaimsReportAsText,
  generateClaimsReport,
  type Claim,
  type ClaimsReport,
  type ClaimStatus,
  type EvaluatedClaim,
  type IsoDateString,
} from 'claims-registry-kit';

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}
function assertTrue(value: boolean, message: string): asserts value {
  if (!value) throw new Error(message);
}

const verifiedAt: IsoDateString = '2026-07-20';

// The default EvidenceRef = string.
const stringClaim: Claim = {
  id: 'realtime-sync',
  text: 'Changes sync across your team in real time',
  evidenceRef: 'src/sync/broadcast.ts',
  verifiedAt,
  verifiedBy: 'automated-test',
};

// A caller-defined, richer EvidenceRef, the way the README's "Honest limits"
// section says this generic is meant to be used.
interface FileRef {
  kind: 'file' | 'url' | 'test';
  ref: string;
}
const richClaim: Claim<FileRef> = {
  id: 'soc2-claim',
  text: 'SOC 2 Type II audited infrastructure',
  evidenceRef: { kind: 'file', ref: 'docs/compliance/soc2-report-2025.pdf' },
  verifiedAt: '2025-11-01',
};

const now = new Date('2026-08-02T00:00:00.000Z');

const evaluated: EvaluatedClaim<FileRef> = evaluateClaim(richClaim, 90, now);
const status: ClaimStatus = evaluated.status;
const ageDays: number | null = evaluated.ageDays;
assertEqual(status, 'stale', 'status');
assertEqual(ageDays, 274, 'ageDays');

// The plain-array entry points, typed against the default EvidenceRef.
const claims: Claim[] = [stringClaim];
const stale: EvaluatedClaim[] = checkStaleness(claims, 90, now);
const unverified: EvaluatedClaim[] = checkEvidenceLinked(claims, now);
const report: ClaimsReport = generateClaimsReport(claims, 90, now);
const text: string = formatClaimsReportAsText(report);
assertEqual(stale.length, 0, 'stale.length');
assertEqual(unverified.length, 0, 'unverified.length');
assertTrue(text.includes('realtime-sync'), 'report text should mention the claim id');

// The registry, typed against the caller-defined EvidenceRef.
const registry = createClaimsRegistry<FileRef>();
registry.registerClaim(richClaim);
const fromRegistry: Claim<FileRef>[] = registry.getClaims();
assertEqual(fromRegistry[0]?.evidenceRef.kind, 'file', 'registered evidenceRef.kind');

console.log('consumer-probe.mts: type probe assembled without error');
