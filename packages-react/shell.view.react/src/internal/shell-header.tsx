import { Slots } from "@statewalker/shared-slots";
import { type DockHeaderItem, dockHeaderItemsSlot } from "@statewalker/shell.core";
import {
  compareByOrderAndId,
  coreViewsSlot,
  type KeyedSlotView,
  useAdapter,
  useKeyedSlot,
  useSlot,
  type ViewComponent,
} from "@statewalker/ui.view.react";
import { type ReactElement, useMemo } from "react";

/**
 * Top-of-shell header rendered by `<MainShell/>`. Subscribes to
 * `dock:header-items`, splits contributions into the `leading` and
 * `trailing` groups, sorts each group by `order`, and renders the
 * components looked up via `ViewRegistry.get(viewKey)`.
 */
export function ShellHeader(): ReactElement {
  const slots = useAdapter(Slots);
  const registry = useKeyedSlot(slots, coreViewsSlot);
  const items = useSlot(slots, dockHeaderItemsSlot);

  const { leading, trailing } = useMemo(() => {
    const lead: DockHeaderItem[] = [];
    const trail: DockHeaderItem[] = [];
    for (const item of items) {
      (item.slot === "leading" ? lead : trail).push(item);
    }
    lead.sort(compareByOrderAndId);
    trail.sort(compareByOrderAndId);
    return { leading: lead, trailing: trail };
  }, [items]);

  return (
    <header className="flex h-10 shrink-0 items-center gap-2 border-b bg-background px-3">
      {leading.map((item) => (
        <HeaderItemView key={item.id} registry={registry} item={item} />
      ))}
      <div className="ml-auto" />
      {trailing.map((item) => (
        <HeaderItemView key={item.id} registry={registry} item={item} />
      ))}
    </header>
  );
}

function HeaderItemView({
  registry,
  item,
}: {
  registry: KeyedSlotView<ViewComponent>;
  item: DockHeaderItem;
}): ReactElement | null {
  const Component = registry.get(item.viewKey);
  return Component ? <Component /> : null;
}
