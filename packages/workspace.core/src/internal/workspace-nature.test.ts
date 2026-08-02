import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { describe, expect, it } from "vitest";
import {
  applyNature,
  type Nature,
  NatureBuilders,
  ProjectBuilder,
  type RegisteredBuilder,
  SOURCES_SIGNAL,
} from "../public/builders/index.js";
import type { Project } from "../public/types/project.js";
import { Workspace } from "../public/types/workspace.js";

const enc = new TextEncoder();

/** A project-level adapter a nature contributes. */
class Marker {
  constructor(readonly project: Project) {}
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

async function workspace(files: Record<string, string>): Promise<Workspace> {
  const fs = new MemFilesApi();
  for (const [path, body] of Object.entries(files)) await fs.write(path, [enc.encode(body)]);
  const ws = new Workspace().setFileSystem(fs, "A");
  await ws.open();
  return ws;
}

async function drain(builder: ProjectBuilder): Promise<void> {
  for await (const _ of builder.run()) {
    /* consume */
  }
}

describe("applyNature(workspace, nature)", () => {
  it("registers a nature's adapters and exposes its builders per project", async () => {
    const ws = await workspace({ "/proj/a.txt": "a", "/proj/b.txt": "b" });
    const processed: string[] = [];
    const nature: Nature = {
      adapters: () => [
        { level: "project", type: Marker, factory: (p) => new Marker(p as Project) },
      ],
      builders: () => [echoBuilder(processed)],
    };

    const dispose = applyNature(ws, nature);
    const p = (await ws.getProject("proj")) as Project;

    // The class-keyed adapter resolves on the project via the shared registry.
    expect(p.requireAdapter(Marker)).toBeInstanceOf(Marker);

    // The builders reach the project through the NatureBuilders provider, and run.
    const provider = p.requireAdapter(NatureBuilders);
    const detach = applyNature(p, provider);
    await drain(p.requireAdapter(ProjectBuilder));
    expect(processed.sort()).toEqual(["a.txt", "b.txt"]);

    // The disposer unregisters both the adapter and the builder provider.
    detach();
    dispose();
    expect(ws.adaptersRegistry.getFactory("project", Marker)).toBeUndefined();
    expect(ws.adaptersRegistry.getFactory("project", NatureBuilders)).toBeUndefined();
  });
});
