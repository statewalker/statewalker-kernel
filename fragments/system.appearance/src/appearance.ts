import { Validator } from "@cfworker/json-schema";
import type { ActivationContext, Extension } from "@statewalker/kernel.core";
import { BRANDING_POINT, brandSchema, THEMES_POINT } from "./archive.js";
import type { Palette, TokenSet } from "./css.js";
import { AppearanceError } from "./errors.js";

/** The mode the page is shown in. */
export type ColorMode = "light" | "dark";

/** What the user chose: a mode, or the system's (`prefers-color-scheme`). */
export type ModePreference = ColorMode | "system";

/** A brand as `branding` takes it, and as an application defines its own. */
export interface BrandData {
  readonly id: string;
  readonly name: string;
  readonly logo?: string;
  readonly tokens: Palette;
}

/** A theme as `themes` takes it. */
export interface ThemeData {
  readonly id: string;
  readonly title: string;
  readonly tokens: Palette;
}

/** A brand the model lists. */
export interface BrandEntry {
  /** The application's brand: its own id; a contributed one: `<fragment-id>/<id>`. */
  readonly id: string;
  readonly name: string;
  readonly logo?: string;
  readonly tokens: Palette;
  /** The contributing fragment; none for the application's brand. */
  readonly fragment?: string;
}

/** A theme the model lists. */
export interface ThemeEntry {
  /** `<fragment-id>/<id>`. */
  readonly id: string;
  readonly title: string;
  readonly tokens: Palette;
  readonly fragment: string;
}

/** What the page shows, as a whole. */
export interface AppearanceState {
  readonly brands: readonly BrandEntry[];
  readonly brand: BrandEntry | undefined;
  readonly themes: readonly ThemeEntry[];
  readonly theme: ThemeEntry | undefined;
  readonly mode: ModePreference;
  readonly colorMode: ColorMode;
  /** The tokens of both modes: the brand's, the theme's laid over them. */
  readonly palette: Palette;
  /** The tokens of the mode shown. */
  readonly tokens: TokenSet;
}

/** The appearance model: one brand active at a time, a theme over it, light or dark. */
export interface Appearance {
  /** The application's brand first, then the contributed ones in the order they are read. */
  brands(): readonly BrandEntry[];
  /** The active brand: the one selected, else the application's (else the first). */
  brand(): BrandEntry | undefined;
  /** Make the brand `id` the active one. Throws `AppearanceError` (`unknown-brand`). */
  selectBrand(id: string): void;
  themes(): readonly ThemeEntry[];
  /** The selected theme, if any. */
  theme(): ThemeEntry | undefined;
  /** Lay the theme `id` over the brand, or none. Throws `AppearanceError` (`unknown-theme`). */
  selectTheme(id: string | undefined): void;
  /** The user's choice; `system` by default. */
  mode(): ModePreference;
  setMode(mode: ModePreference): void;
  /** What the system prefers: the host feeds it from `prefers-color-scheme`. */
  setSystemMode(mode: ColorMode): void;
  /** The mode shown: the user's choice, or the system's. */
  colorMode(): ColorMode;
  palette(): Palette;
  tokens(): TokenSet;
  state(): AppearanceState;
  /** Called at once, then after every change. Returns a disposer. */
  observe(listener: (state: AppearanceState) => void): () => void;
}

export interface SystemAppearanceOptions {
  /** The application's own brand, listed first and active unless another is selected. */
  readonly brand?: BrandData;
  /** The user's mode at start; `system` by default. */
  readonly mode?: ModePreference;
}

/** The system.appearance fragment's headless code: its model and its client activator body. */
export interface SystemAppearance {
  readonly appearance: Appearance;
  /** Activate the client aspect: follow the `branding` and `themes` points. Returns the cleanup. */
  activate(context: ActivationContext): () => void;
}

const brandValidator = new Validator(brandSchema as never, "2020-12", false);

function validBrand(brand: BrandData): BrandData {
  const result = brandValidator.validate(brand);
  if (!result.valid) {
    const problems = result.errors
      .filter((e) => e.keyword !== "properties" && e.keyword !== "additionalProperties")
      .map((e) => `${e.instanceLocation}: ${e.error}`);
    throw new AppearanceError("invalid-brand", problems.join("; ") || "schema violation");
  }
  return brand;
}

