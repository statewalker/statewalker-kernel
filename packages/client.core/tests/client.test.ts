// The client API as a fragment's client half sees it: one module whose bindings the host installs.
import { afterEach, describe, expect, it } from "vitest";
import {
  ClientApiError,
  type ClientCommands,
  type ClientL10n,
  type ClientSettings,
  commands,
  dialogs,
  type HostServices,
  host,
  installClient,
  l10n,
  notifications,
  settings,
  translator,
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

describe("settings", () => {
  /** The host's settings: one value per fragment namespace. */
  function fakeSettings(): ClientSettings {
    const values: Record<string, Record<string, string | number | boolean>> = {
      "org.example.notes": { sort: "added" },
      "org.example.other": { sort: "theirs" },
    };
    return {
      of: (fragment) => ({
        values: () => ({ ...values[fragment] }),
        get: (key) => values[fragment]?.[key],
        set(key, value) {
          values[fragment] = { ...values[fragment], [key]: value as string };
        },
        reset(key) {
          if (key) delete values[fragment]?.[key];
          else values[fragment] = {};
        },
        observe(listener) {
          listener({ ...values[fragment] });
          return () => {};
        },
      }),
    };
  }

  it("are refused before the install, and when the host installed none", () => {
    expect(() => settings.of("org.example.notes").values()).toThrow(ClientApiError);
    uninstall = installClient({ commands: fakeBus() });
    expect(() => settings.of("org.example.notes").get("sort")).toThrow(ClientApiError);
    expect(() => settings.of("org.example.notes").observe(() => {})).toThrow(ClientApiError);
  });

  it("reach the host's settings, in the fragment's namespace", () => {
    uninstall = installClient({ commands: fakeBus(), settings: fakeSettings() });
    const mine = settings.of("org.example.notes");
    expect(mine.get("sort")).toBe("added");
    mine.set("sort", "alphabetical");
    expect(mine.values()).toEqual({ sort: "alphabetical" });
    expect(settings.of("org.example.other").get("sort")).toBe("theirs");
    const seen: unknown[] = [];
    mine.observe((values) => seen.push(values.sort));
    mine.reset("sort");
    expect(mine.get("sort")).toBeUndefined();
    expect(seen).toEqual(["alphabetical"]);
  });
});

/** An l10n model with a French bundle for one namespace, recording what is asked. */
function fakeL10n(): ClientL10n {
  let locale = "en";
  const listeners = new Set<(s: { locale: string; locales: readonly string[] }) => void>();
  const fr: Record<string, string> = { "org.example.notes\nview.add": "Ajouter {n}" };
  const fill = (text: string, params: Record<string, unknown> = {}) =>
    text.replace(/\{(\w+)\}/g, (w, k: string) => (params[k] === undefined ? w : String(params[k])));
  const state = () => ({ locale, locales: ["en", "fr"] });
  return {
    locale: () => locale,
    locales: () => ["en", "fr"],
    setLocale(next) {
      locale = next;
      for (const l of listeners) l(state());
    },
    text(namespace, key, options = {}) {
      const found = locale === "fr" ? fr[`${namespace}\n${key}`] : undefined;
      return fill(found ?? options.fallback ?? key, options.params);
    },
    format: (text, params) => fill(text, params),
    observe(listener) {
      listeners.add(listener);
      listener(state());
      return () => listeners.delete(listener);
    },
  };
}

describe("the client API's l10n", () => {
  it("refuses before the host installs it", () => {
    uninstall = installClient({ commands: fakeBus() });
    expect(() => l10n.locale()).toThrow(ClientApiError);
    expect(() => translator("org.example.notes")("view.add")).toThrow(ClientApiError);
  });

  it("gives a fragment's texts in the interface language and follows its changes", () => {
    uninstall = installClient({ commands: fakeBus(), l10n: fakeL10n() });
    const t = translator("org.example.notes");
    expect(t("view.add", { n: 2 }, "Add {n}")).toBe("Add 2");
    const seen: string[] = [];
    const stop = l10n.observe((s) => seen.push(s.locale));
    l10n.setLocale("fr");
    expect(l10n.locale()).toBe("fr");
    expect(t("view.add", { n: 2 }, "Add {n}")).toBe("Ajouter 2");
    expect(t("view.other")).toBe("view.other");
    expect(l10n.locales()).toEqual(["en", "fr"]);
    expect(l10n.format("{a}", { a: 1 })).toBe("1");
    stop();
    expect(seen).toEqual(["en", "fr"]);
  });
});
