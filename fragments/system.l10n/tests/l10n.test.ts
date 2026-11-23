// Seam 1: the real kernel with system.l10n as a core fragment; observed through the l10n model
// (the owner of `l10n`) and the kernel's public slots.
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
  createSystemL10n,
  L10nError,
  type L10nState,
  SYSTEM_L10N_ID,
  systemL10nArchive,
} from "../src/index.js";

const SCHEMA = "https://example.org/schemas/fragment.v1.schema.json";
const ASPECT_SCHEMA = "https://example.org/schemas/fragment-aspect.v1.schema.json";
const NOTES = "org.example.notes";
const PACK = "org.example.pack";

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

const bundle = (locale: string, messages: Record<string, string>, namespace?: string) => ({
  point: "l10n",
  data: { locale, messages, ...(namespace ? { namespace } : {}) },
});

const notes = fragment(NOTES, [
  bundle("en", { "view.add": "Add note", "view.count": "{count} notes" }),
  bundle("fr", { "view.add": "Ajouter la note", "views.notes.title": "Notes (fr)" }),
  bundle("fr-CA", { "view.add": "Ajouter la note (CA)" }),
]);

/** The kernel with system.l10n as its core fragment, these fragments enabled and active. */
async function platform(
  archives: Record<string, string>[],
  options: Parameters<typeof createSystemL10n>[0] = {},
) {
  const system = createSystemL10n(options);
  const kernel = createKernel({
    platform: { version: "1.0.0", bindings: [] },
    core: [systemL10nArchive],
    activators: {
      client: (f, context) => (f.id === SYSTEM_L10N_ID ? system.activate(context) : undefined),
    },
  });
  await kernel.start();
  for (const f of await kernel.install(archives)) await kernel.enable(f.id);
  await kernel.activate("client");
  const states: L10nState[] = [];
  system.l10n.observe((state) => states.push(state));
  return { kernel, l10n: system.l10n, states };
}

describe("the system.l10n fragment", () => {
  it("is a core fragment the kernel installs and activates", async () => {
    const { kernel } = await platform([]);
    expect([...kernel.slots.getSnapshot(activeFragmentsSlot("client")).keys()]).toEqual([
      SYSTEM_L10N_ID,
    ]);
  });

  it("ships the archive its folder holds", () => {
    const root = join(import.meta.dirname, "..");
    for (const file of ["fragment.jsonc", "fragment.client.jsonc"]) {
      const onDisk = parseJsonc(readFileSync(join(root, file), "utf8")).value;
      expect(onDisk).toEqual(JSON.parse(systemL10nArchive[file] ?? "null"));
    }
  });
});

describe("bundle resolution", () => {
  it("gives a fragment's key in the interface language, switched live", async () => {
    const { l10n, states } = await platform([notes]);
    expect(l10n.locale()).toBe("en");
    expect(l10n.text(NOTES, "view.add")).toBe("Add note");
    l10n.setLocale("fr");
    expect(l10n.locale()).toBe("fr");
    expect(l10n.text(NOTES, "view.add")).toBe("Ajouter la note");
    expect(states.at(-1)?.locale).toBe("fr");
    l10n.setLocale("en");
    expect(l10n.text(NOTES, "view.add")).toBe("Add note");
  });
});

