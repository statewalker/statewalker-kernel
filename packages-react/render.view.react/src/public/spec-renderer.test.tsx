// Phase 1b coverage (task 4.6): SpecRenderer is a ~15-line, zero-project-logic
// passthrough — it casts spec/registry/store/handlers out of `unknown` and hands
// them to @json-render/react's <JSONUIProvider> + <Renderer>. There is no own
// behavior to unit-assert, so LABELED SMOKE is the honest tier here (per design):
// mount a minimal REAL json-render registry + spec and prove it wires up without
// throwing. The output assertion keeps it non-tautological — a passthrough that
// failed to mount the Renderer would render nothing, and this would fail.
import { defineCatalog } from "@json-render/core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { defineRegistry, SpecRenderer, schema } from "./index.js";

// A one-component real catalog + registry: "Text" renders its `text` prop.
function buildTextRegistry() {
  const catalog = defineCatalog(schema, {
    components: { Text: { props: {}, slots: [], description: "renders text" } },
  } as never);
  const { registry } = defineRegistry(catalog, {
    components: {
      Text: ({ props }: { props: { text?: string } }) => <span>{props.text}</span>,
    },
  } as never);
  return registry;
}

describe("SpecRenderer (smoke)", () => {
  // smoke: mounts a real registry + spec through the json-render boundary
  // without throwing, and the wrapped Renderer produces the spec's output.
  it("renders a minimal real json-render spec through the boundary", () => {
    const registry = buildTextRegistry();
    const spec = {
      root: "t",
      elements: { t: { type: "Text", props: { text: "SPEC-RENDERED" } } },
    };
    render(<SpecRenderer spec={spec} registry={registry} />);
    expect(screen.getByText("SPEC-RENDERED")).toBeTruthy();
  });

  // smoke: the optional store/handlers props are forwarded to JSONUIProvider;
  // passing them (even unused by this spec) must not break the mount.
  it("mounts with the optional store/handlers props supplied", () => {
    const registry = buildTextRegistry();
    const spec = {
      root: "t",
      elements: { t: { type: "Text", props: { text: "WITH-OPTS" } } },
    };
    render(<SpecRenderer spec={spec} registry={registry} store={undefined} handlers={{}} />);
    expect(screen.getByText("WITH-OPTS")).toBeTruthy();
  });
});
