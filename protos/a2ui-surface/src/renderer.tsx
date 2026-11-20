import {
  type ComponentNode,
  effect,
  getValue,
  isComponentNode,
  NodeResolver,
  peekValue,
  ResolvedBinding,
  type Signal,
  type SurfaceModel,
} from "@a2ui/web_core";
import {
  type ComponentType,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import type { RenderProps } from "./define-component.js";

/** Catalog component name → React implementation. Nothing else is renderable. */
export type Registry = Record<string, ComponentType<RenderProps<any, any>>>;

const Ctx = createContext<{ surface: SurfaceModel; registry: Registry } | null>(null);

/** A component's event enters A2UI's action path; the action router maps it to a command. */
export function emitComponentEvent(
  surface: SurfaceModel,
  componentId: string,
  name: string,
  payload: unknown,
) {
  return surface.dispatchAction({ event: { name, context: payload } }, componentId);
}

function useSignal<T>(s: Signal<T>): T {
  const subscribe = useCallback(
    (onChange: () => void) => {
      let first = true;
      return effect(() => {
        getValue(s); // track
        if (!first) onChange();
        first = false;
      });
    },
    [s],
  );
  const get = () => peekValue(s);
  return useSyncExternalStore(subscribe, get, get);
}

/** ResolvedBinding → plain value; child nodes, arrays and bound actions pass through. */
function unwrap(v: unknown): unknown {
  if (v instanceof ResolvedBinding) return v.value;
  if (Array.isArray(v)) return v.map(unwrap);
  return v;
}

export function A2uiNode({ node }: { node: unknown }) {
  const ctx = useContext(Ctx);
  if (!ctx || !isComponentNode(node)) return null;
  return <ResolvedNode node={node} />;
}

function ResolvedNode({ node }: { node: ComponentNode }) {
  const ctx = useContext(Ctx);
  const raw = useSignal(node.props);
  if (!ctx) return null;
  const Impl = Object.hasOwn(ctx.registry, node.type) ? ctx.registry[node.type] : undefined;
  if (node.state === "pending") return <span data-a2ui-pending={node.componentId} />;
  if (node.state !== "resolved" || !Impl) {
    // Untrusted spec: never render what is not a registered catalog component.
    return (
      <span data-a2ui-refused={node.type} className="a2ui-refused">
        [refused: {node.type}]
      </span>
    );
  }
  const props = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, unwrap(v)]));
  const emit = (name: string, payload: unknown) =>
    void emitComponentEvent(ctx.surface, node.componentId, name, payload);
  return (
    <div data-a2ui={node.type} style={{ display: "contents" }}>
      <Impl props={props} emit={emit} />
    </div>
  );
}

export function A2uiSurface({ surface, registry }: { surface: SurfaceModel; registry: Registry }) {
  const [resolver] = useState(() => new NodeResolver(surface, surface.catalog));
  useEffect(() => () => resolver.dispose(), [resolver]);
  const root = useSignal(resolver.rootNode);
  return (
    <Ctx.Provider value={{ surface, registry }}>
      <div data-a2ui-surface={surface.id}>{root ? <ResolvedNode node={root} /> : null}</div>
    </Ctx.Provider>
  );
}
