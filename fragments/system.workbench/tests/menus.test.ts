// Seam 1: the `menus` point, read by system.workbench from the registry (static contributions,
// shown before the contributor's code loads) and run through system.commands' bus.
import { extensionRefusalsSlot } from "@statewalker/kernel.core";
import { describe, expect, it } from "vitest";
import type { MenuNode } from "../src/index.js";
import { command, ext, fragment, platform } from "./helpers.js";

const NOTES = "org.example.notes";
const TODO = "org.example.todo";

/** A menu as titles: commands by title, submenus as `{ title: [...] }`, separators as `---`. */
function titles(nodes: readonly MenuNode[]): unknown[] {
  return nodes.map((node) => {
    if (node.kind === "separator") return "---";
    if (node.kind === "submenu") return { [node.title]: titles(node.children) };
    return node.title;
  });
}

const notesFragment = (extra: ReturnType<typeof ext>[] = []) =>
  fragment(NOTES, [
    command("new-note", { labels: { fr: { title: "Nouvelle note" } } }),
    command("clear-notes"),
    ext("menus", { menu: "menubar", submenu: "notes", title: "Notes" }),
    ext("menus", { menu: "notes", command: `${NOTES}/new-note`, group: "1-edit" }),
    ext("menus", { menu: "notes", command: `${NOTES}/clear-notes`, group: "2-danger" }),
    ...extra,
  ]);

describe("the menus point", () => {
  it("shows static menu entries, titled by their commands, before the contributor's code loads", async () => {
    const { workbench, loaded } = await platform([notesFragment()]);
    expect(titles(workbench.menu("menubar"))).toEqual([
      { Notes: ["Summary of new-note", "---", "Summary of clear-notes"] },
    ]);
    expect(loaded).toEqual([]);
  });

  it("titles commands in the workbench's locale, and a menu entry's own title wins", async () => {
    const { workbench } = await platform(
      [
        notesFragment([
          ext("menus", { menu: "notes", command: `${NOTES}/new-note`, title: "Add one" }),
        ]),
      ],
      {},
      { locale: "fr-FR" },
    );
    expect(titles(workbench.menu("notes"))).toEqual([
      "Add one",
      "---",
      "Nouvelle note",
      "---",
      "Summary of clear-notes",
    ]);
  });

  it("orders entries by group, then order, then title", async () => {
    const { workbench } = await platform([
      fragment(NOTES, [
        command("a"),
        command("b"),
        command("c"),
        ext("menus", { menu: "m", command: `${NOTES}/c`, order: 1 }),
        ext("menus", { menu: "m", command: `${NOTES}/a`, order: 2 }),
        ext("menus", { menu: "m", command: `${NOTES}/b`, order: 2 }),
      ]),
    ]);
    expect(titles(workbench.menu("m"))).toEqual(["Summary of c", "Summary of a", "Summary of b"]);
  });

  it("hides entries whose command is not on the bus, and submenus left empty", async () => {
    const { workbench } = await platform([
      fragment(TODO, [
        ext("menus", { menu: "menubar", submenu: "todo", title: "To do" }),
        ext("menus", { menu: "todo", command: `${NOTES}/new-note` }),
      ]),
    ]);
    expect(workbench.menu("menubar")).toEqual([]);
  });

  it("hides a titled entry too while its command is not on the bus", async () => {
    const { kernel, workbench } = await platform([
      fragment(NOTES, [command("go")]),
      fragment(TODO, [
        ext("menus", { menu: "menubar", submenu: "todo", title: "To do" }),
        ext("menus", { menu: "todo", command: `${NOTES}/go`, title: "Go!" }),
        ext("menus", { menu: "todo", command: "org.example.none/missing", title: "Ghost" }),
      ]),
    ]);
    expect(titles(workbench.menu("menubar"))).toEqual([{ "To do": ["Go!"] }]);
    await kernel.disable(NOTES);
    expect(workbench.menu("menubar")).toEqual([]);
  });

  it("filters entries by their `when` against the context", async () => {
    const { workbench } = await platform([
      notesFragment([
        ext("menus", {
          menu: "view/context",
          command: `${NOTES}/new-note`,
          when: `view == ${NOTES}/notes`,
        }),
      ]),
    ]);
    expect(titles(workbench.menu("view/context", { view: `${NOTES}/notes` }))).toEqual([
      "Summary of new-note",
    ]);
    expect(workbench.menu("view/context", { view: `${TODO}/list` })).toEqual([]);
    expect(workbench.menu("view/context")).toEqual([]);
  });

  it("runs a menu entry's command through the bus, loading its handler then", async () => {
    const calls: unknown[] = [];
    const { workbench, loaded } = await platform([notesFragment()], {
      "new-note": (input) => {
        calls.push(input);
        return { ok: true };
      },
    });
    const [notes] = workbench.menu("menubar");
    if (notes?.kind !== "submenu") throw new Error("no Notes submenu");
    const [entry] = notes.children;
    if (entry?.kind !== "command") throw new Error("no command entry");
    await expect(workbench.run(entry.command)).resolves.toEqual({ ok: true });
    expect(calls).toEqual([{}]);
    expect(loaded).toEqual([`${NOTES}#new-note`]);
  });

  it("drops a fragment's entries when it is disabled, and brings them back on enable", async () => {
    const { kernel, workbench } = await platform([notesFragment()]);
    const seen: number[] = [];
    workbench.observe(() => seen.push(workbench.menu("menubar").length));
    await kernel.disable(NOTES);
    expect(workbench.menu("menubar")).toEqual([]);
    await kernel.enable(NOTES);
    expect(titles(workbench.menu("menubar"))).toEqual([
      { Notes: ["Summary of new-note", "---", "Summary of clear-notes"] },
    ]);
    expect(seen.at(0)).toBe(1);
    expect(seen).toContain(0);
    expect(seen.at(-1)).toBe(1);
  });

  it("refuses an entry naming both a command and a submenu, or neither", async () => {
    const { kernel } = await platform([
      fragment(NOTES, [
        ext("menus", { menu: "m", command: `${NOTES}/x`, submenu: "y", title: "Y" }),
        ext("menus", { menu: "m" }),
        ext("menus", { menu: "m", submenu: "y" }),
      ]),
    ]);
    const refused = [...kernel.slots.getSnapshot(extensionRefusalsSlot("client")).values()];
    expect(refused.filter((r) => r.point === "menus")).toHaveLength(3);
  });
});
