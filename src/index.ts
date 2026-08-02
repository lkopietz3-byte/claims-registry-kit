export type { IsoDateString, Claim, ClaimStatus, EvaluatedClaim } from './types.js';

export { createClaimsRegistry } from './registry.js';
export type { ClaimsRegistry } from './registry.js';

export {
  evaluateClaim,
  checkStaleness,
  checkEvidenceLinked,
  generateClaimsReport,
  formatClaimsReportAsText,
} from './checks.js';
export type { ClaimsReport } from './checks.js';
