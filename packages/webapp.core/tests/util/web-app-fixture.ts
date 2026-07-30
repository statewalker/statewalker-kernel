import type { FilesApi } from "@statewalker/webrun-files";
import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { type PollScheduler, type Project, Workspace } from "@statewalker/workspace.core";

const enc = new TextEncoder();

/**
 * A hermetic web-app fixture: local relative imports only, and a declared-but-never-
 * imported npm dep so `deriveLock` pins a version without the transpile ever touching
 * the network. `client/main.ts` → `client/greeting.ts` is the whole reachable graph.
 */
export const HELLO_WORLD_FILES: Record<string, string> = {
  "package.json": JSON.stringify({ name: "hello", dependencies: { react: "18.3.1" } }),
  "client/index.html": '<!doctype html><script type="module" src="./main.ts"></script>',
  "client/main.ts": 'import { greet } from "./greeting.ts";\nexport const msg = greet("world");\n',
  "client/greeting.ts":
    "export function greet(name: string): string {\n  return `hello ${name}`;\n}\n",
  "server/index.ts":
    'export default async (_request: Request) => new Response("api ok", { status: 200 });\n',
  "data/message.txt": "from-server-context",
};

/** Create a workspace + project seeded with `files` (project-relative paths). */
export async function setupProject(
  files: Record<string, string> = HELLO_WORLD_FILES,
): Promise<{ project: Project; workspace: Workspace; fs: MemFilesApi }> {
  const fs = new MemFilesApi();
  for (const [path, body] of Object.entries(files)) {
    await fs.write(`/proj/${path}`, [enc.encode(body)]);
  }
  const workspace = new Workspace().setFileSystem(fs);
  const project = await workspace.getProject("proj", true);
  if (!project) throw new Error("project not resolved");
  return { project, workspace, fs };
}

/** Rewrite `path` guaranteeing a strictly greater mtime than any prior write. */
export async function touch(fs: MemFilesApi, path: string, body: string): Promise<void> {
  const before = Date.now();
  while (Date.now() === before) {
    /* spin until the wall clock advances so MemFilesApi stamps a new mtime */
  }
  await fs.write(path, [enc.encode(body)]);
}

/** A manual clock: captures the scheduled tick so a test drives a single poll. */
export function fakeClock() {
  let current: { intervalMs: number; tick: () => void | Promise<void> } | undefined;
  const scheduler: PollScheduler = (intervalMs, tick) => {
    current = { intervalMs, tick };
    return () => {
      current = undefined;
    };
  };
  return {
    scheduler,
    get running() {
      return current !== undefined;
    },
    async advance() {
      if (!current) throw new Error("no poll scheduled");
      await current.tick();
    },
  };
}

/** Read every file under `files` into a path → content map (for byte-identity diffs). */
export async function snapshot(files: FilesApi, root = "/"): Promise<Map<string, string>> {
  const dec = new TextDecoder();
  const out = new Map<string, string>();
  for await (const info of files.list(root, { recursive: true })) {
    if (info.kind !== "file") continue;
    const chunks: Uint8Array[] = [];
    for await (const c of files.read(info.path)) chunks.push(c);
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const buf = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      buf.set(c, off);
      off += c.length;
    }
    out.set(info.path, dec.decode(buf));
  }
  return out;
}
