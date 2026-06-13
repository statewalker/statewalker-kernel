import { describe, expect, it } from "vitest";
import { type GraphNode, topoSort } from "../src/topo-sort.js";

function makeGraph(entries: Record<string, string[]>): Map<string, GraphNode> {
  const graph = new Map<string, GraphNode>();
  for (const [name, deps] of Object.entries(entries)) {
    graph.set(name, { name, deps });
  }
  return graph;
}

function names(result: GraphNode[]): string[] {
  return result.map((n) => n.name);
}

describe("topoSort", () => {
  it("returns empty array for empty graph", () => {
    const result = topoSort(new Map());
    expect(result).toEqual([]);
  });

  it("returns single node", () => {
    const graph = makeGraph({ a: [] });
    expect(names(topoSort(graph))).toEqual(["a"]);
  });

  it("orders a linear chain: a -> b -> c", () => {
    const graph = makeGraph({
      a: [],
      b: ["a"],
      c: ["b"],
    });
    expect(names(topoSort(graph))).toEqual(["a", "b", "c"]);
  });

  it("orders a diamond: d depends on b,c; both depend on a", () => {
    const graph = makeGraph({
      a: [],
      b: ["a"],
      c: ["a"],
      d: ["b", "c"],
    });
    const result = names(topoSort(graph));
    expect(result[0]).toBe("a");
    expect(result[3]).toBe("d");
    // b and c can be in either order, but alphabetical tie-breaking gives b first
    expect(result).toEqual(["a", "b", "c", "d"]);
  });

  it("sorts independent nodes alphabetically", () => {
    const graph = makeGraph({
      z: [],
      a: [],
      m: [],
    });
    expect(names(topoSort(graph))).toEqual(["a", "m", "z"]);
  });

  it("ignores deps not in the graph (external deps)", () => {
    const graph = makeGraph({
      a: ["external-lib"],
      b: ["a"],
    });
    // "external-lib" is not in the graph, so a has in-degree 0
    expect(names(topoSort(graph))).toEqual(["a", "b"]);
  });

  it("handles a complex DAG", () => {
    // shared <- logger <- http <- auth
    //        <- pg     <--------/
    const graph = makeGraph({
      shared: [],
      logger: ["shared"],
      pg: ["shared"],
      http: ["logger"],
      auth: ["http", "pg"],
    });
    const result = names(topoSort(graph));

    // shared must be first
    expect(result[0]).toBe("shared");
    // auth must be last
    expect(result[result.length - 1]).toBe("auth");
    // logger before http
    expect(result.indexOf("logger")).toBeLessThan(result.indexOf("http"));
    // pg before auth
    expect(result.indexOf("pg")).toBeLessThan(result.indexOf("auth"));
  });

  it("throws on circular dependency", () => {
    const graph = makeGraph({
      a: ["b"],
      b: ["c"],
      c: ["a"],
    });
    expect(() => topoSort(graph)).toThrow(/Circular dependency/);
  });

  it("throws on self-referencing node", () => {
    const graph = makeGraph({
      a: ["a"],
    });
    expect(() => topoSort(graph)).toThrow(/Circular dependency/);
  });

  it("uses custom comparator for tie-breaking", () => {
    const graph = makeGraph({
      z: [],
      a: [],
      m: [],
    });
    // Reverse alphabetical
    const result = names(topoSort(graph, (a, b) => b.localeCompare(a)));
    expect(result).toEqual(["z", "m", "a"]);
  });

  it("throws on partial cycle with non-cyclic nodes", () => {
    const graph = makeGraph({
      ok: [],
      a: ["b"],
      b: ["a"],
    });
    expect(() => topoSort(graph)).toThrow(/Circular dependency/);
  });
});
