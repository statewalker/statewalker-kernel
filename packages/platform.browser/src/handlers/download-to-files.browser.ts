import type { DownloadProgress } from "@statewalker/platform.core";
import { DownloadToFilesCommand } from "@statewalker/platform.core";
import type { Commands } from "@statewalker/shared-commands";
import type { FilesApi } from "@statewalker/webrun-files";

/**
 * Browser default for `platform:download-to-files`. Streams `fetch(url)` into
 * `files.write(path, asyncIterable)` with progress events. When `resume` is
 * true and the target path already has content on disk, issues a
 * `Range: bytes=<offset>-` header and concatenates the existing bytes with the
 * new stream so the final on-disk file is the full object. Respects
 * `AbortSignal` on the payload; an abort throws and the command rejects.
 */
export function registerDownloadToFilesBrowser(commands: Commands): () => void {
  return commands.listen(DownloadToFilesCommand, (command) => {
    void performDownload(command.payload)
      .then((result) => {
        command.resolve(result);
      })
      .catch((error) => {
        command.reject(error);
      });
    return true;
  });
}

async function performDownload(payload: {
  url: string;
  files: FilesApi;
  path: string;
  resume?: boolean;
  onProgress?: (progress: DownloadProgress) => void;
  signal?: AbortSignal;
}): Promise<{ bytes: number }> {
  const { url, files, path, resume, onProgress, signal } = payload;

  let existing: Uint8Array | undefined;
  let startByte = 0;
  if (resume) {
    existing = await readExistingBytes(files, path);
    startByte = existing ? existing.byteLength : 0;
  }

  const headers = new Headers();
  if (startByte > 0) {
    headers.set("Range", `bytes=${startByte}-`);
  }

  const response = await fetch(url, { headers, signal });
  if (!response.ok && response.status !== 206) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }

  // If we requested a Range but the server ignored it, drop the existing bytes
  // and start fresh (content-range absent or 200 status with a full body).
  const gotPartial = response.status === 206;
  const effectiveExisting = gotPartial ? existing : undefined;
  const effectiveStart = gotPartial ? startByte : 0;

  const contentLengthRaw = response.headers.get("Content-Length");
  const contentLength = contentLengthRaw ? Number.parseInt(contentLengthRaw, 10) : undefined;
  const total =
    contentLength !== undefined && Number.isFinite(contentLength)
      ? effectiveStart + contentLength
      : undefined;

  if (!response.body) {
    throw new Error("Response body is not readable");
  }

  let loaded = effectiveStart;
  onProgress?.({ loaded, total });

  const reader = response.body.getReader();

  // Wire the signal to the reader so reader.read() wakes up on abort instead of hanging.
  const abortListener = (): void => {
    void reader.cancel(signal?.reason instanceof Error ? signal.reason : new Error("Aborted"));
  };
  if (signal) {
    if (signal.aborted) abortListener();
    else signal.addEventListener("abort", abortListener, { once: true });
  }

  const source = async function* (): AsyncIterable<Uint8Array> {
    if (effectiveExisting && effectiveExisting.byteLength > 0) {
      yield effectiveExisting;
    }
    try {
      while (true) {
        if (signal?.aborted) {
          throw signal.reason instanceof Error ? signal.reason : new Error("Aborted");
        }
        const { done, value } = await reader.read();
        if (done) {
          // Reader closed naturally OR was cancelled by the abort listener; in
          // the latter case signal.aborted is true and we surface that.
          if (signal?.aborted) {
            throw signal.reason instanceof Error ? signal.reason : new Error("Aborted");
          }
          break;
        }
        if (value) {
          loaded += value.byteLength;
          onProgress?.({ loaded, total });
          yield value;
        }
      }
    } finally {
      if (signal) signal.removeEventListener("abort", abortListener);
      try {
        await reader.cancel();
      } catch {
        // Reader may already be closed; nothing to do.
      }
    }
  };

  await files.write(path, source());
  return { bytes: loaded };
}

async function readExistingBytes(files: FilesApi, path: string): Promise<Uint8Array | undefined> {
  const stats = await files.stats(path);
  if (!stats || stats.kind !== "file") return undefined;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of files.read(path)) {
    chunks.push(chunk);
    total += chunk.byteLength;
  }
  if (total === 0) return undefined;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
