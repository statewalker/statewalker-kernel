// The client API as a fragment's client half sees it: one module whose bindings the host installs.
import { afterEach, describe, expect, it } from "vitest";
import {
  ClientApiError,
  type ClientCommands,
  commands,
  dialogs,
  type HostServices,
  host,
  installClient,
  notifications,
  type UrlState,
} from "../src/index.js";

function fakeBus(): ClientCommands & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  const listed = [{ id: "org.example.notes/add-note" }];
  return {
    calls,
    async call<T>(id: string, input?: unknown) {
      calls.push([id, input]);
      return { ok: id } as T;
    },
    list: () => listed,
    observe(listener) {
      listener(listed);
      return () => {};
    },
  };
}

let uninstall: (() => void) | undefined;
afterEach(() => {
  uninstall?.();
  uninstall = undefined;
});

describe("the client API", () => {
  it("refuses every call until the host installs it", async () => {
    await expect(commands.call("org.example.notes/add-note")).rejects.toBeInstanceOf(
      ClientApiError,
    );
    expect(() => commands.list()).toThrow(ClientApiError);
    expect(() => commands.observe(() => {})).toThrow(ClientApiError);
  });

  it("reaches the host's command bus once installed", async () => {
    const bus = fakeBus();
    uninstall = installClient({ commands: bus });
    await expect(commands.call("org.example.notes/add-note", { text: "a" })).resolves.toEqual({
      ok: "org.example.notes/add-note",
    });
    expect(bus.calls).toEqual([["org.example.notes/add-note", { text: "a" }]]);
    expect(commands.list().map((c) => c.id)).toEqual(["org.example.notes/add-note"]);
    const seen: string[][] = [];
    commands.observe((all) => seen.push(all.map((c) => c.id)));
    expect(seen).toEqual([["org.example.notes/add-note"]]);
  });

  it("takes one host at a time", () => {
    uninstall = installClient({ commands: fakeBus() });
    expect(() => installClient({ commands: fakeBus() })).toThrow(ClientApiError);
    uninstall();
    uninstall = installClient({ commands: fakeBus() });
    expect(commands.list()).toHaveLength(1);
  });
});

/** Host services recording what fragments ask of them. */
function fakeHost(): HostServices & { log: unknown[][] } {
  const log: unknown[][] = [];
  let url: UrlState = { path: "", query: {} };
  const listeners = new Set<(state: UrlState) => void>();
  return {
    log,
    clipboard: {
      async writeText(text) {
        log.push(["writeText", text]);
      },
      readText: async () => "pasted",
    },
    files: {
      async pickFile(options) {
        log.push(["pickFile", options]);
        return { blobs: [], names: [] };
      },
    },
    urlState: {
      read: async () => url,
      async write(state) {
        url = state;
        for (const listener of listeners) listener(state);
      },
      observe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  };
}

describe("host services through the client API", () => {
  it("refuses every call until the host installs them", async () => {
    await expect(host.clipboard.writeText("a")).rejects.toBeInstanceOf(ClientApiError);
    uninstall = installClient({ commands: fakeBus() });
    await expect(host.urlState.read()).rejects.toBeInstanceOf(ClientApiError);
    expect(() => host.urlState.observe(() => {})).toThrow(ClientApiError);
  });

  it("reaches the host's clipboard, file pickers and URL state once installed", async () => {
    const services = fakeHost();
    uninstall = installClient({ commands: fakeBus(), host: services });
    await host.clipboard.writeText("Buy milk");
    await expect(host.clipboard.readText()).resolves.toBe("pasted");
    await expect(host.files.pickFile({ accept: [".md"] })).resolves.toEqual({
      blobs: [],
      names: [],
    });
    const seen: UrlState[] = [];
    const stop = host.urlState.observe((state) => seen.push(state));
    await host.urlState.write({ path: "/notes", query: { views: "a" } });
    stop();
    await host.urlState.write({ path: "/", query: {} });
    await expect(host.urlState.read()).resolves.toEqual({ path: "/", query: {} });
    expect(seen).toEqual([{ path: "/notes", query: { views: "a" } }]);
    expect(services.log).toEqual([
      ["writeText", "Buy milk"],
      ["pickFile", { accept: [".md"] }],
    ]);
  });
});

describe("dialogs and notifications", () => {
  it("are refused before the install, and when the host installed no workbench", async () => {
    await expect(dialogs.show("org.example.notes/new-note")).rejects.toMatchObject({
      kind: "not-installed",
    });
    uninstall = installClient({ commands: fakeBus() });
    await expect(dialogs.show("org.example.notes/new-note")).rejects.toMatchObject({
      kind: "not-installed",
    });
    await expect(notifications.show("org.example.notes/saved")).rejects.toBeInstanceOf(
      ClientApiError,
    );
  });

  it("reach the host's workbench and return the user's answer", async () => {
    const raised: unknown[][] = [];
    uninstall = installClient({
      commands: fakeBus(),
      dialogs: {
        async show(id, params) {
          raised.push(["dialog", id, params]);
          return { action: "add", value: "Milk" };
        },
      },
      notifications: {
        async show(id, params) {
          raised.push(["notification", id, params]);
          return { action: "undo" };
        },
      },
    });
    await expect(dialogs.show("org.example.notes/new-note", { who: "you" })).resolves.toEqual({
      action: "add",
      value: "Milk",
    });
    await expect(notifications.show("org.example.notes/saved")).resolves.toEqual({
      action: "undo",
    });
    expect(raised).toEqual([
      ["dialog", "org.example.notes/new-note", { who: "you" }],
      ["notification", "org.example.notes/saved", undefined],
    ]);
  });
});
