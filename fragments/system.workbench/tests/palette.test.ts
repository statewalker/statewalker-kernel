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
