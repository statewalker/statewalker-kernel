// Seam 1: dialogs and notifications. A fragment declares them on the `dialogs` and
// `notifications` points and raises them by identity; the workbench queues them for its client
// to show the same way for every fragment, and the user's answer resolves the raiser's promise.
import { extensionRefusalsSlot } from "@statewalker/kernel.core";
import { describe, expect, it } from "vitest";
import { WorkbenchError } from "../src/index.js";
import { command, ext, fragment, platform } from "./helpers.js";

const NOTES = "org.example.notes";

const newNoteDialog = {
  id: "new-note",
  title: "New note",
  message: "Write {what} for {who}.",
  input: { label: "Text", placeholder: "Buy milk" },
  actions: [
    { id: "add", label: "Add", primary: true },
    { id: "cancel", label: "Cancel" },
  ],
};

const addedNotification = {
  id: "note-added",
  title: "Note {count} added",
  severity: "success",
  actions: [{ id: "undo", label: "Undo" }],
};

const notes = () =>
  fragment(NOTES, [ext("dialogs", newNoteDialog), ext("notifications", addedNotification)]);

describe("dialogs", () => {
  it("shows a declared dialog, its texts filled from the params, and returns the user's answer", async () => {
    const { workbench, loaded } = await platform([notes()]);
    const answer = workbench.dialogs.show(`${NOTES}/new-note`, { what: "a note", who: "you" });
    const [pending, ...rest] = workbench.dialogs.pending();
    expect(rest).toEqual([]);
    expect(pending).toMatchObject({
      id: `${NOTES}/new-note`,
      fragment: NOTES,
      title: "New note",
      message: "Write a note for you.",
      input: { label: "Text", placeholder: "Buy milk" },
      actions: [
        { id: "add", label: "Add", primary: true },
        { id: "cancel", label: "Cancel" },
      ],
    });
    if (!pending) throw new Error("no dialog");
    workbench.dialogs.answer(pending.request, { action: "add", value: "Milk" });
    await expect(answer).resolves.toEqual({ action: "add", value: "Milk" });
    expect(workbench.dialogs.pending()).toEqual([]);
    expect(loaded).toEqual([]);
  });

  it("answers a dismissed dialog with no action", async () => {
    const { workbench } = await platform([notes()]);
    const answer = workbench.dialogs.show(`${NOTES}/new-note`);
    const [pending] = workbench.dialogs.pending();
    workbench.dialogs.answer(pending?.request ?? -1, {});
    await expect(answer).resolves.toEqual({});
  });

  it("gives a dialog declaring no actions one OK button", async () => {
    const { workbench } = await platform([
      fragment(NOTES, [ext("dialogs", { id: "hi", title: "Hi" })]),
    ]);
    void workbench.dialogs.show(`${NOTES}/hi`);
    expect(workbench.dialogs.pending()[0]?.actions).toEqual([
      { id: "ok", label: "OK", primary: true },
    ]);
  });

  it("refuses to show a dialog nobody declares", async () => {
    const { workbench } = await platform([notes()]);
    await expect(workbench.dialogs.show(`${NOTES}/nope`)).rejects.toThrow(WorkbenchError);
    await expect(workbench.dialogs.show(`${NOTES}/nope`)).rejects.toMatchObject({
      kind: "unknown-dialog",
    });
  });

  it("dismisses a fragment's open dialogs when it is disabled", async () => {
    const { kernel, workbench } = await platform([notes()]);
    const answer = workbench.dialogs.show(`${NOTES}/new-note`);
    await kernel.disable(NOTES);
    await expect(answer).resolves.toEqual({});
    expect(workbench.dialogs.pending()).toEqual([]);
  });

  it("refuses a dialog whose data breaks the point's schema", async () => {
    const { kernel } = await platform([
      fragment(NOTES, [
        ext("dialogs", { id: "x" }),
        ext("dialogs", { id: "y", title: "Y", actions: [] }),
      ]),
    ]);
    const refused = [...kernel.slots.getSnapshot(extensionRefusalsSlot("client")).values()];
    expect(refused.filter((r) => r.point === "dialogs")).toHaveLength(2);
  });
});

describe("notifications", () => {
  it("shows a declared notification and returns the action the user picked", async () => {
    const { workbench } = await platform([notes()]);
    const states: number[] = [];
    workbench.observe((state) => states.push(state.notifications.length));
    const answer = workbench.notifications.show(`${NOTES}/note-added`, { count: 3 });
    const [pending] = workbench.notifications.pending();
    expect(pending).toMatchObject({
      id: `${NOTES}/note-added`,
      fragment: NOTES,
      title: "Note 3 added",
      severity: "success",
      actions: [{ id: "undo", label: "Undo" }],
    });
    workbench.notifications.answer(pending?.request ?? -1, { action: "undo" });
    await expect(answer).resolves.toEqual({ action: "undo" });
    expect(states).toEqual([0, 1, 0]);
  });

  it("is `info` by default, and answers a dismissed notification with no action", async () => {
    const { workbench } = await platform([
      fragment(NOTES, [ext("notifications", { id: "saved", title: "Saved" })]),
    ]);
    const answer = workbench.notifications.show(`${NOTES}/saved`);
    const [pending] = workbench.notifications.pending();
    expect(pending).toMatchObject({ severity: "info", actions: [] });
    workbench.notifications.answer(pending?.request ?? -1, {});
    await expect(answer).resolves.toEqual({});
  });

  it("raises system.workbench's own notification when a command run from the chrome fails", async () => {
    const { workbench } = await platform([fragment(NOTES, [command("broken")])], {
      broken: () => {
        throw new Error("disk full");
      },
    });
    await expect(workbench.execute(`${NOTES}/broken`)).resolves.toBeUndefined();
    expect(workbench.notifications.pending()).toMatchObject([
      {
        id: "system.workbench/command-failed",
        fragment: "system.workbench",
        severity: "error",
        title: "Summary of broken failed",
      },
    ]);
    expect(workbench.notifications.pending()[0]?.message).toContain("disk full");
  });
});
