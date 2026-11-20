import { Command, passthrough } from "@statewalker/shared-commands";
import { lazy } from "react";
import { z } from "zod";
import { defineComponent } from "../define-component.js";

export const SelectPlaceCommand = Command.required("proto:select-place")
  .input(z.object({ id: z.string() }))
  .output(passthrough<unknown>())
  .label("Select place")
  .build();

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
  commands: { select: SelectPlaceCommand },
  render: lazy(() => import("./map-view-view.js")),
});
