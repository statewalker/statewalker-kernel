// The client half of notes-export (statewalker/statewalker-root#261): its action on the notes view,
// the `export-notes` command, and the Exports view. Every export is kept by its server half's DO.
// `export-slowly` runs from system.tasks' queue (statewalker/statewalker-root#409): the Exports view
// starts it, follows its job log (after the last stamp it showed, over reloads) and cancels it.
// React, the shadcn primitives and the client API come from the shell's import map.
import { commands, servers } from "@statewalker/client.core";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@statewalker/ui.view.shadcn";
import { useEffect, useState, useSyncExternalStore } from "react";

const ID = "org.statewalker.notes-export";
const LIST_NOTES = "org.statewalker.notes/list-notes";
const server = servers.of(ID);

/** One export, as the server half keeps it. */
interface Export {
  readonly id: number;
  readonly count: number;
  readonly text: string;
  readonly at: number;
}

let exports: readonly Export[] = [];
let failure: string | undefined;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const changed = () => {
  for (const listener of [...listeners]) listener();
};

async function call(path: string, init?: RequestInit): Promise<unknown> {
  if (!server.available())
    throw new Error("notes-export needs its server half, which does not run here");
  const res = await server.fetch(path, init);
  const body = await res.text();
  if (!res.ok)
    throw new Error(`notes-export server half: ${res.status} ${body || res.statusText}`.trim());
  return body ? JSON.parse(body) : undefined;
}

/** Read the exports again from the server half. */
async function refresh(): Promise<void> {
  try {
    exports = ((await call("exports")) as { exports: Export[] }).exports;
    failure = undefined;
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }
  changed();
}

async function save(notes: readonly { text: string }[], callId?: string): Promise<Export> {
  const saved = (await call("exports", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      notes: notes.map(({ text }) => ({ text })),
      ...(callId ? { call: callId } : {}),
    }),
  })) as Export;
  exports = [...exports.filter((e) => e.id !== saved.id), saved];
  changed();
  return saved;
}

/** The action on the notes view: export the notes as shown. */
export async function exportAction({
  notes,
}: {
  notes: readonly { text: string }[];
}): Promise<{ message: string }> {
  const saved = await save(notes);
  return { message: `Exported ${saved.count} notes (export ${saved.id})` };
}

/** The `export-notes` command: export the notes the notes fragment lists. */
export async function exportNotes(): Promise<{ id: number; count: number }> {
  const { notes } = await commands.call<{ notes: { text: string }[] }>(LIST_NOTES);
  const saved = await save(notes);
  return { id: saved.id, count: saved.count };
}

/** What a handler gets beside its input (system.commands' `CommandContext`, as far as used here). */
interface HandlerContext {
  readonly callId: string;
  readonly signal: AbortSignal;
  progress(entry: unknown): Promise<void>;
}

/** Waits `ms`, or rejects with the signal's reason once it aborts. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

/**
 * `export-slowly`, run from system.tasks' queue (the `task` exposure): the notes one by one, each
 * after `delay_ms`, progress after each, then the export, kept by the DO under the task's id: a
 * task run again (at least once) answers the export it already made.
 */
export async function exportSlowly(
  { delay_ms = 500 }: { delay_ms?: number },
  context: HandlerContext,
): Promise<{ id: number; count: number }> {
  const { notes } = await commands.call<{ notes: { text: string }[] }>(LIST_NOTES);
  await context.progress({ done: 0, total: notes.length });
  for (let i = 0; i < notes.length; i++) {
    await sleep(delay_ms, context.signal);
    await context.progress({ done: i + 1, total: notes.length });
  }
  const saved = await save(notes, context.callId);
  return { id: saved.id, count: saved.count };
}

const SLOWLY_SUBJECT = `fragments.${ID}.export-slowly`;
/** The run the Exports view follows, kept over reloads (this origin's storage). */
const RUN_KEY = `${ID}:run`;

/** A task run as the view shows it: what its job log said so far, after its last stamp. */
interface Run {
  readonly task: string;
  job?: string;
  /** The last stamp read: the next read is after it. */
  after?: number;
  state: "waiting" | "running" | "done" | "error" | "cancelled";
  /** Each progress entry read, in order: `done of total notes`. */
  log: string[];
  /** The reply, once the run ended: the export, or the error. */
  reply?: string;
  /** Why the last read failed, while it is tried again. */
  trouble?: string;
}

let run: Run | undefined = load();
const saveRun = () => {
  try {
    if (run) localStorage.setItem(RUN_KEY, JSON.stringify(run));
    else localStorage.removeItem(RUN_KEY);
  } catch {
    // no storage: the run is followed while the page lives
  }
  changed();
};
function load(): Run | undefined {
  try {
    const text = localStorage.getItem(RUN_KEY);
    return text ? (JSON.parse(text) as Run) : undefined;
  } catch {
    return undefined;
  }
}

const ended = (r: Run) => r.state === "done" || r.state === "error" || r.state === "cancelled";
let following: string | undefined;

/** The reply of a run's latest job, as system.tasks' job index has it. */
function replyText(reply: unknown): string | undefined {
  const r = reply as {
    result?: { id: number; count: number };
    error?: string;
    cancelled?: boolean;
  };
  if (!r) return undefined;
  if (r.result) return `Exported ${r.result.count} notes (export ${r.result.id})`;
  if (r.cancelled) return "Cancelled";
  if (r.error) return `Failed: ${r.error}`;
  return undefined;
}

/**
 * Follow the run's job log from its last stamp until it ends: find its job (system.tasks/jobs),
 * read the log after the last stamp (system.tasks/job, waiting for entries), and take the reply
 * from the job index once the log ends. Survives a reload: the run and its stamp are kept.
 */
