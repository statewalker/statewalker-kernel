// Shared dock-panel identity for the web-app nature: the catalog id the `<SiteFrame>`
// renderer registers under, the spec shape it consumes, and deterministic panel/spec ids.
// React-free plain data, so both the open-command logic (this package) and the paired
// `webapp.view.react` renderer import the same constants without a React dependency
// (ADR-0002: logic ≠ renderer, separate packages).

import type { Spec } from "@statewalker/render.core";

/** Catalog id under which `webapp.view.react` registers the `<SiteFrame>` component. */
export const WEBAPP_DOCK_CATALOG_ID = "webapp";

/** Params carried by a web-app dock spec and consumed by `<SiteFrame>`. */
export interface SiteFrameParams {
  /** Same-origin base URL the hosted app is served under (trailing slash). */
  baseUrl: string;
  /**
   * Client HTML entry as a `baseUrl`-relative URL — including the hosted site's
   * `~/` project-file prefix (e.g. `~/client/index.html`), so `baseUrl + clientEntry`
   * is the served client document.
   */
  clientEntry: string;
}

/**
 * Deterministic dock panel id for a web-app project (open-or-focus keyed by the
 * project's full workspace path, not its leaf directory name — two projects that
 * share a leaf name in different subtrees get distinct panels).
 */
export function webAppPanelId(projectPath: string): string {
  return `webapp:${projectPath}`;
}

/** Deterministic SpecStore id for a web-app project (keyed on the full project path). */
export function webAppSpecId(projectPath: string): string {
  return `spec:webapp:${projectPath}`;
}

/** The one-element dock spec binding `<SiteFrame>` to a hosted `baseUrl` + client entry. */
export function makeSiteFrameSpec(params: SiteFrameParams): Spec {
  return {
    root: "site",
    elements: {
      site: { type: "SiteFrame", props: { ...params }, children: [] },
    },
  } as Spec;
}
