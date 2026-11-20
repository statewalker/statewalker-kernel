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

export async function runAgentTurn(processor: MessageProcessor, model: FakeModel) {
  const surfaceIds: string[] = [];
  const sub = processor.onSurfaceCreated((s) => surfaceIds.push(s.id));
  const errors = processor.processMessagesWithErrors(await model());
  sub.unsubscribe();
  return { surfaceIds, errors };
}
