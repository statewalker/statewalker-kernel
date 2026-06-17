import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { describe, expect, it } from "vitest";
import {
  applyNature,
  type BuilderProvider,
  ProjectBuilder,
  type RegisteredBuilder,
  SOURCES_REMOVED_SIGNAL,
  SOURCES_SIGNAL,
} from "../public/builders/index.js";
import type { Project } from "../public/types/project.js";
import { Workspace } from "../public/types/workspace.js";

const enc = new TextEncoder();

async function project(files: Record<string, string>): Promise<Project> {
  const fs = new MemFilesApi();
  for (const [path, body] of Object.entries(files)) await fs.write(path, [enc.encode(body)]);
  const ws = new Workspace();
  ws.setFileSystem(fs, "A");
  await ws.open();
  const p = await ws.getProject("proj");
  if (!p) throw new Error("project not resolved");
  return p;
}

/** A builder that records every source URI it processes. */
function echoBuilder(processed: string[]): RegisteredBuilder {
  return {
    id: "Echo",
    inputs: [SOURCES_SIGNAL],
    outputs: ["content"],
    async *handler(p) {
      const builder = p.requireAdapter(ProjectBuilder);
      for await (const u of builder.readUpdates({ signal: SOURCES_SIGNAL, cell: "Echo" })) {
        processed.push(u.uri);
        await u.handled();
        yield { signal: "content", uri: u.uri, stamp: u.stamp };
      }
      return true;
    },
  };
}

async function drain(builder: ProjectBuilder): Promise<void> {
  for await (const _ of builder.run()) {
    /* consume progress */
  }
}

describe("ProjectBuilder — convergence", () => {
  it("scans sources and runs registered builders to convergence", async () => {
    const p = await project({ "/proj/a.txt": "a", "/proj/b.txt": "b" });
    const processed: string[] = [];
    const builder = p.requireAdapter(ProjectBuilder);
    builder.registerBuilder(echoBuilder(processed));

    await drain(builder);
    expect(processed.sort()).toEqual(["a.txt", "b.txt"]);
  });

  it("a second run with no filesystem change processes nothing new", async () => {
    const p = await project({ "/proj/a.txt": "a", "/proj/b.txt": "b" });
    const processed: string[] = [];
    const builder = p.requireAdapter(ProjectBuilder);
    builder.registerBuilder(echoBuilder(processed));

    await drain(builder);
    const afterFirst = processed.length;
    await drain(builder);
    expect(processed.length).toBe(afterFirst);
  });
});

describe("ProjectBuilder — restartFrom", () => {
  it("reprocesses a builder after restartFrom", async () => {
    const p = await project({ "/proj/a.txt": "a" });
    const processed: string[] = [];
    const builder = p.requireAdapter(ProjectBuilder);
    builder.registerBuilder(echoBuilder(processed));

    await drain(builder);
    expect(processed).toEqual(["a.txt"]);

    await builder.restartFrom("Echo");
    await drain(builder);
    expect(processed).toEqual(["a.txt", "a.txt"]);
  });
});

describe("ProjectBuilder — nature (BuilderProvider)", () => {
  it("applyNature registers a provider's builders and they run", async () => {
    const p = await project({ "/proj/a.txt": "a", "/proj/b.txt": "b" });
    const processed: string[] = [];
    const nature: BuilderProvider = {
      builders: () => [echoBuilder(processed)],
    };
    applyNature(p, nature);

    await drain(p.requireAdapter(ProjectBuilder));
    expect(processed.sort()).toEqual(["a.txt", "b.txt"]);
  });
});

describe("ProjectBuilder — .projectignore", () => {
  it("skips sources matched by .projectignore", async () => {
    const p = await project({
      "/proj/keep.txt": "k",
      "/proj/skip.txt": "s",
      "/proj/.projectignore": "skip.txt",
    });
    const processed: string[] = [];
    const builder = p.requireAdapter(ProjectBuilder);
    builder.registerBuilder(echoBuilder(processed));

    await drain(builder);
    expect(processed).toEqual(["keep.txt"]);
  });
});

/** A builder that records processed sources AND removed ones. */
function echoWithRemovals(processed: string[], removed: string[]): RegisteredBuilder {
  return {
    id: "Echo",
    inputs: [SOURCES_SIGNAL, SOURCES_REMOVED_SIGNAL],
    outputs: ["content"],
    async *handler(p) {
      const builder = p.requireAdapter(ProjectBuilder);
      for await (const u of builder.readUpdates({ signal: SOURCES_SIGNAL, cell: "Echo" })) {
        processed.push(u.uri);
        await u.handled();
        yield { signal: "content", uri: u.uri, stamp: u.stamp };
      }
      for await (const u of builder.readUpdates({ signal: SOURCES_REMOVED_SIGNAL, cell: "Echo" })) {
        removed.push(u.uri);
        await u.handled();
      }
      return true;
    },
  };
}

describe("ProjectBuilder — configureSourceIgnore", () => {
  it("composes the injected predicate with .projectignore", async () => {
    const p = await project({
      "/proj/keep.txt": "k",
      "/proj/skip.txt": "s",
      "/proj/nature-skip.txt": "n",
      "/proj/.projectignore": "skip.txt",
    });
    const processed: string[] = [];
    const builder = p.requireAdapter(ProjectBuilder);
    builder.registerBuilder(echoBuilder(processed));
    builder.configureSourceIgnore(async () => (uri) => uri === "nature-skip.txt");

    await drain(builder);
    expect(processed).toEqual(["keep.txt"]);
  });

  it("re-invokes the provider each scan, pruning a newly-excluded source", async () => {
    const p = await project({ "/proj/a.txt": "a", "/proj/b.txt": "b" });
    const processed: string[] = [];
    const removed: string[] = [];
    const excluded = new Set<string>();
    const builder = p.requireAdapter(ProjectBuilder);
    builder.registerBuilder(echoWithRemovals(processed, removed));
    builder.configureSourceIgnore(async () => (uri) => excluded.has(uri));

    await drain(builder);
    expect(processed.sort()).toEqual(["a.txt", "b.txt"]);

    // Exclude b on the next scan: it should be emitted as a removed source.
    excluded.add("b.txt");
    await drain(builder);
    expect(removed).toEqual(["b.txt"]);
  });
});
