import { describe, expect, it } from "vitest";
import { command, fragment, platform } from "./helpers.js";

const NOTES = "org.example.notes";
const notes = () =>
  fragment(NOTES, [command("read-note", "read"), command("delete-note", "write")]);
const handlers = {
  [NOTES]: { "read-note": () => ({ text: "hello" }), "delete-note": () => ({ deleted: true }) },
};
const agent = { kind: "agent", id: "session-1" } as const;

describe("an agent's call", () => {
  it("passes with a grant for the command and an Allow policy", async () => {
    const { bus, security } = await platform([notes()], handlers);
    security.setPolicy({ actions: { read: "allow" } });
    const capability = security.issue(agent, { permissions: [`tools.use:${NOTES}/read-note`] });
    await expect(bus.call(`${NOTES}/read-note`, {}, { caller: { capability } })).resolves.toEqual({
      text: "hello",
    });
  });
});

describe("grants are deny-by-default", () => {
  async function refused(call: Promise<unknown>) {
    const error = await call.then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toMatchObject({ name: "CommandCallError", kind: "forbidden" });
    return error as Error;
  }

  it("refuses a call whose capability grants nothing, and the handler does not run", async () => {
    let ran = false;
    const { bus, security } = await platform([notes()], {
      [NOTES]: {
        "read-note": () => {
          ran = true;
          return {};
        },
      },
    });
    security.setPolicy({ actions: { read: "allow" } });
    const capability = security.issue(agent);
    const error = await refused(bus.call(`${NOTES}/read-note`, {}, { caller: { capability } }));
    expect(error.message).toContain(`tools.use:${NOTES}/read-note`);
    expect(ran).toBe(false);
  });

  it("refuses a command the capability does not name", async () => {
    const { bus, security } = await platform([notes()], handlers);
    security.setPolicy({ actions: { read: "allow", write: "allow" } });
    const capability = security.issue(agent, { permissions: [`tools.use:${NOTES}/read-note`] });
    await refused(bus.call(`${NOTES}/delete-note`, {}, { caller: { capability } }));
  });

  it("refuses a caller without a capability system.security issued", async () => {
    const { bus, security } = await platform([notes()], handlers);
    security.setPolicy({ actions: { read: "allow" } });
    for (const capability of ["", "not a token", undefined as unknown as string])
      await refused(bus.call(`${NOTES}/read-note`, {}, { caller: { capability } }));
  });
});

describe("exposures", () => {
  const all = fragment(NOTES, [
    command("internal", undefined),
    command("served", undefined, { http: { path: "/served" } }),
    command("tool", "read"),
  ]);
  const ok = { [NOTES]: { internal: () => ({}), served: () => ({}), tool: () => ({}) } };
  const permissions = ["internal", "served", "tool"].map((c) => `tools.use:${NOTES}/${c}`);

  it("let agents call only agent-exposed commands, whatever they are granted", async () => {
    const { bus, security } = await platform([all], ok);
    security.setPolicy({ actions: { read: "allow", write: "allow", admin: "allow" } });
    const capability = security.issue(agent, { permissions });
    await expect(bus.call(`${NOTES}/tool`, {}, { caller: { capability } })).resolves.toEqual({});
    for (const c of ["internal", "served"])
      await expect(bus.call(`${NOTES}/${c}`, {}, { caller: { capability } })).rejects.toMatchObject(
        { kind: "forbidden", message: expect.stringContaining("expose") },
      );
  });

  it("let peers call only HTTP-exposed commands (MCP implies HTTP)", async () => {
    const { bus, security } = await platform([all], ok);
    security.setPolicy({ actions: { read: "allow", write: "allow", admin: "allow" } });
    const capability = security.issue({ kind: "peer", id: "p1" }, { permissions });
    await expect(bus.call(`${NOTES}/served`, {}, { caller: { capability } })).resolves.toEqual({});
    for (const c of ["internal", "tool"])
      await expect(bus.call(`${NOTES}/${c}`, {}, { caller: { capability } })).rejects.toMatchObject(
        { kind: "forbidden" },
      );
  });

  it("take a command without an agent action as an admin action for the policy", async () => {
    const { bus, security } = await platform([all], ok);
    security.setPolicy({ actions: { read: "allow", write: "allow", admin: "block" } });
    const capability = security.issue({ kind: "sandbox", id: "s1" }, { permissions });
    await expect(
      bus.call(`${NOTES}/internal`, {}, { caller: { capability } }),
    ).rejects.toMatchObject({ kind: "forbidden" });
    await expect(bus.call(`${NOTES}/tool`, {}, { caller: { capability } })).resolves.toEqual({});
  });
});

describe("revocation", () => {
  it("refuses every later call of a revoked capability, and only of that one", async () => {
    const { bus, security } = await platform([notes()], handlers);
    security.setPolicy({ actions: { read: "allow" } });
    const permissions = [`tools.use:${NOTES}/read-note`];
    const revoked = security.issue(agent, { permissions });
    const other = security.issue(agent, { permissions });
    await bus.call(`${NOTES}/read-note`, {}, { caller: { capability: revoked } });
    security.revoke(revoked);
    await expect(
      bus.call(`${NOTES}/read-note`, {}, { caller: { capability: revoked } }),
    ).rejects.toMatchObject({ kind: "forbidden", message: expect.stringContaining("revoked") });
    await expect(
      bus.call(`${NOTES}/read-note`, {}, { caller: { capability: other } }),
    ).resolves.toEqual({ text: "hello" });
  });
});

describe("revoking an issued capability", () => {
  it("also refuses the tokens its holder narrowed from it", async () => {
    const { Biscuit } = await import("@statewalker/webrun-biscuit");
    const { bus, security } = await platform([notes()], handlers);
    security.setPolicy({ actions: { read: "allow" } });
    const issued = security.issue(agent, { permissions: [`tools.use:${NOTES}/read-note`] });
    const narrowed = Biscuit.fromBase64(issued).attenuate("check if true;").toBase64();
    security.revoke(issued);
    await expect(
      bus.call(`${NOTES}/read-note`, {}, { caller: { capability: narrowed } }),
    ).rejects.toMatchObject({ kind: "forbidden" });
  });
});
