# @statewalker/backbone.browser

Backbone web runtime: fragment loader and browser-side module activation for the backbone platform.

## Installation

```sh
pnpm add @statewalker/backbone.browser
```

## Usage

```ts
import { loadFragment } from "@statewalker/backbone.browser";

const fragment = await loadFragment({ url: "/fragments/chat.js" });
await fragment.activate(context);
```

## API

- `loadFragment(options)`: fetch + sucrase-transpile + activate a fragment.
- `activateFragments(manifest)`: higher-level activation bound to `AppManifest`.

## Related

- `@statewalker/backbone.core` — shared primitives.
- `@statewalker/backbone.node` — Node analogue for server-side manifests.

## License

MIT — see the monorepo root `LICENSE`.
