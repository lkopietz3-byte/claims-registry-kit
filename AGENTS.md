# claims-registry-kit — agent instructions

A dependency-free TypeScript library for tracking public claims, their evidence references, and their review freshness.

## Read first
- `ENGINEERING.md` holds this package's invariants and design rules; read it before changing behavior.
- `PROJECT_CONTEXT.md` is the current project state and decisions.
- `SECURITY.md` covers the security posture; follow it for anything touching input handling.

## Commands (from package.json)
- `npm run verify`
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run build`
- `npm run verify:package` packs and installs the tarball offline; run `npm run build` first.

## Rules
- Run `npm run verify` and read its output before calling work done. Report any step that did not run.
- Build cleans `dist/` first; never trust a stale `dist/` for declaration or package checks.
- Never weaken lint, tests or `api-surface.json` to get green. Public API changes are deliberate (`node scripts/verify-package.mjs --update-api`) and must be called out.
- Do not run `npm publish` or push tags without explicit permission. Treat any claim that a version is published as Reported until the registry confirms it.
- Runtime `dependencies` stay empty; add dev tooling only.
- Keep unrelated uncommitted work intact; never stage or reset the whole tree.

## Review preparation

See [docs/REVIEW_READINESS.md](docs/REVIEW_READINESS.md) for review cadence, declared verification gates and the next consumer integration task.

## Code Review Rules

- Preserve status precedence: absent usable evidence is unverified even with a recent date; malformed, unparseable, overdue or too-far-future dates are stale. Bare dates retain 14-hour future tolerance; explicit timestamps have none.
- Evaluate from a single validated snapshot and reject malformed claims or bad policy/clock inputs instead of returning a plausible status. Preserve the documented omitted-now current-time default and explicit-clock reproducibility.
- Do not treat an evidence reference as proof: the kit does not open or assess it. Preserve duplicate-ID rejection and the documented shallow-copy boundary; nested evidence values remain shared unless the API deliberately changes.
