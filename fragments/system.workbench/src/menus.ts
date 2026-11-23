import type { Extension } from "@statewalker/kernel.core";
import { evaluateWhen, type WhenContext } from "./when.js";

/** One entry of a menu, as the workbench renders it. */
export type MenuNode =
  | {
      readonly kind: "command";
      /** A key unique within the menu (the extension's id). */
      readonly key: string;
      /** The command it runs, `<fragment-id>/<command-id>`. */
      readonly command: string;
      readonly title: string;
      /** The command's first live keybinding, when it has one (`ctrl+alt+n`). */
      readonly keybinding?: string;
      /** The contributing fragment. */
      readonly fragment: string;
    }
  | {
      readonly kind: "submenu";
      readonly key: string;
      /** The id of the menu it opens. */
      readonly submenu: string;
      readonly title: string;
      readonly children: readonly MenuNode[];
      readonly fragment: string;
    }
  | { readonly kind: "separator"; readonly key: string };

/** The data of an extension to `menus` (valid against `menuSchema`). */
export interface MenuData {
  readonly menu: string;
  readonly command?: string;
  readonly submenu?: string;
  readonly title?: string;
  readonly group?: string;
  readonly order?: number;
  readonly when?: string;
}

/** What building a menu needs to know about commands. */
export interface MenuCommands {
  /** The live command's title in the workbench's locale; undefined when not on the bus. */
  title(command: string): string | undefined;
  keybinding(command: string): string | undefined;
  /**
   * An entry's own title in the interface language: the key `key` of the contributing fragment,
   * `fallback` (the inline title) without a translation. The inline title when not given.
   */
  text?(namespace: string, key: string, fallback: string): string;
}

interface Sortable {
  readonly group: string;
  readonly order: number;
  readonly node: Exclude<MenuNode, { kind: "separator" }>;
}

/**
 * The menu `menu` from the `menus` extensions: entries whose `when` holds in `context`, commands
 * on the bus only, submenus with something in them only; sorted by group, order and title, with
 * a separator between groups.
 */
export function buildMenu(
  menu: string,
  extensions: readonly Extension[],
  commands: MenuCommands,
  context: WhenContext,
  open: ReadonlySet<string> = new Set(),
): MenuNode[] {
  const entries: Sortable[] = [];
  for (const extension of extensions) {
    const data = extension.data as MenuData;
    if (data.menu !== menu || !evaluateWhen(data.when, context)) continue;
    const group = data.group ?? "";
    const order = data.order ?? 0;
    if (data.command !== undefined) {
      // Shown only while the command is on the bus, whatever title the entry carries.
      const commandTitle = commands.title(data.command);
      if (commandTitle === undefined) continue;
      const title =
        data.title === undefined
          ? commandTitle
          : (commands.text?.(
              extension.contributor,
              `menus.${menu}.${data.command}.title`,
              data.title,
            ) ?? data.title);
      const keybinding = commands.keybinding(data.command);
      entries.push({
        group,
        order,
        node: {
          kind: "command",
          key: extension.id,
          command: data.command,
          title,
          ...(keybinding ? { keybinding } : {}),
          fragment: extension.contributor,
        },
      });
    } else if (data.submenu !== undefined && !open.has(data.submenu)) {
      // A submenu opening one of the menus it sits in would never end: it is left out.
      const children = buildMenu(
        data.submenu,
        extensions,
        commands,
        context,
        new Set([...open, menu]),
      );
      if (children.length === 0) continue;
      entries.push({
        group,
        order,
        node: {
          kind: "submenu",
          key: extension.id,
          submenu: data.submenu,
          title:
            commands.text?.(
              extension.contributor,
              `menus.${data.submenu}.title`,
              data.title ?? data.submenu,
            ) ??
            data.title ??
            data.submenu,
          children,
          fragment: extension.contributor,
        },
      });
    }
  }
  entries.sort(
    (a, b) => compare(a.group, b.group) || a.order - b.order || compare(a.node.title, b.node.title),
  );
  const nodes: MenuNode[] = [];
  entries.forEach((entry, index) => {
    const previous = entries[index - 1];
    if (previous && previous.group !== entry.group)
      nodes.push({ kind: "separator", key: `separator:${entry.node.key}` });
    nodes.push(entry.node);
  });
  return nodes;
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
