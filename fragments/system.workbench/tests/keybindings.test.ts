// Seam 1: keyboard shortcuts. system.commands opens the `keybindings` point; system.workbench's
// keybinding registry reads it through the bus and maps key events to commands.
import { describe, expect, it } from "vitest";
import { formatChord, normalizeChord } from "../src/index.js";
import { command, ext, fragment, platform } from "./helpers.js";

const NOTES = "org.example.notes";
const NEW_NOTE = `${NOTES}/new-note`;

const key = (
  key: string,
  modifiers: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean } = {},
  code?: string,
) => ({
  key,
  code,
  ctrlKey: modifiers.ctrl ?? false,
  shiftKey: modifiers.shift ?? false,
  altKey: modifiers.alt ?? false,
  metaKey: modifiers.meta ?? false,
});

describe("keybindings", () => {
  it("normalizes chords: lowercase, modifiers in one order", () => {
    expect(normalizeChord("Shift+Ctrl+P")).toBe("ctrl+shift+p");
    expect(normalizeChord("alt + meta + F1")).toBe("alt+meta+f1");
    expect(normalizeChord("cmd+k")).toBe("meta+k");
    expect(normalizeChord("control+option+n")).toBe("ctrl+alt+n");
  });

  it("formats chords for menus and the palette", () => {
    expect(formatChord("ctrl+alt+n")).toBe("Ctrl+Alt+N");
    expect(formatChord("shift+f1")).toBe("Shift+F1");
    expect(formatChord("meta+escape")).toBe("Meta+Escape");
  });

  it("lists a fragment's keybindings before its code loads, for commands on the bus", async () => {
    const { workbench, loaded } = await platform([
      fragment(NOTES, [
        command("new-note"),
        ext("keybindings", { key: "Ctrl+Alt+N", command: NEW_NOTE }),
        ext("keybindings", { key: "ctrl+alt+x", command: `${NOTES}/missing` }),
      ]),
    ]);
    expect(workbench.keybindings()).toEqual([
      { key: "ctrl+alt+n", command: NEW_NOTE, fragment: NOTES },
    ]);
    expect(loaded).toEqual([]);
  });

  it("maps a key event to its command, by key code when a modifier changes the key", async () => {
    const { workbench } = await platform([
      fragment(NOTES, [
        command("new-note"),
        ext("keybindings", { key: "ctrl+alt+n", command: NEW_NOTE }),
      ]),
    ]);
    expect(workbench.keyCommand(key("n", { ctrl: true, alt: true }, "KeyN"))).toBe(NEW_NOTE);
    expect(workbench.keyCommand(key("ñ", { ctrl: true, alt: true }, "KeyN"))).toBe(NEW_NOTE);
    expect(workbench.keyCommand(key("n", { ctrl: true }, "KeyN"))).toBeUndefined();
    expect(workbench.keyCommand(key("n", { ctrl: true, alt: true, shift: true }, "KeyN"))).toBe(
      undefined,
    );
    expect(workbench.keyCommand(key("F1", {}, "F1"))).toBeUndefined();
  });

  it("honours `when`, and the binding contributed last wins", async () => {
    const { workbench } = await platform([
      fragment(NOTES, [
        command("new-note"),
        command("other"),
        ext("keybindings", { key: "f2", command: NEW_NOTE }),
        ext("keybindings", { key: "f2", command: `${NOTES}/other`, when: "inputFocus" }),
      ]),
    ]);
    expect(workbench.keyCommand(key("F2", {}, "F2"))).toBe(NEW_NOTE);
    expect(workbench.keyCommand(key("F2", {}, "F2"), { inputFocus: true })).toBe(`${NOTES}/other`);
  });

  it("shows a command's keybinding beside its menu entry", async () => {
    const { workbench } = await platform([
      fragment(NOTES, [
        command("new-note"),
        ext("keybindings", { key: "Ctrl+Alt+N", command: NEW_NOTE }),
        ext("menus", { menu: "m", command: NEW_NOTE }),
      ]),
    ]);
    expect(workbench.menu("m")).toMatchObject([{ command: NEW_NOTE, keybinding: "ctrl+alt+n" }]);
  });

  it("drops a fragment's keybindings when it is disabled", async () => {
    const { kernel, workbench } = await platform([
      fragment(NOTES, [
        command("new-note"),
        ext("keybindings", { key: "ctrl+alt+n", command: NEW_NOTE }),
      ]),
    ]);
    await kernel.disable(NOTES);
    expect(workbench.keybindings()).toEqual([]);
    expect(workbench.keyCommand(key("n", { ctrl: true, alt: true }, "KeyN"))).toBeUndefined();
  });
});
