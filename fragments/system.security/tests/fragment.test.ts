import { readFileSync } from "node:fs";
import { join } from "node:path";
import { activeFragmentsSlot, parseJsonc } from "@statewalker/kernel.core";
import { describe, expect, it } from "vitest";
import { SYSTEM_SECURITY_ID, systemSecurityArchive } from "../src/index.js";
import { command, fragment, platform } from "./helpers.js";

const NOTES = "org.example.notes";

describe("the system.security fragment", () => {
  it("is a core fragment the kernel installs and activates", async () => {
    const { kernel } = await platform([]);
    expect([...kernel.slots.getSnapshot(activeFragmentsSlot("client")).keys()]).toContain(
      SYSTEM_SECURITY_ID,
    );
  });

  it("ships the archive its folder holds", () => {
    const root = join(import.meta.dirname, "..");
    for (const file of ["fragment.jsonc", "fragment.client.jsonc"]) {
      const onDisk = parseJsonc(readFileSync(join(root, file), "utf8")).value;
      expect(onDisk).toEqual(JSON.parse(systemSecurityArchive[file] ?? "null"));
    }
  });

  it("refuses every call it gates while it is not active (fail-closed)", async () => {
    const { kernel, bus, security } = await platform([fragment(NOTES, [command("ping", "read")])], {
      [NOTES]: { ping: () => ({}) },
    });
    security.setPolicy({ actions: { read: "allow" } });
    const capability = security.issue(
      { kind: "agent", id: "a" },
      { permissions: [`tools.use:${NOTES}/ping`] },
    );
    await kernel.deactivate("client", SYSTEM_SECURITY_ID);
    await expect(bus.call(`${NOTES}/ping`, {}, { caller: { capability } })).rejects.toMatchObject({
      kind: "forbidden",
      message: expect.stringContaining("not active"),
    });
    await kernel.activate("client", SYSTEM_SECURITY_ID);
    await expect(bus.call(`${NOTES}/ping`, {}, { caller: { capability } })).resolves.toEqual({});
  });
});
