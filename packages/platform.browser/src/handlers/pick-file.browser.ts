import type { PickFilePayload, PickFileResult } from "@statewalker/platform.core";
import { PickFileCommand } from "@statewalker/platform.core";
import type { Commands } from "@statewalker/shared-commands";

/** Minimal shape of the File System Access API file-picker. */
interface OpenFilePickerGlobal {
  showOpenFilePicker?: (options?: {
    multiple?: boolean;
    types?: { description?: string; accept: Record<string, string[]> }[];
  }) => Promise<FileSystemFileHandle[]>;
}

/**
 * Browser default for `platform:pick-file`. Prefers `showOpenFilePicker()`
 * (File System Access API) when available, falls back to a synthesised
 * `<input type="file">` click otherwise (covers Safari / Firefox).
 */
export function registerPickFileBrowser(commands: Commands): () => void {
  return commands.listen(PickFileCommand, (command) => {
    const api = globalThis as unknown as OpenFilePickerGlobal;
    const picker = api.showOpenFilePicker;

    if (typeof picker === "function") {
      picker({
        multiple: command.payload.multiple ?? false,
        ...buildFSAccessTypes(command.payload.accept),
      })
        .then(async (handles) => {
          const files = await Promise.all(handles.map((h) => h.getFile()));
          command.resolve({ blobs: files, names: files.map((f) => f.name) });
        })
        .catch((error) => {
          command.reject(error);
        });
      return true;
    }

    // Fallback: synthesize an <input type="file"> click.
    pickWithInputElement(command.payload)
      .then((result) => {
        command.resolve(result);
      })
      .catch((error) => {
        command.reject(error);
      });
    return true;
  });
}

function buildFSAccessTypes(accept: readonly string[] | undefined): {
  types?: { accept: Record<string, string[]> }[];
} {
  if (!accept || accept.length === 0) return {};
  const mimeTypes: Record<string, string[]> = {};
  const extensions: string[] = [];
  for (const entry of accept) {
    if (entry.startsWith(".")) {
      extensions.push(entry);
    } else {
      mimeTypes[entry] = [];
    }
  }
  if (extensions.length > 0) {
    mimeTypes["*/*"] = extensions;
  }
  return { types: [{ accept: mimeTypes }] };
}

function pickWithInputElement(payload: PickFilePayload): Promise<PickFileResult> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    if (payload.multiple) input.multiple = true;
    if (payload.accept && payload.accept.length > 0) {
      input.accept = payload.accept.join(",");
    }
    input.style.display = "none";
    document.body.appendChild(input);

    const cleanup = (): void => {
      input.remove();
    };

    input.addEventListener(
      "change",
      () => {
        try {
          const files = Array.from(input.files ?? []);
          cleanup();
          resolve({ blobs: files, names: files.map((f) => f.name) });
        } catch (error) {
          cleanup();
          reject(error);
        }
      },
      { once: true },
    );
    input.addEventListener(
      "cancel",
      () => {
        cleanup();
        resolve({ blobs: [], names: [] });
      },
      { once: true },
    );
    input.click();
  });
}
