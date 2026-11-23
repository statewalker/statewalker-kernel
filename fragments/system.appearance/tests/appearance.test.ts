// Seam 1: the real kernel with system.appearance as a core fragment; observed through the
// appearance model (the owner of `branding` and `themes`) and the kernel's public slots.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  activeFragmentsSlot,
  createKernel,
  type ExtensionRefusal,
  extensionRefusalsSlot,
  parseJsonc,
} from "@statewalker/kernel.core";
import { describe, expect, it } from "vitest";
import {
  AppearanceError,
  type AppearanceState,
  type BrandData,
  createSystemAppearance,
  SYSTEM_APPEARANCE_ID,
  systemAppearanceArchive,
  tokensCss,
} from "../src/index.js";

const SCHEMA = "https://example.org/schemas/fragment.v1.schema.json";
const ASPECT_SCHEMA = "https://example.org/schemas/fragment-aspect.v1.schema.json";
const ACME = "org.example.acme";
const HIGH_CONTRAST = "org.example.contrast";

/** The application's own brand. */
const NOTES_BRAND: BrandData = {
  id: "notes",
  name: "Notes",
  logo: "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'/%3E",
  tokens: {
    light: { primary: "oklch(0.55 0.16 49)", background: "oklch(0.99 0.01 90)" },
    dark: { primary: "oklch(0.77 0.19 70)", background: "oklch(0.2 0.01 60)" },
  },
};

/** A client-only fragment contributing these extensions. */
function fragment(id: string, extensions: { point: string; data: unknown }[]) {
  return {
    "fragment.jsonc": JSON.stringify({
      $schema: SCHEMA,
      id,
      version: "1.0.0",
      engines: { platform: "^1.0.0" },
      aspects: { client: {} },
    }),
    "fragment.client.jsonc": JSON.stringify({ $schema: ASPECT_SCHEMA, extensions }),
  };
}

const acme = fragment(ACME, [
  {
    point: "branding",
    data: {
      id: "acme",
      name: "Acme",
      tokens: { light: { primary: "red" }, dark: { primary: "darkred" } },
    },
  },
]);

const contrast = fragment(HIGH_CONTRAST, [
  {
    point: "themes",
    data: {
      id: "high",
      title: "High contrast",
      tokens: { light: { foreground: "black" }, dark: { foreground: "white" } },
    },
  },
]);

/** The kernel with system.appearance as its core fragment, these fragments enabled and active. */
async function platform(archives: Record<string, string>[], brand: BrandData = NOTES_BRAND) {
  const system = createSystemAppearance({ brand });
  const kernel = createKernel({
    platform: { version: "1.0.0", bindings: [] },
    core: [systemAppearanceArchive],
    activators: {
      client: (f, context) =>
        f.id === SYSTEM_APPEARANCE_ID ? system.activate(context) : undefined,
    },
  });
  await kernel.start();
  for (const f of await kernel.install(archives)) await kernel.enable(f.id);
  await kernel.activate("client");
  const states: AppearanceState[] = [];
  system.appearance.observe((state) => states.push(state));
  return { kernel, appearance: system.appearance, states };
}

describe("the system.appearance fragment", () => {
  it("is a core fragment the kernel installs and activates", async () => {
    const { kernel } = await platform([]);
    expect([...kernel.slots.getSnapshot(activeFragmentsSlot("client")).keys()]).toEqual([
      SYSTEM_APPEARANCE_ID,
    ]);
  });

  it("ships the archive its folder holds", () => {
    const root = join(import.meta.dirname, "..");
    for (const file of ["fragment.jsonc", "fragment.client.jsonc"]) {
      const onDisk = parseJsonc(readFileSync(join(root, file), "utf8")).value;
      expect(onDisk).toEqual(JSON.parse(systemAppearanceArchive[file] ?? "null"));
    }
  });
});

