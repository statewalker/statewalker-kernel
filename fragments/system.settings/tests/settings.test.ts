// Seam 1: the system.settings core fragment through the real kernel: the `settings` point, the
// settings model over system.profile's store (defaults from the schema, values validated when
// stored and when read back, one namespace per fragment), and removal keeping the values unless
// removed with data.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { activeFragmentsSlot, parseJsonc } from "@statewalker/kernel.core";
import { describe, expect, it } from "vitest";
import { SettingsError, SYSTEM_SETTINGS_ID, systemSettingsArchive } from "../src/index.js";
import { fragment, fragmentWith, notesPage, platform } from "./helpers.js";

const NOTES = "org.example.notes";
const OTHER = "org.example.other";

describe("the system.settings fragment", () => {
  it("is a core fragment the kernel installs and activates", async () => {
    const { kernel } = await platform([]);
    expect([...kernel.slots.getSnapshot(activeFragmentsSlot("client")).keys()]).toContain(
      SYSTEM_SETTINGS_ID,
    );
  });

  it("ships the archive its folder holds", () => {
    const root = join(import.meta.dirname, "..");
    for (const file of ["fragment.jsonc", "fragment.client.jsonc"]) {
      const onDisk = parseJsonc(readFileSync(join(root, file), "utf8")).value;
      expect(onDisk).toEqual(JSON.parse(systemSettingsArchive[file] ?? "null"));
    }
  });
});

describe("settings pages", () => {
  it("lists each fragment's page from its static schema, with the defaults as values", async () => {
    const { settings } = await platform([fragment(NOTES, notesPage)]);
    expect(settings.pages().map((p) => [p.fragment, p.title])).toEqual([[NOTES, "Notes"]]);
    const page = settings.page(NOTES);
    expect(page?.fields.map((f) => [f.key, f.type])).toEqual([
      ["sort", "string"],
      ["copyButtons", "boolean"],
      ["max", "integer"],
      ["greeting", "string"],
    ]);
    expect(settings.of(NOTES).values()).toEqual({ sort: "added", copyButtons: true, max: 20 });
    expect(settings.of(NOTES).get("greeting")).toBeUndefined();
  });
});

