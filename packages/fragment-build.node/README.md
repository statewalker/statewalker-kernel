# @statewalker/fragment-build.node

## What it is

The Node side of fragment authoring: it loads a fragment folder's `fragment.config.ts`, writes the files it generates beside it, reads the built folder, and packs it into a content-hashed archive with [fragment-build.core](../fragment-build.core). It also gives the `fragment-build` command. Private for now.

## Why it exists

Generating and packing are portable (fragment-build.core); finding a folder's files and loading a TypeScript config are not. Keeping them here leaves the `.core` package free of Node built-ins (statewalker-root#251).

## How to use

```sh
fragment-build ./notes                 # generate, then pack ./notes/dist/<id>-<version>.fragment.json
fragment-build ./notes --out ./archives
fragment-build generate ./notes        # only write the generated files
```

It prints `<hash> <archive path>`, exits 1 with a message when the build fails and 2 on bad arguments.

```ts
import { buildFragment, generateFragment, loadFragmentConfig, readFragmentFolder } from "@statewalker/fragment-build.node";

const { hash, path, archive } = await buildFragment("./notes");
await kernel.install([archive.files]);
```

| Export | Provides |
| --- | --- |
| `loadFragmentConfig(dir)` | The default export of `<dir>/fragment.config.ts` (through `tsx`), or `undefined`. |
| `generateFragment(dir)` | Writes the generated files into `dir`; `undefined` without a config. |
| `readFragmentFolder(dir)` | The built folder's files, by relative POSIX path. |
| `buildFragment(dir, { outDir?, archiveSchema? })` → `{ id, version, hash, archive, path, generated }` | Generate (when there is a config), read, pack, write the archive. |
| `main(args, io?)` | The `fragment-build` command. |

## Internals

A folder without `fragment.config.ts` is hand-written: it is packed as it is. The archive takes the root files `fragment.jsonc`, `fragment.<aspect>.jsonc`, `wrangler.jsonc` and `openapi.json`, then every file under the folder of each aspect `fragment.jsonc` lists (its `dir`, else `server/`, `client/`, `agent/`), skipping dot entries (`.wrangler/` state) and `node_modules`. Anything else at the root (the config, `package.json`, `dist/`) stays out. A file that is not UTF-8 text is refused by name: archive format v1 carries text only. Paths are read with `/` on every platform, and file times play no part, so the same sources give the same hash on any machine.

The config is loaded with `tsx`'s `tsImport`, so it may import `zod` and `@statewalker/fragment-build.core` from the fragment's own dependencies; each load is a fresh module.

The tests run the real kernel with `system.commands` on built archives, and `wrangler dev --local` (wrangler is a dev dependency) on an archive unpacked into an empty folder: the generated `wrangler.jsonc`, with a Durable Object and its sqlite migration, serves requests unchanged.

### Dependencies

- `@statewalker/fragment-build.core`, `@statewalker/kernel.core`.
- `tsx`: loads `fragment.config.ts`.
- `zod` (peer, 4), as for fragment-build.core.

## License

MIT. See [LICENSE](../../LICENSE).
