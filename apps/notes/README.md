# apps/notes

## What it is

The notes demo of the platform (spec statewalker/statewalker-root#215, user story 63), private. So far it is the shell tracer (statewalker/statewalker-root#252): the thinnest real path through the shell. In the browser, the kernel loads the core fragments `system.commands` and `system.workbench`, then fetches, installs, enables and activates the app's client-only `notes` fragment; notes contributes a view to the `views` point and a command to the `commands` point, and the view opens in the workbench.

## How to run it

From the repository root, after `pnpm install`:

1. `pnpm --filter @statewalker/notes.app... run build`: builds the app and the packages it uses into `apps/notes/dist/`.
2. `pnpm --filter @statewalker/notes.app start`: serves `dist/` on http://127.0.0.1:4173/ (`PORT` changes it).
3. `pnpm --filter @statewalker/notes.app test`: the browser tests, against `dist/` (build first). They need Chromium for the pinned `playwright`: `pnpm --filter @statewalker/notes.app exec playwright install chromium` once, if it is not there.

`window.platform` holds the kernel, the command bus and the workbench model, for the console and the tests.

## What the tests show

`tests/notes.e2e.test.ts` (seam 2) opens the built app in Chromium:

| Test step | Feature |
| --- | --- |
| The notes view appears in a dockview panel titled "Notes" | A client-only fragment installed at run time contributes a view to system.workbench's `views` point; the app's default layout opens it; its component loads lazily through the extension's reference |
| Typing a note and pressing "Add note" lists it | The view calls `org.statewalker.notes/add-note` through the client API (`@statewalker/client.core`) on system.commands' bus; the handler is the command extension's lazy reference |
| `window.platform.commands.call("org.statewalker.notes/add-note", ...)` lists the note and returns `{ count: 2 }` | The same command on the bus, with its input and output checked against the OpenAPI schemas |
| The import map lists React, react-dom, dockview, shadcn and the client API; each is fetched once; one react-dom renderer registers | The shared modules: one copy each for the shell and every fragment |
| Every bare import of the notes bundle is a key of the import map | Fragment client bundles leave the shared modules external |
| `kernel.disable("org.statewalker.notes")` removes the panel and the command (`unknown-command` afterwards), leaving the workbench | Removal repair: a disabled fragment's view closes and its command leaves the bus; nothing else changes |

## Internals

### Layout

```
platform.json          the platform version and the shared modules' ranges
src/boot.ts            the shell: kernel, core fragments, client API, app fragments (React-free)
src/main.tsx           renders the workbench, opens the default layout
fragments/notes/       the notes fragment: fragment.jsonc, fragment.client.jsonc, client/
scripts/build.mjs      the build (Vite library builds, Tailwind CLI)
scripts/serve.mjs      the static server (`pnpm start`; the tests use static-server.mjs)
tests/                 the seam-2 browser tests
```

### The build

`scripts/build.mjs` writes `dist/`:

- `index.html` with the import map, generated from `platform.json`'s `shared` list;
- `shared/<module>.js`: one ES module per shared module. React and react-dom are CommonJS, so each gets an entry re-exporting its exports by name; their `require()`s of one another become imports, since an ES module cannot `require` in a browser;
- `main.js` and `main.css`: the shell, with the kernel, system.commands and system.workbench bundled in, and the workbench's prebuilt CSS;
- `fragments/<id>/`: each folder of `fragments/`, its root files copied and its client half bundled to `client/index.js`, with `client/index.css` compiled by the Tailwind CLI against system.workbench's `tokens.css`, without preflight; `fragments/index.json` lists them.

Every bundle (the shell, the shared modules, the fragments) leaves the shared modules external as bare specifiers, so the import map resolves each to its one file. The build refuses an installed shared module outside its range in `platform.json`: moving one is a platform version change, which fragments declare against in `engines.platform`.

### The shell

`boot()` creates the kernel with `platform.json`'s version and the two core fragments, installs the client API's bindings, fetches each app fragment's `fragment.jsonc` and the aspect files it lists, installs and enables them, and activates the client aspect. A module reference resolves to an export of the contributor's client folder (`fragments/<id>/<client dir>/<module>`), imported on first use. Activating an app fragment's client aspect links its `index.css`, removed when the aspect deactivates.

## License

MIT. See [LICENSE](../../LICENSE).