describe("settings values", () => {
  it("stores a valid value in the profile, under the fragment's key, and reads it back", async () => {
    const { settings, store } = await platform([fragment(NOTES, notesPage)]);
    settings.of(NOTES).set("sort", "alphabetical");
    settings.of(NOTES).set("copyButtons", false);
    expect(settings.of(NOTES).values()).toEqual({
      sort: "alphabetical",
      copyButtons: false,
      max: 20,
    });
    // The stored form (a storage format): version 1, only the values set.
    expect(store.get(`settings/${NOTES}`)).toEqual({
      version: 1,
      values: { sort: "alphabetical", copyButtons: false },
    });
  });

  it("refuses a value its schema refuses, an undeclared key, and a fragment without a page", async () => {
    const { settings } = await platform([fragment(NOTES, notesPage)]);
    const notes = settings.of(NOTES);
    const refusal = (run: () => void) => {
      try {
        run();
      } catch (error) {
        return error instanceof SettingsError ? [error.kind, error.key] : error;
      }
      return "stored";
    };
    expect(refusal(() => notes.set("sort", "by-colour"))).toEqual(["invalid-value", "sort"]);
    expect(refusal(() => notes.set("max", 2.5))).toEqual(["invalid-value", "max"]);
    expect(refusal(() => notes.set("max", 101))).toEqual(["invalid-value", "max"]);
    expect(refusal(() => notes.set("copyButtons", "yes"))).toEqual([
      "invalid-value",
      "copyButtons",
    ]);
    expect(refusal(() => notes.set("greeting", "far too long a greeting"))).toEqual([
      "invalid-value",
      "greeting",
    ]);
    expect(refusal(() => notes.set("colour", "red"))).toEqual(["unknown-setting", "colour"]);
    expect(refusal(() => settings.of(OTHER).set("sort", "added"))).toEqual([
      "unknown-fragment",
      undefined,
    ]);
    expect(notes.values()).toEqual({ sort: "added", copyButtons: true, max: 20 });
  });

  it("keeps the values over a reload (a new platform over the same storage)", async () => {
    const first = await platform([fragment(NOTES, notesPage)]);
    first.settings.of(NOTES).set("sort", "alphabetical");
    first.settings.of(NOTES).set("greeting", "hi");
    const second = await platform([fragment(NOTES, notesPage)], { storage: first.storage });
    expect(second.settings.of(NOTES).values()).toEqual({
      sort: "alphabetical",
      copyButtons: true,
      max: 20,
      greeting: "hi",
    });
  });

  it("reads a stored value its schema refuses as the default, and an unknown form as none", async () => {
    const { settings, store } = await platform([fragment(NOTES, notesPage)]);
    store.set(`settings/${NOTES}`, {
      version: 1,
      values: { sort: "by-colour", copyButtons: "no", max: 50, retired: "kept" },
    });
    expect(settings.of(NOTES).values()).toEqual({ sort: "added", copyButtons: true, max: 50 });
    expect(settings.of(NOTES).get("retired")).toBeUndefined();
    // A value set later keeps what the schema no longer declares (an older or newer version's).
    settings.of(NOTES).set("sort", "alphabetical");
    expect(store.get(`settings/${NOTES}`)).toEqual({
      version: 1,
      values: { sort: "alphabetical", copyButtons: "no", max: 50, retired: "kept" },
    });
    store.set(`settings/${NOTES}`, { version: 2, values: { sort: "alphabetical" } });
    expect(settings.of(NOTES).get("sort")).toBe("added");
  });

  it("resets one value, or all, to the defaults", async () => {
    const { settings, store } = await platform([fragment(NOTES, notesPage)]);
    const notes = settings.of(NOTES);
    notes.set("sort", "alphabetical");
    notes.set("max", 5);
    notes.reset("sort");
    expect(notes.values()).toEqual({ sort: "added", copyButtons: true, max: 5 });
    notes.reset();
    expect(notes.values()).toEqual({ sort: "added", copyButtons: true, max: 20 });
    expect(store.get(`settings/${NOTES}`)).toBeUndefined();
  });
});

describe("one namespace per fragment", () => {
  const otherPage = {
    schema: {
      type: "object",
      properties: {
        sort: { type: "string", default: "other-default" },
        secret: { type: "string" },
      },
    },
  };

  it("gives a fragment its own values only, whatever the keys", async () => {
    const { settings } = await platform([fragment(NOTES, notesPage), fragment(OTHER, otherPage)]);
    settings.of(OTHER).set("sort", "theirs");
    settings.of(OTHER).set("secret", "s3cr3t");
    expect(settings.of(NOTES).get("sort")).toBe("added");
    expect(settings.of(NOTES).get("secret")).toBeUndefined();
    expect(settings.of(NOTES).get(`../${OTHER}/secret`)).toBeUndefined();
    expect(() => settings.of(NOTES).set("secret", "mine")).toThrow(SettingsError);
    expect(settings.of(OTHER).values()).toEqual({ sort: "theirs", secret: "s3cr3t" });
  });

  it("tells a fragment's observer of its own changes only", async () => {
    const { settings } = await platform([fragment(NOTES, notesPage), fragment(OTHER, otherPage)]);
    const seen: unknown[] = [];
    const stop = settings.of(NOTES).observe((values) => seen.push(values.sort));
    settings.of(OTHER).set("sort", "theirs");
    settings.of(NOTES).set("sort", "alphabetical");
    settings.of(NOTES).set("max", 3);
    settings.of(NOTES).reset("sort");
    stop();
    settings.of(NOTES).set("sort", "alphabetical");
    expect(seen).toEqual(["added", "alphabetical", "alphabetical", "added"]);
  });

  it("tells the model's observers of pages and values", async () => {
    const { settings } = await platform([fragment(NOTES, notesPage)]);
    const seen: unknown[] = [];
    settings.observe((state) => seen.push([state.pages.length, state.values[NOTES]?.sort]));
    settings.of(NOTES).set("sort", "alphabetical");
    expect(seen).toEqual([
      [1, "added"],
      [1, "alphabetical"],
    ]);
  });
});

