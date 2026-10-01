# Review and consumer integration readiness

Updated September 30, 2026 against main `6d420a648be6ea40973c298a80a30043c90d4772`. The npm registry reported `claims-registry-kit@0.3.0` on that date. This is review guidance for future changes and a consumer integration task; it is not a product audit, registry integrity check or marketing certification.

## Review cadence

Request one focused review on a meaningful candidate PR after relevant checks; repeat when material changes invalidate that review. Review cadence and automation settings should reflect the current development stage and available review capacity.

When this repo enters sustained launch or customer-facing development, enable its repository setting individually with **All PRs / On PR open / Exhaustive Off**. Keep the personal automatic default and credit-funded reviews off. Inspect the first result before expanding cadence. Review guidance lives in the root [AGENTS.md](../AGENTS.md); it supplements existing tests and release requirements.

Check current repository and personal review settings before changing review automation. This document does not activate a setting.

## Next consumer integration task

For the next consumer integration, verify a packed-consumer registry with missing evidence, explicit-offset/bare-date boundaries and duplicate IDs. Check that marketing status labels refer to presence/freshness rather than source truth.

Finish condition: The real API returns the documented classifications and registry errors, and the receipt states the chosen clock, shallow-copy boundary and evidence-reference limits.

## Declared verification commands

Read from the current `package.json`. These are declared gates, not execution receipts. Use focused checks during implementation and the existing release gates on the frozen candidate; report unavailable checks explicitly.

- `npm run verify`: `npm run lint && npm run typecheck && npm test && npm run build && npm run verify:package`
- `npm run lint`: `eslint . --max-warnings=0`
- `npm run typecheck`: `tsc --noEmit`
- `npm run test`: `vitest run`
- `npm run build`: `node -e "require('fs').rmSync('dist',{recursive:true,force:true})" && tsc -p tsconfig.build.json`
- `npm run verify:package`: `node scripts/verify-package.mjs`
- `npm run attw`: `attw --pack . --ignore-rules cjs-resolves-to-esm`

Local tests, hosted authorization, installed package behavior, deployment and buyer evidence are separate outcomes. A dated receipt applies to its recorded revision.

## Source basis

- [ENGINEERING.md](../ENGINEERING.md)
- [PROJECT_CONTEXT.md](../PROJECT_CONTEXT.md)
- [src/checks.ts](../src/checks.ts)
- [src/registry.ts](../src/registry.ts)

Public claims require current candidate evidence. Private-data transfers, commercial commitments, package publication, database promotion and deployment retain their existing authorization boundaries.
