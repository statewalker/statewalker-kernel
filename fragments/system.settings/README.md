# system.settings

## What it is

The core fragment that owns settings. It opens the `settings` extension point in its client aspect, on which a fragment declares its settings page: its settings as a JSON Schema 2020-12 object, statically, in its `fragment.client.jsonc`, so the page shows before the fragment's code loads. It keeps the settings model: the page of every enabled fragment, and each fragment's values, kept in the user's profile on the device (system.profile's store), one namespace per fragment, validated against the schema when they are stored and again when they are read back, the schema's defaults applying until the user sets a value. Its client half is one settings view in the workbench (a view and an activity bar entry on system.workbench's points), rendering each page as a form of shadcn controls. A fragment reads, writes and observes its own values through the client API (`settings.of(<its id>)` in `@statewalker/client.core`). It is a private workspace package, `@statewalker/system.settings`, in two halves: `src/` (React-free, tested in Node at seam 1) and `client/` (the settings view, React).

## Why it exists

ADR `2026-11-20-kernel-and-core-fragments` (statewalker-root) gives the `settings` point and the settings UI to this fragment and the values to system.profile; ADR `2026-11-18-fragment-manifest-and-extension-points` has fragments declare their settings schemas statically. Spec statewalker/statewalker-root#215: each fragment's settings in one settings view (user story 10), kept in the user's profile on the device (user story 30), declared before the fragment's code loads (user story 54), a disabled or removed fragment's settings page gone (user story 20) and its values kept unless it is removed with data (user story 17, ADR `2026-11-20-fragment-lifecycle`).

## How to use

```ts
import {
  createSystemSettings,
  SettingsError,
  SYSTEM_SETTINGS_ID,
  systemSettingsArchive,
} from "@statewalker/system.settings";
import { settingsModule } from "@statewalker/system.settings/client"; // React
import "@statewalker/system.settings/client.css"; // the settings view's prebuilt CSS
```

