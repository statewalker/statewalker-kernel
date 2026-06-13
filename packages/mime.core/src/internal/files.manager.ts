import { ShowDockPanelCommand } from "@statewalker/dock";
import { SpecStore } from "@statewalker/render.core";
import { Commands } from "@statewalker/shared-commands";
import { newRegistry } from "@statewalker/shared-registry";
import { Slots } from "@statewalker/shared-slots";
import { extname } from "@statewalker/webrun-files";
import type { Workspace } from "@statewalker/workspace";
import { VisualizeFileCommand } from "../public/commands.js";
import { pickMimeRenderer } from "../public/pick-mime-renderer.js";
import type { MimeRenderer } from "../public/types.js";

export interface FilesManagerOptions {
  workspace: Workspace;
}

/**
 * Orchestrator for the files fragment's `files:visualize` command.
 *
 * Resolves a matching `MimeRenderer` from the `files:mime-renderers`
 * slot, calls `buildPanel(uri)` to obtain spec + deterministic ids,
 * registers the spec in `SpecStore`, and opens a dock panel via
 * `runShowDockPanel`. Spec eviction on panel close is owned by the
 * dock manager (non-persistent specs evict on last unmount).
 *
 * The primitive `files:*` filesystem commands (load/write/move/…) are
 * owned by `@statewalker/workspace`'s `WorkspaceFilesManager`.
 */
export class FilesManager {
  private readonly commands: Commands;
  private readonly slots: Slots;
  private readonly store: SpecStore;
  private readonly _cleanup: () => Promise<void>;

  constructor({ workspace }: FilesManagerOptions) {
    this.commands = workspace.requireAdapter(Commands);
    this.slots = workspace.requireAdapter(Slots);
    this.store = workspace.requireAdapter(SpecStore);

    const [register, cleanup] = newRegistry();
    this._cleanup = cleanup;

    register(
      this.commands.listen(VisualizeFileCommand, (cmd) => {
        const { uri, referencePanelId } = cmd.payload;
        const mime = guessMimeType(uri);
        const renderer = pickMimeRenderer(this.slots, mime);
        if (!renderer) {
          cmd.reject(new Error(`No mime-renderer registered for "${mime}"`));
          return true;
        }
        void this._openVisualizePanel(renderer, uri, referencePanelId)
          .then(() => cmd.resolve())
          .catch((error) => cmd.reject(error));
        return true;
      }),
    );
  }

  async close(): Promise<void> {
    await this._cleanup();
  }

  // ── Command handler implementations ────────────────────────────

  private async _openVisualizePanel(
    renderer: MimeRenderer,
    uri: string,
    referencePanelId: string | undefined,
  ): Promise<void> {
    const plan = renderer.buildPanel(uri);
    if (!this.store.get(plan.specId)) {
      this.store.create({
        id: plan.specId,
        catalogId: plan.catalogId,
        spec: plan.spec,
        // Non-persistent: dock manager evicts on last panel close.
      });
    }
    await this.commands.call(ShowDockPanelCommand, {
      panelId: plan.panelId,
      specId: plan.specId,
      title: filenameFromUri(uri),
      referencePanelId,
    }).promise;
  }
}

// ── MIME / renderer helpers ─────────────────────────────────────

const MIME_TYPES: Readonly<Record<string, string>> = {
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".txt": "text/plain",
  ".json": "application/json",
  ".js": "text/javascript",
  ".ts": "text/typescript",
  ".tsx": "text/typescript",
  ".jsx": "text/javascript",
  ".html": "text/html",
  ".css": "text/css",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".ogg": "video/ogg",
  ".mov": "video/quicktime",
};

export function guessMimeType(pathOrUri: string): string {
  const ext = extname(pathOrUri.replace(/^file:\/\//, "")).toLowerCase();
  return MIME_TYPES[ext] ?? "application/octet-stream";
}

/** Last path segment of a file URI/path, with the `file://` scheme stripped. */
export function filenameFromUri(uriOrPath: string): string {
  const cleaned = uriOrPath.replace(/^file:\/\//, "").replace(/\/+$/, "");
  const lastSlash = cleaned.lastIndexOf("/");
  return lastSlash >= 0 ? cleaned.slice(lastSlash + 1) : cleaned;
}

export function pickRenderer(
  renderers: readonly MimeRenderer[],
  mimeType: string,
): MimeRenderer | undefined {
  const matches = renderers.filter((r) => matchMime(r.mimeTypePattern, mimeType));
  if (matches.length === 0) return undefined;
  matches.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  return matches[0];
}

function matchMime(pattern: string, mimeType: string): boolean {
  if (pattern === mimeType) return true;
  if (!pattern.includes("*")) return false;
  // Convert glob-with-* to a regex anchored at both ends.
  const regex = new RegExp(
    `^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`,
  );
  return regex.test(mimeType);
}
