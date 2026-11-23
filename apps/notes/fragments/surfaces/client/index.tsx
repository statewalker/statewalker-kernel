// The client half of the surfaces demo: the NoteEditor catalog component (a light definition,
// its CodeMirror view loaded on first placement) and a view placing a surface with it, as an
// agent would. React and system.a2ui come from the shell's import map, never bundled here.
import { defineComponent, installedA2ui } from "@statewalker/system.a2ui";
import { A2uiSurfaceView } from "@statewalker/system.a2ui/client";
import { lazy, useEffect, useState } from "react";
import { z } from "zod";

export const NoteEditor = defineComponent({
  name: "NoteEditor",
  description:
    "A plain-text editor. Bind `value` to a data-model path: the user's edits are written back " +
    "there, and new values pushed there are applied in place, keeping the cursor and undo history.",
  props: z.object({ value: z.string() }),
  events: z.object({}),
  render: lazy(() => import("./note-editor-view.js")),
});

const SURFACE = "demo";

/** The surface an agent would send: a heading and the editor bound to `/doc/text`. */
const createDemoSurface = (catalogId: string) => ({
  version: "1.0",
  createSurface: {
    surfaceId: SURFACE,
    catalogId,
    components: [
      { id: "root", component: "Column", children: ["intro", "editor"] },
      { id: "intro", component: "Text", text: "Draft the trip notes with the agent." },
      { id: "editor", component: "NoteEditor", value: { "@path": "/doc/text" } },
    ],
    dataModel: { doc: { text: "Trip notes\n- Berlin: museums\n- Paris: food" } },
  },
});

/** The demo view: places the surface once (as an agent), and shows it inline. */
export function SurfacesView() {
  const [error, setError] = useState<string>();
  const [ready, setReady] = useState(() => installedA2ui().surface(SURFACE) !== undefined);
  useEffect(() => {
    const a2ui = installedA2ui();
    if (a2ui.surface(SURFACE)) return;
    a2ui
      .process(createDemoSurface(a2ui.catalogId), { origin: "agent", title: "Trip notes" })
      .then(({ errors }) => {
        if (errors.length > 0) setError(JSON.stringify(errors));
        else setReady(true);
      });
  }, []);
  return (
    <div data-testid="surfaces-view" className="flex flex-col gap-3 p-4">
      {error ? <div role="alert">{error}</div> : null}
      {ready ? <A2uiSurfaceView surfaceId={SURFACE} /> : null}
    </div>
  );
}