describe("the application's brand", () => {
  it("is active from the start, its tokens following the light or dark mode", async () => {
    const { appearance } = await platform([]);
    expect(appearance.brand()).toMatchObject({ id: "notes", name: "Notes", logo: NOTES_BRAND.logo });
    expect(appearance.colorMode()).toBe("light");
    expect(appearance.tokens()).toEqual({
      primary: "oklch(0.55 0.16 49)",
      background: "oklch(0.99 0.01 90)",
    });
    appearance.setSystemMode("dark");
    expect(appearance.colorMode()).toBe("dark");
    expect(appearance.tokens().primary).toBe("oklch(0.77 0.19 70)");
  });

  it("follows the system's mode unless the user chose one", async () => {
    const { appearance } = await platform([]);
    expect(appearance.mode()).toBe("system");
    appearance.setMode("dark");
    expect(appearance.colorMode()).toBe("dark");
    appearance.setSystemMode("light");
    expect(appearance.colorMode()).toBe("dark");
    appearance.setMode("system");
    expect(appearance.colorMode()).toBe("light");
  });

  it("refuses an application brand that breaks the branding schema", () => {
    const bad = { ...NOTES_BRAND, tokens: { light: { primary: "red; } body { x: y" }, dark: {} } };
    expect(() => createSystemAppearance({ brand: bad })).toThrow(AppearanceError);
  });
});

describe("the branding point", () => {
  it("lists the brands fragments contribute; one is active at a time", async () => {
    const { appearance, states } = await platform([acme]);
    expect(appearance.brands().map((b) => b.id)).toEqual(["notes", `${ACME}/acme`]);
    appearance.selectBrand(`${ACME}/acme`);
    expect(appearance.brand()?.name).toBe("Acme");
    expect(appearance.tokens()).toEqual({ primary: "red" });
    expect(states.at(-1)?.brand?.id).toBe(`${ACME}/acme`);
    expect(() => appearance.selectBrand("org.example.none/x")).toThrow(AppearanceError);
    expect(appearance.brand()?.name).toBe("Acme");
  });

  it("goes back to the application's brand when the active brand's fragment leaves", async () => {
    const { kernel, appearance } = await platform([acme]);
    appearance.selectBrand(`${ACME}/acme`);
    await kernel.disable(ACME);
    expect(appearance.brand()?.id).toBe("notes");
    expect(appearance.brands().map((b) => b.id)).toEqual(["notes"]);
  });

  it("refuses a brand whose tokens could break out of their CSS declaration", async () => {
    const bad = fragment("org.example.bad", [
      {
        point: "branding",
        data: { id: "bad", name: "Bad", tokens: { light: { primary: "red}" }, dark: {} } },
      },
    ]);
    const { kernel, appearance } = await platform([bad]);
    expect(appearance.brands().map((b) => b.id)).toEqual(["notes"]);
    const refused: ExtensionRefusal[] = [
      ...kernel.slots.getSnapshot(extensionRefusalsSlot("client")).values(),
    ];
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ contributor: "org.example.bad", point: "branding" });
  });
});

describe("the themes point", () => {
  it("lays a selected theme's tokens over the brand's, until its fragment leaves", async () => {
    const { kernel, appearance } = await platform([contrast]);
    expect(appearance.themes().map((t) => ({ id: t.id, title: t.title }))).toEqual([
      { id: `${HIGH_CONTRAST}/high`, title: "High contrast" },
    ]);
    appearance.selectTheme(`${HIGH_CONTRAST}/high`);
    expect(appearance.tokens()).toEqual({
      primary: "oklch(0.55 0.16 49)",
      background: "oklch(0.99 0.01 90)",
      foreground: "black",
    });
    appearance.setMode("dark");
    expect(appearance.tokens().foreground).toBe("white");
    await kernel.disable(HIGH_CONTRAST);
    expect(appearance.theme()).toBeUndefined();
    expect(appearance.tokens().foreground).toBeUndefined();
  });
});

describe("tokensCss", () => {
  it("writes the light tokens for the page without .dark and the dark ones under it", () => {
    expect(tokensCss({ light: { primary: "red", "card-foreground": "#000" }, dark: { primary: "blue" } })).toBe(
      ":root:not(.dark) {\n  --primary: red;\n  --card-foreground: #000;\n}\n:root.dark {\n  --primary: blue;\n}\n",
    );
  });
});
