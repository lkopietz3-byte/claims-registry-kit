export type {
  IsoDateString,
  Claim,
  ClaimStatus,
  EvaluatedClaim,
  EvidenceOptions,
} from './types.js';

export { DEFAULT_PLACEHOLDER_REFS } from './placeholders.js';

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
