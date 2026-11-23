import { Settings, type SettingsTab, settingsTabSlot } from "@statewalker/settings.core";
import { Slots } from "@statewalker/shared-slots";
import {
  compareByOrderAndId,
  coreViewsSlot,
  type KeyedSlotView,
  useAdapter,
  useAdapterValue,
  useKeyedSlot,
  useSlot,
  type ViewComponent,
} from "@statewalker/ui.view.react";
import {
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@statewalker/ui.view.shadcn";
import { type ReactElement, useMemo } from "react";

/**
 * Top-level settings dialog. Mounted once per app. Reads:
 *   - `Settings.isOpen` / `activeTabId` (open state).
 *   - `settings:tabs` slot (tab list, sorted by `order`).
 *   - `ViewRegistry.get(tab.viewKey)` (tab content).
 *
 * Keeps the rendering surface thin — each tab's UI is owned by the
 * fragment that contributed it; this component is the layout
 * shell.
 */
export function SettingsDialog(): ReactElement | null {
  const settings = useAdapter(Settings);
  const slots = useAdapter(Slots);
  const registry = useKeyedSlot(slots, coreViewsSlot);

  // Read each primitive separately so getSnapshot returns stable
  // values across renders (Object.is identity).
  const isOpen = useAdapterValue(Settings, (s) => s.isOpen);
  const activeTabId = useAdapterValue(Settings, (s) => s.activeTabId);

  const tabs = useSlot(slots, settingsTabSlot);
  const sortedTabs = useMemo(() => [...tabs].sort(compareByOrderAndId), [tabs]);

  if (!isOpen) return null;

  const activeTab = sortedTabs.find((t) => t.id === activeTabId) ?? sortedTabs[0];

  return (
    <Dialog open={isOpen} onOpenChange={(open) => settings._setOpen(open)}>
      <DialogContent className="flex h-[85vh] max-h-[85vh] w-[90vw] max-w-5xl flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="shrink-0 border-b p-4 pb-3">
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Configure providers, models, and other workspace preferences.
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1">
          <nav className="w-44 shrink-0 border-r bg-muted/20 p-2">
            {sortedTabs.length === 0 ? (
              <p className="px-2 py-1 text-xs text-muted-foreground">
                No settings tabs registered.
              </p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {sortedTabs.map((tab) => (
                  <li key={tab.id}>
                    <button
                      type="button"
                      className={cn(
                        "w-full rounded px-2 py-1.5 text-left text-sm",
                        tab.id === activeTab?.id
                          ? "bg-accent text-accent-foreground"
                          : "hover:bg-muted",
                      )}
                      onClick={() => settings.setActiveTab(tab.id)}
                    >
                      {tab.title}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </nav>
          <div className="flex-1 overflow-y-auto">
            {activeTab ? <TabContent tab={activeTab} registry={registry} /> : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TabContent({
  tab,
  registry,
}: {
  tab: SettingsTab;
  registry: KeyedSlotView<ViewComponent>;
}): ReactElement {
  const Component = registry.get(tab.viewKey);
  if (!Component) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Tab "{tab.title}" registered but no component is bound to viewKey "{tab.viewKey}".
      </div>
    );
  }
  return <Component />;
}
