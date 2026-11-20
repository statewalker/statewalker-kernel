import { MessageProcessor } from "@a2ui/web_core";
import { describe, expect, it } from "vitest";
import { fakeModel, runAgentTurn } from "./agent.js";
import { protoCatalog } from "./catalog.js";

describe("scripted agent turn", () => {
  it("is processed by MessageProcessor into a surface model", async () => {
    const processor = new MessageProcessor([protoCatalog]);
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
