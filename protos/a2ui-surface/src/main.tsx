import type { SurfaceModel } from "@a2ui/web_core";
import { Commands } from "@statewalker/shared-commands";
import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  type ActionRequest,
  createActionRouter,
  type LogEntry,
  type PolicyDecision,
} from "./actions.js";
import { agentDataUpdate, complexModel, fakeModel, runAgentTurn } from "./agent.js";
import {
  ConfirmCommand,
  protoCatalog,
  protoComponents,
  protoRegistry,
  SaveDocumentCommand,
  SelectPlaceCommand,
} from "./catalog.js";
import { createProcessor } from "./processor.js";
import { A2uiSurface } from "./renderer.js";

function App() {
  const [policy, setPolicy] = useState<PolicyDecision>("ask");
  const [log, setLog] = useState<LogEntry[]>([]);
  const [asking, setAsking] = useState<{ req: ActionRequest; answer: (ok: boolean) => void }>();
  const [deleted, setDeleted] = useState<string[]>([]);
  const [surface, setSurface] = useState<SurfaceModel>();
  const [workbench, setWorkbench] = useState<SurfaceModel>();
  const [saved, setSaved] = useState<string>();
  const [selected, setSelected] = useState<string>();
  const policyRef = useMemo(() => ({ current: policy }), []);
  policyRef.current = policy;

  const processor = useMemo(() => {
    const commands = Commands.create();
    commands.listen(ConfirmCommand, async (cmd) => {
      setDeleted((d) => [...d, cmd.payload.title]);
      return { ok: true };
    });
    commands.listen(SaveDocumentCommand, async (cmd) => {
      setSaved(cmd.payload.value);
      return { ok: true };
    });
    commands.listen(SelectPlaceCommand, async (cmd) => {
      setSelected(cmd.payload.id);
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
    const p = createProcessor([protoCatalog], router.handle);
    router.attach(p);
    return p;
  }, [policyRef]);

  const run = async () => {
    await runAgentTurn(processor, fakeModel);
    setSurface(processor.getSurface("confirm-delete"));
  };

  const runComplex = async () => {
    await runAgentTurn(processor, complexModel);
    setWorkbench(processor.getSurface("workbench"));
  };
  const pushUpdate = () => {
    const text = workbench?.dataModel.get("/doc/text") as string | undefined;
    processor.processMessages(agentDataUpdate(text) as any);
  };

  return (
    <main>
      <section className="panel wide">
        <h2>Agent surface: complex components (CodeEditor, MapView)</h2>
        {workbench ? (
          <>
            <A2uiSurface surface={workbench} registry={protoRegistry} />
            <button type="button" data-push onClick={pushUpdate} style={{ marginTop: 8 }}>
              Simulate agent data-model update
            </button>
          </>
        ) : (
          <button type="button" data-run-complex onClick={runComplex}>
            Run complex agent turn
          </button>
        )}
      </section>
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
            {
              policy,
              pendingApproval: asking?.req.commandKey ?? null,
              confirmed: deleted,
              savedDocument: saved ?? null,
              selectedPlace: selected ?? null,
            },
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
