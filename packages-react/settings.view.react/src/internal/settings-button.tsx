import { OpenSettingsCommand } from "@statewalker/settings.core";
import { Commands } from "@statewalker/shared-commands";
import { useAdapter } from "@statewalker/ui.view.react";
import { Button } from "@statewalker/ui.view.shadcn";
import { Settings as SettingsIcon } from "lucide-react";
import type { ReactElement } from "react";

export interface SettingsButtonProps {
  /** Optional initial tab id to open (e.g. "providers"). */
  tabId?: string;
}

/**
 * Header trigger that fires `runOpenSettings`. Pure UI — the
 * dialog itself is rendered separately by `<SettingsDialog />`,
 * mounted once at the top of the React tree.
 */
export function SettingsButton({ tabId }: SettingsButtonProps): ReactElement {
  const commands = useAdapter(Commands);
  return (
    <Button
      size="sm"
      variant="ghost"
      aria-label="Settings"
      onClick={() => commands.call(OpenSettingsCommand, { tabId })}
    >
      <SettingsIcon className="h-3.5 w-3.5" /> Settings
    </Button>
  );
}
