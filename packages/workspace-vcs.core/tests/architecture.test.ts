import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { type Project, Workspace } from "@statewalker/workspace.core";
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

  it("has no change-observation primitive anywhere in src/", () => {
    // No trailing boundary: `watcher`, `subscribeAll` and `onUpdated` are banned too.
    // The lookbehind is what keeps `Stopwatch` or `resubscribe` from matching.
    const banned = /(?<![A-Za-z0-9_$])(setInterval|setTimeout|onUpdate|subscribe|watch)/;
    const offenders = sources
      .filter((file) => banned.test(file.code))
      .map((file) => `${file.path}: ${banned.exec(file.code)?.[0]}`);
    expect(offenders).toEqual([]);
  });

  it("has exactly one commit call site outside src/adapters/", () => {
    // `\.commit\s*\(` catches `git.commit()` AND `this.commit()`, so a timer or
    // callback that re-entered the nature's own commit would push this count to two.
    // It does not catch a bare `commit()` on a module-scope function — there is none,
    // and the behavioural test below is the backstop for anything this misses.
    const sites = sources
      .filter((file) => !file.path.startsWith(ADAPTERS))
      .flatMap((file) => [...file.code.matchAll(/\.commit\s*\(/g)].map(() => file.path));
    expect(sites).toEqual(["runtime/vcs-nature.ts"]);

    // `src/adapters/repository.ts` legitimately holds the second call site: it is
    // reachable only by the three deliberate acts the spec names (construct the
    // adapter, hand it to `publish`, set `commitAfterSync`) — none of which the
    // nature performs.
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
});
