# apps/notes

## What it is

The notes demo of the platform (spec statewalker/statewalker-root#215, user story 63), private. It started as the shell tracer (statewalker/statewalker-root#252) and now shows the workbench chrome (statewalker/statewalker-root#254), A2UI surfaces (statewalker/statewalker-root#267), host services (statewalker/statewalker-root#258), its application definition (statewalker/statewalker-root#257): a brand in light and dark, baseline fragments and a default layout, in `application.json`, the three device modes with layouts remembered per mode (statewalker/statewalker-root#253), the interface language switched live (statewalker/statewalker-root#256), settings (statewalker/statewalker-root#255), and the secrets vault (statewalker/statewalker-root#264). In the browser, the kernel loads the core fragments `system.profile` (the user's profile in `localStorage`, under `org.statewalker.apps.notes:`, and its vault, opened from the activity bar's "Vault": secrets encrypted in the profile, unlocked with a password or a passkey, its key optionally remembered in IndexedDB), `system.commands`, `system.workbench`, `system.a2ui`, `system.appearance`, `system.host`, `system.l10n`, `system.settings` (every fragment's settings in one view, opened from the activity bar's "Settings", the values in the profile) and `system.fragments` (the fragment manager, opened from the activity bar's "Fragments": the app's fragments installed live with the user's consent, enabled, disabled, retried and removed with or without their data; statewalker/statewalker-root#261), then fetches, installs, enables and activates the app's client-only fragments (its baseline, on a fresh profile):

- `notes` contributes a view to the `views` point, two commands (`add-note`, `new-note`) to the `commands` point, and, all statically, a menu bar menu, a context menu and a tab menu entry for its view, a keybinding (`Ctrl+Alt+N`), two status bar items (one shown while its view is active), an activity bar entry, a dialog and a notification. `new-note` asks for the note's text in that dialog, adds it, and reports it in that notification, whose Undo takes it back. Each note has a Copy button, which copies it through system.host's clipboard service. Its settings page (system.settings' `settings` point) declares two settings the view follows through the client API: `sort` (`added` or `alphabetical`) and `copyButtons` (whether the Copy buttons show), labelled in English and French. Its texts come in English and French bundles on system.l10n's `l10n` point (the French one leaves the view's count out on purpose, so French shows the English text); its view reads them through the client API's `translator`.
- `surfaces` contributes a catalog component, `NoteEditor` (CodeMirror), to the `catalog` point and a view placing an A2UI surface with it, preferring the right zone.

Notes also opens an extension point in its client aspect, `org.statewalker.notes/actions`. Each extension's `{ title }` becomes a button in the notes view. The button calls the extension's reference with `{ notes: [{ text }] }` and shows the `{ message }` it answers. The view reads the point through the client API's `points`, which the shell backs with the kernel's owner context while notes' client aspect is active. Notes also has a `list-notes` command.

Where server halves run, the shell also installs `system.tasks` as a core fragment, its queue in its own fragment DO (statewalker/statewalker-root#409). `scripts/core-fragments.mjs` lists the core fragments with a server half. `build.mjs` bundles them for the shard pool, and `launch.mjs` runs them on Node and wrangler beside the app's own. The page's runners hold 10 s leases, so a task whose page was closed or reloaded runs again within seconds.

`notes-export` is not in the baseline. The user installs it from the app's catalog (`archives/index.json`) in system.fragments' Fragments view, after the consent screen (statewalker/statewalker-root#261). It requires notes, and contributes:
- an "Export" action on notes' `actions` point;
- an `export-notes` command, offered to agents as a write;
- an entry in the Notes menu;
- an Exports view with its activity bar entry;
- `export-slowly`, exposed as a task: the notes one by one (`delay_ms` each, 500 ms by default) with progress after each, deduplicated by the task's id in its DO. The Exports view starts it ("Export as a task"), follows its job log after the last stamp it showed (kept over reloads), shows the reply, and cancels it.

Its server half is a fragment DO that keeps every export. In the `browser` launch configuration, an app fragment with a server half is activated only once that half loads in the shard pool. If it cannot load, the fragment is failed with the reason, and a retry tries again, starting the pool afresh when its start failed (`BootOptions.serverHalf`). The pool starts before client activation (`BootOptions.started`), and the wait is limited to 30 s.

The application's default layout (`application.json`'s `layout.open`, given to the workbench as the host's default layout by `applicationLayouts` in `src/boot.ts`) opens the notes view in the centre, in every device mode. The workbench shows the device mode of the window's width and keeps each mode's layout in the profile once the user changes it. Which layout shows: the views the URL names (`#?views=`), else the current mode's saved layout, else the default layout.

## How to run it

From the repository root, after `pnpm install`:

1. `pnpm --filter @statewalker/notes.app... run build`: builds the app and the packages it uses into `apps/notes/dist/`.
2. `pnpm --filter @statewalker/notes.app start`: serves `dist/` on http://127.0.0.1:4173/ (`PORT` or `--port` changes it), with the fragments' server halves running in the browser. The launch configurations (`scripts/launch.mjs`, statewalker/statewalker-root#259) say who serves them at `/fragments/{id}/…`:
   - `start:browser` (what `start` runs): CellB in the page's origin. A ServiceWorker (`fragments-sw.js`, CellB's router) sends `/fragments/{id}/…` to a pool of shard workers the tabs share (`fragment-shard.js`), each running every server half on SQLite WASM in OPFS.
   - `start:node`: CellB on Node, one fragment host (`createFragmentHost`) holding every server half, its data under `--data <dir>` (memory by default).
   - `start:wrangler`: `wrangler dev`, one per server half, its Worker routing `/fragments/{id}/…` to its fragment DO; the app's server forwards to it.

   Under `node` and `wrangler`, the app's server answers `/fragments/…` only to this app's pages. It refuses a request a browser marks as cross-site (`Sec-Fetch-Site`) and one whose `Host` is not `127.0.0.1`, `localhost` or `[::1]`, which blocks DNS rebinding (403). It also refuses a POST whose body type another site could send without a preflight: `text/plain`, a form type, or no type at all (415, statewalker/statewalker-kernel#76). Under `wrangler`, each server half's own `wrangler dev` port answers only what this server forwards, which carries the launch's secret (`LAUNCH_SECRET`). A page that finds a Worker's port reaches no DO (403, statewalker/statewalker-kernel#78).

   "Remove with data" of a fragment with a server half deletes its DO data on every host. In the browser this is the shard pool's storage. Under `node` and `wrangler` the shell asks the app's server (`POST /_launch/fragments/<id>/data/remove`, answered only to this app's pages). The server removes the server half with its data and starts it again empty: `FragmentHost.remove(id, { withData: true })` on Node, or the fragment's persisted state on wrangler. A host that cannot refuses, and the kernel keeps the fragment's record (statewalker/statewalker-kernel#73). Without `--data`, `wrangler` keeps its state in `apps/notes/.wrangler/launch-state/` (gitignored), across runs.

   **Placement** (statewalker/statewalker-root#263). Where each server half is served is the route table in the profile (`routes`: `{ "<id>": { "host": "url:<base>" } }`; unlisted fragments are `local`, the app's own server). Client halves keep calling `<base>fragments/{id}/…`, and the page sends each request to the fragment's home (`src/placement.ts`, `window.placement`). A Move takes a fragment's server half, with its DO data, to another `node` host: `await placement.move("org.statewalker.notes", "url:http://127.0.0.1:4174/")`. It runs these steps, and each host does its own part under `/_launch/` (`scripts/placement.mjs`):
   1. The new host installs the same version, disabled, or refuses, giving the version it offers or the bindings it lacks.
   2. The fragment is disabled here.
   3. Its data is exported with a hand-over, so it cannot run here again.
   4. The data is imported there, and the fragment is activated there.
   5. The route switches.

   The source keeps its data, handed over, until `placement.confirm(id)` deletes it. `placement.rollback(id)` runs the source again on that data, switches the route back and deletes the copy. `placement.setRoute(id, host)` changes a route without moving data, and is refused once the fragment has data at its home. A Move copies data without transforming it. The host it goes to lets this app's pages in with `allowOrigins` (`launch("node", { allowOrigins: ["http://127.0.0.1:4173"], fragments: [] })`), which adds CORS and answers its preflights; every other origin is still refused.

   Each takes `--peer-id <id>`: `/peers/<id>/fragments/{id}/…` then answers as `/fragments/{id}/…`. The page reads which one runs from `launch.json` (`window.launch`); the built `dist/launch.json` says `none`, so a plain file server runs no server halves.
3. `pnpm --filter @statewalker/notes.app test`: the browser tests, against `dist/` (build first). They need Chromium for the pinned `playwright`: `pnpm --filter @statewalker/notes.app exec playwright install chromium` once, if it is not there.

`window.platform` holds the kernel, the command bus, the workbench model, the A2UI model, the profile store, system.host's services (`host.services`, `host.provider(kind)`), the settings model (`settings`), the vault (`vault`: its state, and its secrets once unlocked), the lifecycle slots (`slots.installed`, `enabled`, `active`) and system.l10n's model (`l10n`: `setLocale`, `locales()`), for the console and the tests. `localStorage.clear()` and a reload give a fresh profile.

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

`tests/fragments.e2e.test.ts` (seam 2) runs the notes fragment's server half in each launch configuration, `browser`, `node` and `wrangler` (statewalker/statewalker-root#259):

| Test step | Feature |
| --- | --- |
| The page posts a note to `/fragments/org.statewalker.notes/notes` (201) and reads it back; an empty one is refused (400); after a reload the note is still there | The notes fragment's server half (`wrangler.jsonc`, `server/index.js`): one fragment DO at `idFromName("org.statewalker.notes")` keeping notes in SQLite, the same project on CellB in the browser, CellB on Node and `wrangler dev` |
| Ctrl+Alt+N, a note, Enter: the view lists it, the DO has it, and a reload lists it again; Undo on a second note's notification takes it out of the view and the DO | The client half reaches its own server half through the client API's `servers.of(id)` (statewalker-root#436): the notes are kept in the fragment DO (`DELETE /notes/<id>` for Undo). With no server half (`launch.json` `none`) they stay in memory, as the other tests run them |
| With the server half disabled (the pool's or the host's `disable`), "Add note" shows the error, its cause (`503 … disabled`) included, and the shell keeps running commands (browser, node) | A server half that answers an error is shown in the view, never a crash |
| `/fragments/org.example.nope/…` answers 404 | A fragment the host does not have; in the browser the ServiceWorker answers it itself |
| `/peers/peer-self/fragments/org.statewalker.notes/notes` lists what `/fragments/…` lists | `/peers/{self}/…` equals `/fragments/…` |
| Browser: `kernel.disable("org.statewalker.notes")`; Node: the fragment host's `disable`. Three posts answer 503; enabled again, the notes are as before (browser and Node) | A disabled fragment answers 503 without waking its DO: in the browser the shard pool follows the kernel's fragments (`src/fragment-servers.ts`) and the router answers from the tabs' fragment table |

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

`tests/remove-data.e2e.test.ts` (seam 2, node and wrangler) shows that a plain removal keeps notes-export's DO data, which a reinstall finds, and that "remove with data" deletes it. The host's endpoint answers only the app's pages.

`tests/move.e2e.test.ts` (seam 2, two node hosts) covers #263:
- notes moves with its data to a second host, and the view reads and writes it through `<base>fragments/<id>/`;
- the source keeps its data, handed over, so it cannot be enabled;
- a rollback runs the source again on that data, and a confirmed Move deletes it;
- a Move to a host offering another version is refused, as is a route change on a fragment with data and a page of an origin the second host does not let in.

`tests/move-tasks.e2e.test.ts` (seam 2, two node hosts) covers #410: with notes-export moved to a second host, a task published from the first is served in the second host's queue and its reply comes back; the first host's wildcard subscription never sees it; once the home is down, the publish fails (`unreachable`) with nothing queued on the first host.

`tests/host-jobs.e2e.test.ts` (seam 2) covers #411:
- **node:** the jobs-demo fragment (`fragments/jobs-demo`, which requires the `host-jobs` binding) runs its `count` script through a task-exposed command, and the job log holds its lines, then `done`. Cancelling `wait` terminates its process group (SIGTERM, then SIGKILL for a child that ignores SIGTERM) and ends the job `cancelled`. A script outside the archive is refused.
- **browser:** the install is refused, naming the missing binding.

The `node` configuration offers the binding (`launch.json`'s `bindings`) and runs `@statewalker/host-jobs.node` over its own system.tasks queue, taking each script from the fragment's built archive (`dist/archives/<id>/scripts/`).

`tests/tasks.e2e.test.ts` (seam 2, on browser, node and wrangler) covers #409:
- the task, started from the Exports view, is followed over a reload with no log entry read twice, and its reply shows;
- its export is made once;
- a cancelled run ends as cancelled;
- a task waiting while its fragment is disabled is processed after a restart of the host (Node and wrangler: the same data and port; browser: every tab closed).

`tests/notes-export.e2e.test.ts` (seam 2, launch `browser`) covers #261's acceptance criteria for notes-export:
- the consent screen lists everything it asks for, and declining installs nothing;
- installed, its action, command, menu entry and view work;
- removed, they all go while notes and the other fragments stay;
- a plain removal keeps its DO data, which a reinstall finds, and "remove with data" deletes it;
- when its server bundle fails to load, it is shown failed with the reason while notes keeps working, and a retry makes it active.

`tests/fragments-manager.e2e.test.ts` (seam 2) drives system.fragments' manager view, each test in a fresh profile. It covers an archive uploaded from a file: declined, then installed, with its command and settings page live. It covers an archive refused for its platform and an unmet requirement, with the reasons shown. It covers a cascading disable that lists the dependents first, a removal that keeps the data and one that deletes it after confirmation, and the refused removal of a baseline fragment.

`tests/settings.e2e.test.ts` (seam 2) drives system.settings, each test in a fresh profile:

| Test step | Feature |
| --- | --- |
| The activity bar's "Settings" opens the settings view with a "Notes" page showing the defaults ("Order added", Copy buttons on); picking "Alphabetical" and unchecking "Show Copy buttons" re-sorts the notes view and hides its Copy buttons; localStorage holds `settings/org.statewalker.notes` as `{ version: 1, values: { sort, copyButtons } }` | A fragment's settings page declared statically on the `settings` point, rendered with shadcn controls from its schema; the fragment follows its own values through the client API (`settings.of(id).observe`); values kept in system.profile |
| After a reload the notes sort alphabetically and the page shows "Alphabetical"; "Reset to defaults" brings back "Order added" and the insertion order, and the key leaves localStorage | Values survive a reload; defaults from the schema |
| `kernel.disable("org.statewalker.notes")` removes its page ("No fragment has settings."); enabling it brings the page back with "Alphabetical" | A disabled fragment's settings page disappears; its values are kept |
| A fragment installed at run time with a page: a value typed is stored, one its schema refuses (too long) shows an alert and is not stored; `kernel.remove` drops the page and keeps the value, a reinstall shows it again; `remove(id, { withData: true })` deletes its key, and the notes' values stay | Values are validated before they are stored; kept on removal unless removed with data (the shell's `removeData` calls system.settings') |
| `l10n.setLocale("fr")`: the page "Bloc-notes", "Trier les notes par" showing "Ordre alphabétique", "Afficher les boutons Copier", "Rétablir les valeurs par défaut", the activity bar's "Paramètres"; picking "Ordre d'ajout" stores `added`; back to English, "Order added" | Settings labels through system.l10n, under keys derived from the page (`settings.title`, `settings.<key>.title`, `settings.<key>.enum.<value>`), switched live; values are not texts |

`tests/vault.e2e.test.ts` (seam 2) drives system.profile's vault, each test in a fresh profile, the app served on `localhost` (WebAuthn refuses IP addresses):

| Test step | Feature |
| --- | --- |
| The activity bar's "Vault" opens the vault view; a password typed twice creates the vault (PBKDF2 at 600 000 iterations); a secret put through `platform.vault.secrets(...)` reads back; no localStorage item or IndexedDB value holds the secret, its name or the password; after a reload the vault is locked, a wrong password says "Wrong password.", the right one unlocks; "Lock" locks | Password unlock; nothing in clear; locked by default after a reload |
| Created with "Remember on this device": after a reload it is unlocked, IndexedDB holding one non-extractable AES-GCM `CryptoKey`; "Forget on this device" empties it, and the next reload is locked | The remembered key unlocks after a reload and can be forgotten |
| With Chromium's virtual authenticator (DevTools protocol, PRF on): "Add a passkey" with the password registers one credential; after a reload "Unlock with a passkey" unlocks | Passkey unlock through WebAuthn PRF |
| With `indexedDB` throwing (an init script): the app boots; creating with "Remember on this device" unlocks and says the key could not be remembered; after a reload the vault is locked and the password opens it | The vault never depends on IndexedDB: the remembered key is a convenience |
| The record replaced by text that is not JSON, or given `version: 2`: after a reload the view says why ("not readable", "version 2"), offers nothing that writes, `unlock` and `create` throw `VaultUnavailableError`, and after another reload localStorage holds the same bytes | A corrupt vault or one of an unknown version stays locked, says why, and is never written over |

`tests/l10n.e2e.test.ts` (seam 2) switches the interface language, in an `en-US` browser context:

| Test step | Feature |
| --- | --- |
| In English: the picker is labelled "Language", the menu bar's "Notes" menu holds "New note… Ctrl+Alt+N", the tab, the card title, "Add note", "Write a note", "Notes: 0", the status bar's "New note", the palette's "New note…" | Every label read through system.l10n in the interface language, the inline texts and the English bundle |
| Picking "Français": "Langue", the "Bloc-notes" menu with "Nouvelle note… Ctrl+Alt+N", the tab and the card retitled "Bloc-notes", "Ajouter la note", "Écrire une note", "Nouvelle note" in the status bar, "Nouvelle note…" and "Saisir une commande…" in the palette, the view's `lang` is `fr` | The language switched live: menus, a view, its tab, the palette and the bars follow (`LanguagePicker`, `l10n.setLocale`) |
| The count stays "Notes: 0" in French | A text the French bundle lacks falls back to the default language's (English) bundle |
| Ctrl+Alt+N raises the "Nouvelle note" dialog ("Ajouter"); adding raises "Note ajoutée" | Dialogs and notifications in the language |
| Back to English: every text is English again, the note added in French is still listed, and a flag set on `window` before the switches is still there | No reload |
| `l10n.locales()` is `["en", "fr"]`; `setLocale("de")`, a language no bundle has, shows every text in English | The default language as the last fallback |
| On a phone (390×844), French retitles the tab bar ("Barre d'onglets", "Bloc-notes") and "Plus" lists the "Bloc-notes" menu and, under "Ouvrir", "Surfaces" (no French text: its inline title) | Labels reach the phone's tab bar and More menu |
| On a tablet (820×1180), French names the zone strip ("Zone droite", "Droite (0)") and the drawer ("Aucune vue ici.", "Fermer le tiroir") | Labels reach the tablet's drawers |

## Internals

### Layout

```
platform.json          the platform version and the shared modules' ranges
application.json       the application definition: brand, baseline fragments, default layout
src/boot.ts            the shell: kernel, core fragments, client API, app fragments (React-free)
src/main.tsx           renders the workbench, docks surfaces through system.a2ui, keeps the open views in the URL
src/url-layout.ts      the open views kept in the URL state, through system.host's urlState
src/fragment-servers.ts  the launch configuration `browser`: the router ServiceWorker and the shard pool, following the kernel
src/fragments-sw.ts    CellB's router, as the app's ServiceWorker
src/fragment-shard.ts  a shard worker of the pool (CellB, SQLite WASM)
fragments/notes/       the notes fragment: fragment.jsonc, fragment.client.jsonc, client/, wrangler.jsonc, server/
fragments/surfaces/    the surfaces demo: the NoteEditor catalog component and a view with a surface
scripts/build.mjs      the build (Vite library builds, Tailwind CLI)
scripts/serve.mjs      a plain static server (no server halves; the tests use static-server.mjs)
scripts/launch.mjs     the launch configurations: browser, node, wrangler
tests/                 the seam-2 browser tests
```

### The build

`scripts/build.mjs` writes `dist/`:

- `index.html` with the import map, generated from `platform.json`'s `shared` list;
- `shared/<module>.js`: one ES module per shared module. React and react-dom are CommonJS, so each gets an entry re-exporting its exports by name; their `require()`s of one another become imports, since an ES module cannot `require` in a browser;
- `main.js` and `main.css`: the shell, with the kernel, system.commands and system.workbench bundled in, and the workbench's and system.a2ui's prebuilt CSS (system.a2ui itself is a shared module: fragments import `defineComponent` and the renderer from it);
- `archives/<id>/`: each folder of `fragments/`, its root files copied and its client half bundled to `client/index.js`, with `client/index.css` compiled by the Tailwind CLI against system.workbench's `tokens.css`, without preflight, and its server half bundled for CellB in a browser to `server/bundle.js`; `archives/index.json` lists them. The archives are not under `fragments/`: `/fragments/{id}/…` is the fragments' server halves;
- `fragments-sw.js`, `fragment-shard.js` and `assets/`: CellB's router and shard worker (with SQLite WASM), for the launch configuration `browser`;
- `launch.json`: `{ "fragments": "none" }`; the launch scripts serve their own.

Every bundle (the shell, the shared modules, the fragments) leaves the shared modules external as bare specifiers, so the import map resolves each to its one file. The build refuses an installed shared module outside its range in `platform.json`: moving one is a platform version change, which fragments declare against in `engines.platform`.

### The shell

`boot()` creates the kernel with `platform.json`'s version and the eight core fragments (system.profile's store over localStorage as the kernel's profile and its vault, loaded before the kernel starts, the workbench's and system.settings'; the workbench wired to the command bus, to system.l10n (which starts in the browser's language) and to the application's default layout, and started in the device mode of the window's width, since the URL state edits the current mode's layout before React renders; system.host with platform.browser's `createBrowserHostServices()` as its defaults), installs the client API's bindings (the bus, the workbench's dialogs and notifications, system.host's services, system.settings' values, system.l10n's model) and the A2UI model (`installA2ui`; agents' surface events are denied until system.security supplies a policy), fetches each app fragment's `fragment.jsonc` and the aspect files it lists, installs and enables them, and activates the client aspect.

Which app fragments: the kernel's records live in the user's profile, kept in localStorage under `org.statewalker.apps.notes:` (system.profile's store). A fresh profile, one without the application's record (`applications/org.statewalker.apps.notes`), installs and enables `application.json`'s `baseline`, then writes that record; `window.platform.firstRun` says which run this is. A later run installs again the fragments the profile records (`fragments/<id>`, core fragments aside), enabling those recorded enabled, plus any baseline fragment the profile lacks. A recorded fragment the app no longer serves is skipped with a warning and its record dropped, so it cannot stop later boots; a baseline fragment that cannot be fetched stops the boot. The kernel's `removeData` (a removal with `{ withData: true }`) deletes the fragment's settings values; a plain removal keeps them. The kernel gets the baseline as `KernelOptions.baseline`, so removing a baseline fragment is refused while disabling it works, and stays disabled on the next run. system.appearance gets `application.json`'s `brand` as the application's brand; `main.tsx` applies it to the page (`applyAppearance`: tokens, `.dark` following `prefers-color-scheme` unless `appearance.setMode` overrides it, title, icon), and renders its `BrandMark` above the workbench beside system.l10n's `LanguagePicker`.

Which views show: the views the URL state names (`#?views=<id>,<id>`) win, opened and closed in the current device mode's layout, which the workbench then saves as any change; a URL naming none leaves the workbench showing the mode's saved layout (`workbench/layouts/<mode>` in the profile), else its default layout, `layout.open` (the host's `layouts`, before the `layouts` point's). `bindLayoutToUrl` (`src/url-layout.ts`) then keeps the two in step: opening or closing a view replaces the URL's history entry with the current mode's open views, and a navigation to another URL state opens and closes views to match. A named view nobody contributes is skipped. A core fragment's module reference resolves to its in-process module (system.workbench's commands; system.settings' view, whose React module loads with it, bound to the model); an app fragment's resolves to an export of the contributor's client folder (`archives/<id>/<client dir>/<module>`), imported on first use. Activating an app fragment's client aspect links its `index.css`, removed when the aspect deactivates. The shell follows `system:fragments:resolved` and activates the client aspect of every fragment that resolves after boot (enabled again, or installed later), since its extensions come back on resolve.

## License

MIT. See [LICENSE](../../LICENSE).

`tests/device-modes.e2e.test.ts` (seam 2) opens the app at a phone's, a tablet's and a desktop's width, each in a fresh profile:

| Test step | Feature |
| --- | --- |
| At 1280×800, `data-mode="desktop"`: the menu bar, the activity bar, the notes view in a dock tab, no tab bar; the surfaces view opens in a group right of it, in the right zone | The desktop mode: one dockview whose groups are the zones; a view's preferred zone (`zone` in the `views` point) |
| At 820×1180, `data-mode="tablet"`: the surfaces view opens in the "Right zone" drawer, not the dock; the drawer closes and the strip's "Right zone" button opens it again; a touch drag (CDP touch events) of the Notes tab to the dock's right edge splits it into a second group | The tablet mode: side zones as drawers, the centre a dockview whose panels drag by touch |
| At 390×844, `data-mode="phone"`: the notes view alone, a "Views" tab bar with "Notes" selected, no menu bar or dock tabs; "More" lists the menu bar's Notes menu and the Surfaces view, which opens as the one panel; the Notes tab brings the notes view back | The phone mode: one panel, a bottom tab bar and a "More" menu |
| Closing the notes tab on a desktop saves `workbench/layouts/desktop` (only the surfaces view); after a reload the notes view stays closed; resized to a phone's width the notes view is there (the phone's default layout, nothing saved for phone or tablet); back to a desktop's width it is closed again | A layout changed in one mode is saved in system.profile, survives a reload and leaves the other modes' layouts alone; the mode follows the width live |
| For each pair (desktop then phone, desktop then tablet, phone then desktop, tablet then desktop): a layout saved in the first mode, another in the second, a reload at the second width: every mode's stored layout unchanged, the second mode's views shown, the first mode's back on resizing | A reload at one width never saves another mode's layout (the workbench starts in the width's mode) |
| On a desktop with only a docked surface in the dock, opening the notes view puts it in the centre, left of the surface, and saves it there | A new zone group always gets an explicit place; the docked surfaces' group is never read as a zone |
| Dragging the Notes tab (mouse) into the right zone's group saves it in the right zone, and a reload keeps it there | A panel dragged to another zone's group moves its view to that zone in the model |
| `kernel.disable("org.statewalker.notes")` (a baseline fragment: removing it is refused) drops the notes view from the saved desktop layout; after a reload notes stays disabled, and enabling it contributes its view without opening it | A saved layout drops the views of a fragment that leaves (disabled or removed: the workbench sees the same view leaving) |
