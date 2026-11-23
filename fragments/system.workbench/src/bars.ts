import type { Extension } from "@statewalker/kernel.core";
import type { TextOf } from "./l10n.js";
import { fillText } from "./requests.js";
import { evaluateWhen, type WhenContext } from "./when.js";

/** The inline texts alone. */
const inlineText: TextOf = (_namespace, _key, fallback) => fillText(fallback);

/** One item of the status bar. */
export interface StatusItem {
  /** Its identity, `<fragment-id>/<id>`. */
  readonly id: string;
  readonly fragment: string;
  readonly text: string;
  readonly tooltip?: string;
  readonly alignment: "left" | "right";
  readonly order: number;
  /** The command a click runs, while it is on the bus. */
  readonly command?: string;
}

/** One entry of the activity bar: it opens a view or runs a command. */
export interface ActivityItem {
  /** Its identity, `<fragment-id>/<id>`. */
  readonly id: string;
  readonly fragment: string;
  readonly title: string;
  readonly order: number;
  readonly view?: string;
  readonly command?: string;
}

interface StatusData {
  readonly id: string;
  readonly text: string;
  readonly tooltip?: string;
  readonly alignment?: "left" | "right";
  readonly order?: number;
  readonly command?: string;
  readonly when?: string;
}

interface ActivityData {
  readonly id: string;
  readonly title: string;
  readonly order?: number;
  readonly view?: string;
  readonly command?: string;
}

/** The status bar: items whose `when` holds, left then right, each by order. */
export function buildStatusbar(
  extensions: readonly Extension[],
  hasCommand: (id: string) => boolean,
  context: WhenContext,
  text: TextOf = inlineText,
): StatusItem[] {
  const items: StatusItem[] = [];
  for (const extension of extensions) {
    const data = extension.data as StatusData;
    if (!evaluateWhen(data.when, context)) continue;
    items.push({
      id: `${extension.contributor}/${data.id}`,
      fragment: extension.contributor,
      text: text(extension.contributor, `statusbar.${data.id}.text`, data.text),
      ...(data.tooltip !== undefined
        ? { tooltip: text(extension.contributor, `statusbar.${data.id}.tooltip`, data.tooltip) }
        : {}),
      alignment: data.alignment ?? "left",
      order: data.order ?? 0,
      ...(data.command !== undefined && hasCommand(data.command) ? { command: data.command } : {}),
    });
  }
  const side = (item: StatusItem) => (item.alignment === "left" ? 0 : 1);
  return items.sort((a, b) => side(a) - side(b) || a.order - b.order);
}

/** The activity bar: entries whose view or command is live, by order then title. */
export function buildActivitybar(
  extensions: readonly Extension[],
  hasView: (id: string) => boolean,
  hasCommand: (id: string) => boolean,
  text: TextOf = inlineText,
  locale?: string,
): ActivityItem[] {
  const items: ActivityItem[] = [];
  for (const extension of extensions) {
    const data = extension.data as ActivityData;
    if (data.view !== undefined ? !hasView(data.view) : !hasCommand(data.command ?? "")) continue;
    items.push({
      id: `${extension.contributor}/${data.id}`,
      fragment: extension.contributor,
      title: text(extension.contributor, `activitybar.${data.id}.title`, data.title),
      order: data.order ?? 0,
      ...(data.view !== undefined ? { view: data.view } : { command: data.command }),
    });
  }
  return items.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, locale));
}