function brandOf(extension: Extension): BrandEntry {
  const data = extension.data as BrandData;
  return {
    id: `${extension.contributor}/${data.id}`,
    name: data.name,
    ...(data.logo === undefined ? {} : { logo: data.logo }),
    tokens: data.tokens,
    fragment: extension.contributor,
  };
}

function themeOf(extension: Extension): ThemeEntry {
  const data = extension.data as ThemeData;
  return {
    id: `${extension.contributor}/${data.id}`,
    title: data.title,
    tokens: data.tokens,
    fragment: extension.contributor,
  };
}

/** The first entry per identity. */
function unique<T extends { id: string }>(entries: readonly T[]): T[] {
  const byId = new Map<string, T>();
  for (const entry of entries) if (!byId.has(entry.id)) byId.set(entry.id, entry);
  return [...byId.values()];
}

export function createSystemAppearance(options: SystemAppearanceOptions = {}): SystemAppearance {
  const own: BrandEntry | undefined = options.brand && { ...validBrand(options.brand) };
  let contributed: readonly BrandEntry[] = [];
  let themes: readonly ThemeEntry[] = [];
  let selectedBrand: string | undefined;
  let selectedTheme: string | undefined;
  let mode: ModePreference = options.mode ?? "system";
  let systemMode: ColorMode = "light";
  const listeners = new Set<(state: AppearanceState) => void>();

  const brands = (): readonly BrandEntry[] =>
    own ? [own, ...contributed.filter((b) => b.id !== own.id)] : contributed;
  const brand = () => {
    const all = brands();
    return all.find((b) => b.id === selectedBrand) ?? all[0];
  };
  const theme = () => themes.find((t) => t.id === selectedTheme);
  const colorMode = (): ColorMode => (mode === "system" ? systemMode : mode);
  const palette = (): Palette => {
    const b = brand()?.tokens;
    const t = theme()?.tokens;
    return {
      light: { ...b?.light, ...t?.light },
      dark: { ...b?.dark, ...t?.dark },
    };
  };
  const state = (): AppearanceState => {
    const p = palette();
    const shown = colorMode();
    return {
      brands: brands(),
      brand: brand(),
      themes,
      theme: theme(),
      mode,
      colorMode: shown,
      palette: p,
      tokens: p[shown],
    };
  };

  function notify() {
    const current = state();
    for (const listener of [...listeners]) {
      try {
        listener(current);
      } catch (error) {
        console.error("[system.appearance] a listener threw:", error);
      }
    }
  }

  const appearance: Appearance = {
    brands,
    brand,
    selectBrand(id) {
      if (!brands().some((b) => b.id === id)) throw new AppearanceError("unknown-brand", id);
      selectedBrand = id;
      notify();
    },
    themes: () => themes,
    theme,
    selectTheme(id) {
      if (id !== undefined && !themes.some((t) => t.id === id)) {
        throw new AppearanceError("unknown-theme", id);
      }
      selectedTheme = id;
      notify();
    },
    mode: () => mode,
    setMode(next) {
      if (next === mode) return;
      mode = next;
      notify();
    },
    setSystemMode(next) {
      if (next === systemMode) return;
      systemMode = next;
      notify();
    },
    colorMode,
    palette,
    tokens: () => palette()[colorMode()],
    state,
    observe(listener) {
      const entry = (s: AppearanceState) => listener(s);
      listeners.add(entry);
      entry(state());
      return () => {
        listeners.delete(entry);
      };
    },
  };

  return {
    appearance,
    activate(context) {
      const stopBrands = context.extensions.observe(BRANDING_POINT, (all) => {
        contributed = unique(all.map(brandOf));
        // A brand that left is no longer selected: the application's comes back.
        if (selectedBrand !== undefined && !brands().some((b) => b.id === selectedBrand)) {
          selectedBrand = undefined;
        }
        notify();
      });
      const stopThemes = context.extensions.observe(THEMES_POINT, (all) => {
        themes = unique(all.map(themeOf));
        if (selectedTheme !== undefined && !themes.some((t) => t.id === selectedTheme)) {
          selectedTheme = undefined;
        }
        notify();
      });
      return () => {
        stopBrands();
        stopThemes();
        contributed = [];
        themes = [];
        selectedBrand = undefined;
        selectedTheme = undefined;
        notify();
      };
    },
  };
}
