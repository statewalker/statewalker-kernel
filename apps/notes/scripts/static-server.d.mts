export interface StaticServer {
  /** The server's base URL, ending with `/`. */
  readonly url: string;
  close(): Promise<void>;
}

export interface StaticServerOptions {
  /** Served as `/launch.json` instead of the built file: the launch configuration the page runs. */
  readonly launch?: object;
  /** Asked first for every request; its answer wins, `undefined` leaves the request to the files. */
  readonly handle?: (request: Request) => Promise<Response | undefined>;
}

/** Serve the files of `root` on 127.0.0.1 (`port` 0: any free port). */
export function serveStatic(
  root: string,
  port?: number,
  options?: StaticServerOptions,
): Promise<StaticServer>;
