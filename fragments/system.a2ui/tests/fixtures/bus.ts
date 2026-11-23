// A command bus with the shape surfaces call (`call(id, input)`): handlers by command id.
export interface TestBus {
  call(id: string, input?: unknown, options?: { caller?: unknown }): Promise<unknown>;
  /** The options of each call, in order. */
  readonly calls: { id: string; options?: { caller?: unknown } }[];
  listen(id: string, handler: (input: unknown) => unknown): void;
}

export function createTestBus(): TestBus {
  const handlers = new Map<string, (input: unknown) => unknown>();
  const calls: TestBus["calls"] = [];
  return {
    calls,
    listen: (id, handler) => void handlers.set(id, handler),
    async call(id, input, options) {
      calls.push({ id, options });
      const handler = handlers.get(id);
      if (!handler) throw new Error(`unknown command ${id}`);
      return handler(input);
    },
  };
}
