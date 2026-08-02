import type { Claim } from './types.js';

/**
 * A minimal in-memory registry for Claims.
 *
 * This is intentionally thin — the value this library provides is the
 * checking logic in `checks.ts`, not a database. Most callers won't need
 * this at all: keep claims as a plain array wherever you already keep
 * config (a module export, a JSON file, a database table) and pass that
 * array straight into `checkStaleness` / `checkEvidenceLinked` /
 * `generateClaimsReport`.
 *
 * Reach for `createClaimsRegistry` only when it's genuinely convenient to
 * have several files each register a claim at load time and end up with one
 * array to run checks against — e.g. mirroring the source pattern this
 * library was extracted from, where each feature's config module owned its
 * own claims.
 */
export interface ClaimsRegistry<EvidenceRef = string> {
  /**
   * Add a claim to the registry. Throws if a claim with the same `id` is
   * already registered — silently overwriting a claim would defeat the
   * point of a registry meant to catch drift.
   */
  registerClaim(claim: Claim<EvidenceRef>): void;
  /** All registered claims, in registration order. */
  getClaims(): Claim<EvidenceRef>[];
  /** A single claim by id, or `undefined` if none is registered under it. */
  getClaim(id: string): Claim<EvidenceRef> | undefined;
  /** Remove all registered claims. Mainly useful for tests. */
  clear(): void;
}

export function createClaimsRegistry<EvidenceRef = string>(): ClaimsRegistry<EvidenceRef> {
  const claims = new Map<string, Claim<EvidenceRef>>();

  return {
    registerClaim(claim) {
      if (claims.has(claim.id)) {
        throw new Error(
          `claims-registry-kit: a claim with id "${claim.id}" is already registered`,
        );
      }
      claims.set(claim.id, claim);
    },
    getClaims() {
      return Array.from(claims.values());
    },
    getClaim(id) {
      return claims.get(id);
    },
    clear() {
      claims.clear();
    },
  };
}
