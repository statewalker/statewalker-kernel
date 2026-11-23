# apps/notes

## What it is

The notes demo of the platform (spec statewalker/statewalker-root#215, user story 63), private. So far it is the shell tracer (statewalker/statewalker-root#252): the thinnest real path through the shell. In the browser, the kernel loads the core fragments `system.commands`, `system.workbench` and `system.a2ui`, then fetches, installs, enables and activates the app's client-only fragments: `notes` contributes a view to the `views` point and a command to the `commands` point, and the view opens in the workbench; `surfaces` (statewalker/statewalker-root#267) contributes a catalog component, `NoteEditor` (CodeMirror), to the `catalog` point and a view placing an A2UI surface with it.

## How to run it

From the repository root, after `pnpm install`:

1. `pnpm --filter @statewalker/notes.app... run build`: builds the app and the packages it uses into `apps/notes/dist/`.
2. `pnpm --filter @statewalker/notes.app start`: serves `dist/` on http://127.0.0.1:4173/ (`PORT` changes it).
3. `pnpm --filter @statewalker/notes.app test`: the browser tests, against `dist/` (build first). They need Chromium for the pinned `playwright`: `pnpm --filter @statewalker/notes.app exec playwright install chromium` once, if it is not there.

`window.platform` holds the kernel, the command bus, the workbench model and the A2UI model, for the console and the tests.

## What the tests show

`tests/notes.e2e.test.ts` (seam 2) opens the built app in Chromium:

| Test step | Feature |
| --- | --- |
| The notes view appears in a dockview panel titled "Notes" | A client-only fragment installed at run time contributes a view to system.workbench's `views` point; the app's default layout opens it; its component loads lazily through the extension's reference |
| Typing a note and pressing "Add note" lists it | The view calls `org.statewalker.notes/add-note` through the client API (`@statewalker/client.core`) on system.commands' bus; the handler is the command extension's lazy reference |
| `window.platform.commands.call("org.statewalker.notes/add-note", ...)` lists the note and returns `{ count: 2 }` | The same command on the bus, with its input and output checked against the OpenAPI schemas |
| The import map lists React, react-dom, dockview, shadcn and the client API; each is fetched once; one react-dom renderer registers | The shared modules: one copy each for the shell and every fragment |
| Every bare import of the notes bundle is a key of the import map | Fragment client bundles leave the shared modules external |
| `kernel.disable("org.statewalker.notes")` removes the panel, the command (`unknown-command` afterwards) and the fragment's stylesheet, leaving the workbench | Removal repair: a disabled fragment's view closes, its command leaves the bus and its client aspect deactivates; nothing else changes |
| `kernel.enable("org.statewalker.notes")`, then opening its view: the command is back, the stylesheet linked, the view styled (`m-4`, from the fragment's own CSS) | A fragment resolved after boot gets its client aspect activated by the shell |
| The notes view's margin is 16px from the first load | Prebuilt CSS per fragment, linked while its client aspect is active |

`tests/surfaces.e2e.test.ts` (seam 2) opens the surfaces demo's view in Chromium:

| Test step | Feature |
| --- | --- |
| The view shows a surface whose `NoteEditor` is bound to `/doc/text` | A catalog component from a fragment (`defineComponent`, its CodeMirror view a lazy chunk), placed by an A2UI 1.0 surface, validated strictly |
| Typing reaches `/doc/text` in the surface's data model | Two-way binding: the view writes back to its bound path |
| An agent's `updateDataModel` built from the data model prepends a line: the same editor shows it, typing goes on after the user's text, and undo takes back only the user's typing | An editable component keeps its cursor and undo history when the surface updates |
| "Pop out" docks the surface in a tab titled "Trip notes" and leaves a placeholder inline; "Back inline" brings it back, the typed text kept | Surfaces pop out into the workbench's dock and back, by the user |
| `system.workbench/open-surface` on the bus docks it; closing its tab brings it back inline | The workbench's command; the user closing the dock's panel |
| An agent's surface placing `Html` with an `onerror` attribute is refused, and nothing is kept | Strict validation, fail-closed |

## Internals

### Layout

```
platform.json          the platform version and the shared modules' ranges
src/boot.ts            the shell: kernel, core fragments, client API, app fragments (React-free)
src/main.tsx           renders the workbench, docks surfaces through system.a2ui, opens the default layout
fragments/notes/       the notes fragment: fragment.jsonc, fragment.client.jsonc, client/
fragments/surfaces/    the surfaces demo: the NoteEditor catalog component and a view with a surface
scripts/build.mjs      the build (Vite library builds, Tailwind CLI)
scripts/serve.mjs      the static server (`pnpm start`; the tests use static-server.mjs)
tests/                 the seam-2 browser tests
```

### The build

`scripts/build.mjs` writes `dist/`:

- `index.html` with the import map, generated from `platform.json`'s `shared` list;
- `shared/<module>.js`: one ES module per shared module. React and react-dom are CommonJS, so each gets an entry re-exporting its exports by name; their `require()`s of one another become imports, since an ES module cannot `require` in a browser;
- `main.js` and `main.css`: the shell, with the kernel, system.commands and system.workbench bundled in, and the workbench's and system.a2ui's prebuilt CSS (system.a2ui itself is a shared module: fragments import `defineComponent` and the renderer from it);
- `fragments/<id>/`: each folder of `fragments/`, its root files copied and its client half bundled to `client/index.js`, with `client/index.css` compiled by the Tailwind CLI against system.workbench's `tokens.css`, without preflight; `fragments/index.json` lists them.

Every bundle (the shell, the shared modules, the fragments) leaves the shared modules external as bare specifiers, so the import map resolves each to its one file. The build refuses an installed shared module outside its range in `platform.json`: moving one is a platform version change, which fragments declare against in `engines.platform`.

### The shell

`boot()` creates the kernel with `platform.json`'s version and the three core fragments, installs the client API's bindings and the A2UI model (`installA2ui`; agents' surface events are denied until system.security supplies a policy), fetches each app fragment's `fragment.jsonc` and the aspect files it lists, installs and enables them, and activates the client aspect. A core fragment's module reference resolves to its in-process module (system.workbench's commands); an app fragment's resolves to an export of the contributor's client folder (`fragments/<id>/<client dir>/<module>`), imported on first use. Activating an app fragment's client aspect links its `index.css`, removed when the aspect deactivates. The shell follows `system:fragments:resolved` and activates the client aspect of every fragment that resolves after boot (enabled again, or installed later), since its extensions come back on resolve.

## License

MIT. See [LICENSE](../../LICENSE).
