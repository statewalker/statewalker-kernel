export interface StaticServer {
  /** The server's base URL, ending with `/`. */
  readonly url: string;
  close(): Promise<void>;
}

/** Serve the files of `root` on 127.0.0.1 (`port` 0: any free port). */
export function serveStatic(root: string, port?: number): Promise<StaticServer>;
