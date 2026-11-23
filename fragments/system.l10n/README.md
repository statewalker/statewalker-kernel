# system.l10n

## What it is

The core fragment that owns the interface language. It opens the `l10n` extension point in its client aspect: fragments declare message bundles there (the texts of one locale for one fragment's keys, namespaced by fragment id), and language packs add translations for other fragments' keys. Its model keeps the interface language, switched live (observers re-render, nothing reloads), and gives each key's text in it with a fallback to the default language, then to the contribution's inline text. Values are formatted with `Intl`. Its client half is a language picker. It is a private workspace package, `@statewalker/system.l10n`, in two halves: `src/` (React-free, tested in Node at seam 1) and `client/` (a React component).

## Why it exists

ADR `2026-11-18-fragment-manifest-and-extension-points` (statewalker-root, decision 7) namespaces message bundles per fragment, lets language packs translate other fragments' keys, uses `Intl`, and needs no reload on a locale change; ADR `2026-11-20-kernel-and-core-fragments` gives the `l10n` point to this fragment. The spec (statewalker/statewalker-root#215, user story 9) asks for the interface language to switch while menus, views, commands' labels and settings follow.

## How to use

```ts
import {
  createSystemL10n,
  SYSTEM_L10N_ID,
  systemL10nArchive,
} from "@statewalker/system.l10n";
import { LanguagePicker } from "@statewalker/system.l10n/client";
import "@statewalker/system.l10n/client.css"; // the picker's styles
```

| Export | Provides |
| --- | --- |
| `systemL10nArchive`, `SYSTEM_L10N_ID` | The fragment's files (`fragment.jsonc`, `fragment.client.jsonc`), for `createKernel({ core })`. |
| `createSystemL10n({ locale?, defaultLocale? })` → `{ l10n, activate }` | The model, starting in `locale` (the browser's), falling back to `defaultLocale` (`en`), and the body of the fragment's client activator. |
| `L10n` | `locale()`, `defaultLocale()`, `locales()`, `setLocale(locale)`, `text(namespace, key, { params?, labels?, fallback? })`, `has(namespace, key, locale?)`, `format(text, params?)`, `bundles()`, `state()`, `observe(listener)`. |
| `BundleData`, `BundleEntry`, `TextOptions`, `L10nState` | The point's data; a bundle the model holds; how a text is looked up; the model's state. |
| `formatMessage(text, params?, locale?)`, `formatValue(value, locale?)`, `MessageParams` | `{name}` filled with `Intl`: numbers (`NumberFormat`), dates (`DateTimeFormat`), lists of strings (`ListFormat`). |
| `canonicalLocale(tag)`, `localeChain(tag)` | `fr-ca` → `fr-CA`; `fr-CA` → `["fr-CA", "fr"]`. |
| `L10nError` | `invalid-locale`. |
| `bundleSchema`, `L10N_POINT`, `DEFAULT_LOCALE`, `LOCALE_PATTERN`, `KEY_PATTERN` | The point's schema (JSON Schema 2020-12), short id and patterns. |
| `./client`: `LanguagePicker({ l10n })`, `localeName(tag)` | A `<select>` (`data-testid="language-picker"`, labelled "Language" in the interface language) of every locale bundles exist in, each named in its own language (`Intl.DisplayNames`); picking one switches the language. |
| `./client.css` | The picker's styles, plain CSS over the shadcn tokens. |

## Examples

A fragment declares its bundles in its `fragment.client.jsonc`, with no `requires`:

```jsonc
{
  "extensions": [
    { "point": "views", "data": { "id": "notes", "title": "Notes" } },
    { "point": "l10n", "data": { "locale": "en", "messages": { "view.count": "Notes: {count}" } } },
    {
      "point": "l10n",
      "data": {
        "locale": "fr",
        "messages": { "views.notes.title": "Bloc-notes", "view.add": "Ajouter la note" }
      }
    }
  ]
}
```

A language pack translates another fragment's keys by naming its namespace:

```jsonc
{ "point": "l10n", "data": { "locale": "de", "namespace": "org.statewalker.notes", "messages": { "view.add": "Notiz hinzufügen" } } }
```

The host wires the model into the kernel, the workbench and the client API, and shows the picker:

```tsx
const l10n = createSystemL10n({ locale: navigator.language });
const workbench = createSystemWorkbench({ commands: commands.bus, l10n: l10n.l10n });
const kernel = createKernel({
  platform,
  core: [systemL10nArchive /* , ... */],
  activators: {
    client: (f, context) => (f.id === SYSTEM_L10N_ID ? l10n.activate(context) : undefined),
  },
});
installClient({ commands: commands.bus, l10n: l10n.l10n });
root.render(<LanguagePicker l10n={l10n.l10n} />);

l10n.l10n.setLocale("fr"); // menus, views, the palette, dialogs follow; nothing reloads
```

A fragment's view reads its texts through the client API (`@statewalker/client.core`):

```tsx
const t = translator("org.statewalker.notes");
<Button>{t("view.add", {}, "Add note")}</Button>; // re-render on l10n.observe
```

## Internals

**Bundles.** An extension's data is `{ locale, messages, namespace? }`: a BCP 47 tag, the texts by key (letters, digits, `_`, `.`, `-`, `/`; at most 2000 per bundle, 4096 characters each), and the namespace, the contributor's fragment id unless a language pack names another. Bundles are inline in the aspect file, so they are known before the fragment's code loads. A bundle breaking the schema is refused by the kernel (`system:extensions:refused:client`). A bundle for a core fragment's namespace (`system.*`) is taken only from a core fragment: an installed fragment cannot reword the platform's own texts, such as its permission prompts.

**Resolution.** `text(namespace, key, options)` asks, in order: the interface language's bundles (`fr-CA`, then `fr`); `options.labels` in those locales (inline per-locale texts a contribution carries, such as a command's `labels`); the default language's bundles; `options.fallback` (the contribution's inline text, in the default language); the key. At each step the namespace's own bundles win over language packs, which only fill gaps; among packs the first read wins. `{name}` is then filled from `options.params`, formatted for the interface language. A locale is canonicalized (`fr-ca` → `fr-CA`) and compared without case.

**Keys of the chrome.** The workbench reads its contributions' texts under keys derived from them (system.workbench's README lists them: `views.<id>.title`, `commands.<command-id>.title`, `menus.<submenu>.title`, `dialogs.<id>.message`, ...), so a contribution keeps its inline text as the default-language fallback and needs no key of its own.

**The language** is `locale` at start (any valid tag, even one no bundle has: its texts fall back), switched by `setLocale`, which tells observers. `locales()` lists the default language and every locale a bundle is contributed in. The choice lasts for the page's life; it goes to the profile once system.settings exists.

### Dependencies

- `@statewalker/kernel.core`: the activation context and the archive type.

## License

MIT. See [LICENSE](../../LICENSE).
