import { describe, expect, it, vi } from "vitest";
import type { UrlSerializer } from "../src/url-state-view.js";
import { UrlStateView } from "../src/url-state-view.js";

describe("UrlStateView", () => {
  it("registers and disposes serializers", () => {
    const view = new UrlStateView();
    const serializer: UrlSerializer = {
      serialize: (s) => ({ ...s, query: { ...s.query, foo: "bar" } }),
      deserialize: () => {},
    };

    const dispose = view.register(serializer);
    expect(view.buildState()).toEqual({ path: "", query: { foo: "bar" } });

    dispose();
    expect(view.buildState()).toEqual({ path: "", query: {} });
  });

  it("runs serializers in registration order", () => {
    const view = new UrlStateView();
    view.register({
      serialize: (s) => ({ ...s, path: "/a" }),
      deserialize: () => {},
    });
    view.register({
      serialize: (s) => ({ ...s, path: `${s.path}/b` }),
      deserialize: () => {},
    });

    expect(view.buildState().path).toBe("/a/b");
  });

  it("sync() calls notify()", () => {
    const view = new UrlStateView();
    const listener = vi.fn();
    view.onUpdate(listener);

    view.sync();
    expect(listener).toHaveBeenCalledOnce();
  });

  it("sync() prevents re-entrant sync", () => {
    const view = new UrlStateView();
    let reentrantCalled = false;

    view.onUpdate(() => {
      if (!reentrantCalled) {
        reentrantCalled = true;
        view.sync();
      }
    });

    view.sync();
    expect(reentrantCalled).toBe(true);
  });

  it("applyUrl() runs deserializers", () => {
    const view = new UrlStateView();
    const deserializeFn = vi.fn();
    view.register({
      serialize: (s) => s,
      deserialize: deserializeFn,
    });

    view.applyUrl({ path: "/chat", query: { id: "123" } });
    expect(deserializeFn).toHaveBeenCalledWith({
      path: "/chat",
      query: { id: "123" },
    });
  });

  it("applyUrl() is blocked during sync() (loop prevention)", () => {
    const view = new UrlStateView();
    const deserializeFn = vi.fn();
    view.register({
      serialize: (s) => s,
      deserialize: deserializeFn,
    });

    view.onUpdate(() => {
      view.applyUrl({ path: "/x", query: {} });
    });

    view.sync();
    expect(deserializeFn).not.toHaveBeenCalled();
  });

  it("sync() is blocked during applyUrl() (reverse loop prevention)", () => {
    const view = new UrlStateView();
    const listener = vi.fn();

    view.register({
      serialize: (s) => s,
      deserialize: () => {
        view.sync();
      },
    });

    view.onUpdate(listener);
    view.applyUrl({ path: "/", query: {} });
    expect(listener).not.toHaveBeenCalled();
  });
});
