# @statewalker/backbone.node

Backbone server bootstrap: resolves an `AppManifest` against the filesystem and activates its modules, honoring the shared logger and module resolver.

## Installation

```sh
pnpm add @statewalker/backbone.node
```

## Usage

```ts
import { bootstrap } from "@statewalker/backbone.node";

await bootstrap({
  manifestPath: "./manifest.json",
  cwd: process.cwd(),
});
```

## API

- `bootstrap(options)`: resolve + activate the manifest. Options include `manifestPath`, `cwd`, and logger overrides.

## Related

- `@statewalker/backbone.core` — primitive resolver/activation used here.

## License

MIT — see the monorepo root `LICENSE`.
