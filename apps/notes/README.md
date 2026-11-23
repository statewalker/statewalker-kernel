# apps/notes

## What it is

The notes demo of the platform (spec statewalker/statewalker-root#215, user story 63), private. It started as the shell tracer (statewalker/statewalker-root#252) and now shows the workbench chrome (statewalker/statewalker-root#254), A2UI surfaces (statewalker/statewalker-root#267), its application definition (statewalker/statewalker-root#257): a brand in light and dark, baseline fragments and a default layout, in `application.json`, and the three device modes with layouts remembered per mode (statewalker/statewalker-root#253). In the browser, the kernel loads the core fragments `system.profile` (the user's profile in `localStorage`, under `org.statewalker.apps.notes:`), `system.commands`, `system.workbench`, `system.a2ui` and `system.appearance`, then fetches, installs, enables and activates the app's client-only fragments (its baseline, on a fresh profile):

- `notes` contributes a view to the `views` point, two commands (`add-note`, `new-note`) to the `commands` point, and, all statically, a menu bar menu, a context menu and a tab menu entry for its view, a keybinding (`Ctrl+Alt+N`), two status bar items (one shown while its view is active), an activity bar entry, a dialog and a notification. `new-note` asks for the note's text in that dialog, adds it, and reports it in that notification, whose Undo takes it back.
- `surfaces` contributes a catalog component, `NoteEditor` (CodeMirror), to the `catalog` point and a view placing an A2UI surface with it, preferring the right zone.

The application's default layout (`application.json`'s `layout.open`, given to the workbench as the host's default layout by `applicationLayouts` in `src/boot.ts`) opens the notes view in the centre, in every device mode. The workbench shows the device mode of the window's width and keeps each mode's layout in the profile once the user changes it.

## How to run it

From the repository root, after `pnpm install`:

1. `pnpm --filter @statewalker/notes.app... run build`: builds the app and the packages it uses into `apps/notes/dist/`.
2. `pnpm --filter @statewalker/notes.app start`: serves `dist/` on http://127.0.0.1:4173/ (`PORT` changes it).
3. `pnpm --filter @statewalker/notes.app test`: the browser tests, against `dist/` (build first). They need Chromium for the pinned `playwright`: `pnpm --filter @statewalker/notes.app exec playwright install chromium` once, if it is not there.

`window.platform` holds the kernel, the command bus, the workbench model, the A2UI model and the profile store, for the console and the tests. `localStorage.clear()` and a reload give a fresh profile.

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

`tests/application.e2e.test.ts` (seam 2) checks the application definition, each test in a new browser context, so from a fresh profile:

| Test step | Feature |
| --- | --- |
| With the system in light, the bar above the workbench shows the logo and "Notes", the title is "Notes", the root has no `.dark`, `--primary` and `--background` are the brand's light values, and the notes view's "Add note" button and the page's background are those colours | The application's brand (`application.json`) set by system.appearance as the shadcn tokens, the single theme source the fragments' prebuilt CSS reads |
| With the system in dark (`colorScheme: "dark"`), the root has `.dark` and `--primary`, `--background` and `--card` are the brand's dark values; the notes card is the dark card colour | Branding in dark, following `prefers-color-scheme` |
| `appearance.setMode("dark")` in a light system shows the dark tokens; `setMode("system")` goes back to light | The user's choice over the system's |
| A fresh profile: `firstRun` is true, both baseline fragments are enabled, the notes view is open in a tab titled "Notes"; after a reload, `firstRun` is false and the notes view is back | Baseline fragments installed on first run; the default layout; the profile restoring what it recorded |
| A profile recording `org.example.gone`, which the app does not serve: the reload boots, with the baseline installed, and the record is gone | A recorded fragment no longer served is forgotten, not fatal |
| `kernel.remove("org.statewalker.notes")` is refused (a baseline fragment) and the view stays; `kernel.disable` closes it; after a reload notes is installed but not enabled (surfaces still enabled) and no notes view opens; enabling it brings the view back | Baseline fragments can be disabled, not removed (`KernelOptions.baseline`); the enabled state is kept in the profile |

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

## Internals

### Layout

```
platform.json          the platform version and the shared modules' ranges
application.json       the application definition: brand, baseline fragments, default layout
src/boot.ts            the shell: kernel, core fragments, client API, app fragments (React-free)
src/main.tsx           renders the workbench, docks surfaces through system.a2ui
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

`boot()` creates the kernel with `platform.json`'s version and the five core fragments (system.profile's store over localStorage as the kernel's profile and the workbench's; the workbench wired to the command bus, the browser's locale and the application's default layout), installs the client API's bindings (the bus, the workbench's dialogs and notifications) and the A2UI model (`installA2ui`; agents' surface events are denied until system.security supplies a policy), fetches each app fragment's `fragment.jsonc` and the aspect files it lists, installs and enables them, and activates the client aspect.

Which app fragments: the kernel's records live in the user's profile, kept in localStorage under `org.statewalker.apps.notes:` (system.profile's store). A fresh profile, one without the application's record (`applications/org.statewalker.apps.notes`), installs and enables `application.json`'s `baseline`, then writes that record; `window.platform.firstRun` says which run this is. A later run installs again the fragments the profile records (`fragments/<id>`, core fragments aside), enabling those recorded enabled, plus any baseline fragment the profile lacks. A recorded fragment the app no longer serves is skipped with a warning and its record dropped, so it cannot stop later boots; a baseline fragment that cannot be fetched stops the boot. The kernel gets the baseline as `KernelOptions.baseline`, so removing a baseline fragment is refused while disabling it works, and stays disabled on the next run. system.appearance gets `application.json`'s `brand` as the application's brand; `main.tsx` applies it to the page (`applyAppearance`: tokens, `.dark` following `prefers-color-scheme` unless `appearance.setMode` overrides it, title, icon), and renders its `BrandMark` above the workbench. `layout.open` is the workbench's default layout for every device mode (the host's `layouts`); once the user changes a mode's layout, the workbench saves it in the profile under `workbench/layouts/<mode>` and the default no longer applies to that mode. A core fragment's module reference resolves to its in-process module (system.workbench's commands); an app fragment's resolves to an export of the contributor's client folder (`fragments/<id>/<client dir>/<module>`), imported on first use. Activating an app fragment's client aspect links its `index.css`, removed when the aspect deactivates. The shell follows `system:fragments:resolved` and activates the client aspect of every fragment that resolves after boot (enabled again, or installed later), since its extensions come back on resolve.

## License

MIT. See [LICENSE](../../LICENSE).

`tests/device-modes.e2e.test.ts` (seam 2) opens the app at a phone's, a tablet's and a desktop's width, each in a fresh profile:

| Test step | Feature |
| --- | --- |
| At 1280×800, `data-mode="desktop"`: the menu bar, the activity bar, the notes view in a dock tab, no tab bar; the surfaces view opens in a group right of it, in the right zone | The desktop mode: one dockview whose groups are the zones; a view's preferred zone (`zone` in the `views` point) |
| At 820×1180, `data-mode="tablet"`: the surfaces view opens in the "Right zone" drawer, not the dock; the drawer closes and the strip's "Right zone" button opens it again; a touch drag (CDP touch events) of the Notes tab to the dock's right edge splits it into a second group | The tablet mode: side zones as drawers, the centre a dockview whose panels drag by touch |
| At 390×844, `data-mode="phone"`: the notes view alone, a "Views" tab bar with "Notes" selected, no menu bar or dock tabs; "More" lists the menu bar's Notes menu and the Surfaces view, which opens as the one panel; the Notes tab brings the notes view back | The phone mode: one panel, a bottom tab bar and a "More" menu |
| Closing the notes tab on a desktop saves `workbench/layouts/desktop` (only the surfaces view); after a reload the notes view stays closed; resized to a phone's width the notes view is there (the phone's default layout, nothing saved for phone or tablet); back to a desktop's width it is closed again | A layout changed in one mode is saved in system.profile, survives a reload and leaves the other modes' layouts alone; the mode follows the width live |
| Dragging the Notes tab (mouse) into the right zone's group saves it in the right zone, and a reload keeps it there | A panel dragged to another zone's group moves its view to that zone in the model |
| `kernel.disable("org.statewalker.notes")` (a baseline fragment: removing it is refused) drops the notes view from the saved desktop layout; after a reload notes stays disabled, and enabling it contributes its view without opening it | A saved layout drops the views of a fragment that leaves (disabled or removed: the workbench sees the same view leaving) |
