import { GitWorkingCopyConfig } from "@statewalker/vcs-store-files";
import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { describe, expect, it } from "vitest";
import { configFilesOf } from "../../src/adapters/config-files.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function readText(files: MemFilesApi, path: string): Promise<string> {
  let text = "";
  for await (const chunk of files.read(path)) text += decoder.decode(chunk, { stream: true });
  return text + decoder.decode();
}

describe("configFilesOf", () => {
  it("reports a missing file as undefined, not as an empty buffer", async () => {
    // `FilesApi.read` yields nothing for a path that does not exist, so a shim that
    // only collected chunks would hand `GitWorkingCopyConfig.load()` an empty
    // `Uint8Array` — which is truthy, so it would parse "" as a config instead of
    // returning early. The distinction only shows up here.
    const files = new MemFilesApi();
    expect(await configFilesOf(files).read("/nope")).toBeUndefined();
  });

  it("collects a streamed read into one buffer", async () => {
    const files = new MemFilesApi();
    await files.write("/a.txt", [encoder.encode("one "), encoder.encode("two")]);
    expect(decoder.decode(await configFilesOf(files).read("/a.txt"))).toBe("one two");
  });

  it("writes a single buffer through the chunk-iterable FilesApi", async () => {
    const files = new MemFilesApi();
    await configFilesOf(files).write("/deep/b.txt", encoder.encode("hello"));
    expect(await readText(files, "/deep/b.txt")).toBe("hello");
  });

  it("is what makes GitWorkingCopyConfig constructible over a FilesApi", async () => {
    const files = new MemFilesApi();
    const config = new GitWorkingCopyConfig(configFilesOf(files), ".git/config");
    await config.load(); // no file yet — must not throw
    config.set("remote.origin.url", "http://git.test/demo.git");
    await config.save();

    expect(await readText(files, "/.git/config")).toBe(
      '[remote "origin"]\n\turl = http://git.test/demo.git\n',
    );
  });
});

describe("configFilesOf — a directory is not an empty file", () => {
  it("reports `undefined`, so GitWorkingCopyConfig.load() short-circuits", async () => {
    // `tryReadFile` gates on `exists()`, which is TRUE for a directory, and then
    // collects zero chunks — a truthy `Uint8Array(0)`. `load()`'s `if (!content)
    // return` then failed to fire and the next write assembled a config from
    // nothing. The undefined-vs-empty distinction this shim exists for got the
    // MISSING case right and this one wrong.
    const files = new MemFilesApi();
    await files.mkdir("/.git/config");

    expect(await configFilesOf(files).read(".git/config")).toBeUndefined();
  });
});
