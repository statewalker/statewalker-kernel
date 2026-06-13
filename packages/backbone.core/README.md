# @statewalker/backbone-common

Backbone primitives used by both the server and web runtimes: module resolver, topological sort, activation sequencing, `AppManifest` type, plus the vendored `Logger`/`getLogger` slice that keeps backbone independent of `@statewalker/*`.

## Installation

```sh
pnpm add @statewalker/backbone-common
```

## Usage

```ts
import { activateModules, getLogger, ModuleResolver, topoSort } from "@statewalker/backbone-common";

const resolver = new ModuleResolver(/* ... */);
const modules = await resolver.resolve();
const ordered = topoSort(modules);
await activateModules(ordered, { log: getLogger({}) });
```

## API

- `ModuleResolver` / `resolveModules`: resolve a manifest into concrete module descriptors.
- `activateModules`: sequence activation per topo-sorted modules.
- `topoSort`: generic topological sort used by the resolver.
- `Logger` / `getLogger` / `setLogger`: narrow logger slice (vendored; no runtime dep on `@statewalker/shared-logger`).
- Types: `AppManifest`, `FragmentInit`, `ResolvedModule`, `ModuleResolverOptions`, `GraphNode`.

## Related

- `@statewalker/backbone-server` — Node-side bootstrap that consumes this package.
- `@statewalker/backbone-web` — browser-side fragment loader built on top.

## License

MIT — see the monorepo root `LICENSE`.
