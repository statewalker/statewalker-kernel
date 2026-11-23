import { VisualizeFileCommand } from "@statewalker/mime.core";
import { Commands } from "@statewalker/shared-commands";
import { useAppWorkspace } from "@statewalker/ui.view.react";
import { type ReactElement, useCallback } from "react";

interface FileCardProps {
  uri: string;
  /** Display name shown in the card; defaults to the URI tail. */
  name?: string;
  description?: string;
}

function isFileCardProps(value: unknown): value is FileCardProps {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.uri === "string";
}

function tail(uri: string): string {
  const i = uri.lastIndexOf("/");
  return i >= 0 ? uri.slice(i + 1) : uri;
}

/**
 * Compact card representing a file. Clicking the card fires
 * `files:visualize` so the file opens in a dock panel — closing
 * the loop with the markdown-viewer and any other registered
 * mime-renderer.
 */
export function FileCard({ props }: { props: unknown }): ReactElement {
  const workspace = useAppWorkspace();
  const commands = workspace.requireAdapter(Commands);

  const onClick = useCallback(() => {
    if (!isFileCardProps(props)) return;
    void commands.call(VisualizeFileCommand, { uri: props.uri }).promise.catch((error: unknown) => {
      console.warn("[inline-content] FileCard visualize failed:", error);
    });
  }, [commands, props]);

  if (!isFileCardProps(props)) {
    return (
      <span className="rounded-sm bg-destructive/10 px-2 py-0.5 font-mono text-xs text-destructive">
        FileCard: invalid props
      </span>
    );
  }
  const { uri, name, description } = props;
  return (
    <button
      type="button"
      className="inline-flex flex-col items-start rounded-md border border-border bg-card px-3 py-2 text-left hover:bg-accent"
      onClick={onClick}
    >
      <span className="font-medium">{name ?? tail(uri)}</span>
      {description ? <span className="text-xs text-muted-foreground">{description}</span> : null}
      <span className="font-mono text-[10px] text-muted-foreground">{uri}</span>
    </button>
  );
}
