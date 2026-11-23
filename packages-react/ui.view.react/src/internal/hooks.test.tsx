import { BaseClass } from "@statewalker/shared-baseclass";
import { defineSlot, Slots } from "@statewalker/shared-slots";
import { Workspace } from "@statewalker/workspace.core";
import { act, render, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { AppWorkspaceProvider, useAppWorkspace } from "./app-workspace-provider.js";
import { useAdapter } from "./use-adapter.js";
import { useAdapterValue } from "./use-adapter-value.js";
import { useSlot } from "./use-slot.js";

// A minimal real observable adapter (BaseClass gives onUpdate/notify).
// Self-hosted: the class is both the adapter token and its impl.
class CounterAdapter extends BaseClass {
  count = 0;
  increment(): void {
    this.count += 1;
    this.notify();
  }
  // Adapters are WorkspaceAdapter (an all-optional, "weak" type): share a member with it.
  close(): void {}
}

function wrapperFor(ws: Workspace) {
  return ({ children }: { children: ReactNode }) => (
    <AppWorkspaceProvider workspace={ws}>{children}</AppWorkspaceProvider>
  );
}

describe("useAppWorkspace", () => {
  it("returns the workspace provided by AppWorkspaceProvider", () => {
    const ws = new Workspace();
    const { result } = renderHook(() => useAppWorkspace(), {
      wrapper: wrapperFor(ws),
    });
    expect(result.current).toBe(ws);
  });

  it("throws when used outside an AppWorkspaceProvider", () => {
    function Probe() {
      useAppWorkspace();
      return null;
    }
    expect(() => render(<Probe />)).toThrow(/must be used inside/i);
  });
});

describe("useAdapter", () => {
  it("resolves the same adapter instance as workspace.requireAdapter", () => {
    const ws = new Workspace();
    const { result } = renderHook(() => useAdapter(Slots), {
      wrapper: wrapperFor(ws),
    });
    expect(result.current).toBe(ws.requireAdapter(Slots));
  });

  it("self-hosts a class-keyed adapter and caches it (stable identity)", () => {
    const ws = new Workspace();
    const { result, rerender } = renderHook(() => useAdapter(CounterAdapter), {
      wrapper: wrapperFor(ws),
    });
    const first = result.current;
    expect(first).toBeInstanceOf(CounterAdapter);
    rerender();
    expect(result.current).toBe(first);
    // same instance the workspace hands out directly
    expect(first).toBe(ws.requireAdapter(CounterAdapter));
  });
});

describe("useAdapterValue", () => {
  it("returns the current selected value", () => {
    const ws = new Workspace();
    const counter = ws.requireAdapter(CounterAdapter);
    counter.count = 7;
    const { result } = renderHook(() => useAdapterValue(CounterAdapter, (c) => c.count), {
      wrapper: wrapperFor(ws),
    });
    expect(result.current).toBe(7);
  });

  it("re-renders with the new value when the adapter notifies", () => {
    const ws = new Workspace();
    const counter = ws.requireAdapter(CounterAdapter);
    const { result } = renderHook(() => useAdapterValue(CounterAdapter, (c) => c.count), {
      wrapper: wrapperFor(ws),
    });
    expect(result.current).toBe(0);
    act(() => {
      counter.increment();
    });
    expect(result.current).toBe(1);
  });

  it("does not change the returned value when an unrelated notify keeps the selection equal", () => {
    const ws = new Workspace();
    const counter = ws.requireAdapter(CounterAdapter);
    let renders = 0;
    const { result } = renderHook(
      () => {
        renders += 1;
        return useAdapterValue(CounterAdapter, () => "constant");
      },
      { wrapper: wrapperFor(ws) },
    );
    const rendersAfterMount = renders;
    act(() => {
      counter.notify();
    });
    // Object.is snapshot equality bails out: value unchanged, no extra commit re-render.
    expect(result.current).toBe("constant");
    expect(renders).toBe(rendersAfterMount);
  });
});

describe("useSlot", () => {
  const numbersSlot = defineSlot<number>("test:numbers");

  it("returns the current plain-slot contributions", () => {
    const slots = new Slots();
    slots.provide(numbersSlot, 1);
    slots.provide(numbersSlot, 2);
    const { result } = renderHook(() => useSlot(slots, numbersSlot));
    expect([...result.current].sort()).toEqual([1, 2]);
  });

  it("re-renders when a contribution is added, then removed", () => {
    const slots = new Slots();
    const { result } = renderHook(() => useSlot(slots, numbersSlot));
    expect(result.current).toEqual([]);

    let dispose: () => void = () => {};
    act(() => {
      dispose = slots.provide(numbersSlot, 42);
    });
    expect(result.current).toEqual([42]);

    act(() => {
      dispose();
    });
    expect(result.current).toEqual([]);
  });

  it("returns a referentially stable snapshot across renders with no slot change", () => {
    const slots = new Slots();
    slots.provide(numbersSlot, 5);
    const { result, rerender } = renderHook(() => useSlot(slots, numbersSlot));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});

describe("AppWorkspaceProvider (probe child)", () => {
  it("makes the workspace + adapters reachable from a mounted child", () => {
    const ws = new Workspace();
    let seen: Workspace | null = null;
    let seenSlots: Slots | null = null;
    function Probe() {
      seen = useAppWorkspace();
      seenSlots = useAdapter(Slots);
      return <span>probe</span>;
    }
    const { getByText } = render(
      <AppWorkspaceProvider workspace={ws}>
        <Probe />
      </AppWorkspaceProvider>,
    );
    expect(getByText("probe")).toBeTruthy();
    expect(seen).toBe(ws);
    expect(seenSlots).toBe(ws.requireAdapter(Slots));
  });
});
