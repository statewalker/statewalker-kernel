import { catalogsSlot, type SpecRecord, SpecStore } from "@statewalker/render.core";
import { SpecRenderer } from "@statewalker/render.view.react";
import { Commands } from "@statewalker/shared-commands";
import { Slots } from "@statewalker/shared-slots";
import { ClosePanelCommand } from "@statewalker/shell.core";
import { useAdapter, useAppWorkspace, useKeyedSlot } from "@statewalker/ui.view.react";
import type { IDockviewPanelProps } from "dockview-react";
import { type ReactElement, useSyncExternalStore } from "react";

interface JsonPanelParams {
  specId: string;
}

/**
 * The single DockView component kind. Every panel rendered by the
 * dock fragment flows through this component. It resolves the
 * spec by id from `SpecStore`, the catalog by id from
 * `CatalogRegistry`, and renders the json-render `<Renderer>`
 * against both. Missing spec / missing catalog → recovery
 * placeholder; the user can close the panel.
 *
 * The workspace is resolved via React context (`useAppWorkspace`),
 * not via `props.containerApi` — dockview-react renders panels
 * through React.createPortal, so React context propagates from
 * the parent tree (the MainShell that hosts `<DockviewReact>`).
 */
export function JsonPanel(props: IDockviewPanelProps<JsonPanelParams>): ReactElement {
  const { specId } = props.params;
  const workspace = useAppWorkspace();
  const store = workspace.requireAdapter(SpecStore);
  const slots = useAdapter(Slots);
  const catalogs = useKeyedSlot(slots, catalogsSlot);
  const commands = workspace.requireAdapter(Commands);

  const record = useSyncExternalStore<SpecRecord | null>(
    (notify) => store.observe(specId, notify),
    () => store.get(specId),
  );

  if (!record) {
    return (
      <PanelMissing
        specId={specId}
        onClose={() => commands.call(ClosePanelCommand, { panelId: props.api.id })}
      />
    );
  }

  const catalogRegistry = catalogs.get(record.catalogId);
  if (!catalogRegistry) {
    return (
      <CatalogMissing
        catalogId={record.catalogId}
        onClose={() => commands.call(ClosePanelCommand, { panelId: props.api.id })}
      />
    );
  }

  // `<SpecRenderer>` (from render.view.react) is the single boundary
  // into `@json-render/react`; it crosses from the deliberately-loose
  // `unknown` storage in SpecStore + the catalogs slot to json-render's
  // concrete types.
  return <SpecRenderer spec={record.spec} registry={catalogRegistry} />;
}

function PanelMissing({ specId, onClose }: { specId: string; onClose: () => void }): ReactElement {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-sm text-muted-foreground">
        Spec <code className="font-mono text-xs">{specId}</code> is missing.
      </p>
      <button
        type="button"
        className="rounded border border-border bg-background px-3 py-1 text-sm hover:bg-accent"
        onClick={onClose}
      >
        Close panel
      </button>
    </div>
  );
}

function CatalogMissing({
  catalogId,
  onClose,
}: {
  catalogId: string;
  onClose: () => void;
}): ReactElement {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-sm text-muted-foreground">
        Catalog <code className="font-mono text-xs">{catalogId}</code> is not registered.
      </p>
      <button
        type="button"
        className="rounded border border-border bg-background px-3 py-1 text-sm hover:bg-accent"
        onClick={onClose}
      >
        Close panel
      </button>
    </div>
  );
}
