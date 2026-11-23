# system.workbench

## What it is

The core fragment that owns the workbench. It opens the `views`, `layouts`, `menus`, `notifications`, `dialogs`, `statusbar` and `activitybar` extension points in its client aspect, keeps the workbench model (which views fragments contribute and where the open ones are: the left, right, bottom and centre zones, per device mode, saved in the user's profile, the menus, the keyboard shortcuts over system.commands' `keybindings`, the command palette, the bars, the dialogs and notifications waiting for an answer), and its client half renders that model in the device mode the window's width gives: on a desktop a menu bar, an activity bar, one dockview (`dockview-react`) whose groups are the zones, a status bar; on a tablet the same with the side and bottom zones as drawers and panels dragged by touch; on a phone one panel, a bottom tab bar and a "More" menu; and everywhere context and tab menus per view, the command palette, keyboard shortcuts, dialogs and Sonner notifications, all shadcn, styled with the shadcn tokens. Every command the chrome runs goes through system.commands' bus. It is a private workspace package, `@statewalker/system.workbench`, in two halves: `src/` (React-free, tested in Node at seam 1; `lint:check` fails a React import or a `.tsx` file there) and `client/` (React, the fragment's default client folder).

It also has a dock for surfaces: system.a2ui's surfaces popped out by the user or by its commands `system.workbench/open-surface` and `close-surface`. Layouts per device mode, the last point ADR `2026-11-20-kernel-and-core-fragments` gives it, come with statewalker/statewalker-root#253.

## Why it exists

ADR `2026-11-18-react-only-shell-with-shared-modules` makes the shell React only, one dockview with shadcn (Menubar, DropdownMenu, ContextMenu, Command, Sonner, and our own keybinding registry), sharing React, shadcn, dockview and the client API through an import map, with prebuilt CSS per fragment and no preflight. ADR `2026-11-20-kernel-and-core-fragments` puts the workbench's points in this fragment. Everything a fragment adds to the chrome is data in its `fragment.client.jsonc` (ADR `2026-11-18-fragment-manifest-and-extension-points`: "menus, views and agent tools must be known before a fragment's code loads"), so the workbench shows a fragment's menus, keybindings and bars before its code loads, runs its commands through the bus (which loads the handler on first call), and drops them all when the fragment leaves. Dialogs and notifications are declared the same way and raised by identity, so they look the same for every fragment (spec statewalker-root#215, user stories 7, 8 and 36). The same application works on a phone, a tablet and a desktop, each with the chrome that fits it, and remembers its layout per device mode, so switching between them does not scramble an arrangement (user stories 2 to 6); the layouts are the user's, kept on the device by system.profile (user story 30, ADR `2026-11-20-kernel-and-core-fragments`), and a removed fragment's views leave them (ADR `2026-11-20-fragment-lifecycle`).

## How to use

```ts
import {
  createSystemWorkbench,
  SYSTEM_WORKBENCH_ID,
  systemWorkbenchArchive,
  WorkbenchError,
} from "@statewalker/system.workbench";
import { WorkbenchView } from "@statewalker/system.workbench/client"; // React
import "@statewalker/system.workbench/theme.css"; // the token values, once per page
import "@statewalker/system.workbench/client.css"; // the workbench's prebuilt CSS
```

| Export | Provides |
| --- | --- |
| `systemWorkbenchArchive`, `SYSTEM_WORKBENCH_ID` | The fragment's files (`fragment.jsonc`, `fragment.client.jsonc`), for `createKernel({ core })`. |
| `createSystemWorkbench({ commands?, locale?, l10n?, profile?, mode?, layouts? })` → `{ workbench, module, activate }` | The model, the fragment's client module (its commands' handlers, what its references resolve to), and the body of its client activator. `commands` is system.commands' bus (the chrome titles, binds and runs commands on it); `l10n` is system.l10n's model (every label is read through it, live), or, without it, `locale` the one command labels are read in; `profile` where layouts are saved (a `LayoutStore`: system.profile's store), `mode` the device mode to start in (`desktop`), `layouts` the host's default layouts (an application definition's), read before the `layouts` point's. |
| `workbench.text(key, fallback, params?)`, `workbench.locale()` | The chrome's own texts (system.workbench's keys) in the interface language; the language. |
| `WorkbenchL10n`, `commandLabels(entry, l10n, locale)`, `textOf(l10n)` | What the workbench needs of system.l10n; a command's title and description through it. |
| `Workbench` | Views: `views()`, `view(id)`, `opened()`, `open(id, zone?)`, `close(id)`. Zones and modes: `mode()`, `setMode(mode)`, `layout()`, `zoneOf(id)`, `move(id, zone, index?)`, `setActive(id)`. Chrome: `menu(menu, context?)`, `keybindings()`, `keyCommand(event, context?)`, `palette()`, `statusbar(context?)`, `activitybar()`, `dialogs`, `notifications`, `execute(id)`, `run(id, input?)`. Dock: `setSurfaceSource(source)`, `openSurface(surfaceId, { title? })`, `closeSurface(surfaceId)`, `docked()`. `observe(listener)`. |
| `SurfaceSource`, `DockedSurface`, `SURFACE_PANEL_PREFIX` | Where docked surfaces come from (`title`, `component`, `docked`, optional `onRemoved`); a docked surface (panel id `surface:<surfaceId>`). |
| `ViewEntry`, `WorkbenchState` | A view (`id`, `viewId`, `fragment`, `title`, `zone`, `extension`, `component()`); the views, the open ones, the device mode and its layout, the pending dialogs and notifications, the docked surfaces. |
| `Zone`, `ZONES`, `DeviceMode`, `DEVICE_MODES`, `DEVICE_BREAKPOINTS`, `deviceModeOf(width)` | The zones (`center`, `left`, `right`, `bottom`); the device modes and the widths choosing them (phone below 640 CSS pixels, tablet below 1024, desktop from there). |
| `WorkbenchLayout`, `LayoutContribution`, `SavedLayout`, `LayoutStore`, `layoutKey(mode)`, `LAYOUT_VERSION`, `readSavedLayout`, `defaultLayout`, `filterLayout`, `placeView`, `withoutViews` | A layout (views per zone, the active one); a default layout as the `layouts` point takes it; the saved form (version 1) under `workbench/layouts/<mode>`; the store the workbench saves into; the pure layout operations. |
| `MenuNode`, `WorkbenchKeybinding`, `PaletteEntry`, `StatusItem`, `ActivityItem` | What the chrome renders. |
| `Requests`, `DialogRequest`, `NotificationRequest`, `RequestAnswer`, `RequestAction` | Raising (`show(id, params)` → the answer), listing (`pending()`) and answering (`answer(request, answer)`) dialogs and notifications. |
| `needsInput`, `normalizeChord`, `chordOf`, `typesText`, `formatChord`, `commandForKey`, `PALETTE_CHORDS`, `evaluateWhen`, `fillText` | The keybinding registry's and `when` expressions' pure parts. |
| `WorkbenchError` | `unknown-view` (opening a view nobody contributes), `no-component`, `no-commands`, `unknown-dialog`, `unknown-notification`, `unknown-surface` (docking a surface no source holds). |
| `viewSchema`, `layoutSchema`, `menuSchema`, `notificationSchema`, `dialogSchema`, `statusItemSchema`, `activityItemSchema`, `*_POINT` | The points' schemas (JSON Schema 2020-12) and short ids. |
| `./client`: `WorkbenchView` | The React component rendering a `Workbench` in the device mode of the window's width (`followWidth={false}` leaves the mode to the host): the chrome around one dockview, drawers, or a phone's one panel. |
| `./client.css`, `./theme.css`, `./tokens.css` | The prebuilt CSS; the shadcn token values (light, `.dark`); the tokens as Tailwind theme variables, for fragments' CSS. |

## Examples

A fragment contributes a view in its `fragment.client.jsonc`, with no `requires` on system.workbench:

```jsonc
{
  "$schema": "./node_modules/@statewalker/kernel.core/schemas/fragment-aspect.v1.schema.json",
  "extensions": [
    {
      "point": "views",
      "data": { "id": "notes", "title": "Notes" },
      "reference": { "module": "./index.js", "export": "NotesView" }
    }
  ]
}
```

A view may name the zone it opens in (`center` by default), and a fragment, or the host for an application, contributes default layouts, for every device mode or for one:

```jsonc
{ "point": "views", "data": { "id": "outline", "title": "Outline", "zone": "left" }, "reference": { "module": "./index.js", "export": "OutlineView" } },
{ "point": "layouts", "data": { "zones": { "center": ["org.example.notes/notes"] } } },
{ "point": "layouts", "data": { "mode": "desktop", "zones": { "left": ["org.example.notes/outline"] } } }
```

The host gives the workbench the user's profile and follows the window's width:

```ts
const profile = createSystemProfile({ storage: localStorage, prefix: "org.example.app:" });
const system = createSystemWorkbench({
  commands: bus,
  profile: profile.store,
  layouts: [{ zones: { center: ["org.example.notes/notes"] } }], // the application's default layout
});
createRoot(app).render(<WorkbenchView workbench={system.workbench} />); // sets the mode by width
system.workbench.move("org.example.notes/notes", "left"); // saved as the desktop layout
```

Menus, a keybinding, the bars, a dialog and a notification, beside the command they reach (system.commands' `commands` point):

```jsonc
{
  "extensions": [
    { "point": "menus", "data": { "menu": "menubar", "submenu": "notes", "title": "Notes" } },
    { "point": "menus", "data": { "menu": "notes", "command": "org.statewalker.notes/new-note" } },
    {
      "point": "menus",
      "data": {
        "menu": "view/context",
        "command": "org.statewalker.notes/new-note",
        "when": "view == org.statewalker.notes/notes"
      }
    },
    { "point": "keybindings", "data": { "key": "ctrl+alt+n", "command": "org.statewalker.notes/new-note" } },
    { "point": "statusbar", "data": { "id": "new-note", "text": "New note", "command": "org.statewalker.notes/new-note" } },
    { "point": "activitybar", "data": { "id": "notes", "title": "Notes", "view": "org.statewalker.notes/notes" } },
    {
      "point": "dialogs",
      "data": {
        "id": "new-note",
        "title": "New note",
        "input": { "label": "Note" },
        "actions": [{ "id": "add", "label": "Add", "primary": true }, { "id": "cancel", "label": "Cancel" }]
      }
    },
    {
      "point": "notifications",
      "data": { "id": "note-added", "title": "Note added", "message": "{text}", "severity": "success", "actions": [{ "id": "undo", "label": "Undo" }] }
    }
  ]
}
```

The command's handler raises them through the client API and gets the user's answers:

```ts
import { dialogs, notifications } from "@statewalker/client.core";

const { action, value } = await dialogs.show("org.statewalker.notes/new-note");
const { action: picked } = await notifications.show("org.statewalker.notes/note-added", { text: value });
```

The host runs the fragment and renders it:

```tsx
const commands = createSystemCommands();
const workbench = createSystemWorkbench({ commands: commands.bus, locale: navigator.language });
const kernel = createKernel({
  platform,
  core: [systemCommandsArchive, systemWorkbenchArchive],
  resolvers: {
    // system.workbench's own references (its commands) name its in-process module.
    module: (ref, { contributor }) =>
      contributor.id === SYSTEM_WORKBENCH_ID
        ? workbench.module[ref.export ?? "default"]
        : importExport(contributor, ref),
  },
  activators: {
    client: (fragment, context) =>
      fragment.id === SYSTEM_WORKBENCH_ID ? workbench.activate(context) : activateClient(fragment),
  },
});
await kernel.start();
createRoot(element).render(<WorkbenchView workbench={workbench.workbench} />);
installClient({
  commands: commands.bus,
  dialogs: workbench.workbench.dialogs,
  notifications: workbench.workbench.notifications,
});
workbench.workbench.open("org.statewalker.notes/notes");
```

A fragment's CSS is compiled against the tokens, without preflight:

```css
@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/utilities.css" layer(utilities) source(none);
@import "@statewalker/system.workbench/tokens.css";
@source "./";
```

## Internals

### The `views` point

An extension's data is `{ id, title, zone? }`: `zone` is where it opens unless asked otherwise (`center`, `left`, `right` or `bottom`; the centre by default), `id` is unique within the contributing fragment (lowercase letters and digits with inner hyphens, at most 64), and the view's identity is `<fragment-id>/<id>`. The reference is the view's React component (a client module export); `ViewEntry.component()` resolves it through the kernel, so it rejects with `ExtensionUnavailable` once the contributor is gone. Data that breaks the schema is refused by the kernel with a reason in `system:extensions:refused:client`. When one fragment declares the same view id twice, the first extension read wins.

### The model

The model follows the `views` point through the activation context, so a view lives exactly while its fragment is resolved. Where the open views are is the current device mode's layout: the views of each zone in tab order, and the active one. `open(id, zone?)` adds a contributed view at the end of the zone asked, else its preferred zone, and makes it active (a view already open stays where it is); `close(id)` removes it (another open view becomes active); `move(id, zone, index?)` moves a view to another zone or place (opening it if closed); `setActive(id)` brings an open view forward. `opened()` lists the open views zone by zone (centre, left, right, bottom). A view that leaves (its fragment disabled or removed) is closed too, and the rest stays as it was; re-enabling the fragment brings its view back to the list, closed. Deactivating system.workbench empties the model but keeps the saved layouts. `observe` is called at once and after each change.

### Device modes and layouts

The device mode is `phone` below 640 CSS pixels of window width, `tablet` below 1024 and `desktop` from there (`deviceModeOf`); the client sets it from the window's width, before the first paint and on every resize, and `setMode` switches the layout shown. A host that changes the layout before the client renders (restoring views from the URL, say) starts the workbench in the right mode (`createSystemWorkbench({ mode: deviceModeOf(window.innerWidth) })`): every change saves the current mode's layout, so a change made in the default `desktop` mode at a phone's width would overwrite the desktop layout. Each mode has its own layout:

- **Default.** Until the user changes a mode's layout, it is the mode's default layout: the host's `layouts`, then the `layouts` point's contributions, each for that mode or for every mode, in order, a view in the first zone naming it, the first `active` given. It follows the point and the views: a view arriving later shows when a default layout names it.
- **Saved.** The first change in a mode (open, close, move, a different active view, a panel dragged to another zone) saves that mode's layout in the profile, under `workbench/layouts/<mode>`, and the default no longer applies to it. The other modes' layouts do not change. A saved layout may name views not there (yet): they are kept and show when their fragment arrives. When a view leaves (its fragment disabled or removed), it is dropped from every mode's saved layout, for good: re-enabling the fragment does not reopen it.

The saved form is JSON, version 1: `{ "version": 1, "zones": { "center": [...], "left": [...], "right": [...], "bottom": [...] }, "active": "<view>" }`. A value that is not version 1, or not well formed, is ignored (the default layout applies) and is replaced by the next change. Profile errors are logged, never thrown at the user.

### The chrome's points

All of them are read from the kernel's registry, never from the contributor's code: a fragment's entries show as soon as it resolves, before its client code loads, and leave when it is disabled or removed. Data that breaks a point's schema is refused with a reason in `system:extensions:refused:client`.

- **`menus`**: `{ menu, command | submenu + title, title?, group?, order?, when? }`. `menu` is where the entry sits: `menubar` (its entries are submenus, one menu each), `view/context` (a view's context menu), `view/title` (the "View actions" menu of a view's tab bar), or a submenu's id (ids are global; prefix them with the fragment id when they should not be shared). A command entry is titled by the command's label in the interface language (above) unless it has a `title`, and shows (titled or not) only while the command can run from the chrome (below); a submenu shows only when something is in it. Entries are sorted by `group` (ungrouped first, a separator between groups), then `order` (0 by default), then title. `menu(menu, context)` builds a menu.
- **Keybindings** stay system.commands' point (`{ key, command, when? }`); the workbench's registry reads them through the bus: `keybindings()` lists those whose command can run from the chrome, chords normalized (`Shift+Ctrl+P` → `ctrl+shift+p`; aliases `cmd`, `option`, `control`), and `keyCommand(event, context)` answers the command a key event runs: the last binding whose chord matches and whose `when` holds. Letters and digits are read from the key's code, so `ctrl+alt+n` matches whatever character Alt makes. A key typed with AltGr (`getModifierState("AltGraph")`; Windows reports it as ctrl+alt) is text, never a chord. While a text field has the focus (`inputFocus`), a binding without a `when` leaves the chords that may type text (no modifier, shift alone, alt, ctrl+alt: `typesText`) to the field; ctrl and meta chords still run, and a binding with a `when` decides for itself (`when: "inputFocus"` to run in fields too). Ctrl/Cmd+Shift+P and F1 open the palette (`PALETTE_CHORDS`); they are the workbench's own, not on the point.
- **`when`** is a deliberately small language: terms joined by `&&` and `||`, each `key`, `!key`, `key == value` or `key != value`. The client gives `view` (the view a context or tab menu is for), `activeView` (the dock's active panel) and `inputFocus` (a text field has the focus) to every menu, the status bar and the keybindings, and re-renders the chrome when they change. A missing key is false; an unreadable expression never holds.
- **Commands the chrome can run.** The chrome runs commands with no input, so it offers only commands that need none (`needsInput`: a request body marked `required`, or an input schema with `required` properties). A command that needs an input stays on the bus, for views and other fragments to call with one, but is left out of the palette, menus, keybindings and bars.
- **The palette** (`palette()`) lists every command on the bus the chrome can run, titled and described in the locale, with its keybinding, sorted by title.
- **`statusbar`**: `{ id, text, tooltip?, alignment?, order?, command?, when? }`, left then right, by order; a click runs `command` while the chrome can run it.
- **`activitybar`**: `{ id, title, order?, view | command }`, shown while its view or command is live; a click opens the view or runs the command.
- **`dialogs`**: `{ id, title, message?, input?: { label, placeholder?, value? }, actions? }` (one OK button by default). **`notifications`**: `{ id, title, message?, severity?, actions? }` (`info` by default). A fragment raises one by identity, `<fragment-id>/<id>`, with params its texts name as `{name}` (`dialogs.show(id, params)` in the model, the same in `@statewalker/client.core`); the promise resolves with the user's answer, `{ action?, value? }`: the action picked and the text typed, `{}` when dismissed. Raising an undeclared one rejects with a `WorkbenchError`. A request whose fragment leaves is answered `{}`. Requests are queued (`pending()`); the client answers them (`answer(request, answer)`).
- **`execute(id)`** runs a command as the chrome does: a failure raises system.workbench's own notification, `system.workbench/command-failed` (declared in this fragment's `fragment.client.jsonc`), instead of rejecting. `run(id, input)` is the plain bus call.

### Labels and l10n

With system.l10n wired (`l10n`), every text the workbench shows is read through it, in the interface language, under a key of the contributing fragment's namespace derived from the contribution; the inline text stays the default language's fallback, so a contribution needs no key of its own:

| Text | Key |
| --- | --- |
| A view's title | `views.<view-id>.title` |
| A command's title, description | `commands.<command-id>.title`, `.description` (in each locale, the fragment's own bundle, then the command's inline `labels`, then language packs; the default language's text comes after the language's) |
| A submenu's title; a command entry's own title | `menus.<submenu>.title`; `menus.<menu>.<command>.title` |
| A status bar item | `statusbar.<id>.text`, `.tooltip` |
| An activity bar entry | `activitybar.<id>.title` |
| A dialog | `dialogs.<id>.title`, `.message`, `.input.label`, `.input.placeholder`, `.input.value`, `.actions.<action-id>` |
| A notification | `notifications.<id>.title`, `.message`, `.actions.<action-id>` |
| The chrome's own (system.workbench's namespace) | `palette.placeholder`, `palette.empty`, `activitybar.label`, `view.actions`, `view.loading`, `view.failed`, `view.close`, `notification.dismiss`, `actions.ok`; a tablet's `zones.<zone>`, `zones.<zone>.short`, `zones.close`, `zones.empty`; a phone's `phone.tabbar`, `phone.views`, `phone.more`, `phone.open`, `phone.empty` |

When the language changes, the model notifies its observers: views are titled again (the client retitles their tabs), pending dialogs and notifications are rebuilt in the new language (their `{name}` values formatted with `Intl`), and menus, bars and the palette are built in it on the next read; the palette sorts in the language. This fragment carries its own texts in French (a bundle in `fragment.client.jsonc`). Without `l10n`, nothing changes: inline texts, and command labels in `locale` (system.commands' `labelsOf`).

### The dock

A surface source (system.a2ui's `createSurfaceDock`, set by the host with `setSurfaceSource`) gives the workbench surfaces without the workbench knowing how they render. `openSurface(surfaceId, { title? })` docks one the source holds (titled by the source unless a title is given) and tells the source; `closeSurface` takes it out and tells the source too; a surface docked already stays, and the source is told again that it is docked. While a source is set, the workbench follows its `onRemoved`: a surface the source drops leaves the dock. The fragment declares two commands in its own `fragment.client.jsonc`, `open-surface` (`{ surfaceId, title? }`) and `close-surface` (`{ surfaceId }`), both answering `{}`, their handlers the exports `openSurface`/`closeSurface` of its client module (`module`), which a host resolves in process; with system.commands they are `system.workbench/open-surface` and `close-surface` on the bus. Deactivating the fragment, or changing the source, empties the dock.

### The client half

`WorkbenchView` renders the device mode's chrome. On a desktop, one `DockviewReact` holds every zone, each zone a group tagged with it (the left and right zones and the bottom at the dock's edges, the centre between them, docked surfaces in a group of their own at the right edge, never read as a zone; every new group gets an explicit place, so a centre view opened beside only docked surfaces goes left of them); a panel the user drags into another zone's group moves its view to that zone in the model (a group the user splits off keeps the zone its panel came from; a view dropped among the docked surfaces keeps its zone and goes back to it). On a tablet, the dockview holds the centre zone, its panels dragged by touch or mouse (dockview's `pointer` strategy), and a strip above it opens the left, right and bottom zones as drawers (a view made active in a side zone opens its drawer). On a phone, there is no menu bar, activity bar, status bar or dockview: one panel shows the active view (or a docked surface), a bottom tab bar lists the first four open views and docked surfaces, and "More" lists the rest, the views not open and the menu bar's menus. On a desktop and a tablet, the menu bar (shadcn `Menubar`, one menu per `menubar` submenu), the activity bar and the status bar surround the dock. In every mode: the command palette (`CommandDialog`), the oldest pending dialog (`Dialog`, Enter answers with its primary action, Escape or closing with none), every pending notification as a Sonner toast rendered by one card component (staying until answered when it has actions, closing by itself otherwise), and a window `keydown` listener dispatching keybindings (not while a dialog or the palette is open). A view's panel carries its `view/context` entries as a `ContextMenu` (the browser's own menu when there are none) and its tab bar the `view/title` entries as a `DropdownMenu` ("View actions"). The dock's panels are the open views: a newly opened view gets a panel titled with the view's title (retitled when the language changes), a closed one loses its panel, and a panel the user closes closes its view. Docked surfaces get panels of their own in one group on the right, the dock zone; closing such a panel closes the surface's dock entry, so it goes back inline. A panel resolves its view's (or surface's) component and renders it inside an error boundary, so a view that fails to load or throws shows its error in its panel and nothing else. React context crosses into panels (dockview renders them through portals).

dockview's light theme takes its colours from the shadcn tokens (`.dockview-theme-workbench` in `client/styles.css`). The prebuilt `dist/client.css` holds dockview's stylesheet and the utilities the client half and the shadcn primitives it renders use, compiled with the Tailwind CLI against `tokens.css`, without preflight. `theme.css` holds the token values and the page's base rules, among them the few preflight rules the shadcn primitives need (no UA borders or button chrome) in the `base` layer, which every fragment's utilities override; it is plain CSS the shell loads once (branding will set the values).

### Dependencies

- `@statewalker/kernel.core`: the activation context, the archive type.
- `@statewalker/system.commands`: the bus type and `labelsOf` (the chrome titles commands in the locale). Both are core fragments, shipped together.
- system.l10n is not a dependency: the host passes its model, which fits `WorkbenchL10n` (its package is a dev dependency, for the seam-1 tests).
- `@statewalker/ui.view.shadcn`, `dockview-react`, and `react`/`react-dom` as peers: the client half, shared by the shell's import map in a browser.

## License

MIT. See [LICENSE](../../LICENSE).
