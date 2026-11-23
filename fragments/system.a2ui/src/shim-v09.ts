type Msg = Record<string, unknown>;
type Component = Record<string, unknown>;

/** Enum values 0.9 had and 1.0 dropped, per component property. */
const DROPPED: Record<string, Record<string, string[]>> = {
  Text: { variant: ["h1", "h2", "h3", "h4", "h5"] },
};

function upgradeComponent(c: Component): Component {
  const dropped = Object.hasOwn(DROPPED, c.component as string)
    ? DROPPED[c.component as string]
    : undefined;
  if (!dropped) return c;
  const out = { ...c };
  for (const [prop, values] of Object.entries(dropped)) {
    if (values.includes(out[prop] as string)) delete out[prop];
  }
  return out;
}

/** Whether `msg` is an A2UI v0.9 / v0.9.1 message. */
export function isV09Message(msg: unknown): boolean {
  const version = (msg as Msg | null)?.version;
  return version === "v0.9" || version === "v0.9.1";
}

/**
 * v0.9 / v0.9.1 agent message → A2UI 1.0. Envelope keys are identical; web_core binds a
 * surface to its catalog's spec version, so the version and catalog id must change, and
 * component values that 1.0 removed (Text's heading variants) are dropped, as is the theme.
 * `path` bindings and `call` stay (1.0 accepts both). The upgraded message is validated like any
 * other.
 */
export function upgradeV09Message(msg: Msg, opts: { catalogIds: Record<string, string> }): Msg {
  if (!isV09Message(msg)) return msg;
  const out: Msg = { ...msg, version: "1.0" };
  const cs = msg.createSurface as Msg | undefined;
  if (cs) {
    const id = cs.catalogId as string;
    const catalogId = Object.hasOwn(opts.catalogIds, id) ? opts.catalogIds[id] : id;
    const { theme: _theme, ...rest } = cs; // 1.0 moved theming out of createSurface
    out.createSurface = {
      ...rest,
      catalogId,
      ...(Array.isArray(cs.components) ? { components: cs.components.map(upgradeComponent) } : {}),
    };
  }
  const uc = msg.updateComponents as Msg | undefined;
  if (uc && Array.isArray(uc.components)) {
    out.updateComponents = { ...uc, components: uc.components.map(upgradeComponent) };
  }
  return out;
}