describe("fallback", () => {
  it("falls back from a region to its language, then to the default language", async () => {
    const { l10n } = await platform([notes]);
    l10n.setLocale("fr-ca");
    expect(l10n.locale()).toBe("fr-CA");
    expect(l10n.text(NOTES, "view.add")).toBe("Ajouter la note (CA)");
    expect(l10n.text(NOTES, "views.notes.title")).toBe("Notes (fr)");
    // No French text for view.count: the default language's.
    expect(l10n.text(NOTES, "view.count")).toBe("{count} notes");
  });

  it("asks inline labels after the language's bundles and before the default language", async () => {
    const { l10n } = await platform([notes]);
    l10n.setLocale("fr");
    const labels = { fr: "Libellé", de: "Bezeichnung" };
    expect(l10n.text(NOTES, "view.add", { labels, fallback: "Add" })).toBe("Ajouter la note");
    expect(l10n.text(NOTES, "view.count", { labels, fallback: "Count" })).toBe("Libellé");
    expect(l10n.text(NOTES, "missing", { labels: { de: "x" }, fallback: "Inline" })).toBe("Inline");
    expect(l10n.text(NOTES, "missing")).toBe("missing");
  });

  it("prefers the default language's bundle to the inline fallback", async () => {
    const { l10n } = await platform([notes]);
    l10n.setLocale("de");
    expect(l10n.text(NOTES, "view.add", { fallback: "Inline" })).toBe("Add note");
  });

  it("fills {name} with values formatted for the interface language", async () => {
    const { l10n } = await platform([notes]);
    expect(l10n.text(NOTES, "view.count", { params: { count: 1234.5 } })).toBe("1,234.5 notes");
    l10n.setLocale("fr");
    expect(l10n.format("{n} / {who} / {x}", { n: 1234.5, who: ["Ann", "Bob"] })).toBe(
      "1 234,5 / Ann et Bob / {x}",
    );
  });

  it("refuses a malformed locale and keeps the language", async () => {
    const { l10n } = await platform([notes]);
    expect(() => l10n.setLocale("not a locale")).toThrow(L10nError);
    expect(l10n.locale()).toBe("en");
  });
});

describe("namespacing and language packs", () => {
  it("keeps each fragment's keys in its own namespace", async () => {
    const other = fragment("org.example.other", [bundle("fr", { "view.add": "Autre" })]);
    const { l10n } = await platform([notes, other]);
    l10n.setLocale("fr");
    expect(l10n.text(NOTES, "view.add")).toBe("Ajouter la note");
    expect(l10n.text("org.example.other", "view.add")).toBe("Autre");
  });

  it("lets a language pack translate another fragment's keys, the fragment's own winning", async () => {
    const pack = fragment(PACK, [
      bundle("de", { "view.add": "Notiz hinzufügen" }, NOTES),
      bundle("fr", { "view.add": "Pas pris", "view.count": "{count} notes (pack)" }, NOTES),
    ]);
    const { kernel, l10n } = await platform([pack, notes]);
    expect(l10n.locales()).toEqual(["en", "de", "fr", "fr-CA"]);
    l10n.setLocale("de");
    expect(l10n.text(NOTES, "view.add")).toBe("Notiz hinzufügen");
    l10n.setLocale("fr");
    expect(l10n.text(NOTES, "view.add")).toBe("Ajouter la note");
    expect(l10n.text(NOTES, "view.count")).toBe("{count} notes (pack)");
    await kernel.disable(PACK);
    expect(l10n.text(NOTES, "view.count")).toBe("{count} notes");
    expect(l10n.locales()).toEqual(["en", "fr", "fr-CA"]);
  });

  it("ignores an installed fragment's bundle for a core fragment's namespace", async () => {
    const pack = fragment(PACK, [
      bundle("fr", { "picker.label": "Piégé", "picker.hint": "Piégé" }, SYSTEM_L10N_ID),
    ]);
    const { l10n } = await platform([pack]);
    l10n.setLocale("fr");
    expect(l10n.text(SYSTEM_L10N_ID, "picker.label")).toBe("Langue");
    expect(l10n.text(SYSTEM_L10N_ID, "picker.hint", { fallback: "Hint" })).toBe("Hint");
  });

  it("tells observers when bundles come and go", async () => {
    const { kernel, l10n, states } = await platform([notes]);
    l10n.setLocale("fr");
    const before = states.length;
    await kernel.disable(NOTES);
    expect(states.length).toBeGreaterThan(before);
    expect(l10n.text(NOTES, "view.add", { fallback: "Add note" })).toBe("Add note");
  });

  it("refuses a bundle that breaks the l10n schema", async () => {
    const bad = fragment("org.example.bad", [
      bundle("not a locale", { a: "b" }),
      bundle("fr", { "bad key!": "x" }),
      { point: "l10n", data: { locale: "fr", messages: { a: 1 } } },
    ]);
    const { kernel, l10n } = await platform([bad]);
    expect(l10n.bundles().filter((b) => b.fragment === "org.example.bad")).toEqual([]);
    const refused: ExtensionRefusal[] = [
      ...kernel.slots.getSnapshot(extensionRefusalsSlot("client")).values(),
    ];
    expect(refused).toHaveLength(3);
  });
});
