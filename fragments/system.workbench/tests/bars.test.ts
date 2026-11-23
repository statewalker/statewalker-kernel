// Seam 1: the `statusbar` and `activitybar` points, static contributions the workbench shows
// before the contributor's code loads.
import { extensionRefusalsSlot } from "@statewalker/kernel.core";
import { describe, expect, it } from "vitest";
import { command, ext, fragment, platform } from "./helpers.js";

const NOTES = "org.example.notes";
const TODO = "org.example.todo";

const view = (id: string, title: string) => ({
  point: "views",
  data: { id, title },
  reference: { module: "./index.js", export: id },
});

describe("the statusbar point", () => {
  it("lists items left then right, by order, before code loads; a command shows only while on the bus", async () => {
    const { workbench, loaded } = await platform([
      fragment(NOTES, [
        command("new-note"),
        ext("statusbar", { id: "count", text: "Notes", command: `${NOTES}/new-note`, order: 2 }),
        ext("statusbar", { id: "sync", text: "Synced", alignment: "right", tooltip: "All saved" }),
        ext("statusbar", { id: "mode", text: "Edit", order: 1, command: `${NOTES}/gone` }),
      ]),
    ]);
    expect(workbench.statusbar()).toEqual([
      { id: `${NOTES}/mode`, fragment: NOTES, text: "Edit", alignment: "left", order: 1 },
      {
        id: `${NOTES}/count`,
        fragment: NOTES,
        text: "Notes",
        alignment: "left",
        order: 2,
        command: `${NOTES}/new-note`,
      },
      {
        id: `${NOTES}/sync`,
        fragment: NOTES,
        text: "Synced",
        tooltip: "All saved",
        alignment: "right",
        order: 0,
      },
    ]);
    expect(loaded).toEqual([]);
  });

  it("drops a fragment's items when it is disabled", async () => {
    const { kernel, workbench } = await platform([
      fragment(NOTES, [ext("statusbar", { id: "a", text: "A" })]),
      fragment(TODO, [ext("statusbar", { id: "b", text: "B" })]),
    ]);
    await kernel.disable(NOTES);
    expect(workbench.statusbar().map((i) => i.id)).toEqual([`${TODO}/b`]);
  });
});

describe("the activitybar point", () => {
  it("lists entries opening a view or running a command, by order then title, live targets only", async () => {
    const { workbench, loaded } = await platform([
      fragment(NOTES, [
        view("notes", "Notes"),
        command("new-note"),
        ext("activitybar", { id: "notes", title: "Notes", view: `${NOTES}/notes`, order: 1 }),
        ext("activitybar", { id: "add", title: "Add", command: `${NOTES}/new-note`, order: 1 }),
        ext("activitybar", { id: "gone", title: "Gone", view: `${TODO}/list` }),
      ]),
    ]);
    expect(workbench.activitybar()).toEqual([
      { id: `${NOTES}/add`, fragment: NOTES, title: "Add", order: 1, command: `${NOTES}/new-note` },
      { id: `${NOTES}/notes`, fragment: NOTES, title: "Notes", order: 1, view: `${NOTES}/notes` },
    ]);
    expect(loaded).toEqual([]);
  });

  it("refuses an entry naming both a view and a command, or neither", async () => {
    const { kernel } = await platform([
      fragment(NOTES, [
        ext("activitybar", { id: "a", title: "A" }),
        ext("activitybar", { id: "b", title: "B", view: `${NOTES}/x`, command: `${NOTES}/y` }),
      ]),
    ]);
    const refused = [...kernel.slots.getSnapshot(extensionRefusalsSlot("client")).values()];
    expect(refused.filter((r) => r.point === "activitybar")).toHaveLength(2);
  });
});
