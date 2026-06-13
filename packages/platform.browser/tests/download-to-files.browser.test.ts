import type { DownloadProgress } from "@statewalker/platform.core";
import { DownloadToFilesCommand, getCommands } from "@statewalker/platform.core";
import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerDownloadToFilesBrowser } from "../src/handlers/download-to-files.browser.js";

async function collectBytes(iterable: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of iterable) {
    chunks.push(chunk);
    total += chunk.byteLength;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function makeStreamingResponse(body: Uint8Array, init?: ResponseInit): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Emit in two chunks so the reader loop iterates.
      const mid = Math.floor(body.byteLength / 2);
      controller.enqueue(body.slice(0, mid));
      controller.enqueue(body.slice(mid));
      controller.close();
    },
  });
  const headers = new Headers(init?.headers);
  headers.set("Content-Length", String(body.byteLength));
  return new Response(stream, { ...init, headers });
}

describe("download-to-files browser handler", () => {
  let files: MemFilesApi;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    files = new MemFilesApi();
    fetchMock = vi.fn();
    (globalThis as unknown as { fetch: typeof fetchMock }).fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("downloads a payload and writes it to FilesApi with monotonic progress", async () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    fetchMock.mockResolvedValueOnce(makeStreamingResponse(payload));

    const ctx = {};
    const unregister = registerDownloadToFilesBrowser(getCommands(ctx));
    try {
      const progressEvents: DownloadProgress[] = [];
      const result = await getCommands(ctx).call(DownloadToFilesCommand, {
        url: "https://example.test/data.bin",
        files,
        path: "/data.bin",
        onProgress: (p) => progressEvents.push(p),
      }).promise;

      expect(result.bytes).toBe(payload.byteLength);
      const written = await collectBytes(files.read("/data.bin"));
      expect(Array.from(written)).toEqual(Array.from(payload));

      // Progress is monotonic and ends at total.
      expect(progressEvents.length).toBeGreaterThan(1);
      for (let i = 1; i < progressEvents.length; i++) {
        const current = progressEvents[i];
        const previous = progressEvents[i - 1];
        if (!current || !previous) throw new Error("unexpected undefined progress event");
        expect(current.loaded).toBeGreaterThanOrEqual(previous.loaded);
      }
      expect(progressEvents.at(-1)?.loaded).toBe(payload.byteLength);
      expect(progressEvents.at(-1)?.total).toBe(payload.byteLength);
    } finally {
      unregister();
    }
  });

  it("resumes from an existing partial file using a Range request", async () => {
    const full = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80]);
    // Pre-seed first 3 bytes on disk (simulating an earlier partial download).
    await files.write(
      "/data.bin",
      (async function* () {
        yield full.slice(0, 3);
      })(),
    );

    // Server honors Range: bytes=3- and returns the remaining 5 bytes with 206.
    fetchMock.mockImplementationOnce(async (_url: string, init?: RequestInit) => {
      const rangeHeader = new Headers(init?.headers).get("Range");
      expect(rangeHeader).toBe("bytes=3-");
      return makeStreamingResponse(full.slice(3), { status: 206 });
    });

    const ctx = {};
    const unregister = registerDownloadToFilesBrowser(getCommands(ctx));
    try {
      const result = await getCommands(ctx).call(DownloadToFilesCommand, {
        url: "https://example.test/data.bin",
        files,
        path: "/data.bin",
        resume: true,
      }).promise;

      expect(result.bytes).toBe(full.byteLength);
      const written = await collectBytes(files.read("/data.bin"));
      expect(Array.from(written)).toEqual(Array.from(full));
    } finally {
      unregister();
    }
  });

  it("rejects when aborted via signal", async () => {
    const payload = new Uint8Array(100).fill(42);
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(payload.slice(0, 40));
        // Never completes — the abort has to surface.
      },
    });
    const response = new Response(stream, {
      headers: { "Content-Length": String(payload.byteLength) },
    });
    fetchMock.mockImplementationOnce(async (_url: string, init?: RequestInit) => {
      // Propagate the incoming signal so abort actually affects the response path.
      const signal = init?.signal;
      if (signal?.aborted) {
        throw signal.reason instanceof Error ? signal.reason : new Error("Aborted");
      }
      return response;
    });

    const controller = new AbortController();
    const ctx = {};
    const unregister = registerDownloadToFilesBrowser(getCommands(ctx));
    try {
      const run = getCommands(ctx).call(DownloadToFilesCommand, {
        url: "https://example.test/data.bin",
        files,
        path: "/data.bin",
        signal: controller.signal,
      });
      // Give the handler a tick to enter its read loop, then abort.
      await new Promise((r) => setTimeout(r, 0));
      controller.abort();
      await expect(run.promise).rejects.toThrow();
    } finally {
      unregister();
    }
  });

  it("falls back to a fresh download when the server ignores Range", async () => {
    const full = new Uint8Array([1, 2, 3, 4, 5]);
    await files.write(
      "/data.bin",
      (async function* () {
        yield new Uint8Array([9, 9]);
      })(),
    );
    // Server responds 200 (ignoring Range) — handler must NOT concatenate stale bytes.
    fetchMock.mockResolvedValueOnce(makeStreamingResponse(full, { status: 200 }));

    const ctx = {};
    const unregister = registerDownloadToFilesBrowser(getCommands(ctx));
    try {
      const result = await getCommands(ctx).call(DownloadToFilesCommand, {
        url: "https://example.test/data.bin",
        files,
        path: "/data.bin",
        resume: true,
      }).promise;
      expect(result.bytes).toBe(full.byteLength);
      const written = await collectBytes(files.read("/data.bin"));
      expect(Array.from(written)).toEqual(Array.from(full));
    } finally {
      unregister();
    }
  });
});
