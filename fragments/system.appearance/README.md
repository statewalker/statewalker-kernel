# system.appearance

## What it is

The core fragment that owns how the platform looks. It opens the `branding` and `themes` extension points in its client aspect and keeps the appearance model: one brand active at a time (a name, a logo and the shadcn colour tokens in light and dark), an optional theme laid over it, and the mode shown (light or dark, following the system unless the user chooses). Its client half sets the active tokens on the page as CSS variables, so they are the single theme source every fragment's prebuilt CSS reads, and shows the brand's mark. It is a private workspace package, `@statewalker/system.appearance`, in two halves: `src/` (React-free, tested in Node at seam 1) and `client/` (the DOM applier, and a React component).

## Why it exists

ADR `2026-11-20-kernel-and-core-fragments` gives `branding` and `themes` to this fragment; ADR `2026-11-18-fragment-manifest-and-extension-points` keeps one brand active at a time; ADR `2026-11-18-react-only-shell-with-shared-modules` makes the shadcn tokens the single theme source, set by branding. An application carries its own brand (spec statewalker/statewalker-root#215, user stories 11 and 59): the host passes it to this fragment, and fragments may contribute others.

## How to use

```ts
import {
  createSystemAppearance,
  SYSTEM_APPEARANCE_ID,
  systemAppearanceArchive,
} from "@statewalker/system.appearance";
import { applyAppearance, BrandMark } from "@statewalker/system.appearance/client";
import "@statewalker/system.appearance/client.css"; // the brand mark's styles
```

| Export | Provides |
| --- | --- |
| `systemAppearanceArchive`, `SYSTEM_APPEARANCE_ID` | The fragment's files (`fragment.jsonc`, `fragment.client.jsonc`), for `createKernel({ core })`. |
| `createSystemAppearance({ brand?, mode? })` → `{ appearance, activate }` | The model with the application's brand (validated against `brandSchema`, else `AppearanceError` `invalid-brand`), and the body of the fragment's client activator. |
| `Appearance` | `brands()`, `brand()`, `selectBrand(id)`, `themes()`, `theme()`, `selectTheme(id \| undefined)`, `mode()`, `setMode("light" \| "dark" \| "system")`, `setSystemMode(mode)`, `colorMode()`, `palette()`, `tokens()`, `state()`, `observe(listener)`. |
| `BrandData`, `ThemeData`, `BrandEntry`, `ThemeEntry`, `AppearanceState`, `ColorMode`, `ModePreference` | The points' data; the listed brands and themes (contributed ones as `<fragment-id>/<id>`); the model's state. |
| `tokensCss(palette)`, `Palette`, `TokenSet` | The stylesheet setting a palette: light tokens on `:root:not(.dark)`, dark ones on `:root.dark`. |
| `AppearanceError` | `invalid-brand`, `unknown-brand`, `unknown-theme`. |
| `brandSchema`, `themeSchema`, `BRANDING_POINT`, `THEMES_POINT` | The points' schemas (JSON Schema 2020-12) and short ids. |
| `./client`: `applyAppearance(appearance, { document?, matchMedia? })` | Sets the page and keeps it set: a `<style data-fragment="system.appearance">` with the palette, `.dark` and `color-scheme` on the root, the brand's name as the title and its logo as the icon; the system's mode from `prefers-color-scheme`. Returns the disposer. |
| `./client`: `BrandMark` | The active brand's logo and name (`data-testid="brand"`), React. |
| `./client.css` | The brand mark's styles, plain CSS over the tokens. |

## Examples

A fragment contributes a brand and a theme in its `fragment.client.jsonc`, with no `requires`:

```jsonc
{
  "$schema": "./node_modules/@statewalker/kernel.core/schemas/fragment-aspect.v1.schema.json",
  "extensions": [
    {
      "point": "branding",
      "data": {
        "id": "acme",
        "name": "Acme",
        "logo": "./client/logo.svg",
        "tokens": { "light": { "primary": "oklch(0.55 0.2 260)" }, "dark": { "primary": "oklch(0.75 0.15 260)" } }
      }
    },
    {
      "point": "themes",
      "data": { "id": "high", "title": "High contrast", "tokens": { "light": { "foreground": "black" }, "dark": { "foreground": "white" } } }
    }
  ]
}
```

The host runs it with the application's brand and applies it:

```tsx
const system = createSystemAppearance({ brand: application.brand });
const kernel = createKernel({
  platform,
  core: [systemAppearanceArchive /* , ... */],
  activators: {
    client: (f, context) => (f.id === SYSTEM_APPEARANCE_ID ? system.activate(context) : undefined),
  },
});
await kernel.start();
applyAppearance(system.appearance); // the page follows the model
root.render(<BrandMark appearance={system.appearance} />);

system.appearance.selectBrand("org.example.acme/acme"); // one brand at a time
system.appearance.setMode("dark"); // the user's choice over prefers-color-scheme
```

## Internals

**Tokens.** A token is a shadcn variable's name without `--` (`primary`, `card-foreground`, `radius`) and a value. The schemas refuse a value that could leave its declaration or rule (`;`, braces, `<`, `>`, a backslash, quotes, a line break, `/*`), so a fragment's brand cannot write CSS beyond its tokens; `tokensCss` drops such tokens again for any other caller. A logo is an image data URL, an https URL or a path on the page's site, shown in an `<img>` (an SVG there runs no script).

**The palette.** The active brand's tokens, the selected theme's laid over them, per mode. A token neither sets keeps system.workbench's default from `theme.css`: `tokensCss`'s selectors (`:root:not(.dark)`, `:root.dark`) outrank that file's `:root` and `.dark`, so no change there was needed.

**The active brand** is the one selected, else the application's, else the first contributed. A brand or theme whose fragment leaves is no longer selected: the application's brand comes back, and no theme applies. Two extensions with one identity: the first read wins.

**The mode** is the user's choice (`setMode`), `system` by default; the host feeds the system's (`applyAppearance` from `prefers-color-scheme`). The choice lasts for the page's life; it goes to the profile once system.settings exists.

## License

MIT. See [LICENSE](../../LICENSE).
