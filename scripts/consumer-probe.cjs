// Proves CommonJS require() works against the packed tarball, on a Node
// version that supports require(esm) (>=20.19.0 or >=22.12.0). This file is
// plain CommonJS regardless of the consumer project's "type": "module",
// because a .cjs extension always forces CommonJS. Run by verify-package.mjs.
const assert = require('node:assert/strict');

const { evaluateClaim, generateClaimsReport, createClaimsRegistry } = require('claims-registry-kit');

const NOW = new Date('2026-08-02T00:00:00.000Z');
const claim = {
  id: 'realtime-sync',
  text: 'Changes sync across your team in real time',
  evidenceRef: 'src/sync/websocketBroadcast.ts',
  verifiedAt: '2026-07-20',
};

const result = evaluateClaim(claim, 90, NOW);
assert.equal(result.status, 'current');

const report = generateClaimsReport([claim], 90, NOW);
assert.equal(report.counts.total, 1);
assert.equal(report.counts.current, 1);

const registry = createClaimsRegistry();
registry.registerClaim(claim);
assert.deepEqual(registry.getClaims(), [claim]);
assert.deepEqual(registry.getClaim('realtime-sync'), claim);

console.log('CommonJS require() probe passed');
