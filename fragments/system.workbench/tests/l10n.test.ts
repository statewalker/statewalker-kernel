// Seam 1: the workbench's labels read through system.l10n (the real kernel with system.commands,
// system.workbench and system.l10n as core fragments): menus, views, the palette, the bars,
// dialogs and notifications follow the interface language, live, and fall back to the default
// language, then to the contribution's inline text.
import { createKernel } from "@statewalker/kernel.core";
import {
  createSystemCommands,
  SYSTEM_COMMANDS_ID,
  systemCommandsArchive,
} from "@statewalker/system.commands";
import { createSystemL10n, SYSTEM_L10N_ID, systemL10nArchive } from "@statewalker/system.l10n";
import { describe, expect, it } from "vitest";
import {
  COMMAND_FAILED_NOTIFICATION,
  createSystemWorkbench,
  SYSTEM_WORKBENCH_ID,
  systemWorkbenchArchive,
  type WorkbenchState,
} from "../src/index.js";
import { command, ext, fragment, type TestExtension } from "./helpers.js";

const NOTES = "org.example.notes";

const l10n = (locale: string, messages: Record<string, string>, namespace?: string) =>
  ext("l10n", { locale, messages, ...(namespace ? { namespace } : {}) });

const notes = (extra: TestExtension[] = []) =>
  fragment(NOTES, [
    command("new-note", { labels: { de: { title: "Neue Notiz" } } }),
    ext("views", { id: "notes", title: "Notes" }),
    ext("menus", { menu: "menubar", submenu: "notes", title: "Notes" }),
    ext("menus", { menu: "notes", command: `${NOTES}/new-note` }),
    ext("statusbar", { id: "new", text: "New note", tooltip: "Write a new note" }),
    ext("activitybar", { id: "notes", title: "Notes", view: `${NOTES}/notes` }),
    ext("dialogs", {
      id: "ask",
      title: "New note",
      message: "Note {n}",
      input: { label: "Note", placeholder: "Write" },
      actions: [{ id: "add", label: "Add", primary: true }],
    }),
    ext("notifications", { id: "added", title: "Note added", message: "{text}" }),
    l10n("en", { "statusbar.new.tooltip": "Write a new note (en)" }),
    l10n("fr", {
      "commands.new-note.title": "Nouvelle note…",
      "views.notes.title": "Notes (fr)",
      "menus.notes.title": "Carnet",
      "statusbar.new.text": "Nouvelle note",
      "activitybar.notes.title": "Carnet",
      "dialogs.ask.title": "Nouvelle note",
      "dialogs.ask.message": "Note {n}",
      "dialogs.ask.input.label": "Texte",
      "dialogs.ask.actions.add": "Ajouter",
      "notifications.added.title": "Note ajoutée",
    }),
    ...extra,
  ]);

async function platform(
  archives: Record<string, string>[],
  handlers: Record<string, unknown> = {},
) {
  const commands = createSystemCommands();
  const lang = createSystemL10n();
  const system = createSystemWorkbench({ commands: commands.bus, l10n: lang.l10n });
  const kernel = createKernel({
    platform: { version: "1.0.0", bindings: [] },
    core: [systemCommandsArchive, systemWorkbenchArchive, systemL10nArchive],
    resolvers: { module: (ref) => handlers[ref.export ?? "default"] },
    activators: {
      client: (f, context) => {
        if (f.id === SYSTEM_COMMANDS_ID) return commands.activate(context);
        if (f.id === SYSTEM_WORKBENCH_ID) return system.activate(context);
        if (f.id === SYSTEM_L10N_ID) return lang.activate(context);
        return undefined;
      },
    },
  });
  await kernel.start();
  for (const f of await kernel.install(archives)) await kernel.enable(f.id);
  await kernel.activate("client");
  return { kernel, workbench: system.workbench, l10n: lang.l10n };
}

const titles = (nodes: readonly { title?: string; kind: string }[]) =>
  nodes.map((n) => (n.kind === "separator" ? "-" : n.title));

describe("the workbench in the interface language", () => {
  it("titles menus, views, the palette and the bars in the language, switched live", async () => {
    const { workbench, l10n } = await platform([notes()]);
    const states: WorkbenchState[] = [];
    workbench.observe((s) => states.push(s));

    expect(titles(workbench.menu("menubar"))).toEqual(["Notes"]);
    expect(titles(workbench.menu("notes"))).toEqual(["Summary of new-note"]);
    expect(workbench.view(`${NOTES}/notes`)?.title).toBe("Notes");

    l10n.setLocale("fr");
    expect(states.length).toBeGreaterThan(1);
    expect(titles(workbench.menu("menubar"))).toEqual(["Carnet"]);
    expect(titles(workbench.menu("notes"))).toEqual(["Nouvelle note…"]);
    expect(states.at(-1)?.views.find((v) => v.id === `${NOTES}/notes`)?.title).toBe("Notes (fr)");
    expect(workbench.palette().find((p) => p.command === `${NOTES}/new-note`)?.title).toBe(
      "Nouvelle note…",
    );
    expect(workbench.statusbar()[0]).toMatchObject({
      text: "Nouvelle note",
      // No French tooltip: the default language's bundle.
      tooltip: "Write a new note (en)",
    });
    expect(workbench.activitybar()[0]?.title).toBe("Carnet");

    l10n.setLocale("en");
    expect(titles(workbench.menu("menubar"))).toEqual(["Notes"]);
    expect(workbench.view(`${NOTES}/notes`)?.title).toBe("Notes");
    expect(workbench.palette()[0]?.title).toBe("Summary of new-note");
  });

  it("keeps a command's inline labels as the fallback before the default language", async () => {
    const { workbench, l10n } = await platform([notes()]);
    l10n.setLocale("de-AT");
    expect(titles(workbench.menu("notes"))).toEqual(["Neue Notiz"]);
    // No German at all: the inline (default language) title.
    expect(titles(workbench.menu("menubar"))).toEqual(["Notes"]);
  });

  it("shows dialogs and notifications in the language, re-translating pending ones", async () => {
    const { workbench, l10n } = await platform([notes()]);
    void workbench.dialogs.show(`${NOTES}/ask`, { n: 1200 });
    expect(workbench.dialogs.pending()[0]).toMatchObject({
      title: "New note",
      message: "Note 1,200",
      input: { label: "Note", placeholder: "Write" },
      actions: [{ id: "add", label: "Add" }],
    });
    l10n.setLocale("fr");
    expect(workbench.dialogs.pending()[0]).toMatchObject({
      title: "Nouvelle note",
      message: "Note 1 200",
      // No French placeholder: the default language's inline text.
      input: { label: "Texte", placeholder: "Write" },
      actions: [{ id: "add", label: "Ajouter" }],
    });
    void workbench.notifications.show(`${NOTES}/added`, { text: "Milk" });
    expect(workbench.notifications.pending()[0]).toMatchObject({
      title: "Note ajoutée",
      message: "Milk",
    });
  });

  it("translates its own command-failed notification", async () => {
    const { workbench, l10n } = await platform([notes()], {
      "new-note": () => {
        throw new Error("boom");
      },
    });
    l10n.setLocale("fr");
    void workbench.notifications.show(COMMAND_FAILED_NOTIFICATION, { command: "X", error: "e" });
    expect(workbench.notifications.pending()[0]?.title).toBe("Échec de X");
    expect(workbench.text("palette.placeholder", "Type a command…")).toBe("Saisir une commande…");
  });
});
