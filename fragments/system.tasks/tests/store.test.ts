// The queue's store as the fragment's DO serves it (statewalker/statewalker-root#409): only the
// store's named operations run, a reader crosses without its functions, and absent arguments keep
// their places through JSON.
import { TaskQueue } from "@statewalker/shared-tasks";
import { describe, expect, it } from "vitest";
import {
  QueueOperationError,
  remoteQueueStore,
  serveQueueStore,
  TASKS_PROJECT,
} from "../src/index.js";
import { sqlite } from "./helpers.js";

const P = TASKS_PROJECT;

describe("serveQueueStore", () => {
  it.each([
    ["not an object", "publish"],
    ["an unknown kind", { kind: "sql", method: "exec", args: [] }],
    ["a method the store does not name", { kind: "queue", method: "listTasks", args: [P] }],
    ["the queue's private parts", { kind: "queue", method: "constructor", args: [] }],
    [
      "an api method it does not name",
      { kind: "api", reader: { id: "a", destinations: [] }, method: "publish", args: [] },
    ],
    ["args that are not a list", { kind: "queue", method: "changeSeq", args: P }],
    [
      "a reader without an id",
      { kind: "api", reader: { destinations: [] }, method: "claim", args: [P, "x"] },
    ],
  ])("refuses %s", async (_label, operation) => {
    const serve = serveQueueStore(new TaskQueue(sqlite().sql));
    await expect(serve(operation)).rejects.toBeInstanceOf(QueueOperationError);
  });

  it("runs the store's operations through JSON, absent arguments in their places", async () => {
    const serve = serveQueueStore(new TaskQueue(sqlite().sql));
    const sent: unknown[] = [];
    const store = remoteQueueStore(async (operation) => {
      const wire = JSON.parse(JSON.stringify(operation));
      sent.push(wire);
      const answer = await serve(wire);
      return answer === undefined ? undefined : JSON.parse(JSON.stringify(answer));
    });
    await store.subscribe(P, { name: "s", filter: { subject: "fragments.a.b" } }, "system:tasks");
    const task = await store.publish(P, { subject: "fragments.a.b", payload: { n: 1 } }, "user");
    // `after` absent: the counter at once, `waitMs` still the third argument.
    expect(typeof (await store.waitChange(P, undefined, 10))).toBe("number");
    expect(sent.at(-1)).toMatchObject({ args: [P, null, 10] });
    const api = store.api({ id: "system:tasks", destinations: [], admin: true });
    const {
      leases: [lease],
    } = await api.claim(P, "s");
    expect(lease?.task.id).toBe(task.id);
    await api.ack(String(lease?.id));
    expect((await store.listSubscriptions(P)).find((s) => s.name === "s")?.counts).toMatchObject({
      waiting: 0,
    });
  });
});
