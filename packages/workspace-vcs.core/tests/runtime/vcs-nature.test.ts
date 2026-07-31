import type { FilesApi } from "@statewalker/webrun-files";
import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { type Project, Workspace } from "@statewalker/workspace.core";
import { beforeEach, describe, expect, it } from "vitest";
import { VcsConfiguration, vcsConfigOf } from "../../src/config/index.js";
import { registerVcs, VcsNature, vcsNatureOf } from "../../src/runtime/vcs-nature.js";

const decoder = new TextDecoder();
const encoder = new TextEncoder();

async function readText(files: FilesApi, path: string): Promise<string> {
  let text = "";
  for await (const chunk of files.read(path)) text += decoder.decode(chunk, { stream: true });
  return text + decoder.decode();
}

/** A `fetch` that must never be called — its presence is the point, not its behaviour. */
const deps = {
  fetch: (() => {
    throw new Error("fetch must not be called by T4");
  }) as never,
};

describe("VcsNature", () => {
  let files: MemFilesApi;
  let workspace: Workspace;

  beforeEach(() => {
    files = new MemFilesApi({
      initialFiles: { "a/README.md": "project a", "b/README.md": "project b" },
    });
    workspace = new Workspace().setFileSystem(files);
    registerVcs(workspace, deps);
  });

  async function projectOf(name: string): Promise<Project> {
    const project = await workspace.getProject(name);
    if (!project) throw new Error(`no project: ${name}`);
    return project;
  }

  describe("exists() / init()", () => {
    it("is false on a bare project and true once init() has laid down a real .git", async () => {
      const nature = vcsNatureOf(await projectOf("a"));
      expect(await nature.exists()).toBe(false);

      await nature.init();

      expect(await nature.exists()).toBe(true);
      // The predicate and the on-disk fact are the same thing: `.git/HEAD` under the
      // project path. Not `.git/`, and emphatically not `.git/index` — the staging
      // store writes that with no repository behind it.
      expect(await files.exists("/a/.git/HEAD")).toBe(true);
      expect(await readText(files, "/a/.git/HEAD")).toBe("ref: refs/heads/main\n");
    });

    it("puts the repository inside the project, invisibly to a sibling", async () => {
      await vcsNatureOf(await projectOf("a")).init();

      expect(await files.exists("/a/.git/HEAD")).toBe(true);
      expect(await files.exists("/.git/HEAD")).toBe(false);
      expect(await files.exists("/b/.git/HEAD")).toBe(false);
      expect(await vcsNatureOf(await projectOf("b")).exists()).toBe(false);
    });

    it("gives two projects wholly independent repositories", async () => {
      const a = vcsNatureOf(await projectOf("a"));
      const b = vcsNatureOf(await projectOf("b"));
      await a.init();
      await b.init();

      const gitA = await a.git();
      const gitB = await b.git();
      expect(gitA).not.toBe(gitB);

      await gitA.add().addFilepattern("README.md").call();
      const first = await gitA
        .commit()
        .setMessage("a only")
        .setAuthor("Test", "test@example.com")
        .call();

      // `b` saw none of it: its branch does not exist yet, so it has no HEAD commit
      // to resolve at all.
      expect(await files.exists("/b/.git/refs/heads/main")).toBe(false);
      await expect(gitB.log().call()).rejects.toThrow(/HEAD cannot be resolved/);

      await gitB.add().addFilepattern("README.md").call();
      const second = await gitB
        .commit()
        .setMessage("b only")
        .setAuthor("Test", "test@example.com")
        .call();

      // Two histories, two branch refs, no overlap — `README.md` differs per project
      // so even the trees are distinct.
      expect(second.id).not.toBe(first.id);
      expect((await readText(files, "/a/.git/refs/heads/main")).trim()).toBe(first.id);
      expect((await readText(files, "/b/.git/refs/heads/main")).trim()).toBe(second.id);

      const logA = [];
      for await (const c of await gitA.log().call()) logA.push(c);
      const logB = [];
      for await (const c of await gitB.log().call()) logB.push(c);
      expect(logA.map((c) => c.message)).toEqual(["a only"]);
      expect(logB.map((c) => c.message)).toEqual(["b only"]);
    });

    it("memoises the Git handle per adapter instance", async () => {
      const nature = vcsNatureOf(await projectOf("a"));
      await nature.init();
      expect(await nature.git()).toBe(await nature.git());
    });

    it("does not poison the memo when opening the repository fails once", async () => {
      // A filesystem that fails exactly the next call and is healthy after it. The
      // memo stores the in-flight promise before it settles, so a rejection that is
      // never cleared would make one transient EIO permanent for the whole cached
      // lifetime of the adapter — and adapters are cached on the Project, which is
      // cached on the Workspace.
      let failNext = false;
      const flaky = new Proxy(files, {
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, target) as unknown;
          if (typeof value !== "function") return Reflect.get(target, prop, receiver);
          return (...args: unknown[]) => {
            if (failNext) {
              failNext = false;
              throw new Error("EIO: simulated transient failure");
            }
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        },
      }) as MemFilesApi;

      const flakyWorkspace = new Workspace().setFileSystem(flaky);
      registerVcs(flakyWorkspace, deps);
      const project = await flakyWorkspace.getProject("a");
      if (!project) throw new Error("no project: a");
      const nature = vcsNatureOf(project);

      failNext = true;
      await expect(nature.git()).rejects.toThrow(/simulated transient failure/);

      // The filesystem is healthy again; the same adapter must be able to open.
      await expect(nature.git()).resolves.toBeDefined();
      await nature.init();
      expect(await nature.exists()).toBe(true);
    });

    it("opens an existing repository on a second nature rather than clobbering it", async () => {
      const nature = vcsNatureOf(await projectOf("a"));
      await nature.init();
      const git = await nature.git();
      await git.add().addFilepattern("README.md").call();
      const commit = await git
        .commit()
        .setMessage("first")
        .setAuthor("Test", "test@example.com")
        .call();

      // A fresh workspace over the same files: nothing from above survives except disk.
      const reopened = new Workspace().setFileSystem(files);
      registerVcs(reopened, deps);
      const project = await reopened.getProject("a");
      if (!project) throw new Error("no project: a");
      const again = vcsNatureOf(project);
      expect(await again.exists()).toBe(true);

      const log = [];
      for await (const c of await (await again.git()).log().call()) log.push(c);
      expect(log.map((c) => c.id)).toEqual([commit.id]);
    });
  });

  describe("two handles on one project", () => {
    /** A second Workspace over the same files — the shape an LRU eviction produces. */
    async function secondHandle(): Promise<Project> {
      const other = new Workspace().setFileSystem(files);
      registerVcs(other, deps);
      const project = await other.getProject("a");
      if (!project) throw new Error("no project: a");
      return project;
    }

    it("does not lose one handle's staged work when the other stages and commits", async () => {
      // `Workspace._projects` is an LRU with a one-hour default maxAge, so "one
      // project, one repository" is false in wall-clock terms: after an eviction
      // `getProject("a")` yields a new Project, a new VcsNature, a new Git and a new
      // staging store — each with its own in-memory index that `add()` writes out
      // wholesale. Nothing about this needs two Workspaces; that is only the fastest
      // way to reproduce it.
      const first = vcsNatureOf(await projectOf("a"));
      await first.init();
      const second = vcsNatureOf(await secondHandle());

      await files.write("/a/one.md", [encoder.encode("one")]);
      await files.write("/a/two.md", [encoder.encode("two")]);

      await second.add("one.md");
      await first.add("two.md");

      const outcome = await first.commit({
        message: "both",
        author: { name: "Test", email: "test@example.com" },
      });
      expect(outcome.changed).toBe(true);

      const git = await first.git();
      const history = git.history;
      if (!history) throw new Error("no history on the Git façade");
      const commit = await history.commits.load(outcome.id ?? "");
      if (!commit) throw new Error("commit not found");
      const tree = await history.trees.load(commit.tree);
      if (!tree) throw new Error("commit tree not found");
      const names: string[] = [];
      for await (const entry of tree) names.push(entry.name);
      expect(names.sort()).toEqual(["one.md", "two.md"]);
    });

    it("lets the other handle see the commit rather than reporting stale staging", async () => {
      const first = vcsNatureOf(await projectOf("a"));
      await first.init();
      const second = vcsNatureOf(await secondHandle());

      await files.write("/a/one.md", [encoder.encode("one")]);
      await files.write("/a/two.md", [encoder.encode("two")]);
      await second.add("one.md");
      await first.add("two.md");
      await first.commit({
        message: "both",
        author: { name: "Test", email: "test@example.com" },
      });

      // The second handle's view must reconverge on what is on disk: both files are
      // in HEAD and in `.git/index`, so nothing is added and nothing is removed. A
      // handle answering from a private in-memory index would report `one.md` added
      // and `two.md` removed — a deletion the user never asked for.
      const status = await second.status();
      expect([...status.added]).toEqual([]);
      expect([...status.removed]).toEqual([]);
      expect(status.isClean()).toBe(true);
    });
  });

  describe("the nature marker", () => {
    it("writes nature.vcs.json, so vcsConfigOf() round-trips it", async () => {
      const project = await projectOf("a");
      expect(await vcsConfigOf(project).exists()).toBe(false);

      await vcsNatureOf(project).init();

      const config = vcsConfigOf(project);
      expect(await config.exists()).toBe(true);
      expect((await config.load()).data).toEqual({ version: 1 });
      expect(await files.exists("/a/.project/nature.vcs.json")).toBe(true);
    });

    it("carries an author through to the marker when one is given", async () => {
      const project = await projectOf("a");
      await vcsNatureOf(project).init({ author: { name: "Ada", email: "ada@example.com" } });

      expect((await vcsConfigOf(project).load()).data).toEqual({
        version: 1,
        author: { name: "Ada", email: "ada@example.com" },
      });
    });

    it("keeps an earlier init()'s configuration when init() is called again", async () => {
      const project = await projectOf("a");
      const nature = vcsNatureOf(project);
      await nature.init({
        author: { name: "Ada", email: "ada@example.com" },
        defaultRemote: "upstream",
      });

      // The docstring calls this safe on a project that already has a repository, so a
      // caller re-running setup passes no arguments — and must not lose what is there.
      await nature.init();

      // Read the marker back through a fresh workspace: the adapter's in-memory cache
      // must not be able to hide a wipe that already happened on disk.
      const reopened = new Workspace().setFileSystem(files);
      registerVcs(reopened, deps);
      const again = await reopened.getProject("a");
      if (!again) throw new Error("no project: a");
      expect((await vcsConfigOf(again).load()).data).toEqual({
        version: 1,
        defaultRemote: "upstream",
        author: { name: "Ada", email: "ada@example.com" },
      });
    });

    it("lets a later init() replace only the fields it names", async () => {
      const project = await projectOf("a");
      const nature = vcsNatureOf(project);
      await nature.init({
        author: { name: "Ada", email: "ada@example.com" },
        defaultRemote: "upstream",
      });

      await nature.init({ defaultRemote: "fork" });

      expect((await vcsConfigOf(project).load()).data).toEqual({
        version: 1,
        defaultRemote: "fork",
        author: { name: "Ada", email: "ada@example.com" },
      });
    });

    it("registers VcsConfiguration alongside VcsNature", async () => {
      const project = await projectOf("a");
      expect(project.requireAdapter(VcsConfiguration)).toBeInstanceOf(VcsConfiguration);
      expect(project.requireAdapter(VcsNature)).toBeInstanceOf(VcsNature);
    });
  });

  describe(".git/info/exclude", () => {
    it("writes the pattern `.project` — with no trailing slash", async () => {
      await vcsNatureOf(await projectOf("a")).init();

      const lines = (await readText(files, "/a/.git/info/exclude"))
        .split("\n")
        .map((line) => line.trim());
      expect(lines).toContain(".project");
      // `.project/` is the trap: IgnoreManager returns CHECK_PARENT for paths inside an
      // ignored directory and `isIgnored` only reports IGNORED, so the trailing slash
      // excludes the directory entry and nothing under it.
      expect(lines).not.toContain(".project/");
    });

    it("actually keeps `.project` out of a commit of the whole tree", async () => {
      const project = await projectOf("a");
      const nature = vcsNatureOf(project);
      await nature.init();
      // `.project/` now holds the marker; give it a nested file too, since the
      // trailing-slash bug shows up on nested paths in particular.
      await files.write("/a/.project/state/scan.lock", [encoder.encode("x")]);

      const git = await nature.git();
      await git.add().addFilepattern(".").call();
      const commit = await git
        .commit()
        .setMessage("all")
        .setAuthor("Test", "test@example.com")
        .call();

      const history = git.history;
      if (!history) throw new Error("no history on the Git façade");
      const tree = await history.trees.load(commit.tree);
      if (!tree) throw new Error("commit tree not found");
      const entries = [];
      for await (const entry of tree) entries.push(entry.name);
      expect(entries).toContain("README.md");
      expect(entries).not.toContain(".project");
      expect(entries).not.toContain(".git");
    });
  });

  describe("dependency injection", () => {
    it("hands registerVcs's deps to the adapter it constructs", async () => {
      const nature = vcsNatureOf(await projectOf("a"));
      expect(nature.requireDeps()).toBe(deps);
    });

    it("throws on a dep-requiring call when registerVcs was never run", async () => {
      // `Adaptable.getAdapter` SELF-HOSTS a class token, so forgetting `registerVcs`
      // still yields a working-looking VcsNature — with every dep silently missing.
      // That silence is what this test exists to break.
      const bare = new Workspace().setFileSystem(files);
      const project = await bare.getProject("a");
      if (!project) throw new Error("no project: a");
      const nature = vcsNatureOf(project);

      expect(nature).toBeInstanceOf(VcsNature);
      expect(() => nature.requireDeps()).toThrow(/registerVcs/);
    });
  });
});
