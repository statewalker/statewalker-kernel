import type { FilesApi } from "@statewalker/webrun-files";
import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { type Project, Workspace } from "@statewalker/workspace.core";
import { beforeEach, describe, expect, it } from "vitest";
import {
  VCS_NATURE_FILE,
  type VcsConfigData,
  VcsConfiguration,
  vcsConfigOf,
} from "../../src/config/vcs-config.js";

const decoder = new TextDecoder();

async function readText(files: FilesApi, path: string): Promise<string> {
  let text = "";
  for await (const chunk of files.read(path)) text += decoder.decode(chunk, { stream: true });
  return text + decoder.decode();
}

/** Data that only an untyped caller (or a hand-edited file) could produce. The
 * TypeScript excess-property check is compile-time only and never sees it — which
 * is exactly why `write()` carries a runtime allowlist. */
function untyped(value: unknown): VcsConfigData {
  return value as VcsConfigData;
}

describe("VcsConfiguration", () => {
  let files: MemFilesApi;
  let workspace: Workspace;
  let project: Project;
  let config: VcsConfiguration;

  beforeEach(async () => {
    files = new MemFilesApi({ initialFiles: { "a/README.md": "project a" } });
    workspace = new Workspace().setFileSystem(files);
    const found = await workspace.getProject("a");
    if (!found) throw new Error("no project: a");
    project = found;
    config = new VcsConfiguration(project);
  });

  describe("load / write / data", () => {
    it("does not exist and fails to load before the nature is materialized", async () => {
      expect(await config.exists()).toBe(false);
      await expect(config.load()).rejects.toThrow(/nature\.vcs\.json/);
    });

    it("throws from the `data` getter before load() (load-before-sync-getters)", () => {
      expect(() => config.data).toThrow(/not loaded/);
    });

    it("round-trips through the project system folder", async () => {
      await config.write({ version: 1, defaultRemote: "origin" });

      // The file is the marker: `<project>/.project/nature.vcs.json`.
      const path = `/a/.project/${VCS_NATURE_FILE}`;
      expect(await files.exists(path)).toBe(true);
      expect(JSON.parse(await readText(files, path))).toEqual({
        version: 1,
        defaultRemote: "origin",
      });

      // Same instance: cached by write(). Fresh instance: read back from disk.
      expect(config.data).toEqual({ version: 1, defaultRemote: "origin" });
      const reopened = new VcsConfiguration(project);
      expect(await reopened.exists()).toBe(true);
      await reopened.load();
      expect(reopened.data).toEqual({ version: 1, defaultRemote: "origin" });
    });

    it("leaves no temp files behind (atomic write)", async () => {
      await config.write({ version: 1 });
      const names: string[] = [];
      for await (const entry of files.list("/a/.project")) names.push(entry.name);
      expect(names).toEqual([VCS_NATURE_FILE]);
    });

    it("keeps the previous file and leaves no debris when the rename fails", async () => {
      // The whole point of the temp-then-rename dance: a failed write must not
      // half-replace the marker. Asserting "one entry in the directory" after a
      // SUCCESSFUL write is equally true of a plain `writeText`, which is why that
      // assertion alone left this entire path untested.
      await config.write({ version: 1, defaultRemote: "origin" });
      const path = `/a/.project/${VCS_NATURE_FILE}`;

      const failingRename = new Proxy(files, {
        get(target, prop, receiver) {
          if (prop === "move") return async () => false;
          const value = Reflect.get(target, prop, target) as unknown;
          if (typeof value !== "function") return Reflect.get(target, prop, receiver);
          return (...args: unknown[]) =>
            (value as (...a: unknown[]) => unknown).apply(target, args);
        },
      }) as MemFilesApi;
      const stuck = new VcsConfiguration(
        (await new Workspace().setFileSystem(failingRename).getProject("a")) as Project,
      );

      await expect(stuck.write({ version: 1, defaultRemote: "replacement" })).rejects.toThrow(
        /failed to rename/,
      );

      // The previous marker is intact, byte for byte …
      expect(JSON.parse(await readText(files, path))).toEqual({
        version: 1,
        defaultRemote: "origin",
      });
      // … and the temp file was cleaned up rather than left beside it.
      const names: string[] = [];
      for await (const entry of files.list("/a/.project")) names.push(entry.name);
      expect(names).toEqual([VCS_NATURE_FILE]);
    });

    it("gives concurrent writers distinct temp paths", async () => {
      // Two tabs, or the CLI and the app, over one folder. A constant `${path}.tmp`
      // would have them clobber each other's temp file and race the rename — the
      // one thing a collision-safe name exists to prevent, and nothing observed it.
      const written: string[] = [];
      const recording = new Proxy(files, {
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, target) as unknown;
          if (typeof value !== "function") return Reflect.get(target, prop, receiver);
          return (...args: unknown[]) => {
            if (prop === "write" && typeof args[0] === "string" && args[0].endsWith(".tmp")) {
              written.push(args[0]);
            }
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        },
      }) as MemFilesApi;
      const workspace2 = new Workspace().setFileSystem(recording);
      const found = await workspace2.getProject("a");
      if (!found) throw new Error("no project: a");

      await Promise.all([
        new VcsConfiguration(found).write({ version: 1, defaultRemote: "one" }),
        new VcsConfiguration(found).write({ version: 1, defaultRemote: "two" }),
      ]);

      expect(written).toHaveLength(2);
      expect(new Set(written).size).toBe(2);
    });

    it("is idempotent to load() and reflects the latest write()", async () => {
      await config.write({ version: 1 });
      await config.load();
      await config.write({ version: 1, defaultRemote: "upstream" });
      expect((await config.load()).data.defaultRemote).toBe("upstream");
    });
  });

  describe("closed-schema validation", () => {
    it("accepts every declared key", async () => {
      await config.write({
        version: 1,
        defaultRemote: "origin",
        author: { name: "Ada", email: "ada@example.com" },
      });
      expect(config.data.author).toEqual({ name: "Ada", email: "ada@example.com" });
    });

    it("rejects an undeclared top-level key, naming it", async () => {
      await expect(config.write(untyped({ version: 1, token: "ghp_live" }))).rejects.toThrow(
        /token/,
      );
    });

    it("rejects an undeclared key whatever it is called", async () => {
      // The point of a closed schema over a name heuristic: an innocuous-looking
      // key carrying a credential is refused just the same.
      await expect(config.write(untyped({ version: 1, o: "ghp_live_token" }))).rejects.toThrow(
        /unknown/i,
      );
    });

    it("rejects an undeclared key nested inside `author`", async () => {
      await expect(
        config.write(
          untyped({ version: 1, author: { name: "Ada", email: "a@e.com", password: "s3cret" } }),
        ),
      ).rejects.toThrow(/password/);
    });

    it("rejects a declared key of the wrong type", async () => {
      await expect(config.write(untyped({ version: 1, defaultRemote: 7 }))).rejects.toThrow(
        /defaultRemote/,
      );
      await expect(config.write(untyped({ version: 1, author: "Ada" }))).rejects.toThrow(/author/);
      await expect(config.write(untyped({ version: 1, author: { name: "Ada" } }))).rejects.toThrow(
        /email/,
      );
    });

    it("requires `version: 1`", async () => {
      await expect(config.write(untyped({}))).rejects.toThrow(/version/);
      await expect(config.write(untyped({ version: 2 }))).rejects.toThrow(/version/);
    });

    it("rejects a non-object argument", async () => {
      await expect(config.write(untyped(null))).rejects.toThrow(/object/);
      await expect(config.write(untyped("version=1"))).rejects.toThrow(/object/);
    });

    it("writes nothing and caches nothing when validation fails", async () => {
      await expect(config.write(untyped({ version: 1, token: "ghp_live" }))).rejects.toThrow();
      expect(await files.exists(`/a/.project/${VCS_NATURE_FILE}`)).toBe(false);
      expect(await config.exists()).toBe(false);
      expect(() => config.data).toThrow(/not loaded/);
    });
  });

  describe("vcsConfigOf", () => {
    it("resolves the project-hosted adapter, memoised per project", async () => {
      const resolved = vcsConfigOf(project);
      expect(resolved).toBeInstanceOf(VcsConfiguration);
      expect(vcsConfigOf(project)).toBe(resolved);

      // It is the same handle the project itself resolves — so a write through it
      // is visible to any other holder of the project.
      await resolved.write({ version: 1 });
      expect(await vcsConfigOf(project).exists()).toBe(true);
    });
  });
});
