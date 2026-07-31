import { describe, expect, it } from "vitest";
import { vcsScaffoldCheck } from "../src/index.js";

describe("workspace-vcs.core scaffold", () => {
  it("names the cross-repo entry points it binds to", () => {
    expect(vcsScaffoldCheck()).toEqual(["CompositeFilesApi", "Git"]);
  });
});
