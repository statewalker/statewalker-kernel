import type { ReactNode } from "react";
import { A2uiNode, type Registry } from "./renderer.js";

const kids = (children: unknown): ReactNode =>
  Array.isArray(children)
    ? children.map((c, i) => (
        <A2uiNode key={(c as { instanceId?: string })?.instanceId ?? i} node={c} />
      ))
    : null;

/**
 * The basic A2UI components the platform renders (`BASIC_COMPONENTS`), as plain React with
 * shadcn-like utility classes. Text is always text: no markup is ever interpreted.
 */
export const basicRenderers: Registry = {
  Text: ({ props }) => (
    <span className={`a2ui-text ${typeof props.variant === "string" ? props.variant : ""}`}>
      {String(props.text ?? "")}
    </span>
  ),
  Column: ({ props }) => (
    <div className="a2ui-column flex flex-col gap-2">{kids(props.children)}</div>
  ),
  Row: ({ props }) => <div className="a2ui-row flex flex-row gap-2">{kids(props.children)}</div>,
  Card: ({ props }) => (
    <div className="a2ui-card rounded-md border p-3">
      <A2uiNode node={props.child} />
    </div>
  ),
  Button: ({ props }) => (
    <button
      type="button"
      className="rounded-md border px-3 py-1"
      onClick={() => void (typeof props.action === "function" ? props.action() : undefined)}
    >
      <A2uiNode node={props.child} />
    </button>
  ),
};
