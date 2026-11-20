import { MessageProcessor, type SurfaceModel } from "@a2ui/web_core";
import { Commands } from "@statewalker/shared-commands";
import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  type ActionRequest,
  createActionRouter,
  type LogEntry,
  type PolicyDecision,
} from "./actions.js";
import { fakeModel, runAgentTurn } from "./agent.js";
import { ConfirmCommand, protoCatalog, protoComponents, protoRegistry } from "./catalog.js";
import { A2uiSurface } from "./renderer.js";

function App() {
  const [policy, setPolicy] = useState<PolicyDecision>("ask");
  const [log, setLog] = useState<LogEntry[]>([]);
  const [asking, setAsking] = useState<{ req: ActionRequest; answer: (ok: boolean) => void }>();
  const [deleted, setDeleted] = useState<string[]>([]);
  const [surface, setSurface] = useState<SurfaceModel>();
  const policyRef = useMemo(() => ({ current: policy }), []);
  policyRef.current = policy;

  const processor = useMemo(() => {
    const commands = Commands.create();
    commands.listen(ConfirmCommand, async (cmd) => {
      setDeleted((d) => [...d, cmd.payload.title]);
      return { ok: true };
    });
    const router = createActionRouter({
      commands,
      components: protoComponents,
      isAgentSurface: () => true,
      policy: () => policyRef.current,
      approve: (req) =>
        new Promise((resolve) =>
          setAsking({ req, answer: (ok) => (setAsking(undefined), resolve(ok)) }),
        ),
      onLog: (e) => setLog((l) => [...l, e]),
    });
    const p = new MessageProcessor([protoCatalog], router.handle);
    router.attach(p);
    return p;
  }, [policyRef]);

  const run = async () => {
    await runAgentTurn(processor, fakeModel);
    setSurface(processor.getSurface("confirm-delete"));
  };

  return (
    <main>
      <section className="panel">
        <h2>Agent surface</h2>
        {surface ? (
          <A2uiSurface surface={surface} registry={protoRegistry} />
        ) : (
          <button type="button" onClick={run}>
            Run agent turn
          </button>
        )}
        {asking && (
          <div className="ask">
            Agent asks to run <b>{asking.req.commandKey}</b> with{" "}
            <code>{JSON.stringify(asking.req.payload)}</code>{" "}
            <button type="button" onClick={() => asking.answer(true)}>
              Approve
            </button>{" "}
            <button type="button" onClick={() => asking.answer(false)}>
              Deny
            </button>
          </div>
        )}
      </section>
      <section className="panel">
        <h2>Agent action policy</h2>
        <div className="seg">
          {(["allow", "ask", "block"] as const).map((p) => (
            <button key={p} type="button" aria-pressed={policy === p} onClick={() => setPolicy(p)}>
              {p[0]?.toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
        <h2 style={{ marginTop: 12 }}>Event log</h2>
        <ul className="log">
          {log.map((e, i) => (
            <li key={i} className={`o-${e.outcome}`}>
              {e.at.slice(11, 19)} {e.componentId}.{e.event} → {e.commandKey ?? "-"}: {e.outcome}
            </li>
          ))}
          {log.length === 0 && <li>(no events yet)</li>}
        </ul>
        <h2 style={{ marginTop: 12 }}>Platform state</h2>
        <pre>
          {JSON.stringify(
            { policy, pendingApproval: asking?.req.commandKey ?? null, confirmed: deleted },
            null,
            2,
          )}
        </pre>
      </section>
    </main>
  );
}

const el = document.getElementById("root");
if (el) createRoot(el).render(<App />);
