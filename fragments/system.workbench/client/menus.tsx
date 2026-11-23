// The workbench's menus rendered with shadcn: one renderer for the three menu families (the menu
// bar, context menus, dropdown menus), so every fragment's entries look the same everywhere.
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  MenubarItem,
  MenubarSeparator,
  MenubarShortcut,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
} from "@statewalker/ui.view.shadcn";
import type { ComponentType, ReactNode } from "react";
import { formatChord, type MenuNode } from "../src/index.js";

/** The parts of one shadcn menu family the renderer needs. */
export interface MenuFamily {
  // biome-ignore lint/suspicious/noExplicitAny: the three families' props differ in details only.
  readonly Item: ComponentType<any>;
  // biome-ignore lint/suspicious/noExplicitAny: see above.
  readonly Separator: ComponentType<any>;
  // biome-ignore lint/suspicious/noExplicitAny: see above.
  readonly Shortcut: ComponentType<any>;
  // biome-ignore lint/suspicious/noExplicitAny: see above.
  readonly Sub: ComponentType<any>;
  // biome-ignore lint/suspicious/noExplicitAny: see above.
  readonly SubTrigger: ComponentType<any>;
  // biome-ignore lint/suspicious/noExplicitAny: see above.
  readonly SubContent: ComponentType<any>;
}

export const menubarFamily: MenuFamily = {
  Item: MenubarItem,
  Separator: MenubarSeparator,
  Shortcut: MenubarShortcut,
  Sub: MenubarSub,
  SubTrigger: MenubarSubTrigger,
  SubContent: MenubarSubContent,
};

export const contextMenuFamily: MenuFamily = {
  Item: ContextMenuItem,
  Separator: ContextMenuSeparator,
  Shortcut: ContextMenuShortcut,
  Sub: ContextMenuSub,
  SubTrigger: ContextMenuSubTrigger,
  SubContent: ContextMenuSubContent,
};

export const dropdownMenuFamily: MenuFamily = {
  Item: DropdownMenuItem,
  Separator: DropdownMenuSeparator,
  Shortcut: DropdownMenuShortcut,
  Sub: DropdownMenuSub,
  SubTrigger: DropdownMenuSubTrigger,
  SubContent: DropdownMenuSubContent,
};

/** Menu entries as items of `family`: commands run through `run`, submenus nest. */
export function MenuEntries({
  nodes,
  family,
  run,
}: {
  nodes: readonly MenuNode[];
  family: MenuFamily;
  run: (command: string) => void;
}): ReactNode {
  const { Item, Separator, Shortcut, Sub, SubTrigger, SubContent } = family;
  return nodes.map((node) => {
    if (node.kind === "separator") return <Separator key={node.key} />;
    if (node.kind === "submenu") {
      return (
        <Sub key={node.key}>
          <SubTrigger>{node.title}</SubTrigger>
          <SubContent>
            <MenuEntries nodes={node.children} family={family} run={run} />
          </SubContent>
        </Sub>
      );
    }
    return (
      <Item key={node.key} onSelect={() => run(node.command)}>
        {node.title}
        {node.keybinding && <Shortcut>{formatChord(node.keybinding)}</Shortcut>}
      </Item>
    );
  });
}
