import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { describe, expect, it } from "vitest";
import { JsonPerKeyStore } from "./json-per-key-store.js";

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("JsonPerKeyStore", () => {
  it("encodes keys so on-disk filenames are filesystem-safe", async () => {
    const files = new MemFilesApi();
    const store = new JsonPerKeyStore(files, "secrets");

    await store.set("ai:provider:openai", "sk-test");
    const entries: string[] = [];
    for await (const entry of files.list("/secrets")) entries.push(entry.path);
    expect(entries).toHaveLength(1);
    const filename = entries[0] ?? "";
    expect(filename).toContain("ai%3Aprovider%3Aopenai");
    expect(filename.endsWith(".json")).toBe(true);
  });

  it("list decodes keys and delete removes the backing file", async () => {
    const files = new MemFilesApi();
    const store = new JsonPerKeyStore(files, "secrets");

    await store.set("ai:provider:openai", "a");
    await store.set("ai:provider:anthropic", "b");
    await store.set("workspace:last-handle", { token: "opaque" });

    expect((await store.list()).sort()).toEqual([
      "ai:provider:anthropic",
      "ai:provider:openai",
      "workspace:last-handle",
    ]);

    expect(await store.delete("ai:provider:anthropic")).toBe(true);
    expect(await store.get("ai:provider:anthropic")).toBeUndefined();
  });

  it("unsubscribing onUpdate stops further notifications", async () => {
    const files = new MemFilesApi();
    const store = new JsonPerKeyStore(files, "secrets");

    const calls: string[][] = [];
    const unsubscribe = store.onUpdate((keys) => calls.push([...keys]));

    await store.set("a", 1);
    await flushMicrotasks();
    expect(calls).toHaveLength(1);

    unsubscribe();
    await store.set("b", 2);
    await flushMicrotasks();
    expect(calls).toHaveLength(1);
  });
});
