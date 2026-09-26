import { describe, expect, it } from 'vitest';
import { createClaimsRegistry, type Claim } from '../src/index.js';
import { claim } from './helpers.js';

// A registry is supposed to be the one place a set of claims can't silently
// go inconsistent. That promise only holds if it owns its data: mutating the
// object a caller handed in, or the object a caller got back out, must not
// reach back into the registry's own state.

describe('createClaimsRegistry isolates its stored claims from the caller', () => {
  it('is not affected by the caller mutating the object after registering it', () => {
    const registry = createClaimsRegistry();
    const original = claim({ id: 'a', evidenceRef: 'docs/a.md' });
    registry.registerClaim(original);

    original.evidenceRef = '';
    original.id = 'b'; // deliberately mutating the id after registration, the exact case this guards

    expect(registry.getClaim('a')).toEqual(claim({ id: 'a', evidenceRef: 'docs/a.md' }));
    expect(registry.getClaim('b')).toBeUndefined();
    expect(registry.getClaims()).toHaveLength(1);
  });

  it('does not let mutating a claim returned by getClaims() reach back into the registry', () => {
    const registry = createClaimsRegistry();
    registry.registerClaim(claim({ id: 'a', evidenceRef: 'docs/a.md' }));

    const [returned] = registry.getClaims();
    returned.evidenceRef = '';
    returned.text = 'tampered';

    expect(registry.getClaim('a')).toEqual(claim({ id: 'a', evidenceRef: 'docs/a.md' }));
  });

  it('does not let mutating a claim returned by getClaim() reach back into the registry', () => {
    const registry = createClaimsRegistry();
    registry.registerClaim(claim({ id: 'a', evidenceRef: 'docs/a.md' }));

    const returned = registry.getClaim('a');
    if (returned === undefined) throw new Error('expected the claim to be registered');
    returned.evidenceRef = '';

    expect(registry.getClaim('a')?.evidenceRef).toBe('docs/a.md');
  });

  it('two calls to getClaims() return independent objects for the same claim', () => {
    const registry = createClaimsRegistry();
    registry.registerClaim(claim({ id: 'a' }));

    const [first] = registry.getClaims();
    const [second] = registry.getClaims();
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });

  it('still throws on a duplicate id no matter which claim mutated first', () => {
    const registry = createClaimsRegistry();
    const x = claim({ id: 'shared' });
    registry.registerClaim(x);
    x.id = 'renamed'; // must not let the second registration in under a changed id check
    expect(() => registry.registerClaim(claim({ id: 'shared' }))).toThrow(/already registered/);
  });

  it('a generic evidenceRef object survives round-trip equal but not identical', () => {
    interface Ref {
      kind: 'file';
      ref: string;
    }
    const registry = createClaimsRegistry<Ref>();
    const withRef: Claim<Ref> = { ...claim(), evidenceRef: { kind: 'file', ref: 'a.ts' } };
    registry.registerClaim(withRef);
    expect(registry.getClaim('c1')?.evidenceRef).toEqual({ kind: 'file', ref: 'a.ts' });
  });
});
