import { Commands } from "@statewalker/shared-commands";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@statewalker/ui.view.shadcn";
import {
  ChangeWorkspaceCommand,
  WorkspaceReconnectCommand,
  WorkspaceShellAdapter,
} from "@statewalker/workspace.browser";
import { FolderOpen } from "lucide-react";
import { type ReactElement, useState } from "react";
import { useAdapter } from "./use-adapter.js";
import { useAdapterValue } from "./use-adapter-value.js";

/**
 * Full-screen empty/onboarding view rendered by `<App/>` whenever
 * `WorkspaceShellAdapter.getState().status !== "ready"`. A single
 * component covers the four non-ready statuses:
 *   - `loading` — disabled "Open folder" button while silent-restore
 *     is pending,
 *   - `unsupported` — explanatory copy in place of the picker button,
 *   - `empty` — the standard onboarding picker,
 *   - `needs-permission` — reconnect prompt for the previously
 *     persisted workspace, plus a "pick a different folder" fallback.
 */
export function DirectoryPickerEmptyState(): ReactElement {
  const commands = useAdapter(Commands);
  const state = useAdapterValue(WorkspaceShellAdapter, (a) => a.getState());
  const [error, setError] = useState<string | null>(null);

  const isUnsupported = state.status === "unsupported";
  const isLoading = state.status === "loading";
  const needsPermission = state.status === "needs-permission";

  const onPick = async (): Promise<void> => {
    setError(null);
    try {
      await commands.call(ChangeWorkspaceCommand, {}).promise;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onReconnect = async (): Promise<void> => {
    setError(null);
    try {
      await commands.call(WorkspaceReconnectCommand, {}).promise;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex h-full w-full items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Pick a workspace folder</CardTitle>
          <CardDescription>
            SandClaw stores its sessions and provider configuration inside a folder you choose on
            disk. Pick any folder — files outside the system subdirectory stay untouched.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {isUnsupported ? <p className="text-sm text-destructive">{state.reason}</p> : null}
          {needsPermission ? (
            <>
              <p className="text-sm text-muted-foreground">
                Reconnect to your previous workspace{" "}
                <span className="font-medium text-foreground">{state.label}</span>?
              </p>
              <Button onClick={onReconnect}>
                <FolderOpen /> Reconnect "{state.label}"
              </Button>
              <Button variant="outline" onClick={onPick}>
                Pick a different folder
              </Button>
            </>
          ) : (
            <Button onClick={onPick} disabled={isUnsupported || isLoading}>
              <FolderOpen /> Open folder
            </Button>
          )}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}
