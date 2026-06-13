export interface GraphNode {
  name: string;
  deps: string[];
}

/**
 * Topological sort using Kahn's algorithm.
 * Returns nodes in activation order: dependencies before dependents.
 * Uses the provided comparator for tie-breaking (defaults to alphabetical).
 */
export function topoSort<T extends GraphNode>(
  graph: Map<string, T>,
  compare: (a: string, b: string) => number = (a, b) => a.localeCompare(b),
): T[] {
  // In-degree = number of dependencies a node has (that are in the graph).
  // Nodes with in-degree 0 have no unsatisfied deps and can activate first.
  const inDegree = new Map<string, number>();
  for (const [name, node] of graph) {
    let count = 0;
    for (const dep of node.deps) {
      if (graph.has(dep)) count++;
    }
    inDegree.set(name, count);
  }

  // Seed with zero in-degree nodes, sorted by comparator
  const queue: string[] = [];
  for (const [name, degree] of inDegree) {
    if (degree === 0) queue.push(name);
  }
  queue.sort(compare);

  const result: T[] = [];
  while (queue.length > 0) {
    const name = queue.shift() as string;
    const node = graph.get(name) as T;
    result.push(node);

    // Decrease in-degree of nodes that depend on this one
    for (const [, candidate] of graph) {
      if (candidate.deps.includes(name)) {
        const newDegree = (inDegree.get(candidate.name) ?? 1) - 1;
        inDegree.set(candidate.name, newDegree);
        if (newDegree === 0) {
          // Insert sorted to maintain tie-breaking order
          const idx = queue.findIndex((q) => compare(q, candidate.name) > 0);
          if (idx === -1) queue.push(candidate.name);
          else queue.splice(idx, 0, candidate.name);
        }
      }
    }
  }

  if (result.length !== graph.size) {
    // Find cycle for error message
    const remaining = [...graph.keys()].filter((n) => !result.some((r) => r.name === n));
    throw new Error(`Circular dependency detected among: ${remaining.join(" -> ")}`);
  }

  return result;
}
