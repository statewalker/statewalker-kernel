// A command bus with the shape surfaces call (`call(id, input)`): handlers by command id.
export interface TestBus {
  call(id: string, input?: unknown): Promise<unknown>;
  listen(id: string, handler: (input: unknown) => unknown): void;
}

export function createTestBus(): TestBus {
  const handlers = new Map<string, (input: unknown) => unknown>();
  return {
    listen: (id, handler) => void handlers.set(id, handler),
    async call(id, input) {
      const handler = handlers.get(id);
      if (!handler) throw new Error(`unknown command ${id}`);
      return handler(input);
    },
  };
}
