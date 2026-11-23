import { describe, expect, it } from "vitest";
import { approvalsSlot } from "../src/index.js";
import { command, fragment, pending, platform } from "./helpers.js";

const NOTES = "org.example.notes";
const notes = () =>
  fragment(NOTES, [command("read-note", "read"), command("delete-note", "write")]);
const handlers = {
  [NOTES]: { "read-note": () => ({ text: "hello" }), "delete-note": () => ({ deleted: true }) },
};
const agent = { kind: "agent", id: "session-1" } as const;
const both = [`tools.use:${NOTES}/read-note`, `tools.use:${NOTES}/delete-note`];

describe("Block", () => {
  it("refuses a granted call, per action kind and per tool", async () => {
    const { bus, security } = await platform([notes()], handlers);
    const capability = security.issue(agent, { permissions: both });
    security.setPolicy({ actions: { read: "allow", write: "block" } });
    await expect(
      bus.call(`${NOTES}/delete-note`, {}, { caller: { capability } }),
    ).rejects.toMatchObject({ kind: "forbidden" });
    await expect(bus.call(`${NOTES}/read-note`, {}, { caller: { capability } })).resolves.toEqual({
      text: "hello",
    });
    security.setPolicy({ actions: { read: "allow" }, tools: { [`${NOTES}/read-note`]: "block" } });
    await expect(
      bus.call(`${NOTES}/read-note`, {}, { caller: { capability } }),
    ).rejects.toMatchObject({ kind: "forbidden" });
  });

  it("wins over an Allow for the tool: the strictest verdict that applies decides", async () => {
    const { bus, security } = await platform([notes()], handlers);
    const capability = security.issue(agent, { permissions: both });
    security.setPolicy({
      actions: { write: "block" },
      tools: { [`${NOTES}/delete-note`]: "allow" },
    });
    await expect(
      bus.call(`${NOTES}/delete-note`, {}, { caller: { capability } }),
    ).rejects.toMatchObject({ kind: "forbidden" });
  });
});

describe("the user's own calls", () => {
  it("are not restricted: no capability, no grant, whatever the policy", async () => {
    const { bus, security } = await platform([notes()], handlers);
    security.setPolicy({ actions: { read: "block", write: "block", admin: "block" } });
    await expect(bus.call(`${NOTES}/delete-note`)).resolves.toEqual({ deleted: true });
    await expect(bus.call(`${NOTES}/read-note`, {}, { caller: { kind: "user" } })).resolves.toEqual(
      { text: "hello" },
    );
  });
});

describe("Ask", () => {
  async function asking(options: { attended?: boolean } = { attended: true }) {
    let ran = 0;
    const p = await platform(
      [notes()],
      {
        [NOTES]: {
          "read-note": () => ({ text: "hello" }),
          "delete-note": () => {
            ran++;
            return { deleted: true };
          },
        },
      },
      options,
    );
    p.security.setPolicy({ actions: { read: "allow", write: "ask" } });
    const capability = p.security.issue(agent, { permissions: both });
    const call = p.bus.call(`${NOTES}/delete-note`, { id: "n1" }, { caller: { capability } });
    return { ...p, call, ran: () => ran, capability };
  }

  it("suspends the call and publishes an approval request until the user answers", async () => {
    const { call, slots, ran } = await asking();
    expect(await pending(call)).toBe(true);
    expect(ran()).toBe(0);
    expect([...slots.getSnapshot(approvalsSlot).values()]).toEqual([
      {
        id: expect.any(String),
        principal: agent,
        command: `${NOTES}/delete-note`,
        action: "write",
        permission: `tools.use:${NOTES}/delete-note`,
        input: { id: "n1" },
        reason: expect.stringContaining("ask"),
      },
    ]);
  });

  it("lets the call proceed once the user allows it", async () => {
    const { call, slots, security, ran } = await asking();
    await pending(call);
    const [id] = slots.getSnapshot(approvalsSlot).keys();
    expect(security.answer(id as string, "allow")).toBe(true);
    await expect(call).resolves.toEqual({ deleted: true });
    expect(ran()).toBe(1);
    expect(slots.getSnapshot(approvalsSlot).size).toBe(0);
  });

  it("refuses the call once the user denies it", async () => {
    const { call, slots, security, ran } = await asking();
    await pending(call);
    const [id] = slots.getSnapshot(approvalsSlot).keys();
    expect(security.answer(id as string, "deny")).toBe(true);
    await expect(call).rejects.toMatchObject({ kind: "forbidden" });
    expect(ran()).toBe(0);
    expect(slots.getSnapshot(approvalsSlot).size).toBe(0);
    expect(security.answer(id as string, "allow")).toBe(false);
  });

  it("is what the policy answers for a call none of its verdicts applies to", async () => {
    const { bus, security, slots } = await platform([notes()], handlers, { attended: true });
    const capability = security.issue(agent, { permissions: both });
    const call = bus.call(`${NOTES}/read-note`, {}, { caller: { capability } });
    expect(await pending(call)).toBe(true);
    expect(slots.getSnapshot(approvalsSlot).size).toBe(1);
  });

  it("is refused at once where nobody attends (the default), and nothing is published", async () => {
    const { call, slots } = await asking({});
    await expect(call).rejects.toMatchObject({
      kind: "forbidden",
      message: expect.stringContaining("nobody"),
    });
    expect(slots.getSnapshot(approvalsSlot).size).toBe(0);
  });

  it("is refused at once for a capability issued unattended, though the host is attended", async () => {
    const { bus, security, slots } = await platform([notes()], handlers, { attended: true });
    security.setPolicy({ actions: { write: "ask" } });
    const capability = security.issue(agent, { permissions: both, unattended: true });
    await expect(
      bus.call(`${NOTES}/delete-note`, {}, { caller: { capability } }),
    ).rejects.toMatchObject({ kind: "forbidden" });
    expect(slots.getSnapshot(approvalsSlot).size).toBe(0);
  });

  it("refuses the calls still waiting when system.security deactivates", async () => {
    const { call, kernel, slots } = await asking();
    await pending(call);
    await kernel.deactivate("client", "system.security");
    await expect(call).rejects.toMatchObject({ kind: "forbidden" });
    expect(slots.getSnapshot(approvalsSlot).size).toBe(0);
  });
});

describe("an approved call", () => {
  it("is still refused when its capability was revoked while it waited", async () => {
    const { bus, security, slots } = await platform([notes()], handlers, { attended: true });
    const capability = security.issue(agent, { permissions: both });
    const call = bus.call(`${NOTES}/delete-note`, {}, { caller: { capability } });
    await pending(call);
    security.revoke(capability);
    const [id] = slots.getSnapshot(approvalsSlot).keys();
    security.answer(id as string, "allow");
    await expect(call).rejects.toMatchObject({ kind: "forbidden" });
  });
});
