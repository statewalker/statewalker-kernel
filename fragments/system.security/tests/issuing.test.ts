import { Biscuit, generateKeypair } from "@statewalker/webrun-biscuit";
import { describe, expect, it } from "vitest";
import { capabilityRefusalsSlot } from "../src/index.js";
import { command, fragment, platform } from "./helpers.js";

const NOTES = "org.example.notes";
const notes = () =>
  fragment(NOTES, [command("read-note", "read"), command("delete-note", "write")]);
const handlers = {
  [NOTES]: { "read-note": () => ({ text: "hello" }), "delete-note": () => ({ deleted: true }) },
};
const agent = { kind: "agent", id: "session-1" } as const;
const allowAll = { actions: { read: "allow", write: "allow", admin: "allow" } } as const;

describe("only system code issues capabilities", () => {
  it("refuses a token minted with any other key, though it names the same rights", async () => {
    const { bus, security } = await platform([notes()], handlers);
    security.setPolicy(allowAll);
    const forger = generateKeypair();
    const capability = Biscuit.build(
      forger.secretKey,
      'principal("agent", "session-1");\nright("tools.use:org.example.notes/read-note");',
    ).toBase64();
    await expect(
      bus.call(`${NOTES}/read-note`, {}, { caller: { capability } }),
    ).rejects.toMatchObject({ kind: "forbidden" });
  });

  it("lets a holder narrow its capability, never widen it", async () => {
    const { bus, security } = await platform([notes()], handlers);
    security.setPolicy(allowAll);
    const issued = security.issue(agent, {
      permissions: [`tools.use:${NOTES}/read-note`, `tools.use:${NOTES}/delete-note`],
    });
    const widened = Biscuit.fromBase64(issued)
      .attenuate('right("tools.use:org.example.notes/delete-note");')
      .toBase64();
    const readOnly = security.issue(agent, { permissions: [`tools.use:${NOTES}/read-note`] });
    const forged = Biscuit.fromBase64(readOnly)
      .attenuate('right("tools.use:org.example.notes/delete-note");')
      .toBase64();
    await expect(
      bus.call(`${NOTES}/delete-note`, {}, { caller: { capability: forged } }),
    ).rejects.toMatchObject({ kind: "forbidden" });
    await expect(
      bus.call(`${NOTES}/delete-note`, {}, { caller: { capability: widened } }),
    ).resolves.toEqual({ deleted: true });

    const narrowed = Biscuit.fromBase64(issued)
      .attenuate('check if command("org.example.notes/read-note");')
      .toBase64();
    await expect(
      bus.call(`${NOTES}/read-note`, {}, { caller: { capability: narrowed } }),
    ).resolves.toEqual({ text: "hello" });
    await expect(
      bus.call(`${NOTES}/delete-note`, {}, { caller: { capability: narrowed } }),
    ).rejects.toMatchObject({ kind: "forbidden" });
  });
});

describe("the capabilities point", () => {
  const grant = (principals: string[], permissions: string[]) => ({
    point: "capabilities",
    data: { principals, permissions },
  });

  it("refuses a standing grant from a fragment that is not system code, which grants nothing", async () => {
    const { bus, security, slots } = await platform(
      [notes(), fragment("org.example.evil", [grant(["agent"], [`tools.use:${NOTES}/read-note`])])],
      handlers,
    );
    security.setPolicy(allowAll);
    const capability = security.issue(agent);
    await expect(
      bus.call(`${NOTES}/read-note`, {}, { caller: { capability } }),
    ).rejects.toMatchObject({ kind: "forbidden" });
    expect([...slots.getSnapshot(capabilityRefusalsSlot).values()]).toEqual([
      expect.objectContaining({
        id: "org.example.evil#0",
        contributor: "org.example.evil",
        code: "not-system-code",
      }),
    ]);
  });

  it("applies a standing grant from system code to every principal of its kinds", async () => {
    const { bus, security, slots } = await platform([notes()], handlers, {
      core: [fragment("system.example", [grant(["agent"], [`tools.use:${NOTES}/read-note`])])],
    });
    security.setPolicy(allowAll);
    const capability = security.issue(agent);
    await expect(bus.call(`${NOTES}/read-note`, {}, { caller: { capability } })).resolves.toEqual({
      text: "hello",
    });
    const peer = security.issue({ kind: "peer", id: "p1" });
    await expect(
      bus.call(`${NOTES}/read-note`, {}, { caller: { capability: peer } }),
    ).rejects.toMatchObject({ kind: "forbidden" });
    expect(slots.getSnapshot(capabilityRefusalsSlot).size).toBe(0);
  });
});

describe("issuing", () => {
  it("refuses a permission that is not `tools.use:<fragment-id>/<command-id>`", async () => {
    const { security } = await platform([]);
    for (const permission of ["tools.use:*", "files.read:/", "tools.use:org.example.notes/*"])
      expect(() => security.issue(agent, { permissions: [permission] })).toThrow(TypeError);
  });
});
