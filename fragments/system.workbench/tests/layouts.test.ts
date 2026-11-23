// Seam 1: the workbench's zones, device modes and layouts, through the real kernel. A view may
// name its preferred zone; default layouts come from the `layouts` point (and the host's own);
// the layout of each device mode is kept in the profile, apart from the others, and drops the
// views of a fragment that leaves.
import { createMemoryProfile } from "@statewalker/kernel.core";
import { describe, expect, it } from "vitest";
import { DEVICE_BREAKPOINTS, deviceModeOf, layoutKey, type WorkbenchState } from "../src/index.js";
import { ext, fragment, platform } from "./helpers.js";

const NOTES = "org.example.notes";
const TODO = "org.example.todo";

const view = (id: string, title: string, zone?: string) => ({
  point: "views",
  data: { id, title, ...(zone ? { zone } : {}) },
  reference: { module: "./index.js", export: id },
});

const notes = (extra: ReturnType<typeof ext>[] = []) =>
  fragment(NOTES, [view("notes", "Notes"), view("outline", "Outline", "left"), ...extra]);
const todo = () => fragment(TODO, [view("list", "To do", "right")]);

const empty = { center: [], left: [], right: [], bottom: [] };

describe("device modes", () => {
  it("are chosen by width: phone below 640px, tablet below 1024px, desktop from there", () => {
    expect(DEVICE_BREAKPOINTS).toEqual({ tablet: 640, desktop: 1024 });
    expect([320, 639, 640, 800, 1023, 1024, 1920].map(deviceModeOf)).toEqual([
      "phone",
      "phone",
      "tablet",
      "tablet",
      "tablet",
      "desktop",
      "desktop",
    ]);
  });

  it("start as desktop, or as the host says, and switch", async () => {
    const { workbench } = await platform([], {}, { mode: "phone" });
    expect(workbench.mode()).toBe("phone");
    const states: WorkbenchState[] = [];
    workbench.observe((s) => states.push(s));
    workbench.setMode("tablet");
    workbench.setMode("tablet");
    expect(workbench.mode()).toBe("tablet");
    expect(states.map((s) => s.mode)).toEqual(["phone", "tablet"]);
    expect((await platform([])).workbench.mode()).toBe("desktop");
  });
});

describe("zones", () => {
  it("open a view in its preferred zone, the centre by default, or the zone asked", async () => {
    const { workbench } = await platform([notes(), todo()]);
    workbench.open(`${NOTES}/notes`);
    workbench.open(`${NOTES}/outline`);
    workbench.open(`${TODO}/list`, "bottom");
    expect(workbench.layout().zones).toEqual({
      center: [`${NOTES}/notes`],
      left: [`${NOTES}/outline`],
      right: [],
      bottom: [`${TODO}/list`],
    });
    expect(workbench.zoneOf(`${TODO}/list`)).toBe("bottom");
    expect(workbench.opened()).toEqual([`${NOTES}/notes`, `${NOTES}/outline`, `${TODO}/list`]);
  });

  it("move a view between zones, to a place in the zone, opening it if closed", async () => {
    const { workbench } = await platform([notes(), todo()]);
    workbench.open(`${NOTES}/notes`);
    workbench.move(`${TODO}/list`, "center", 0);
    expect(workbench.layout().zones.center).toEqual([`${TODO}/list`, `${NOTES}/notes`]);
    workbench.move(`${NOTES}/notes`, "right");
    expect(workbench.layout().zones).toEqual({
      ...empty,
      center: [`${TODO}/list`],
      right: [`${NOTES}/notes`],
    });
    expect(() => workbench.move(`${NOTES}/gone`, "left")).toThrow(/no view/);
  });

  it("refuse a view naming a zone that does not exist", async () => {
    const { workbench } = await platform([fragment(NOTES, [view("notes", "Notes", "top")])]);
    expect(workbench.views()).toEqual([]);
  });

  it("keep the active view; closing it makes another active", async () => {
    const { workbench } = await platform([notes()]);
    workbench.open(`${NOTES}/notes`);
    workbench.open(`${NOTES}/outline`);
    workbench.setActive(`${NOTES}/notes`);
    expect(workbench.layout().active).toBe(`${NOTES}/notes`);
    workbench.close(`${NOTES}/notes`);
    expect(workbench.layout().active).toBe(`${NOTES}/outline`);
  });
});

describe("default layouts", () => {
  it("come from the layouts point, per device mode, and from the host; absent views left out", async () => {
    const { workbench } = await platform(
      [
        notes([
          ext("layouts", { zones: { center: [`${NOTES}/notes`] } }),
          ext("layouts", {
            mode: "desktop",
            zones: { left: [`${NOTES}/outline`], right: [`${TODO}/list`, "org.example.gone/x"] },
          }),
        ]),
        todo(),
      ],
      {},
      { layouts: [{ mode: "phone", zones: { center: [`${TODO}/list`] }, active: `${TODO}/list` }] },
    );
    expect(workbench.layout()).toEqual({
      zones: {
        ...empty,
        center: [`${NOTES}/notes`],
        left: [`${NOTES}/outline`],
        right: [`${TODO}/list`],
      },
    });
    workbench.setMode("phone");
    expect(workbench.layout()).toEqual({
      zones: { ...empty, center: [`${TODO}/list`, `${NOTES}/notes`] },
      active: `${TODO}/list`,
    });
  });

  it("follow the views that arrive while the layout is not changed", async () => {
    const { kernel, workbench } = await platform([
      notes([ext("layouts", { zones: { right: [`${TODO}/list`] } })]),
    ]);
    expect(workbench.opened()).toEqual([]);
    for (const f of await kernel.install([todo()])) await kernel.enable(f.id);
    expect(workbench.opened()).toEqual([`${TODO}/list`]);
  });

  it("refuse a layout naming a mode or a zone that does not exist", async () => {
    const { workbench } = await platform([
      notes([
        ext("layouts", { mode: "watch", zones: { center: [`${NOTES}/notes`] } }),
        ext("layouts", { zones: { top: [`${NOTES}/notes`] } }),
      ]),
    ]);
    expect(workbench.opened()).toEqual([]);
  });
});

