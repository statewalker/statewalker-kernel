import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useRef } from "react";
import type { z } from "zod";
import type { RenderProps } from "../../src/index.js";
import type { mapViewEvents, mapViewProps } from "./map-view.js";

type Props = RenderProps<z.infer<typeof mapViewProps>, typeof mapViewEvents>;
type Marker = Props["props"]["markers"][number];

const icon = (m: Marker) => {
  const el = document.createElement("span");
  el.className = "map-marker";
  el.dataset.markerId = m.id;
  el.textContent = m.label;
  return L.divIcon({ html: el, className: "map-marker-icon", iconSize: undefined });
};

/**
 * One Leaflet map per mounted node. Markers are reconciled by id; center/zoom are applied
 * only when the agent changes them, so the user's own panning is not undone on every render.
 */
export default function MapViewView({ props, emit }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map>(null);
  const layer = useRef<L.LayerGroup>(null);
  const route = useRef<L.GeoJSON>(null);
  const markers = useRef(new Map<string, { marker: L.Marker; data: Marker }>());
  const emitRef = useRef(emit);
  emitRef.current = emit;

  useEffect(() => {
    const m = L.map(host.current!, { zoomControl: true, attributionControl: false });
    m.setView(props.center, props.zoom);
    layer.current = L.layerGroup().addTo(m);
    route.current = L.geoJSON(undefined, { style: { color: "#3367d6", weight: 2 } }).addTo(m);
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
      markers.current.clear();
    };
  }, []);

  const [lat, lng] = props.center;
  useEffect(() => {
    map.current?.setView([lat, lng], props.zoom);
  }, [lat, lng, props.zoom]);

  useEffect(() => {
    const group = layer.current;
    if (!group) return;
    const seen = new Set<string>();
    for (const data of props.markers) {
      seen.add(data.id);
      const known = markers.current.get(data.id);
      if (!known) {
        const marker = L.marker([data.lat, data.lng], { icon: icon(data), title: data.label });
        marker.on("click", () => emitRef.current("select", { id: data.id }));
        marker.addTo(group);
        markers.current.set(data.id, { marker, data });
      } else if (known.data !== data) {
        if (known.data.lat !== data.lat || known.data.lng !== data.lng)
          known.marker.setLatLng([data.lat, data.lng]);
        if (known.data.label !== data.label) known.marker.setIcon(icon(data));
        known.data = data;
      }
    }
    for (const [id, { marker }] of markers.current) {
      if (!seen.has(id)) {
        marker.remove();
        markers.current.delete(id);
      }
    }
    route.current?.clearLayers().addData({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: props.markers.map((m) => [m.lng, m.lat]) },
    } as GeoJSON.Feature);
  }, [props.markers]);

  return <div ref={host} className="map-view" style={{ height: 280 }} />;
}
