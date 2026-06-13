# `_vendor/` — narrow slices of `@statewalker/*` vendored for backbone-independence

Per the `statewalker-workbench` backbone-independence rule (design §D4 of the
`repo-split-foundation` change), `backbone-*` packages MUST NOT declare a
runtime dependency on any `@statewalker/*` package — including siblings in
the same monorepo. The backbone ships the narrow primitives it needs by
vendoring them here.

## Current vendored slices

| File | Source | Copied | Why the narrow slice |
| --- | --- | --- | --- |
| `logger.ts` | `@statewalker/shared-logger` (`logger.adapter.ts`) | 2026-04-19 | Backbone only needs the `Logger` type and a context-keyed lookup; it does not need the adapter-registration machinery. |

## Drift policy

When the upstream `@statewalker/*` interface evolves:

1. Detect via `scripts/check-backbone-isolation.ts` — it fails CI if backbone
   imports `@statewalker/*` at runtime, forcing a refresh of the vendored copy.
2. Update the vendored file here; keep the top-of-file header stamp current
   (`Source:`, `Copied:`).
3. Re-run backbone tests to confirm the narrow contract is still satisfied.

## Expansion policy

Add a new vendored slice only when a backbone package needs a primitive that
currently lives in a `@statewalker/*` package. Prefer the narrowest possible
contract. Large surface copies defeat the purpose — they become their own
maintenance burden.