describe("the settings point", () => {
  it("refuses a page whose schema is not a flat object of strings, numbers and booleans", async () => {
    const { settings, refused } = await platform([
      fragment("org.example.nested", {
        schema: { type: "object", properties: { deep: { type: "object" } } },
      }),
      fragment("org.example.extra", {
        schema: { type: "object", properties: { x: { type: "string", format: "uri" } } },
      }),
      fragment("org.example.array", { schema: { type: "array" } }),
    ]);
    expect(settings.pages()).toEqual([]);
    expect(refused().filter((r) => r.point === "settings")).toHaveLength(3);
  });

  it("keeps the first page a fragment declares, and sorts pages by order, then title", async () => {
    const page = (title: string, order?: number) => ({
      title,
      ...(order === undefined ? {} : { order }),
      schema: { type: "object", properties: {} },
    });
    const { settings } = await platform([
      fragment("org.example.b", page("Beta")),
      fragment("org.example.a", page("Alpha"), page("Alpha again")),
      fragment("org.example.z", page("Zeta", -1)),
    ]);
    expect(settings.pages().map((p) => p.title)).toEqual(["Zeta", "Alpha", "Beta"]);
  });

  it("drops a default its own schema refuses", async () => {
    const { settings } = await platform([
      fragment(NOTES, {
        schema: { type: "object", properties: { n: { type: "integer", minimum: 5, default: 1 } } },
      }),
    ]);
    expect(settings.page(NOTES)?.fields[0]?.default).toBeUndefined();
    expect(settings.of(NOTES).values()).toEqual({});
  });
});

describe("the lifecycle", () => {
  it("drops a disabled fragment's page and keeps its values for when it comes back", async () => {
    const { kernel, settings } = await platform([fragment(NOTES, notesPage)]);
    settings.of(NOTES).set("sort", "alphabetical");
    const seen: number[] = [];
    settings.observe((state) => seen.push(state.pages.length));
    await kernel.disable(NOTES);
    expect(settings.pages()).toEqual([]);
    expect(settings.of(NOTES).values()).toEqual({});
    await kernel.enable(NOTES);
    expect(settings.pages().map((p) => p.fragment)).toEqual([NOTES]);
    expect(settings.of(NOTES).get("sort")).toBe("alphabetical");
    expect(seen).toEqual([1, 0, 1]);
  });

  it("keeps a removed fragment's values, so a reinstall finds them", async () => {
    const { kernel, settings, store } = await platform([fragment(NOTES, notesPage)]);
    settings.of(NOTES).set("sort", "alphabetical");
    await kernel.remove(NOTES);
    expect(store.get(`settings/${NOTES}`)).toEqual({
      version: 1,
      values: { sort: "alphabetical" },
    });
    for (const f of await kernel.install([fragment(NOTES, notesPage)])) await kernel.enable(f.id);
    expect(settings.of(NOTES).get("sort")).toBe("alphabetical");
  });

  it("deletes a fragment's values when it is removed with data, and no other's", async () => {
    const { kernel, settings, store } = await platform([
      fragment(NOTES, notesPage),
      fragment(OTHER, { schema: { type: "object", properties: { a: { type: "string" } } } }),
    ]);
    settings.of(NOTES).set("sort", "alphabetical");
    settings.of(OTHER).set("a", "kept");
    await kernel.remove(NOTES, { withData: true });
    expect(store.get(`settings/${NOTES}`)).toBeUndefined();
    expect(store.get(`settings/${OTHER}`)).toEqual({ version: 1, values: { a: "kept" } });
    for (const f of await kernel.install([fragment(NOTES, notesPage)])) await kernel.enable(f.id);
    expect(settings.of(NOTES).get("sort")).toBe("added");
  });
});

