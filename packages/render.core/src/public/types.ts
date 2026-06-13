/**
 * A json-render spec is an arbitrary JSON shape; the SpecStore does
 * not introspect it, so we type it as `unknown`. Consumers cast at
 * the rendering boundary (inside JsonPanel).
 */
export type Spec = unknown;

export interface SpecMeta {
  /**
   * When `true`, the spec survives panel close — the dock fragment
   * does NOT delete the spec when the last subscribing panel
   * unmounts. Used for chat-session specs (rebuilt deterministically
   * from on-disk session metadata) and any other long-lived spec.
   * When unset / `false`, the dock fragment evicts the spec on last
   * panel unmount.
   */
  persistent?: boolean;
  [key: string]: unknown;
}

export interface SpecRecord {
  catalogId: string;
  spec: Spec;
  meta: SpecMeta;
}

export interface SpecCreateInput {
  /** Caller-supplied id; if omitted, the store generates `"spec:" + crypto.randomUUID()`. */
  id?: string;
  catalogId: string;
  spec: Spec;
  meta?: SpecMeta;
}

export interface SpecPatch {
  catalogId?: string;
  spec?: Spec;
  meta?: SpecMeta;
}
