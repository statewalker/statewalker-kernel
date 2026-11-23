import { VisualizeFileCommand } from "@statewalker/mime.core";
import { Commands } from "@statewalker/shared-commands";
import { useAppWorkspace } from "@statewalker/ui.view.react";
import { type DirectoryEntry, LoadDirectoryCommand } from "@statewalker/workspace.core";
import { type ReactElement, useCallback, useEffect, useState } from "react";

interface DirectoryCardEntry {
  name: string;
  kind: "file" | "directory";
}

interface DirectoryCardProps {
  uri: string;
  /** Display name shown at the top of the card; defaults to the URI tail. */
  name?: string;
  /**
   * Pre-populated entries. When omitted, the component lazy-loads the
   * directory once on mount via `files:load-directory`.
   */
  entries?: DirectoryCardEntry[];
}

function isDirectoryCardProps(value: unknown): value is DirectoryCardProps {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.uri !== "string") return false;
  if (v.entries !== undefined) {
    if (!Array.isArray(v.entries)) return false;
    for (const entry of v.entries) {
      if (!entry || typeof entry !== "object") return false;
      const e = entry as Record<string, unknown>;
      if (typeof e.name !== "string") return false;
      if (e.kind !== "file" && e.kind !== "directory") return false;
    }
  }
  return true;
}

function tail(uri: string): string {
  const trimmed = uri.replace(/\/$/, "");
  const i = trimmed.lastIndexOf("/");
  return i >= 0 ? trimmed.slice(i + 1) || trimmed : trimmed;
}

function joinChildUri(parent: string, child: string): string {
  return parent.endsWith("/") ? `${parent}${child}` : `${parent}/${child}`;
}

/**
 * Inline card representing a directory. Renders the directory name and
 * one row per entry; each row fires `files:visualize` on click,
 * regardless of whether the child is a file or a sub-directory.
 *
 * If `entries` is omitted, lazy-loads them via `runLoadDirectory` on
 * mount (one level deep). Multi-level expansion is intentionally out
 * of scope for v1 — sub-directories route through `files:visualize`.
 */
export function DirectoryCard({ props }: { props: unknown }): ReactElement {
  const workspace = useAppWorkspace();
  const commands = workspace.requireAdapter(Commands);

  const valid = isDirectoryCardProps(props);
  const explicitEntries = valid ? props.entries : undefined;
  const uri = valid ? props.uri : "";
  const displayName = valid ? (props.name ?? tail(uri)) : "";

  const [state, setState] = useState<
    | { kind: "explicit" }
    | { kind: "loading" }
    | { kind: "ready"; entries: DirectoryCardEntry[] }
    | { kind: "error"; message: string }
  >(() => (explicitEntries ? { kind: "explicit" } : { kind: "loading" }));

  useEffect(() => {
    if (!valid || explicitEntries) return;
    let cancelled = false;
    setState({ kind: "loading" });
    const path = uri.replace(/^file:\/\//, "");
    commands
      .call(LoadDirectoryCommand, { path, recursive: false })
      .promise.then((loaded) => {
        if (cancelled) return;
        const mapped: DirectoryCardEntry[] = loaded.map((e: DirectoryEntry) => ({
          name: e.name,
          kind: e.kind,
        }));
        setState({ kind: "ready", entries: mapped });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          kind: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [commands, uri, explicitEntries, valid]);

  const onEntryClick = useCallback(
    (entryName: string) => {
      if (!valid) return;
      const childUri = joinChildUri(uri, entryName);
      void commands
        .call(VisualizeFileCommand, { uri: childUri })
        .promise.catch((error: unknown) => {
          console.warn("[inline-content] DirectoryCard visualize failed:", error);
        });
    },
    [commands, uri, valid],
  );

  if (!valid) {
    return (
      <span className="rounded-sm bg-destructive/10 px-2 py-0.5 font-mono text-xs text-destructive">
        DirectoryCard: invalid props
      </span>
    );
  }

  const rows: DirectoryCardEntry[] | null =
    state.kind === "explicit"
      ? (explicitEntries ?? [])
      : state.kind === "ready"
        ? state.entries
        : null;

  return (
    <div className="inline-flex flex-col items-start rounded-md border border-border bg-card px-3 py-2 text-left">
      <span className="font-medium">{displayName}</span>
      <span className="font-mono text-[10px] text-muted-foreground">{uri}</span>
      {state.kind === "loading" ? (
        <span className="mt-1 text-xs text-muted-foreground">Loading…</span>
      ) : null}
      {state.kind === "error" ? (
        <span className="mt-1 text-xs text-destructive">{state.message}</span>
      ) : null}
      {rows ? (
        <div className="mt-1 flex flex-col">
          {rows.map((entry) => (
            <button
              key={entry.name}
              type="button"
              className="text-left font-mono text-xs hover:bg-accent rounded-sm px-1"
              onClick={() => onEntryClick(entry.name)}
            >
              {entry.kind === "directory" ? `${entry.name}/` : entry.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