describe("labels through system.l10n", () => {
  const bundle = (locale: string, messages: Record<string, string>, namespace?: string) => ({
    point: "l10n",
    data: { locale, messages, ...(namespace ? { namespace } : {}) },
  });
  const notes = () =>
    fragmentWith(NOTES, [
      { point: "settings", data: { ...notesPage, description: "How notes show." } },
      bundle("en", { "settings.sort.enum.added": "Order added" }),
      bundle("fr", {
        "settings.title": "Bloc-notes",
        "settings.description": "Comment les notes s'affichent.",
        "settings.sort.title": "Trier les notes par",
        "settings.sort.enum.added": "Ordre d'ajout",
        "settings.sort.enum.alphabetical": "Ordre alphabétique",
      }),
    ]);
  const labels = (page: ReturnType<typeof platformSettings>) =>
    page && {
      title: page.title,
      description: page.description,
      sort: page.fields.find((f) => f.key === "sort"),
      copy: page.fields.find((f) => f.key === "copyButtons")?.title,
    };
  const platformSettings = (settings: Awaited<ReturnType<typeof platform>>["settings"]) =>
    settings.page(NOTES);

  it("reads the page's, the settings' and the choices' labels under keys derived from them", async () => {
    const { settings, l10n } = await platform([notes()], { locale: "en" });
    const english = labels(platformSettings(settings));
    expect(english?.title).toBe("Notes");
    expect(english?.description).toBe("How notes show.");
    expect(english?.sort?.title).toBe("Sort notes by");
    // A choice's label: its bundle's text, else the value itself.
    expect(english?.sort?.enumTitles).toEqual(["Order added", "alphabetical"]);
    expect(english?.copy).toBe("Copy buttons");

    const seen: string[] = [];
    settings.observe((state) => seen.push(state.pages[0]?.title ?? ""));
    l10n?.setLocale("fr");
    const french = labels(platformSettings(settings));
    expect(french?.title).toBe("Bloc-notes");
    expect(french?.description).toBe("Comment les notes s'affichent.");
    expect(french?.sort?.title).toBe("Trier les notes par");
    expect(french?.sort?.enumTitles).toEqual(["Ordre d'ajout", "Ordre alphabétique"]);
    // No French text: the inline one (the default language's).
    expect(french?.copy).toBe("Copy buttons");
    expect(seen).toEqual(["Notes", "Bloc-notes"]);
    // The values are not texts: they stay as stored.
    settings.of(NOTES).set("sort", "alphabetical");
    expect(settings.of(NOTES).get("sort")).toBe("alphabetical");
  });

  it("keeps the owner's labels over a language pack's", async () => {
    const pack = fragmentWith("org.example.pack", [
      bundle("fr", { "settings.title": "Piraté", "settings.copyButtons.title": "Copier" }, NOTES),
    ]);
    const { settings } = await platform([notes(), pack], { locale: "fr" });
    expect(settings.page(NOTES)?.title).toBe("Bloc-notes");
    // A key the owner leaves untranslated in French: the pack fills it.
    expect(settings.page(NOTES)?.fields.find((f) => f.key === "copyButtons")?.title).toBe("Copier");
  });

  it("gives the view's own texts in the interface language", async () => {
    const { settings, l10n } = await platform([], { locale: "en" });
    expect(settings.text("view.reset", "Reset to defaults")).toBe("Reset to defaults");
    l10n?.setLocale("fr");
    expect(settings.text("view.reset", "Reset to defaults")).toBe(
      "Rétablir les valeurs par défaut",
    );
    expect(settings.text("view.empty", "No fragment has settings.")).toBe(
      "Aucun fragment n'a de paramètres.",
    );
  });

  it("uses the inline labels without system.l10n", async () => {
    const { settings } = await platform([notes()]);
    expect(settings.page(NOTES)?.title).toBe("Notes");
    expect(settings.page(NOTES)?.fields[0]?.enumTitles).toEqual(["added", "alphabetical"]);
    expect(settings.text("view.reset", "Reset to defaults")).toBe("Reset to defaults");
  });
});
