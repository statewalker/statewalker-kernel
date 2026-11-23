// Zones, device modes and layouts: what the workbench keeps of where open views are, per device
// mode. React-free; the client renders a layout as its mode's chrome.

/** The workbench's zones: a view sits in one of them. */
export const ZONES = ["center", "left", "right", "bottom"] as const;
export type Zone = (typeof ZONES)[number];

/** The device modes, chosen by the window's width (`deviceModeOf`). */
export const DEVICE_MODES = ["phone", "tablet", "desktop"] as const;
export type DeviceMode = (typeof DEVICE_MODES)[number];

/** The smallest widths (CSS pixels) of the tablet and desktop modes; narrower is a phone. */
export const DEVICE_BREAKPOINTS = Object.freeze({ tablet: 640, desktop: 1024 });

/** The device mode of a window `width` CSS pixels wide. */
export function deviceModeOf(width: number): DeviceMode {
  if (width >= DEVICE_BREAKPOINTS.desktop) return "desktop";
  if (width >= DEVICE_BREAKPOINTS.tablet) return "tablet";
  return "phone";
}

/** Where open views are: the views of each zone, in tab order, and the active one. */
export interface WorkbenchLayout {
  readonly zones: Readonly<Record<Zone, readonly string[]>>;
  /** The view shown in front (on a phone, the one panel shown). */
  readonly active?: string;
}

/** A default layout, as the `layouts` point (and the host) contribute it. */
export interface LayoutContribution {
  /** The device mode it is for; every mode when absent. */
  readonly mode?: DeviceMode;
  /** Views (`<fragment-id>/<view-id>`) per zone. */
  readonly zones: Readonly<Partial<Record<Zone, readonly string[]>>>;
  readonly active?: string;
}

/** The current version of a saved layout (`SavedLayout.version`). */
export const LAYOUT_VERSION = 1;

/**
 * A layout as the profile keeps it, under `layoutKey(mode)`: version 1. It may name views that
 * are not there (yet): they are kept, and shown when they arrive.
 */
export interface SavedLayout extends WorkbenchLayout {
  readonly version: typeof LAYOUT_VERSION;
}

/** The profile key of a device mode's saved layout: `workbench/layouts/<mode>`. */
export function layoutKey(mode: DeviceMode): string {
  return `workbench/layouts/${mode}`;
}

/** A layout with every zone empty. */
export function emptyLayout(): WorkbenchLayout {
  return { zones: { center: [], left: [], right: [], bottom: [] } };
}

const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((v) => typeof v === "string");

/** A saved layout read back, or `undefined` when it is not one this version reads. */
export function readSavedLayout(value: unknown): WorkbenchLayout | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { version, zones, active } = value as Record<string, unknown>;
  if (version !== LAYOUT_VERSION || typeof zones !== "object" || zones === null) return undefined;
  const read = emptyLayout().zones as Record<Zone, readonly string[]>;
  for (const zone of ZONES) {
    const ids = (zones as Record<string, unknown>)[zone];
    if (ids === undefined) continue;
    if (!isStrings(ids)) return undefined;
    read[zone] = [...ids];
  }
  return { zones: read, ...(typeof active === "string" ? { active } : {}) };
}

/** `layout` as the profile keeps it. */
export function toSaved(layout: WorkbenchLayout): SavedLayout {
  return {
    version: LAYOUT_VERSION,
    zones: Object.fromEntries(ZONES.map((z) => [z, [...layout.zones[z]]])) as Record<
      Zone,
      string[]
    >,
    ...(layout.active !== undefined ? { active: layout.active } : {}),
  };
}

/**
 * The default layout of `mode`: the contributions for that mode or every mode, in order, each
 * view in the first zone that names it; the first `active` given.
 */
export function defaultLayout(
  mode: DeviceMode,
  contributions: readonly LayoutContribution[],
): WorkbenchLayout {
  const zones = emptyLayout().zones as Record<Zone, string[]>;
  const seen = new Set<string>();
  let active: string | undefined;
  for (const contribution of contributions) {
    if (contribution.mode !== undefined && contribution.mode !== mode) continue;
    for (const zone of ZONES) {
      for (const id of contribution.zones[zone] ?? []) {
        if (seen.has(id)) continue;
        seen.add(id);
        zones[zone].push(id);
      }
    }
    active ??= contribution.active;
  }
  return { zones, ...(active !== undefined ? { active } : {}) };
}

/** Every view `layout` names, zone by zone. */
export function viewsOf(layout: WorkbenchLayout): string[] {
  return ZONES.flatMap((zone) => layout.zones[zone]);
}

/** The zone of `id` in `layout`, if any. */
export function zoneIn(layout: WorkbenchLayout, id: string): Zone | undefined {
  return ZONES.find((zone) => layout.zones[zone].includes(id));
}

/** `layout` with only the views `live` keeps; an active view left out is no longer active. */
export function filterLayout(
  layout: WorkbenchLayout,
  live: (id: string) => boolean,
): WorkbenchLayout {
  const zones = Object.fromEntries(
    ZONES.map((zone) => [zone, layout.zones[zone].filter(live)]),
  ) as Record<Zone, string[]>;
  const { active } = layout;
  // The active view must be one shown.
  const shown = active !== undefined && ZONES.some((zone) => zones[zone].includes(active));
  return shown ? { zones, active } : { zones };
}

/**
 * `layout` with `id` moved to `zone` (out of any other), before the `index`-th view `live`
 * keeps there (the end by default): indexes count only the views shown.
 */
export function placeView(
  layout: WorkbenchLayout,
  id: string,
  zone: Zone,
  live: (id: string) => boolean,
  index?: number,
): WorkbenchLayout {
  const zones = Object.fromEntries(
    ZONES.map((z) => [z, layout.zones[z].filter((v) => v !== id)]),
  ) as Record<Zone, string[]>;
  const target = zones[zone];
  let at = target.length;
  if (index !== undefined) {
    let shown = 0;
    for (let i = 0; i < target.length; i++) {
      if (!live(target[i] as string)) continue;
      if (shown === index) {
        at = i;
        break;
      }
      shown++;
    }
  }
  target.splice(at, 0, id);
  return { zones, ...(layout.active !== undefined ? { active: layout.active } : {}) };
}

/** `layout` without the views `drop` names. */
export function withoutViews(layout: WorkbenchLayout, drop: (id: string) => boolean) {
  return filterLayout(layout, (id) => !drop(id));
}
