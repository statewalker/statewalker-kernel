// @vitest-environment jsdom
import { Commands } from "@statewalker/shared-commands";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { createActionRouter, type PolicyDecision } from "./actions.js";
import { fakeModel, runAgentTurn } from "./agent.js";
import { ConfirmCommand, protoCatalog, protoComponents, protoRegistry } from "./catalog.js";
import { createProcessor } from "./processor.js";
import { A2uiSurface, emitComponentEvent } from "./renderer.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function setup(opts: {
  decision?: PolicyDecision;
  approve?: () => Promise<boolean>;
  agent?: boolean;
}) {
  const commands = Commands.create();
  const handled = vi.fn(async (payload: unknown) => ({ ok: true, payload }));
  commands.listen(ConfirmCommand, (cmd) => handled(cmd.payload));
  const policy = vi.fn(() => opts.decision ?? "allow");
  const router = createActionRouter({
    commands,
    components: protoComponents,
    isAgentSurface: () => opts.agent ?? true,
    policy,
    approve: opts.approve ?? (async () => false),
  });
  const processor = createProcessor([protoCatalog], router.handle);
  router.attach(processor);
  await runAgentTurn(processor, fakeModel);
  const surface = processor.getSurface("confirm-delete");
  if (!surface) throw new Error("no surface");
  return { commands, handled, policy, router, surface };
}

describe("component events become platform commands", () => {
  it("a real click on the ConfirmCard button calls the registered command", async () => {
    const { handled, surface, router } = await setup({ decision: "allow" });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<A2uiSurface surface={surface} registry={protoRegistry} />));
    const button = host.querySelector('[data-a2ui="ConfirmCard"] button') as HTMLButtonElement;
    expect(button.textContent).toBe("Delete");
    await act(async () => button.click());
    await vi.waitFor(() => expect(router.log.at(-1)?.outcome).toBe("ran"));
    expect(handled).toHaveBeenCalledWith({ title: "Delete 3 files?" });
    root.unmount();
  });

  it("Allow: an agent surface's event runs the command", async () => {
    const { handled, policy, surface, router } = await setup({ decision: "allow" });
    await emitComponentEvent(surface, "card", "confirm", { title: "Delete 3 files?" });
    await vi.waitFor(() => expect(router.log.at(-1)?.outcome).toBe("ran"));
    expect(policy).toHaveBeenCalledWith(
      expect.objectContaining({ commandKey: "proto:confirm", surfaceId: "confirm-delete" }),
    );
    expect(handled).toHaveBeenCalledTimes(1);
  });

  it("Ask: waits for the approval callback before running", async () => {
    let resolveApproval: (ok: boolean) => void = () => {};
    const approve = vi.fn(() => new Promise<boolean>((r) => (resolveApproval = r)));
    const { handled, surface, router } = await setup({ decision: "ask", approve });
    await emitComponentEvent(surface, "card", "confirm", { title: "Delete 3 files?" });
    await vi.waitFor(() => expect(approve).toHaveBeenCalled());
    expect(router.log.at(-1)?.outcome).toBe("asking");
    expect(handled).not.toHaveBeenCalled();
    resolveApproval(true);
    await vi.waitFor(() => expect(router.log.at(-1)?.outcome).toBe("ran"));
    expect(handled).toHaveBeenCalledTimes(1);
  });

  it("Ask: a denied approval refuses the command", async () => {
    const { handled, surface, router } = await setup({
      decision: "ask",
      approve: async () => false,
    });
    await emitComponentEvent(surface, "card", "confirm", { title: "Delete 3 files?" });
    await vi.waitFor(() => expect(router.log.at(-1)?.outcome).toBe("denied"));
    expect(handled).not.toHaveBeenCalled();
  });

  it("Block: the command is refused without asking", async () => {
    const approve = vi.fn(async () => true);
    const { handled, surface, router } = await setup({ decision: "block", approve });
    await emitComponentEvent(surface, "card", "confirm", { title: "Delete 3 files?" });
    await vi.waitFor(() => expect(router.log.at(-1)?.outcome).toBe("blocked"));
    expect(handled).not.toHaveBeenCalled();
    expect(approve).not.toHaveBeenCalled();
  });

  it("a user-originated surface skips the agent policy", async () => {
    const { handled, policy, surface, router } = await setup({ decision: "block", agent: false });
    await emitComponentEvent(surface, "card", "confirm", { title: "Delete 3 files?" });
    await vi.waitFor(() => expect(router.log.at(-1)?.outcome).toBe("ran"));
    expect(policy).not.toHaveBeenCalled();
    expect(handled).toHaveBeenCalledTimes(1);
  });

  it("an agent cannot spoof a mapped event from a component that does not declare it", async () => {
    const { handled, surface, router } = await setup({ decision: "allow" });
    // A basic Button whose agent-authored action is named "confirm".
    await surface.dispatchAction(
      { event: { name: "confirm", context: { title: "Delete 3 files?" } } },
      "intro",
    );
    await vi.waitFor(() => expect(router.log.at(-1)?.outcome).toBe("unrouted"));
    expect(handled).not.toHaveBeenCalled();
  });

  it("an event payload that fails the component's event schema is rejected", async () => {
    const { handled, surface, router } = await setup({ decision: "allow" });
    await emitComponentEvent(surface, "card", "confirm", { title: 42 });
    await vi.waitFor(() => expect(router.log.at(-1)?.outcome).toBe("invalid"));
    expect(handled).not.toHaveBeenCalled();
  });
});
