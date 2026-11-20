import type { MessageProcessor } from "@a2ui/web_core";
import { PROTO_CATALOG_ID } from "./catalog.js";

export type FakeModel = () => Promise<Record<string, unknown>[]>;

/** A scripted "model": always returns the same A2UI 1.0 messages. */
export const fakeModel: FakeModel = async () => [
  {
    version: "1.0",
    createSurface: {
      surfaceId: "confirm-delete",
      catalogId: PROTO_CATALOG_ID,
      components: [
        { id: "root", component: "Column", children: ["intro", "card"] },
        { id: "intro", component: "Text", text: "The agent wants to clean up." },
        {
          id: "card",
          component: "ConfirmCard",
          title: "Delete 3 files?",
          body: "a.txt, b.txt and c.txt will be removed from the workspace.",
          confirmLabel: "Delete",
        },
      ],
    },
  },
];

const INITIAL_TEXT = "# Trip notes\n\n- Berlin: museums\n- Paris: food\n";

export const PLACES = [
  { id: "ber", lat: 52.52, lng: 13.405, label: "Berlin" },
  { id: "par", lat: 48.857, lng: 2.352, label: "Paris" },
  { id: "ams", lat: 52.37, lng: 4.895, label: "Amsterdam" },
];

/** A scripted turn placing our complex components, bound to the surface data model. */
export const complexModel: FakeModel = async () => [
  {
    version: "1.0",
    createSurface: {
      surfaceId: "workbench",
      catalogId: PROTO_CATALOG_ID,
      components: [
        { id: "root", component: "Column", children: ["intro", "editor", "map"] },
        { id: "intro", component: "Text", text: "Draft the trip notes; pick a city on the map." },
        {
          id: "editor",
          component: "CodeEditor",
          value: { "@path": "/doc/text" },
          language: "markdown",
        },
        {
          id: "map",
          component: "MapView",
          center: [47.5, 8],
          zoom: 4,
          markers: { "@path": "/places" },
        },
      ],
      dataModel: {
        doc: { text: INITIAL_TEXT },
        places: PLACES,
      },
    },
  },
];

/** What the agent sends later: more text at the end of the document and one more city. */
/** What the agent sends later: one more city, and a line appended to the document. */
export const agentDataUpdate = (currentText = INITIAL_TEXT) => [
  {
    version: "1.0",
    updateDataModel: {
      surfaceId: "workbench",
      path: "/places",
      value: [...PLACES, { id: "rom", lat: 41.9, lng: 12.496, label: "Rome" }],
    },
  },
  {
    version: "1.0",
    updateDataModel: {
      surfaceId: "workbench",
      path: "/doc/text",
      value: `${currentText.replace(/\n*$/, "\n")}- Rome: added by the agent\n`,
    },
  },
];

export async function runAgentTurn(processor: MessageProcessor, model: FakeModel) {
  const surfaceIds: string[] = [];
  const sub = processor.onSurfaceCreated((s) => surfaceIds.push(s.id));
  const errors = processor.processMessagesWithErrors(await model());
  sub.unsubscribe();
  return { surfaceIds, errors };
}
