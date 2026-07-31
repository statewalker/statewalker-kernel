import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { type Project, ProjectBuilder, Workspace } from "@statewalker/workspace.core";
import { beforeEach, describe, expect, it } from "vitest";
import { registerVcs, vcsNatureOf } from "../src/runtime/vcs-nature.js";

/**
 * Contract invariant 1 — *no automatic commits* — enforced mechanically.
 *
 * The invariant is not "the nature does not import `vcs-workspace`". That is one way
 * to break it; `setInterval(() => this.commit(…))` inside `vcs-nature.ts` imports
 * nothing new and would sail past an import ban, and so would a `files.onUpdate`
 * subscription. So this file asserts four independent things, three static and one
 * behavioural, and states the exact scope of each — a test that names an invariant
 * without enforcing it is worse than no test, because the task then reports it
 * discharged.
 *
 * Every static rule is an **allow-list**: it applies to all of `src/**` and carves out
 * only `src/adapters/**`. A deny-list naming the three directories that exist today
 * would let a new `src/services/**` do whatever it liked.
 */

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../src");

/** The single directory the import rule exempts — the adapters ARE the vcs-workspace edge. */
const ADAPTERS = "adapters/";

/** One source file: its path relative to `src/`, and its text with comments removed. */
interface SourceFile {
  path: string;
  source: string;
  /** {@link source} with every comment blanked out; string literals are preserved. */
  code: string;
}

/**
 * `source` with comments removed and string/template literals left intact.
 *
 * Comments must go: `vcs-nature.ts` documents in prose that it has "no timers,
 * watchers, subscriptions", and a raw grep for `watch` would fail on that sentence.
 * Strings must stay: the import rule matches a module specifier, which *is* a string.
 * A hand-rolled scanner rather than a regex because `//` inside a string literal and
 * `/` inside a regex literal both defeat the regex forms.
 */
