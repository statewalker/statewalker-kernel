import type { FragmentHost } from "@statewalker/cellb/node";

export interface Launched {
  readonly mode: "browser" | "node" | "wrangler";
  /** The app's base URL, ending with `/`. */
  readonly url: string;
  /** The fragment host (node only). */
  readonly host?: FragmentHost;
  close(): Promise<void>;
}

/** The app's fragments that have a server half: their id and source folder. */
export function serverFragments(): { id: string; dir: string }[];

/** Serve the built app in a launch configuration. */
export function launch(
  mode: "browser" | "node" | "wrangler",
  options?: { port?: number; data?: string; peerId?: string },
): Promise<Launched>;
