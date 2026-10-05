# `_vendor/` — narrow slices of `@statewalker/*` vendored for backbone-independence

Per the backbone-independence rule (design §D4 of the `repo-split-foundation`
change), the `@statewalker/backbone.*` packages MUST NOT declare a runtime
dependency on any other `@statewalker/*` package (they may depend on each
other). The backbone ships the narrow primitives it needs by vendoring them
here.

## Current vendored slices

| File | Source | Copied | Why the narrow slice |
| --- | --- | --- | --- |
| `logger.ts` | `@statewalker/shared-logger` (`logger.adapter.ts`) | 2026-04-19 | Backbone only needs the `Logger` type and a context-keyed lookup; it does not need the adapter-registration machinery. |

## Drift policy

When the upstream `@statewalker/*` interface evolves:

1. Detect via `scripts/check-backbone-isolation.ts` at the repository root
   (`pnpm exec tsx scripts/check-backbone-isolation.ts`) — it exits non-zero if a
   backbone package declares a runtime `@statewalker/*` dependency. It is not
   part of CI; run it by hand.
2. Update the vendored file here; keep the top-of-file header stamp current
   (`Source:`, `Copied:`).
3. Re-run backbone tests to confirm the narrow contract is still satisfied.

## Expansion policy

Add a new vendored slice only when a backbone package needs a primitive that
currently lives in a `@statewalker/*` package. Prefer the narrowest possible
contract. Large surface copies defeat the purpose — they become their own
maintenance burden.
