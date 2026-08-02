import { describe, expect, it } from 'vitest';
import {
  checkEvidenceLinked,
  checkStaleness,
  createClaimsRegistry,
  evaluateClaim,
  generateClaimsReport,
  type Claim,
} from '../src/index.js';

// A toy SaaS product's claims — "TaskFlow", a fictional project-management
// tool — used purely to exercise the library. Nothing here is specific to
// any real product.
const NOW = new Date('2026-08-02T00:00:00.000Z');
const MAX_AGE_DAYS = 90;

function daysAgoIso(days: number, from: Date = NOW): string {
  return new Date(from.getTime() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const currentClaim: Claim = {
  id: 'realtime-sync',
  text: 'Changes sync across your team in real time',
  evidenceRef: 'src/sync/websocketBroadcast.ts: broadcastChange fans out every mutation over the shared socket',
  verifiedAt: daysAgoIso(10),
  verifiedBy: 'automated-test',
};

const staleClaim: Claim = {
  id: 'soc2-claim',
  text: 'SOC 2 Type II audited infrastructure',
  evidenceRef: 'docs/compliance/soc2-report-2025.pdf',
  verifiedAt: daysAgoIso(200), // well past a 90-day policy
  verifiedBy: 'jordan@taskflow.example',
};

const unverifiedClaim: Claim = {
  id: 'uptime-claim',
  text: '99.9% uptime, guaranteed',
  evidenceRef: '', // no evidence at all
  verifiedAt: daysAgoIso(0), // verified "today" — should not rescue it
};

describe('evaluateClaim', () => {
  it('reports "current" for a recently verified, evidence-linked claim', () => {
    const result = evaluateClaim(currentClaim, MAX_AGE_DAYS, NOW);
    expect(result.status).toBe('current');
    expect(result.ageDays).toBe(10);
  });

  it('reports "stale" for a claim whose verifiedAt is older than maxAgeDays', () => {
    const result = evaluateClaim(staleClaim, MAX_AGE_DAYS, NOW);
    expect(result.status).toBe('stale');
    expect(result.ageDays).toBe(200);
  });

  it('reports "unverified" for a claim with no evidenceRef, regardless of how fresh verifiedAt is', () => {
    const result = evaluateClaim(unverifiedClaim, MAX_AGE_DAYS, NOW);
    expect(result.status).toBe('unverified');
    // verifiedAt was "today" — proves date freshness does not override missing evidence.
    expect(result.ageDays).toBe(0);
  });

  it('treats whitespace-only evidenceRef the same as empty', () => {
    const result = evaluateClaim({ ...currentClaim, evidenceRef: '   ' }, MAX_AGE_DAYS, NOW);
    expect(result.status).toBe('unverified');
  });

  it('treats an unparseable verifiedAt as stale, not current, even with evidence present', () => {
    const result = evaluateClaim(
      { ...currentClaim, verifiedAt: 'not-a-date' },
      MAX_AGE_DAYS,
      NOW,
    );
    expect(result.status).toBe('stale');
    expect(result.ageDays).toBeNull();
  });

  it('treats a claim exactly at the maxAgeDays boundary as still current', () => {
    const boundaryClaim: Claim = { ...currentClaim, verifiedAt: daysAgoIso(MAX_AGE_DAYS) };
    const result = evaluateClaim(boundaryClaim, MAX_AGE_DAYS, NOW);
    expect(result.status).toBe('current');
  });
});

describe('checkStaleness', () => {
  it('returns only claims whose evidence is linked but overdue for review', () => {
    const stale = checkStaleness([currentClaim, staleClaim, unverifiedClaim], MAX_AGE_DAYS, NOW);
    expect(stale.map((c) => c.id)).toEqual(['soc2-claim']);
  });

  it('never includes an unverified (no-evidence) claim, even if its date is ancient', () => {
    const ancientNoEvidence: Claim = { ...unverifiedClaim, verifiedAt: daysAgoIso(500) };
    const stale = checkStaleness([ancientNoEvidence], MAX_AGE_DAYS, NOW);
    expect(stale).toHaveLength(0);
  });
});

describe('checkEvidenceLinked', () => {
  it('returns only claims missing an evidenceRef', () => {
    const unlinked = checkEvidenceLinked([currentClaim, staleClaim, unverifiedClaim], NOW);
    expect(unlinked.map((c) => c.id)).toEqual(['uptime-claim']);
    expect(unlinked[0].status).toBe('unverified');
  });

  it('returns an empty array when every claim has evidence', () => {
    const unlinked = checkEvidenceLinked([currentClaim, staleClaim], NOW);
    expect(unlinked).toHaveLength(0);
  });
});

describe('generateClaimsReport', () => {
  it('buckets a mixed set of claims into current / stale / unverified with accurate counts', () => {
    const secondCurrentClaim: Claim = {
      id: 'export-claim',
      text: 'Export your data as CSV or JSON any time',
      evidenceRef: 'src/export/exportData.ts',
      verifiedAt: daysAgoIso(1),
    };

    const report = generateClaimsReport(
      [currentClaim, staleClaim, unverifiedClaim, secondCurrentClaim],
      MAX_AGE_DAYS,
      NOW,
    );

    expect(report.counts).toEqual({ current: 2, stale: 1, unverified: 1, total: 4 });
    expect(report.current.map((c) => c.id).sort()).toEqual(['export-claim', 'realtime-sync']);
    expect(report.stale.map((c) => c.id)).toEqual(['soc2-claim']);
    expect(report.unverified.map((c) => c.id)).toEqual(['uptime-claim']);
    expect(report.maxAgeDays).toBe(MAX_AGE_DAYS);
    expect(report.generatedAt).toBe(NOW.toISOString());
  });

  it('produces zero counts for an empty claim set', () => {
    const report = generateClaimsReport([], MAX_AGE_DAYS, NOW);
    expect(report.counts).toEqual({ current: 0, stale: 0, unverified: 0, total: 0 });
  });
});

describe('createClaimsRegistry', () => {
  it('registers claims and returns them in registration order', () => {
    const registry = createClaimsRegistry();
    registry.registerClaim(currentClaim);
    registry.registerClaim(staleClaim);

    expect(registry.getClaims().map((c) => c.id)).toEqual(['realtime-sync', 'soc2-claim']);
    expect(registry.getClaim('soc2-claim')).toEqual(staleClaim);
    expect(registry.getClaim('missing')).toBeUndefined();
  });

  it('throws when registering a duplicate id', () => {
    const registry = createClaimsRegistry();
    registry.registerClaim(currentClaim);
    expect(() => registry.registerClaim(currentClaim)).toThrow(/already registered/);
  });

  it('clear() empties the registry', () => {
    const registry = createClaimsRegistry();
    registry.registerClaim(currentClaim);
    registry.clear();
    expect(registry.getClaims()).toHaveLength(0);
  });

  it('registered claims can be fed straight into generateClaimsReport', () => {
    const registry = createClaimsRegistry();
    registry.registerClaim(currentClaim);
    registry.registerClaim(staleClaim);
    registry.registerClaim(unverifiedClaim);

    const report = generateClaimsReport(registry.getClaims(), MAX_AGE_DAYS, NOW);
    expect(report.counts).toEqual({ current: 1, stale: 1, unverified: 1, total: 3 });
  });
});