async function follow(current: Run): Promise<void> {
  if (following === current.task) return;
  following = current.task;
  try {
    while (run === current && !ended(current)) {
      try {
        await step(current);
        delete current.trouble;
      } catch (error) {
        // A read that failed (the host restarting, a job log gone with its lease): shown, and
        // tried again, so the run is followed until it ends.
        current.trouble = error instanceof Error ? error.message : String(error);
        saveRun();
        await new Promise((r) => setTimeout(r, 1_000));
      }
    }
  } finally {
    if (following === current.task) following = undefined;
  }
}

/** One step of following a run: its latest job, then its log after the last stamp. */
async function step(current: Run): Promise<void> {
  const { jobs } = await commands.call<{ jobs: { job: string; reply?: unknown }[] }>(
    "system.tasks/jobs",
    { task: current.task },
  );
  const latest = jobs.at(-1);
  if (!latest) {
    await new Promise((r) => setTimeout(r, 300));
    return;
  }
  if (current.job !== latest.job) {
    // A new attempt (the last one's runner gone with its page): its log starts afresh.
    if (current.job !== undefined) current.log.push("attempt restarted");
    current.job = latest.job;
    delete current.after;
  }
  const log = await commands.call<{
    entries: { at: number; progress: unknown; outcome?: string }[];
  }>("system.tasks/job", {
    job: current.job,
    ...(current.after !== undefined ? { after: current.after } : {}),
    wait_ms: 5_000,
  });
  for (const entry of log.entries) {
    current.after = entry.at;
    const p = entry.progress as { done?: number; total?: number } | null;
    if (p && typeof p.done === "number" && typeof p.total === "number") {
      current.state = "running";
      current.log.push(`${p.done} of ${p.total} notes`);
    }
    if (entry.outcome === "done" || entry.outcome === "error" || entry.outcome === "cancelled")
      current.state = entry.outcome;
  }
  if (ended(current)) {
    // The reply: the job index has it once the runner has recorded it.
    for (let i = 0; i < 20 && current.reply === undefined; i++) {
      const { jobs: now } = await commands.call<{
        jobs: { job: string; reply?: unknown }[];
      }>("system.tasks/jobs", { task: current.task });
      current.reply = replyText(now.find((j) => j.job === current.job)?.reply);
      if (current.reply === undefined) await new Promise((r) => setTimeout(r, 200));
    }
    if (current.state === "done") await refresh();
  }
  saveRun();
}

/** Start `export-slowly` from the queue, and follow it. */
async function startRun(): Promise<void> {
  const { task } = await commands.call<{ task: string }>("system.tasks/publish", {
    subject: SLOWLY_SUBJECT,
    payload: {},
    wait: false,
  });
  run = { task, state: "waiting", log: [] };
  saveRun();
  void follow(run);
}

/** The run panel: start, the job log as it comes, cancel, the reply. */
function RunPanel() {
  const current = useSyncExternalStore(subscribe, () => run);
  const [, rerender] = useState(0);
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (current && !ended(current)) void follow(current);
  }, [current]);
  // The run object changes in place: re-render on every change.
  useEffect(() => subscribe(() => rerender((n) => n + 1)), []);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={!!current && !ended(current)}
          onClick={() => startRun().catch((e: unknown) => setError(String((e as Error).message)))}
        >
          Export as a task
        </Button>
        {current && !ended(current) && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              commands
                .call("system.tasks/cancel", { task: current.task })
                .catch((e: unknown) => setError(String((e as Error).message)))
            }
          >
            Cancel
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="m-0 text-sm text-destructive">
          {error}
        </p>
      )}
      {current && (
        <div data-testid="export-run" data-state={current.state} className="text-sm">
          <div data-testid="export-run-state">{current.state}</div>
          <ol data-testid="export-run-log" className="m-0 pl-5 text-xs text-muted-foreground">
            {current.log.map((line, i) => (
              // The log only grows: a key by position is stable.
              <li key={i}>{line}</li>
            ))}
          </ol>
          {current.reply && <div data-testid="export-run-reply">{current.reply}</div>}
          {current.trouble && (
            <div data-testid="export-run-trouble" className="text-xs text-muted-foreground">
              {current.trouble}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Whether the queue serves `export-slowly` here (system.tasks runs where server halves run). */
const commandsServed = () => commands.list().some((c) => c.id === "system.tasks/publish");

/** The Exports view: every export, newest first. */
export function ExportsView() {
  const all = useSyncExternalStore(subscribe, () => exports);
  const error = useSyncExternalStore(subscribe, () => failure);
  // The DO is read as the view opens; the count shows once that read has answered.
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    void refresh().then(() => setLoaded(true));
  }, []);
  return (
    <Card data-testid="exports-view" className="m-4">
      <CardHeader>
        <CardTitle>Exports</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error && (
          <p role="alert" className="m-0 text-sm text-destructive">
            {error}
          </p>
        )}
        {commandsServed() && <RunPanel />}
        {loaded && (
          <p data-testid="exports-count" className="m-0 text-xs text-muted-foreground">
            {all.length} exports
          </p>
        )}
        <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
          {[...all].reverse().map((e) => (
            <li key={e.id} data-testid="export" className="rounded-md border px-3 py-2">
              <div className="text-xs text-muted-foreground">
                Export {e.id}: {e.count} notes, {new Date(e.at).toLocaleString()}
              </div>
              <pre className="m-0 whitespace-pre-wrap">{e.text}</pre>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