| Export | Provides |
| --- | --- |
| `systemSettingsArchive`, `SYSTEM_SETTINGS_ID` | The fragment's files (`fragment.jsonc`, `fragment.client.jsonc`), for `createKernel({ core })`. |
| `createSystemSettings({ profile? })` → `{ settings, activate, removeData }` | The model over `profile` (system.profile's store; memory by default), the body of the fragment's client activator, and the deletion of a fragment's values for the host's `removeData`. |
| `Settings` | `pages()` (the resolved fragments' pages, by `order`, then title), `page(fragment)`, `of(fragment)`, `state()`, `observe(listener)`. |
| `FragmentSettings` (`settings.of(id)`) | `values()`, `get(key)`, `set(key, value)`, `reset(key?)`, `observe(listener)`: one fragment's values. The client API's `settings.of` is this. |
| `SettingsPage`, `SettingsField`, `SettingsState`, `SettingSchema`, `SettingsPageData`, `SettingValue`, `SettingsValues` | A page (fragment, title, description, order, fields), a setting as the view renders it (key, type, title, description, default, enum, schema), the model's state, the point's data. |
| `SettingsStore`, `settingsKey(fragment)`, `SETTINGS_VERSION`, `StoredSettings` | The store the values are kept in; their key, `settings/<fragment-id>`; the stored form, version 1. |
| `SettingsError` | `unknown-fragment` (no page: the fragment declares none, or is not resolved), `unknown-setting` (a key its schema does not declare), `invalid-value` (the schema refuses the value; `reason` says why). |
| `settingsPageSchema`, `settingSchema`, `SETTINGS_POINT`, `SETTINGS_VIEW` | The point's schema (JSON Schema 2020-12), its short id, the view's identity (`system.settings/settings`). |
| `./client`: `SettingsView`, `settingsModule(settings)` | The settings view (React); the fragment's client module bound to the model, which the host resolves the view's reference (`./index.js`, `SettingsView`) to. |
| `./client.css` | The view's prebuilt CSS, against the shadcn tokens, no preflight. |

## Examples

A fragment declares its settings page in its `fragment.client.jsonc`, with no `requires`:

```jsonc
{
  "point": "settings",
  "data": {
    "title": "Notes",
    "description": "How the notes view shows your notes.",
    "schema": {
      "type": "object",
      "properties": {
        "sort": { "type": "string", "title": "Sort notes by", "enum": ["added", "alphabetical"], "default": "added" },
        "copyButtons": { "type": "boolean", "title": "Show Copy buttons", "default": true }
      }
    }
  }
}
```

Its view reads and follows its own values through the client API:

```tsx
import { settings } from "@statewalker/client.core";

const own = settings.of("org.statewalker.notes");

function NotesView() {
  const [values, setValues] = useState(() => own.values());
  useEffect(() => own.observe(setValues), []);
  return values.sort === "alphabetical" ? <Sorted /> : <AsAdded />;
}
```

The host runs the fragment over the user's profile, resolves its view in process, deletes a fragment's values on "remove with data", and installs it in the client API:

```ts
const profile = createSystemProfile({ storage: localStorage, prefix: "org.example.app:" });
const system = createSystemSettings({ profile: profile.store });
const kernel = createKernel({
  platform,
  core: [systemProfileArchive, systemWorkbenchArchive, systemSettingsArchive /* , ... */],
  profile: profile.store,
  removeData: (fragment) => system.removeData(fragment.id),
  resolvers: {
    module: async (ref, { contributor }) =>
      contributor.id === SYSTEM_SETTINGS_ID
        ? settingsModule(system.settings)[ref.export ?? "default"] // cache it: one component
        : importExport(contributor, ref),
  },
  activators: {
    client: (f, context) => (f.id === SYSTEM_SETTINGS_ID ? system.activate(context) : undefined),
  },
});
installClient({ commands: bus, settings: system.settings });
```

## Internals

**The point.** An extension's data is `{ title?, description?, order?, schema }`. `schema` is a JSON Schema 2020-12 object (`type: "object"`, `properties`, an optional `$schema` naming 2020-12) of at most 64 settings, each key a letter then letters, digits, `_`, `-` or `.` (at most 64), each setting a string, number, integer or boolean with only the keywords the view renders and the model validates: `title`, `description`, `default`, `enum` (a choice), `minimum`, `maximum`, `minLength`, `maxLength`, `pattern`. Anything else (a nested object, an array, `format`, `$ref`) is refused by the kernel with a reason in `system:extensions:refused:client`, so a page always renders. A fragment has one page: the first extension it declares wins. A page lives while its fragment is resolved: disabling or removing the fragment drops it from the view, and re-enabling brings it back with the values kept.

**Values.** A fragment's values are kept under `settings/<fragment-id>` in the profile as `{ "version": 1, "values": { "<key>": <value> } }`, only the values the user set. `set` validates the value against the setting's schema (`@cfworker/json-schema`, draft 2020-12) and refuses with a `SettingsError` before anything is stored; it keeps the stored values the current schema does not declare (an older or newer version's), so an upgrade or rollback of the fragment loses none. Reading validates each stored value again: one the schema refuses (the schema changed, the profile was edited) reads as the default, and is replaced by the next `set`; a default the schema itself refuses is dropped. A stored form that is not version 1 reads as no values and is replaced by the next change. `reset(key)` forgets one value, `reset()` all of them (the key leaves the profile). Observers are called at once, then only when what they watch changed: a fragment's observer when its own values change, never another fragment's.

**Namespaces.** `settings.of(id)` reads and writes only `settings/<id>`, and only the keys `id`'s schema declares, so a key cannot reach another fragment's values. In a page every fragment's code shares one JavaScript realm, so the id a fragment passes is declared, not proven; a sandboxed fragment's client (later) gets one the host binds.

**Removal.** A plain removal keeps the values, so a reinstall finds them; the host's `removeData` (the kernel calls it only for `remove(id, { withData: true })`) calls `removeData(id)`, which deletes `settings/<id>` and nothing else.

**The view.** One view, `system.settings/settings`, in the centre zone, opened from the activity bar's "Settings". Each page is a card; an `enum` is a shadcn `Select` (labels are the values), a boolean a checkbox, a string a text field, a number or integer a number field. A value is stored as it changes; one the schema refuses stays in the field with the reason under it (`role="alert"`) and is not stored. "Reset to defaults" resets the page. Labels are the schema's `title` (else the key) and the page's `title` (else the fragment's id); they are not localized yet (system.l10n).

### Dependencies

- `@statewalker/kernel.core`: the activation context, the archive type.
- `@cfworker/json-schema`: validating values against the settings' schemas.
- `@statewalker/ui.view.shadcn` (client half): the view's controls; React is a peer.

## License

MIT. See [LICENSE](../../LICENSE).
