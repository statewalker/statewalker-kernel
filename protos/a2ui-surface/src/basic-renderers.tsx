import type { ReactNode } from "react";
import { A2uiNode, type Registry } from "./renderer.js";

/** The basic A2UI components this prototype needed, as plain React (stand-in for shadcn). */
const kids = (children: unknown): ReactNode =>
  Array.isArray(children)
    ? children.map((c, i) => (
        <A2uiNode key={(c as { instanceId?: string })?.instanceId ?? i} node={c} />
      ))
    : null;

export const basicRenderers: Registry = {
  Text: ({ props }) => (
    <span className={`a2ui-text ${props.variant ?? ""}`}>{String(props.text ?? "")}</span>
  ),
  Column: ({ props }) => <div className="a2ui-column">{kids(props.children)}</div>,
  Row: ({ props }) => <div className="a2ui-row">{kids(props.children)}</div>,
  Card: ({ props }) => (
    <div className="a2ui-card">
      <A2uiNode node={props.child} />
    </div>
  ),
  Button: ({ props }) => (
    <button type="button" onClick={() => void props.action?.()}>
      <A2uiNode node={props.child} />
    </button>
  ),
};
