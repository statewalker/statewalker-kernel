import { DurableObject } from "cloudflare:workers";

interface Env {
  COUNTER: DurableObjectNamespace<Counter>;
}

export class Counter extends DurableObject {
  async increment(by: number): Promise<number> {
    const value = ((await this.ctx.storage.get<number>("value")) ?? 0) + by;
    await this.ctx.storage.put("value", value);
    return value;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const by = Number(new URL(request.url).searchParams.get("by") ?? "1");
    const counter = env.COUNTER.get(env.COUNTER.idFromName("main"));
    return Response.json({ value: await counter.increment(by) });
  },
};
