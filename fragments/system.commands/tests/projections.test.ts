import { describe, expect, it } from "vitest";
import { harnessTools, mcpTools, toolByName } from "../src/index.js";
import { command, fragment, operation, platform } from "./helpers.js";

const NOTES = "org.example.notes";

const findInput = {
  type: "object",
  required: ["query"],
  properties: { query: { type: "string" }, filter: { type: "object", properties: {} } },
};
const findOutput = { type: "object", properties: { ids: { type: "array" } } };

const find = command(operation("find", findInput, findOutput, { summary: "Find notes" }), {
  exposures: { agent: { action: "read" } },
});
const publish = command(operation("publish", undefined, undefined, { summary: "Publish" }), {
  exposures: { agent: { action: "admin" }, http: { path: "/publish" }, mcp: {} },
});
const exportAll = command(operation("export-all", undefined, undefined, { summary: "Export" }), {
  exposures: { http: { path: "/export" }, mcp: {} },
});
const internal = command(operation("reindex"));

async function catalogue() {
  const { kernel, bus } = await platform([
    fragment(NOTES, { commands: [find, publish, exportAll, internal] }),
  ]);
  return { kernel, bus };
}

describe("the harness tool projection", () => {
  it("holds only agent-exposed commands, as documents of the harness's restricted profile", async () => {
    const { bus } = await catalogue();
    const tools = harnessTools(bus.list());
    expect(tools.map((t) => t["x-dev.cellb.harness"].id)).toEqual([
      `${NOTES}/find`,
      `${NOTES}/publish`,
    ]);
    // The shape of statewalker-ai's `toolDefinition` (ai-definitions, statewalker-root#90),
    // written out by hand: the package is not published, so this test pins the format.
    expect(tools[0]).toEqual({
      openapi: "3.1.0",
      info: { title: `${NOTES}/find`, version: "1", description: "Find notes" },
      paths: {
        [`/tools/${NOTES}/find`]: {
          post: {
            operationId: "org_example_notes__find",
            summary: "Find notes",
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["query"],
                    properties: {
                      query: { type: "string" },
                      filter: { type: "object", properties: {}, additionalProperties: false },
                    },
                    additionalProperties: false,
                  },
                },
              },
            },
            responses: {
              200: {
                description: "The tool's result",
                content: { "application/json": { schema: findOutput } },
              },
              default: { description: "The tool failed, or the call was refused" },
            },
          },
        },
      },
      "x-dev.cellb.harness": {
        id: `${NOTES}/find`,
        name: "org_example_notes__find",
        source: "harness",
        plugin: NOTES,
        tool: "find",
        action: "read",
        permission: `tools.use:${NOTES}/find`,
        route: { kind: "harness", entry: `${NOTES}/find` },
      },
    });
    expect(tools[1]?.["x-dev.cellb.harness"]).toMatchObject({
      action: "admin",
      permission: `tools.use:${NOTES}/publish`,
    });
    // No output schema declared: the profile's empty schema.
    expect(
      tools[1]?.paths[`/tools/${NOTES}/publish`]?.post.responses[200].content["application/json"]
        .schema,
    ).toEqual({});
  });
});

describe("the MCP projection", () => {
  it("holds only mcp-exposed commands, as MCP tools/list entries", async () => {
    const { bus } = await catalogue();
    expect(mcpTools(bus.list())).toEqual([
      {
        name: "org_example_notes__publish",
        title: "Publish",
        description: "Publish",
        inputSchema: { type: "object", additionalProperties: false },
        annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      },
      {
        name: "org_example_notes__export-all",
        title: "Export",
        description: "Export",
        inputSchema: { type: "object", additionalProperties: false },
      },
    ]);
  });

  it("can be limited to one fragment (its /fragments/{id}/.well-known/mcp)", async () => {
    const { bus } = await catalogue();
    expect(mcpTools(bus.list(), { fragment: "org.example.other" })).toEqual([]);
    expect(mcpTools(bus.list(), { fragment: NOTES })).toHaveLength(2);
  });
});