function codeOnly(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const start = i;
      i++;
      while (i < source.length && source[i] !== c) {
        if (source[i] === "\\") i++;
        i++;
      }
      i++;
      out += source.slice(start, i);
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

async function loadSources(): Promise<SourceFile[]> {
  const names = await readdir(SRC, { recursive: true, withFileTypes: true });
  const files: SourceFile[] = [];
  for (const entry of names) {
    if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
    const absolute = join(entry.parentPath, entry.name);
    const source = await readFile(absolute, "utf8");
    files.push({
      path: absolute.slice(SRC.length + 1).replaceAll("\\", "/"),
      source,
      code: codeOnly(source),
    });
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/** Every module specifier `file` imports (or re-exports from). */
function importSpecifiers(file: SourceFile): string[] {
  const specifiers: string[] = [];
  const pattern = /(?:\bfrom|\bimport|\brequire)\s*\(?\s*["']([^"']+)["']/g;
  for (const match of file.code.matchAll(pattern)) {
    const specifier = match[1];
    if (specifier) specifiers.push(specifier);
  }
  return specifiers;
}

describe("architecture — contract invariant 1: no automatic commits", () => {
  let sources: SourceFile[];

  beforeEach(async () => {
    sources = await loadSources();
  });

  /** The rules below would be vacuously true over an empty or mis-rooted file set. */
  it("scans the real src tree", async () => {
    expect(sources.length).toBeGreaterThanOrEqual(10);
    expect(sources.map((f) => f.path)).toContain("runtime/vcs-nature.ts");
    expect(sources.map((f) => f.path)).toContain("adapters/repository.ts");
  });

  it("keeps @statewalker/vcs-workspace out of every src/ file except src/adapters/", () => {
    const offenders = sources
      .filter((file) => !file.path.startsWith(ADAPTERS))
      .filter((file) =>
        importSpecifiers(file).some((s) => s.startsWith("@statewalker/vcs-workspace")),
      )
      .map((file) => file.path);
    expect(offenders).toEqual([]);

    // Non-vacuous: the specifier really is present in the tree, in the one place the
    // allow-list exempts, so the matcher above is known to be able to fire.
    const adapterImporters = sources
      .filter((file) => file.path.startsWith(ADAPTERS))
      .filter((file) =>
        importSpecifiers(file).some((s) => s.startsWith("@statewalker/vcs-workspace")),
      )
      .map((file) => file.path);
    expect(adapterImporters).toContain("adapters/repository.ts");
  });

  it("has no deferred-execution or change-observation primitive anywhere in src/", () => {
    // No trailing boundary: `watcher`, `subscribeAll` and `onUpdated` are banned too.
    // The lookbehind is what keeps `Stopwatch` or `resubscribe` from matching.
    //
    // Every way to run code later belongs here, not just the timers. `setInterval`
    // and `setTimeout` alone were an incomplete list: `setImmediate(() => …)` inside
    // `git()` schedules exactly the same autosave and was invisible to this rule.
    // `queueMicrotask` and `requestIdleCallback` are the remaining schedulers, and
    // `addEventListener` is the remaining way to be called back by something else.
    const banned =
      /(?<![A-Za-z0-9_$])(setInterval|setTimeout|setImmediate|queueMicrotask|requestIdleCallback|addEventListener|onUpdate|subscribe|watch)/;
    const offenders = sources
      .filter((file) => banned.test(file.code))
      .map((file) => `${file.path}: ${banned.exec(file.code)?.[0]}`);
    expect(offenders).toEqual([]);
  });

  it("never registers a project builder — the nature contributes none", () => {
    // The other way to get code run without a caller asking: hand a builder to the
    // build engine. `applyNature(project, {builders: () => [...]})` needs no timer and
    // no import the rules above notice, and the handler it registers is driven by
    // `ProjectBuilder.run()` — a commit inside it is a commit nobody asked for.
    // CONTEXT.md asserts "GitNature registers no builders"; this is that assertion.
    //
    // Applies to ALL of src/, adapters included: unlike the vcs-workspace import,
    // there is no directory where registering a builder would be legitimate.
    const banned = /(?<![A-Za-z0-9_$])(applyNature|registerBuilder|ProjectBuilder)/;
    const offenders = sources
      .filter((file) => banned.test(file.code))
      .map((file) => `${file.path}: ${banned.exec(file.code)?.[0]}`);
    expect(offenders).toEqual([]);
  });

  it("has exactly one mention of .commit outside src/adapters/", () => {
    // `\.commit\b`, NOT `\.commit\s*\(`: the call form misses every indirection that
    // reaches the same method without syntactically calling it — `this.commit.bind(this)`
    // handed to a scheduler being the proven one. Any second `.commit` anywhere outside
    // the adapters, called or not, fails this.
    //
    // The lookbehind rejects only a preceding dot, i.e. the spread `[...commit.parents]`
    // over a variable that happens to be named `commit`. A member access is always
    // preceded by an identifier character or a `)`, never by `.`.
    const sites = sources
      .filter((file) => !file.path.startsWith(ADAPTERS))
      .flatMap((file) => [...file.code.matchAll(/(?<!\.)\.commit\b/g)].map(() => file.path));
    expect(sites).toEqual(["runtime/vcs-nature.ts"]);

    // `src/adapters/repository.ts` legitimately holds the second call site: it is
    // reachable only by the three deliberate acts the spec names (construct the
    // adapter, hand it to `publish`, set `commitAfterSync`) — none of which the
    // nature performs. The CALL form here, deliberately: the adapters also read a
    // `PushResult.commit` property, which is not a call site and not a vector.
    const adapterSites = sources
      .filter((file) => file.path.startsWith(ADAPTERS))
      .flatMap((file) => [...file.code.matchAll(/\.commit\s*\(/g)].map(() => file.path));
    expect(adapterSites).toEqual(["adapters/repository.ts"]);
  });
});

describe("architecture — behaviourally, nothing commits on its own", () => {
  let files: MemFilesApi;
  let workspace: Workspace;

  beforeEach(() => {
    files = new MemFilesApi({ initialFiles: { "a/README.md": "project a" } });
    workspace = new Workspace().setFileSystem(files);
    registerVcs(workspace, {
      fetch: (() => {
        throw new Error("fetch must not be called");
      }) as never,
    });
  });

  async function projectOf(name: string): Promise<Project> {
    const project = await workspace.getProject(name);
    if (!project) throw new Error(`no project: ${name}`);
    return project;
  }

  it("leaves log() empty after writes and a macrotask tick, until commit() is called", async () => {
    const encoder = new TextEncoder();
    const nature = vcsNatureOf(await projectOf("a"));
    await nature.init();

    await files.write("/a/src/main.ts", [encoder.encode("export {};")]);
    await files.write("/a/README.md", [encoder.encode("changed")]);

    // A macrotask tick, not just a microtask drain: a `setTimeout(0)` autosave would
    // survive `await Promise.resolve()` and be invisible to this assertion.
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(await nature.log()).toEqual([]);
    expect((await nature.status()).isClean()).toBe(true);

    // Staging alone still commits nothing.
    await nature.add(".");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await nature.log()).toEqual([]);

    // The only thing that ever produces a commit is the explicit call.
    const outcome = await nature.commit({
      message: "explicit",
      author: { name: "Test", email: "test@example.com" },
    });
    expect(outcome.changed).toBe(true);
    expect((await nature.log()).map((c) => c.message)).toEqual(["explicit"]);
  });

  it("commits nothing when a repository is merely REOPENED over staged work", async () => {
    const encoder = new TextEncoder();
    const nature = vcsNatureOf(await projectOf("a"));
    await nature.init();
    await files.write("/a/src/main.ts", [encoder.encode("export {};")]);
    await nature.add(".");

    // Session 1 leaves work staged and deliberately uncommitted.
    expect([...(await nature.status()).added].sort()).toEqual(["README.md", "src/main.ts"]);
    expect(await nature.log()).toEqual([]);

    // Session 2: every handle from session 1 is dropped and the repository is opened
    // again from disk. This is the leg the suite was missing — an autosave installed
    // at OPEN time (`git()`) never fires in a session that opened the repo before the
    // work existed, so the single-session test above cannot see it. On reopen it
    // fires immediately, and the user's staged-not-committed work becomes a commit
    // nobody asked for.
    const reopened = new Workspace().setFileSystem(files);
    registerVcs(reopened, {
      fetch: (() => {
        throw new Error("fetch must not be called");
      }) as never,
    });
    const project = await reopened.getProject("a");
    if (!project) throw new Error("no project: a");
    const again = vcsNatureOf(project);
    await again.git();

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(await again.log()).toEqual([]);
    // And the staged work is still staged — not committed, not dropped.
    expect([...(await again.status()).added].sort()).toEqual(["README.md", "src/main.ts"]);
  });

  it("registers no project builders, so a build run produces no commit", async () => {
    const nature = vcsNatureOf(await projectOf("a"));
    await nature.init();
    await nature.add(".");

    // `registerVcs` ran in `beforeEach`; `init()` and `add()` are the whole surface a
    // caller touches. Nothing along that path may have contributed a builder.
    const builder = (await projectOf("a")).requireAdapter(ProjectBuilder);
    expect((await builder.status()).builders).toEqual([]);

    // And driving the engine to convergence still commits nothing — the backstop for
    // a builder registered by some path this test does not walk.
    for await (const _ of builder.run()) {
      /* drain */
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await nature.log()).toEqual([]);
  });
});
