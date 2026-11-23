// Carried over from kernel.core on sandclaw's consolidation branch (`internal/order.ts`).

export interface OrderNode {
  readonly id: string;
  readonly requires?: readonly string[];
}

/**
 * Order `nodes` so that every node comes after the nodes it `requires`, keeping the given
 * order wherever the requirements allow it (a stable topological sort). Ids outside
 * `nodes` are ignored. Nodes in a cycle are left out: none of them can come first.
 */
export function orderNodes<T extends OrderNode>(nodes: readonly T[]): T[] {
  const index = new Map<string, number>();
  nodes.forEach((node, i) => {
    index.set(node.id, i);
  });
  const indegree = nodes.map(() => 0);
  const dependents: number[][] = nodes.map(() => []);
  nodes.forEach((node, i) => {
    for (const dep of new Set(node.requires ?? [])) {
      const j = index.get(dep);
      if (j === undefined || j === i) continue;
      dependents[j]?.push(i);
      indegree[i] = (indegree[i] ?? 0) + 1;
    }
  });
  const ready: number[] = [];
  indegree.forEach((d, i) => {
    if (d === 0) ready.push(i);
  });
  const result: T[] = [];
  while (ready.length > 0) {
    // Lowest original index first, so independent nodes keep their order.
    ready.sort((a, b) => a - b);
    const i = ready.shift() as number;
    result.push(nodes[i] as T);
    for (const k of dependents[i] ?? []) {
      indegree[k] = (indegree[k] ?? 0) - 1;
      if (indegree[k] === 0) ready.push(k);
    }
  }
  return result;
}
