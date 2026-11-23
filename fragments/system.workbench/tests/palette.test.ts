// Seam 1: the command palette's list, every command on system.commands' bus with its l10n label.
import { describe, expect, it } from "vitest";
import { command, ext, fragment, platform } from "./helpers.js";

const NOTES = "org.example.notes";
const TODO = "org.example.todo";

describe("the command palette", () => {
  it("lists every live command by title in the locale, with its keybinding, before code loads", async () => {
    const { workbench, loaded } = await platform(
      [
        fragment(NOTES, [
          command("new-note", {
            labels: { fr: { title: "Nouvelle note", description: "Écrire" } },
          }),
          ext("keybindings", { key: "ctrl+alt+n", command: `${NOTES}/new-note` }),
        ]),
        fragment(TODO, [command("add-task")]),
      ],
      {},
      { locale: "fr" },
    );
    expect(workbench.palette()).toEqual([
      {
        command: `${NOTES}/new-note`,
        title: "Nouvelle note",
        description: "Écrire",
        keybinding: "ctrl+alt+n",
        fragment: NOTES,
      },
      {
        command: `${TODO}/add-task`,
        title: "Summary of add-task",
        description: "Summary of add-task",
        fragment: TODO,
      },
    ]);
    expect(loaded).toEqual([]);
  });

  it("drops a disabled fragment's commands", async () => {
    const { kernel, workbench } = await platform([
      fragment(NOTES, [command("new-note")]),
      fragment(TODO, [command("add-task")]),
    ]);
    await kernel.disable(NOTES);
    expect(workbench.palette().map((p) => p.command)).toEqual([`${TODO}/add-task`]);
  });
});

describe("commands that need an input", () => {
  // The chrome runs commands with no input: a command whose input requires properties, or whose
  // request body is required, cannot run from it and is not offered there.
  const needsText = (id: string) => ({
    point: "commands",
    data: {
      operation: {
        operationId: id,
        summary: `Summary of ${id}`,
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["text"],
                properties: { text: { type: "string" } },
              },
            },
          },
        },
      },
    },
    reference: { module: "./index.js", export: id },
  });
  const requiredBody = (id: string) => ({
    point: "commands",
    data: {
      operation: {
        operationId: id,
        summary: `Summary of ${id}`,
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object" } } },
        },
      },
    },
    reference: { module: "./index.js", export: id },
  });

  it("are left out of the palette, menus, keybindings and bars", async () => {
    const { workbench } = await platform([
      fragment(NOTES, [
        command("new-note"),
        needsText("add-note"),
        requiredBody("import"),
        ext("menus", { menu: "m", command: `${NOTES}/add-note` }),
        ext("menus", { menu: "m", command: `${NOTES}/import`, title: "Import" }),
        ext("menus", { menu: "m", command: `${NOTES}/new-note` }),
        ext("keybindings", { key: "f3", command: `${NOTES}/add-note` }),
        ext("statusbar", { id: "s", text: "Add", command: `${NOTES}/add-note` }),
        ext("activitybar", { id: "a", title: "Add", command: `${NOTES}/add-note` }),
      ]),
    ]);
    expect(workbench.palette().map((p) => p.command)).toEqual([`${NOTES}/new-note`]);
    expect(workbench.menu("m").map((n) => (n.kind === "command" ? n.command : n.kind))).toEqual([
      `${NOTES}/new-note`,
    ]);
    expect(workbench.keybindings()).toEqual([]);
    expect(workbench.statusbar()).toEqual([
      { id: `${NOTES}/s`, fragment: NOTES, text: "Add", alignment: "left", order: 0 },
    ]);
    expect(workbench.activitybar()).toEqual([]);
  });
});
