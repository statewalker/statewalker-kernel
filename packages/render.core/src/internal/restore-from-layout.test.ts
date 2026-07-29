import { describe, expect, it } from "vitest";
import { restorePanelSpecsFromLayout } from "../public/restore-from-layout.js";
import { SpecStore } from "../public/spec-store.js";

const setup = (layout: object | null | undefined) => ({
  store: new SpecStore(),
  layout,
  panelIdPrefix: "pdf-viewer:",
  catalogId: "pdf-viewer",
  buildSpec: (uri: string) => ({ root: "panel", elements: { panel: { uri } } }) as never,
  buildSpecId: (uri: string) => `spec:pdf-viewer:${uri}`,
});

describe("restorePanelSpecsFromLayout", () => {
  it("creates one spec per matching panel id", () => {
    const env = setup({
      panels: {
        "pdf-viewer:/a.pdf": {},
        "pdf-viewer:/b.pdf": {},
        "image-viewer:/c.png": {},
      },
    });
    restorePanelSpecsFromLayout(env);
    expect(env.store.get("spec:pdf-viewer:/a.pdf")).not.toBeNull();
    expect(env.store.get("spec:pdf-viewer:/b.pdf")).not.toBeNull();
    expect(env.store.get("spec:image-viewer:/c.png")).toBeNull();
  });

  it("ignores entries without a suffix after the prefix", () => {
    const env = setup({
      panels: { "pdf-viewer:": {}, "pdf-viewer:/x.pdf": {} },
    });
    restorePanelSpecsFromLayout(env);
    expect(env.store.get("spec:pdf-viewer:")).toBeNull();
    expect(env.store.get("spec:pdf-viewer:/x.pdf")).not.toBeNull();
  });

  it("is idempotent — re-running does not throw", () => {
    const env = setup({ panels: { "pdf-viewer:/a.pdf": {} } });
    restorePanelSpecsFromLayout(env);
    expect(() => restorePanelSpecsFromLayout(env)).not.toThrow();
  });

  it("no-ops when the layout is null", () => {
    const env = setup(null);
    expect(() => restorePanelSpecsFromLayout(env)).not.toThrow();
    expect(env.store.get("spec:pdf-viewer:/anything")).toBeNull();
  });

  it("no-ops when the layout is undefined", () => {
    const env = setup(undefined);
    restorePanelSpecsFromLayout(env);
    expect(env.store.get("spec:pdf-viewer:/anything")).toBeNull();
  });

  it("survives layouts with a non-object panels field", () => {
    const env = setup({ panels: null } as unknown as object);
    expect(() => restorePanelSpecsFromLayout(env)).not.toThrow();
  });

  it("uses caller-supplied meta", () => {
    const env = setup({ panels: { "pdf-viewer:/a.pdf": {} } });
    restorePanelSpecsFromLayout({ ...env, meta: { custom: 42 } });
    expect(env.store.get("spec:pdf-viewer:/a.pdf")?.meta).toEqual({ custom: 42 });
  });
});
