import type { Claim } from './types.js';
import { escapeForDisplay } from './text.js';
import { assertClaimId, snapshotClaim } from './validate.js';

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
 *
 * `registerClaim`, `getClaims`, and `getClaim` all shallow-copy the claim
 * object, so mutating the object you passed in (or one you got back out)
 * afterward never changes what the registry holds. That copy is shallow: if
 * `evidenceRef` (or another field) is itself an array or object, the
 * registry and the caller still share that inner value.
 */
export interface ClaimsRegistry<EvidenceRef = string> {
  /**
   * Add a claim to the registry. Throws if a claim with the same `id` is
   * already registered — silently overwriting a claim would defeat the
   * point of a registry meant to catch drift. Also throws if `claim` isn't
   * an object or its `id` isn't a non-empty string: this registry is keyed
   * by `id`, so a claim without one has no way to be found, updated, or
   * de-duplicated again later.
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
      // One copy, taken once: the id checked, the key stored under and the id
      // inside the stored claim are the same value, even if the caller passed
      // a getter or mutates the original afterward. The copy is shallow.
      const copy = snapshotClaim<EvidenceRef>(claim, 'claim');
      assertClaimId(copy.id, 'claim');
      if (claims.has(copy.id)) {
        throw new Error(
          `claims-registry-kit: a claim with id "${escapeForDisplay(copy.id)}" is already registered`,
        );
      }
      claims.set(copy.id, copy);
    },
    getClaims() {
      // Shallow-copy on the way out too, so mutating a returned claim can't
      // reach back into the registry's own state.
      return Array.from(claims.values(), (claim) => ({ ...claim }));
    },
    getClaim(id) {
      const claim = claims.get(id);
      return claim === undefined ? undefined : { ...claim };
    },
    clear() {
      claims.clear();
    },
  };
}
