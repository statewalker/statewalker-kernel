import { type CommandEntry, labelsOf } from "@statewalker/system.commands";
import { fillText, type RequestParams } from "./requests.js";

/**
 * What the workbench needs of system.l10n (its `L10n` model fits): the interface language, the
 * text of a fragment's key with the contribution's inline text as the fallback, and a change
 * subscription.
 */
export interface WorkbenchL10n {
  locale(): string;
  text(
    namespace: string,
    key: string,
    options?: {
      readonly params?: RequestParams;
      readonly labels?: Readonly<Record<string, string | undefined>>;
      readonly fallback?: string;
    },
  ): string;
  /** Called at once, then after every change (the language, or the bundles). */
  observe(listener: () => void): () => void;
}

/**
 * A contribution's text: the key `key` in the fragment `namespace` when l10n is wired, its inline
 * `fallback` (the default language's) otherwise or when no bundle has it; `{name}` filled from
 * `params`.
 */
export type TextOf = (
  namespace: string,
  key: string,
  fallback: string,
  params?: RequestParams,
) => string;

/** The text function over `l10n`, or the inline texts alone without it. */
export function textOf(l10n: WorkbenchL10n | undefined): TextOf {
  return (namespace, key, fallback, params) =>
    l10n
      ? l10n.text(namespace, key, { fallback, params: params ?? {} })
      : fillText(fallback, params);
}

/**
 * A command's title and description: with l10n, the keys `commands.<command-id>.title` and
 * `.description` of its fragment, then its inline `labels`, then its operation's summary and
 * description; without, `labelsOf` in `locale`.
 */
export function commandLabels(
  entry: CommandEntry,
  l10n: WorkbenchL10n | undefined,
  locale: string | undefined,
): { title: string; description: string } {
  const inline = labelsOf(entry);
  if (!l10n) return labelsOf(entry, locale);
  const pick = (field: "title" | "description") =>
    Object.fromEntries(Object.entries(entry.labels).map(([tag, label]) => [tag, label[field]]));
  const title = l10n.text(entry.fragment, `commands.${entry.command}.title`, {
    labels: pick("title"),
    fallback: inline.title,
  });
  const description = l10n.text(entry.fragment, `commands.${entry.command}.description`, {
    labels: pick("description"),
    fallback: entry.operation.description ?? entry.operation.summary ?? title,
  });
  return { title, description };
}
