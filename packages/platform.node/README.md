# @statewalker/platform.node

## What it is

The Node implementation of the `@statewalker/platform.core` commands. Its default export, `initPlatformNode(ctx, opts?)`, is a backbone fragment that answers `platform:preference-get` and `platform:preference-set` with values stored in one JSON file.

## Why it exists

Fragments that remember settings call `PreferenceGetCommand` and `PreferenceSetCommand` and should work the same when the application runs headless in Node (servers, CLIs, tests). This package gives those two commands durable storage on Node. The storage goes through a `FilesApi`, so tests can pass an in-memory one and the handlers never touch `node:fs` directly.

## How to use

```sh
pnpm add @statewalker/platform.node
```

Node only. Start it as a manifest root or call it directly. Options:

- `preferences?: FilesApi`: where `/preferences.json` lives. Default: a `NodeFilesApi` rooted at `$XDG_CONFIG_HOME/statewalker`, or `~/.config/statewalker` when `XDG_CONFIG_HOME` is not set.

## Examples

As a manifest root:

```ts
import { bootstrap } from "@statewalker/backbone.node";

await bootstrap({ roots: ["@statewalker/platform.node", "@my/server-fragment"] }, ctx);
```

Directly, with an in-memory store:

```ts
import initPlatformNode from "@statewalker/platform.node";
import { getCommands, PreferenceGetCommand, PreferenceSetCommand } from "@statewalker/platform.core";
import { MemFilesApi } from "@statewalker/webrun-files-mem";

const cleanup = initPlatformNode(ctx, { preferences: new MemFilesApi() });

const commands = getCommands(ctx);
await commands.call(PreferenceSetCommand, { key: "theme", value: "dark" }).promise;
const { value } = await commands.call(PreferenceGetCommand, { key: "theme" }).promise; // "dark"

await cleanup();
```

## Internals

### All preferences share one file

Every get reads `/preferences.json` and every set reads, changes one key and writes the whole object back (pretty-printed). A missing or unparsable file reads as `{}`, the same as an empty `localStorage` in the browser implementation. Two sets that run at the same time can lose one of the writes, since there is no lock between read and write.

### Commands this package does not answer

Pickers, clipboard, `download-blob`, `download-to-files` and URL state have no Node handler. Their declarations use the `silent` policy, so a call to one of them on Node never settles: no result, no error. Do not await them in code that may run headless without a timeout.

### Dependencies

`@statewalker/platform.core` (the contract), `@statewalker/workspace.core` (the workspace that owns the bus), `@statewalker/shared-commands` and `@statewalker/shared-registry` (bus and cleanup registry), `@statewalker/webrun-files` and `@statewalker/webrun-files-node` (file access through `FilesApi`).

## License

MIT
