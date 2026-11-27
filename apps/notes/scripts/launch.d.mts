import type { FragmentHost } from "@statewalker/cellb/node";

export interface Launched {
  readonly mode: "browser" | "node" | "wrangler";
  /** The app's base URL, ending with `/`. */
  readonly url: string;
  /** The fragment host (node only). */
  readonly host?: FragmentHost;
  /** Each server half's own `wrangler dev` address, by fragment id (wrangler only). */
  readonly workerBases?: () => Map<string, string>;
  close(): Promise<void>;
}

/** The fragments whose server halves a server host runs (core, then the app's): id and folder. */
export function serverFragments(): { id: string; dir: string; version: string }[];

/** Serve the built app in a launch configuration. */
export function launch(
  mode: "browser" | "node" | "wrangler",
  options?: {
    port?: number;
    data?: string;
    peerId?: string;
    /**
     * node: the origins of other hosts' pages this host lets in (CORS), as the home a fragment was
     * moved to (statewalker-root#263).
     */
    allowOrigins?: string[];
    /** node: the fragments it runs from the start (default: every server half). */
    fragments?: string[];
    /** node: the version it offers of a fragment, for a host offering another one. */
    versions?: Record<string, string>;
  },
): Promise<Launched>;
