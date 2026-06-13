# @statewalker/backbone-server

Backbone server bootstrap: resolves an `AppManifest` against the filesystem and activates its modules, honoring the shared logger and module resolver.

## Installation

```sh
pnpm add @statewalker/backbone-server
```

## Usage

```ts
import { bootstrap } from "@statewalker/backbone-server";

await bootstrap({
  manifestPath: "./manifest.json",
  cwd: process.cwd(),
});
```

## API

- `bootstrap(options)`: resolve + activate the manifest. Options include `manifestPath`, `cwd`, and logger overrides.

## Related

- `@statewalker/backbone-common` — primitive resolver/activation used here.

## License

MIT — see the monorepo root `LICENSE`.