describe("tool names", () => {
  it("map back to the command they name", async () => {
    const { bus } = await catalogue();
    expect(toolByName(bus.list(), "org_example_notes__publish")?.id).toBe(`${NOTES}/publish`);
    expect(toolByName(bus.list(), "org_example_notes__reindex")).toBeUndefined(); // internal
  });

  /** Three agent-exposed `go` commands of fragments whose ids differ only past 64 characters. */
  const long = `org.example.${"x".repeat(60)}`;
  const agentGo = (id: string) =>
    fragment(id, {
      commands: [command(operation("go"), { exposures: { agent: { action: "read" } } })],
    });
  const fragments = [agentGo(`${long}.a`), agentGo(`${long}.b`), agentGo("org.example.a-b")];

  it("are provider-safe, unique and at most 64 characters", async () => {
    const { bus } = await platform(fragments);
    const tools = harnessTools(bus.list());
    const names = tools.map((t) => t["x-dev.cellb.harness"].name);
    expect(names).toHaveLength(3);
    expect(new Set(names).size).toBe(3);
    for (const name of names) expect(name).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(names).toContain("org_example_a-b__go");
    for (const tool of tools) {
      const x = tool["x-dev.cellb.harness"];
      expect(toolByName(bus.list(), x.name)?.id).toBe(x.id);
      expect(Object.values(tool.paths)[0]?.post.operationId).toBe(x.name);
    }
  });

  it("do not depend on the order commands arrive in", async () => {
    const one = await platform(fragments);
    const two = await platform([...fragments].reverse());
    const byId = (list: ReturnType<typeof harnessTools>) =>
      Object.fromEntries(
        list.map((t) => [t["x-dev.cellb.harness"].id, t["x-dev.cellb.harness"].name]),
      );
    expect(byId(harnessTools(one.bus.list()))).toEqual(byId(harnessTools(two.bus.list())));
  });
});

describe("labels", () => {
  const labelled = command(
    operation("find", undefined, undefined, { summary: "Find notes", description: "Full text" }),
    {
      exposures: { agent: { action: "read" }, http: { path: "/find" }, mcp: {} },
      labels: { fr: { title: "Chercher", description: "Chercher des notes" } },
    },
  );

  it("come from the locale asked for, its language, or the operation", async () => {
    const { bus } = await platform([fragment(NOTES, { commands: [labelled] })]);
    const [fr] = mcpTools(bus.list(), { locale: "fr-CA" });
    expect(fr).toMatchObject({ title: "Chercher", description: "Chercher des notes" });
    const [en] = mcpTools(bus.list(), { locale: "en" });
    expect(en).toMatchObject({ title: "Find notes", description: "Full text" });
    const [tool] = harnessTools(bus.list(), { locale: "fr" });
    expect(tool?.info.description).toBe("Chercher des notes");
  });
});

describe("removal", () => {
  it("removes a disabled fragment's tools from both projections", async () => {
    const { kernel, bus } = await catalogue();
    await kernel.disable(NOTES);
    expect(harnessTools(bus.list())).toEqual([]);
    expect(mcpTools(bus.list())).toEqual([]);
  });
});

describe("the mcp exposure", () => {
  it("implies http, at /commands/<command-id> unless a path is given", async () => {
    const { bus } = await platform([
      fragment(NOTES, {
        commands: [
          command(operation("sync"), { exposures: { mcp: {} } }),
          command(operation("pull"), { exposures: { mcp: {}, http: { path: "/pull-now" } } }),
        ],
      }),
    ]);
    expect(bus.get(`${NOTES}/sync`)?.exposures).toEqual({
      mcp: {},
      http: { path: "/commands/sync" },
    });
    expect(bus.get(`${NOTES}/pull`)?.exposures.http).toEqual({ path: "/pull-now" });
    expect(mcpTools(bus.list()).map((t) => t.name)).toEqual([
      "org_example_notes__sync",
      "org_example_notes__pull",
    ]);
  });
});