describe("saved layouts", () => {
  it("are kept in the profile per device mode once changed, apart from the other modes", async () => {
    const profile = createMemoryProfile();
    const { workbench } = await platform([notes(), todo()], {}, { profile });
    workbench.open(`${NOTES}/notes`);
    expect(profile.get(layoutKey("desktop"))).toEqual({
      version: 1,
      zones: { ...empty, center: [`${NOTES}/notes`] },
      active: `${NOTES}/notes`,
    });
    workbench.setMode("phone");
    expect(workbench.opened()).toEqual([]);
    workbench.open(`${TODO}/list`);
    workbench.setMode("desktop");
    expect(workbench.opened()).toEqual([`${NOTES}/notes`]);
    expect(profile.keys().sort()).toEqual([layoutKey("desktop"), layoutKey("phone")]);
    expect(profile.get(layoutKey("tablet"))).toBeUndefined();
  });

  it("survive a reload: a new workbench over the same profile restores each mode's layout", async () => {
    const profile = createMemoryProfile();
    const first = await platform([notes(), todo()], {}, { profile });
    first.workbench.open(`${NOTES}/notes`);
    first.workbench.move(`${NOTES}/notes`, "left");
    first.workbench.setMode("tablet");
    first.workbench.open(`${TODO}/list`);

    const second = await platform([notes(), todo()], {}, { profile });
    expect(second.workbench.layout().zones).toEqual({ ...empty, left: [`${NOTES}/notes`] });
    second.workbench.setMode("tablet");
    expect(second.workbench.layout().zones).toEqual({ ...empty, right: [`${TODO}/list`] });
    second.workbench.setMode("phone");
    expect(second.workbench.opened()).toEqual([]);
  });

  it("win over the default layout, which no longer changes them", async () => {
    const profile = createMemoryProfile();
    const withDefault = () => notes([ext("layouts", { zones: { center: [`${NOTES}/notes`] } })]);
    const first = await platform([withDefault()], {}, { profile });
    expect(first.workbench.opened()).toEqual([`${NOTES}/notes`]);
    expect(profile.get(layoutKey("desktop"))).toBeUndefined();
    first.workbench.close(`${NOTES}/notes`);
    const second = await platform([withDefault()], {}, { profile });
    expect(second.workbench.opened()).toEqual([]);
  });

  it("drop the views of a fragment that leaves, in every mode, for good", async () => {
    const profile = createMemoryProfile();
    const { kernel, workbench } = await platform([notes(), todo()], {}, { profile });
    workbench.open(`${NOTES}/notes`);
    workbench.open(`${TODO}/list`);
    workbench.setMode("phone");
    workbench.open(`${NOTES}/outline`);
    workbench.open(`${TODO}/list`);
    await kernel.disable(NOTES);
    expect(profile.get(layoutKey("phone"))).toMatchObject({
      zones: { ...empty, right: [`${TODO}/list`] },
    });
    expect(profile.get(layoutKey("desktop"))).toMatchObject({
      zones: { ...empty, right: [`${TODO}/list`] },
    });
    await kernel.enable(NOTES);
    expect(workbench.opened()).toEqual([`${TODO}/list`]);
    const reloaded = await platform([notes(), todo()], {}, { profile });
    expect(reloaded.workbench.opened()).toEqual([`${TODO}/list`]);
  });

  it("keep, unshown, the views of a fragment not there yet", async () => {
    const profile = createMemoryProfile();
    const first = await platform([notes(), todo()], {}, { profile });
    first.workbench.open(`${TODO}/list`);
    first.workbench.open(`${NOTES}/notes`);
    const second = await platform([notes()], {}, { profile });
    expect(second.workbench.opened()).toEqual([`${NOTES}/notes`]);
    second.workbench.move(`${NOTES}/notes`, "bottom");
    for (const f of await second.kernel.install([todo()])) await second.kernel.enable(f.id);
    expect(second.workbench.layout().zones).toEqual({
      ...empty,
      right: [`${TODO}/list`],
      bottom: [`${NOTES}/notes`],
    });
  });

  it("are ignored when unreadable (another version, broken), the default layout applying", async () => {
    const profile = createMemoryProfile();
    profile.set(layoutKey("desktop"), { version: 2, zones: { center: [`${NOTES}/notes`] } });
    profile.set(layoutKey("phone"), { version: 1, zones: "nope" });
    const { workbench } = await platform(
      [notes([ext("layouts", { zones: { left: [`${NOTES}/outline`] } })])],
      {},
      { profile },
    );
    expect(workbench.opened()).toEqual([`${NOTES}/outline`]);
    workbench.setMode("phone");
    expect(workbench.opened()).toEqual([`${NOTES}/outline`]);
  });

  it("are not touched when the workbench is deactivated", async () => {
    const profile = createMemoryProfile();
    const { kernel, workbench } = await platform([notes()], {}, { profile });
    workbench.open(`${NOTES}/notes`);
    await kernel.deactivate("client", "system.workbench");
    expect(workbench.opened()).toEqual([]);
    expect(profile.get(layoutKey("desktop"))).toMatchObject({
      zones: { center: [`${NOTES}/notes`] },
    });
  });
});
