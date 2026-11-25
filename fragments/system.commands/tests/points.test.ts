import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  activeFragmentsSlot,
  type ExtensionRefusal,
  extensionRefusalsSlot,
  parseJsonc,
} from "@statewalker/kernel.core";
import type { Slots } from "@statewalker/shared-slots";
import { describe, expect, it } from "vitest";
import { SYSTEM_COMMANDS_ID, systemCommandsArchive } from "../src/index.js";
import { command, fragment, operation, platform } from "./helpers.js";

const NOTES = "org.example.notes";

function refusals(slots: Slots): ExtensionRefusal[] {
  return [...slots.getSnapshot(extensionRefusalsSlot("client")).values()];
}

describe("the system.commands fragment", () => {
  it("is a core fragment the kernel installs and activates", async () => {
    const { kernel } = await platform([]);
    expect([...kernel.slots.getSnapshot(activeFragmentsSlot("client")).keys()]).toEqual([
      SYSTEM_COMMANDS_ID,
    ]);
  });

  it("ships the archive its folder holds", () => {
    const root = join(import.meta.dirname, "..");
    for (const file of ["fragment.jsonc", "fragment.client.jsonc"]) {
      const onDisk = parseJsonc(readFileSync(join(root, file), "utf8")).value;
      expect(onDisk).toEqual(JSON.parse(systemCommandsArchive[file] ?? "null"));
    }
  });
});

describe("the commands point", () => {
  it("refuses a command whose declaration breaks the point's schema, with a reason", async () => {
    const { kernel, bus } = await platform([
      fragment(NOTES, {
        commands: [
          command(operation("Bad_Id")),
          command(operation("text-input", { type: "string" })),
          command(operation("agent-no-action"), { exposures: { agent: {} } }),
          command(operation("fine")),
        ],
      }),
    ]);
    expect(bus.list().map((c) => c.id)).toEqual([`${NOTES}/fine`]);
    const refused = refusals(kernel.slots);
    expect(refused).toHaveLength(3);
    for (const r of refused) {
      expect(r).toMatchObject({ contributor: NOTES, point: "commands", code: "invalid-data" });
    }
  });

  it("takes the `task` exposure only for an idempotent command with a JSON output", async () => {
    const out = { type: "object", properties: { n: { type: "number" } } };
    const idempotent = { "x-idempotent": true };
    const { kernel, bus } = await platform([
      fragment(NOTES, {
        commands: [
          command(operation("not-idempotent", undefined, out), { exposures: { task: {} } }),
          command(operation("no-output", undefined, undefined, idempotent), {
            exposures: { task: {} },
          }),
          command(operation("served", undefined, out, idempotent), { exposures: { task: {} } }),
        ],
      }),
    ]);
    expect(bus.list().map((c) => c.id)).toEqual([`${NOTES}/served`]);
    expect(bus.get(`${NOTES}/served`)?.exposures).toEqual({ task: {} });
    const refused = refusals(kernel.slots);
    expect(refused).toHaveLength(2);
    for (const r of refused) {
      expect(r).toMatchObject({ contributor: NOTES, point: "commands", code: "invalid-data" });
    }
    const reasons = refused.map((r) => r.message).join("\n");
    expect(reasons).toMatch(/x-idempotent/);
    expect(reasons).toMatch(/200|responses/);
  });

  it("keeps the first of two commands one fragment declares under one id", async () => {
    const { bus } = await platform(
      [
        fragment(NOTES, {
          commands: [command(operation("go"), {}, "first"), command(operation("go"), {}, "second")],
        }),
      ],
      { [NOTES]: { first: () => ({ n: 1 }), second: () => ({ n: 2 }) } },
    );
    expect(bus.list().map((c) => c.id)).toEqual([`${NOTES}/go`]);
    await expect(bus.call(`${NOTES}/go`)).resolves.toEqual({ n: 1 });
  });
});

describe("the keybindings point", () => {
  it("lists the live keybindings, and drops a fragment's when it leaves", async () => {
    const { kernel, bus } = await platform([
      fragment(NOTES, {
        commands: [command(operation("find"))],
        keybindings: [{ key: "ctrl+f", command: `${NOTES}/find`, when: "editorFocus" }],
      }),
    ]);
    expect(bus.keybindings()).toEqual([
      { key: "ctrl+f", command: `${NOTES}/find`, when: "editorFocus", fragment: NOTES },
    ]);
    await kernel.disable(NOTES);
    expect(bus.keybindings()).toEqual([]);
  });

  it("refuses a keybinding without a key", async () => {
    const { kernel, bus } = await platform([
      fragment(NOTES, { keybindings: [{ command: `${NOTES}/find` }] }),
    ]);
    expect(bus.keybindings()).toEqual([]);
    expect(refusals(kernel.slots)).toMatchObject([{ point: "keybindings", code: "invalid-data" }]);
  });
});
