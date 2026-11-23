import { lazy } from "react";
import { z } from "zod";
import { defineComponent } from "../../src/index.js";

export const SELECT_PLACE = "org.example.proto/select-place";

export const mapViewProps = z.object({
  center: z.tuple([z.number(), z.number()]),
  zoom: z.number(),
  markers: z.array(
    z.object({ id: z.string(), lat: z.number(), lng: z.number(), label: z.string() }),
  ),
});
export const mapViewEvents = z.object({ select: z.object({ id: z.string() }) });

export const MapView = defineComponent({
  name: "MapView",
  description:
    "A map with labelled markers (no tiles). `center` and `zoom` move the view when the " +
    "agent changes them; bind `markers` to a data-model list. `select` fires on a marker click.",
  props: mapViewProps,
  events: mapViewEvents,
  commands: { select: SELECT_PLACE },
  render: lazy(() => import("./map-view-view.js")),
});
