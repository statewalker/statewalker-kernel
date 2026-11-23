import { describe, expect, it } from "vitest";
import { createProcessor } from "../src/index.js";
import { agentDataUpdate, complexModel, fakeModel, runAgentTurn } from "./fixtures/agent.js";
import { protoCatalog } from "./fixtures/catalog.js";

describe("scripted agent turn", () => {
  it("is processed by MessageProcessor into a surface model", async () => {
    const processor = createProcessor([protoCatalog]);
    const { surfaceIds, errors } = await runAgentTurn(processor, fakeModel);
    expect(errors).toEqual([]);
    expect(surfaceIds).toEqual(["confirm-delete"]);
    const surface = processor.getSurface("confirm-delete");
    expect(surface).toBeDefined();
    const card = surface?.componentsModel.get("card");
    expect(card?.type).toBe("ConfirmCard");
    expect(card?.properties).toMatchObject({ title: "Delete 3 files?" });
    expect(surface?.componentsModel.get("intro")?.type).toBe("Text");
  });
});

describe("scripted complex agent turn", () => {
  it("places a bound CodeEditor and MapView, and later pushes a data-model update", async () => {
    const processor = createProcessor([protoCatalog]);
    const { surfaceIds, errors } = await runAgentTurn(processor, complexModel);
    expect(errors).toEqual([]);
    expect(surfaceIds).toEqual(["workbench"]);
    const surface = processor.getSurface("workbench");
    expect(surface?.componentsModel.get("editor")?.properties).toMatchObject({
      value: { "@path": "/doc/text" },
    });
    expect(surface?.componentsModel.get("map")?.properties).toMatchObject({
      markers: { "@path": "/places" },
    });
    expect(processor.processMessagesWithErrors(agentDataUpdate())).toEqual([]);
    expect(surface?.dataModel.get("/places")).toHaveLength(4);
  });
});
