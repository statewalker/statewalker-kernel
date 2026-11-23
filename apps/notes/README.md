# apps/notes

## What it is

The notes demo of the platform (spec statewalker/statewalker-root#215, user story 63), private. It started as the shell tracer (statewalker/statewalker-root#252) and now shows the workbench chrome (statewalker/statewalker-root#254) A2UI surfaces (statewalker/statewalker-root#267) and host services (statewalker/statewalker-root#258). In the browser, the kernel loads the core fragments `system.commands`, `system.workbench`, `system.a2ui` and `system.host`, then fetches, installs, enables and activates the app's client-only fragments:

- `notes` contributes a view to the `views` point, two commands (`add-note`, `new-note`) to the `commands` point, and, all statically, a menu bar menu, a context menu and a tab menu entry for its view, a keybinding (`Ctrl+Alt+N`), two status bar items (one shown while its view is active), an activity bar entry, a dialog and a notification. `new-note` asks for the note's text in that dialog, adds it, and reports it in that notification, whose Undo takes it back. Each note has a Copy button, which copies it through system.host's clipboard service.
- `surfaces` contributes a catalog component, `NoteEditor` (CodeMirror), to the `catalog` point and a view placing an A2UI surface with it.

## How to run it

From the repository root, after `pnpm install`:

1. `pnpm --filter @statewalker/notes.app... run build`: builds the app and the packages it uses into `apps/notes/dist/`.
2. `pnpm --filter @statewalker/notes.app start`: serves `dist/` on http://127.0.0.1:4173/ (`PORT` changes it).
3. `pnpm --filter @statewalker/notes.app test`: the browser tests, against `dist/` (build first). They need Chromium for the pinned `playwright`: `pnpm --filter @statewalker/notes.app exec playwright install chromium` once, if it is not there.

`window.platform` holds the kernel, the command bus, the workbench model, the A2UI model and system.host's services (`host.services`, `host.provider(kind)`), for the console and the tests.

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

`tests/chrome.e2e.test.ts` (seam 2) drives the chrome:

| Test step | Feature |
| --- | --- |
| Notes → New note… in the menu bar opens the "New note" dialog; answering adds the note | The menu bar (shadcn `Menubar`) from the `menus` point; the command runs through the bus |
| Right-click on the notes view → New note…; the tab bar's "View actions" → New note… | A view's context menu (`ContextMenu`) and tab menu (`DropdownMenu`), entries filtered by `when: view == org.statewalker.notes/notes` |
| Ctrl+Shift+P lists "New note… Ctrl+Alt+N" but not "Add a note"; typing "new" and Enter runs it | The command palette (shadcn `Command`): every command the chrome can run (no input needed) by its l10n label, with its keybinding |
| Ctrl+Alt+N opens the dialog | Keyboard shortcuts: system.workbench's keybinding registry over system.commands' `keybindings` point |
| Ctrl+Alt+N typed in the notes field keeps the text and opens nothing; an AltGr+N keydown (ctrl, alt and the AltGraph state, a Polish ń) runs nothing, the same keydown without AltGraph opens the dialog | A text field keeps the chords that may type text, unless the binding's `when` asks; AltGr keys are never chords |
| The "Notes view" status item shows while the notes view is active, leaves when it closes, returns when the activity bar reopens it | The chrome's context (`activeView`, `inputFocus`) reaches the status bar's and menus' `when` |
| The status bar's "New note" runs it; the activity bar's "Notes" reopens the closed view | The `statusbar` and `activitybar` points |
| Cancel, then Escape, add nothing; Enter adds "Water the plants" and a "Note added" notification shows it; its Undo removes the note | Dialogs and notifications declared on the `dialogs` and `notifications` points, raised through the client API (`dialogs.show`, `notifications.show`); the user's answer reaches the fragment |
| `workbench.execute("org.statewalker.notes/add-note")` (no text, as the chrome runs commands) raises "Add a note failed" (`data-severity="error"`, from `system.workbench`) | A failing command run from the chrome raises the workbench's own notification, rendered by the same component as every fragment's |
| With the notes bundle held back, the Notes menu (with Ctrl+Alt+N), the status bar item, the activity bar entry and the keybinding are there while the view still loads; Ctrl+Alt+N then opens the dialog once the bundle arrives | Static contributions come from the registry, before the contributor's code loads |
| After `kernel.disable("org.statewalker.notes")`, no Notes menu, status bar item, activity bar entry, keybinding or palette entry is left, and Ctrl+Alt+N does nothing | Contributions leave with their fragment |

`tests/surfaces.e2e.test.ts` (seam 2) opens the surfaces demo's view in Chromium:

| Test step | Feature |
| --- | --- |
| The view shows a surface whose `NoteEditor` is bound to `/doc/text` | A catalog component from a fragment (`defineComponent`, its CodeMirror view a lazy chunk), placed by an A2UI 1.0 surface, validated strictly |
| Typing reaches `/doc/text` in the surface's data model | Two-way binding: the view writes back to its bound path |
| An agent's `updateDataModel` built from the data model prepends a line: the same editor shows it, typing goes on after the user's text, and undo takes back only the user's typing | An editable component keeps its cursor and undo history when the surface updates |
| "Pop out" docks the surface in a tab titled "Trip notes" and leaves a placeholder inline; "Back inline" brings it back, the typed text kept | Surfaces pop out into the workbench's dock and back, by the user |
| `system.workbench/open-surface` on the bus docks it; closing its tab brings it back inline | The workbench's command; the user closing the dock's panel |
| The agent deletes the docked surface: its tab goes | A removed surface leaves the dock |
| An agent's surface placing `Html` with an `onerror` attribute is refused, and nothing is kept | Strict validation, fail-closed |

`tests/host.e2e.test.ts` (seam 2) uses system.host's services, in a browser context granted the clipboard permissions:

| Test step | Feature |
| --- | --- |
| A note's Copy button puts its text on the clipboard (read back with `navigator.clipboard.readText`); `host.provider("clipboard")` is `undefined` | A fragment's view reaches the clipboard through the client API's `host`; no fragment contributes one, so the host's own (the browser's) answers |
| Opening the surfaces view writes `#?views=...` with both views; after a reload both are open again, in that order | The shell keeps the open views in the URL state (`src/url-layout.ts`) and restores them from it |
| Loading `#?views=org.statewalker.surfaces%2Fsurfaces` opens only that view, not the default layout; changing the hash to name the notes view opens it and closes the other | A link restores a view; a navigation to another URL state reaches the layout |

## Internals

### Layout

```
platform.json          the platform version and the shared modules' ranges
src/boot.ts            the shell: kernel, core fragments, client API, app fragments (React-free)
src/main.tsx           renders the workbench, docks surfaces through system.a2ui, opens the views the URL names
src/url-layout.ts      the open views kept in the URL state, through system.host's urlState
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

`boot()` creates the kernel with `platform.json`'s version and the four core fragments (the workbench wired to the command bus and the browser's locale, system.host with platform.browser's `createBrowserHostServices()` as its defaults), installs the client API's bindings (the bus, the workbench's dialogs and notifications, system.host's services) and the A2UI model (`installA2ui`; agents' surface events are denied until system.security supplies a policy), fetches each app fragment's `fragment.jsonc` and the aspect files it lists, installs and enables them, and activates the client aspect. A core fragment's module reference resolves to its in-process module (system.workbench's commands); an app fragment's resolves to an export of the contributor's client folder (`fragments/<id>/<client dir>/<module>`), imported on first use. Activating an app fragment's client aspect links its `index.css`, removed when the aspect deactivates. The shell follows `system:fragments:resolved` and activates the client aspect of every fragment that resolves after boot (enabled again, or installed later), since its extensions come back on resolve.

`main.tsx` then opens the views the URL state names (`#?views=<id>,<id>`), or the default layout (the notes view) when it names none, and keeps the two in step: opening or closing a view replaces the URL's history entry, and a navigation to another URL state opens and closes views to match (`bindLayoutToUrl`). A named view nobody contributes is skipped.

## License

MIT. See [LICENSE](../../LICENSE).
