import type { ActivationContext, Extension } from "@statewalker/kernel.core";
import { DEFAULT_LOCALE, L10N_POINT } from "./archive.js";
import { L10nError } from "./errors.js";
import { formatMessage, type MessageParams } from "./format.js";

/** A message bundle as `l10n` takes it. */
export interface BundleData {
  readonly locale: string;
  /** The fragment whose keys it translates; the contributor's own by default. */
  readonly namespace?: string;
  readonly messages: Readonly<Record<string, string>>;
}

/** A bundle the model holds. */
export interface BundleEntry {
  /** The canonical locale (`fr-CA`). */
  readonly locale: string;
  readonly namespace: string;
  readonly messages: Readonly<Record<string, string>>;
  /** The contributing fragment. */
  readonly fragment: string;
}

/** How a text is looked up beyond the bundles. */
export interface TextOptions {
  /** Values `{name}` is filled from, formatted for the interface language. */
  readonly params?: MessageParams;
  /**
   * Inline texts by locale (`{ fr: "Nouvelle note…" }`), as a contribution carries them: asked
   * after the bundles of the interface language, before those of the default language.
   */
  readonly labels?: Readonly<Record<string, string | undefined>>;
  /** The default language's inline text: the last resort before the key itself. */
  readonly fallback?: string;
}

/** What the model holds, as a whole. */
export interface L10nState {
  /** The interface language. */
  readonly locale: string;
  readonly defaultLocale: string;
  /** The default language first, then every locale a bundle is contributed in, sorted. */
  readonly locales: readonly string[];
}

/** The l10n model: the interface language and the texts of every fragment's keys in it. */
export interface L10n {
  /** The interface language (canonical: `fr-CA`). */
  locale(): string;
  /** The language every fallback ends in. */
  defaultLocale(): string;
  /** The default language first, then every locale a bundle is contributed in, sorted. */
  locales(): readonly string[];
  /**
   * Switch the interface language, live: observers are told, nothing reloads. Any BCP 47 tag is
   * taken (texts it lacks fall back); a malformed one throws `L10nError` (`invalid-locale`).
   */
  setLocale(locale: string): void;
  /**
   * The text of `key` in `namespace` (a fragment id), in the interface language. For each locale
   * of the language (`fr-CA`, then `fr`): the namespace's own bundles, then `options.labels`,
   * then language packs' bundles. Then, in the default language: its own bundles and labels, then
   * `options.fallback` (the owner's inline text), then packs. Then the key. A pack fills only a
   * locale the owner does not cover; it never replaces an owner's text, inline or in a bundle.
   * `{name}` is filled from `options.params`.
   */
  text(namespace: string, key: string, options?: TextOptions): string;
  /** Whether `key` has a text in `namespace` for `locale` (the interface language by default). */
  has(namespace: string, key: string, locale?: string): boolean;
  /** `{name}` in `text` filled from `params`, formatted for the interface language (`Intl`). */
  format(text: string, params?: MessageParams): string;
  /** The live bundles, in the order read. */
  bundles(): readonly BundleEntry[];
  state(): L10nState;
  /** Called at once, then after every change (the language, or the bundles). Returns a disposer. */
  observe(listener: (state: L10nState) => void): () => void;
}

export interface SystemL10nOptions {
  /** The interface language at start (`navigator.language`); the default language otherwise. */
  readonly locale?: string;
  /** The language every fallback ends in; `en` by default. */
  readonly defaultLocale?: string;
}

/** The system.l10n fragment's headless code: its model and its client activator body. */
export interface SystemL10n {
  readonly l10n: L10n;
  /** Activate the client aspect: follow the `l10n` point. Returns the cleanup. */
  activate(context: ActivationContext): () => void;
}

/** The canonical form of a BCP 47 tag; throws `L10nError` for a malformed one. */
export function canonicalLocale(locale: string): string {
  try {
    const [canonical] = Intl.getCanonicalLocales(locale);
    if (canonical) return canonical;
  } catch {
    // RangeError: not a language tag.
  }
  throw new L10nError("invalid-locale", locale);
}

/** `fr-CA` → `["fr-CA", "fr"]`: the locale, then each shorter prefix. */
export function localeChain(locale: string): string[] {
  const parts = locale.split("-");
  const chain: string[] = [];
  for (let n = parts.length; n > 0; n--) chain.push(parts.slice(0, n).join("-"));
  return chain;
}

const isSystem = (id: string) => id === "system" || id.startsWith("system.");

/**
 * The bundle an extension carries, or `undefined` when it may not be taken: a bundle for a core
 * fragment's namespace (`system.*`) is taken only from a core fragment, so an installed fragment
 * cannot reword the platform's own texts (its permission and approval prompts among them).
 */
function bundleOf(extension: Extension): BundleEntry | undefined {
  const data = extension.data as BundleData;
  const namespace = data.namespace ?? extension.contributor;
  if (isSystem(namespace) && !isSystem(extension.contributor)) {
    console.warn(
      `[system.l10n] ${extension.contributor} may not translate ${namespace}: its bundle is ignored`,
    );
    return undefined;
  }
  let locale: string;
  try {
    locale = canonicalLocale(data.locale);
  } catch {
    return undefined;
  }
  return { locale, namespace, messages: data.messages, fragment: extension.contributor };
}

const own = Object.prototype.hasOwnProperty;

export function createSystemL10n(options: SystemL10nOptions = {}): SystemL10n {
  const defaultLocale = canonicalLocale(options.defaultLocale ?? DEFAULT_LOCALE);
  let locale = options.locale === undefined ? defaultLocale : canonicalLocale(options.locale);
  let bundles: readonly BundleEntry[] = [];
  /** `<namespace>\n<locale>` → the messages of the namespace's own bundles, in the order read. */
  let owners = new Map<string, Readonly<Record<string, string>>[]>();
  /** `<namespace>\n<locale>` → the messages of language packs' bundles, in the order read. */
  let packs = new Map<string, Readonly<Record<string, string>>[]>();
  const listeners = new Set<(state: L10nState) => void>();

  function reindex() {
    const nextOwners = new Map<string, Readonly<Record<string, string>>[]>();
    const nextPacks = new Map<string, Readonly<Record<string, string>>[]>();
    for (const b of bundles) {
      const into = b.fragment === b.namespace ? nextOwners : nextPacks;
      const slot = `${b.namespace}\n${b.locale.toLowerCase()}`;
      const list = into.get(slot) ?? [];
      list.push(b.messages);
      into.set(slot, list);
    }
    owners = nextOwners;
    packs = nextPacks;
  }

  /** The text of `key` for exactly `tag` in one tier of bundles, if any. */
  function find(
    tier: Map<string, Readonly<Record<string, string>>[]>,
    namespace: string,
    key: string,
    tag: string,
  ): string | undefined {
    for (const messages of tier.get(`${namespace}\n${tag.toLowerCase()}`) ?? []) {
      if (own.call(messages, key)) return messages[key];
    }
    return undefined;
  }

  /** Any bundle's text of `key` for exactly `tag`, the namespace's own first. */
  function lookup(namespace: string, key: string, tag: string): string | undefined {
    return find(owners, namespace, key, tag) ?? find(packs, namespace, key, tag);
  }

  /** `labels`' text for exactly `tag` (case-insensitive), if any. */
  function label(labels: TextOptions["labels"], tag: string): string | undefined {
    if (!labels) return undefined;
    const wanted = tag.toLowerCase();
    for (const [k, v] of Object.entries(labels)) if (k.toLowerCase() === wanted) return v;
    return undefined;
  }

  /**
   * The owner's texts (its bundles, then its inline labels) form one tier ahead of language
   * packs in every locale: a pack fills only a locale the owner does not cover, never replaces
   * an owner's text. The inline fallback is the owner's text in the default language.
   */
  function resolve(namespace: string, key: string, opts: TextOptions): string {
    const defaults = localeChain(defaultLocale);
    const isDefault = new Set(defaults.map((t) => t.toLowerCase()));
    const ownerText = (tag: string) => find(owners, namespace, key, tag) ?? label(opts.labels, tag);
    for (const tag of localeChain(locale)) {
      if (isDefault.has(tag.toLowerCase())) break; // the default language's step, below
      const found = ownerText(tag) ?? find(packs, namespace, key, tag);
      if (found !== undefined) return found;
    }
    for (const tag of defaults) {
      const found = ownerText(tag);
      if (found !== undefined) return found;
    }
    if (opts.fallback !== undefined) return opts.fallback;
    for (const tag of defaults) {
      const found = find(packs, namespace, key, tag);
      if (found !== undefined) return found;
    }
    return key;
  }

  const locales = (): readonly string[] => {
    const tags = new Map<string, string>();
    for (const b of bundles) tags.set(b.locale.toLowerCase(), b.locale);
    tags.delete(defaultLocale.toLowerCase());
    return [defaultLocale, ...[...tags.values()].sort()];
  };

  const state = (): L10nState => ({ locale, defaultLocale, locales: locales() });

  function notify() {
    const current = state();
    for (const listener of [...listeners]) {
      try {
        listener(current);
      } catch (error) {
        console.error("[system.l10n] a listener threw:", error);
      }
    }
  }

  const l10n: L10n = {
    locale: () => locale,
    defaultLocale: () => defaultLocale,
    locales,
    setLocale(next) {
      const canonical = canonicalLocale(next);
      if (canonical === locale) return;
      locale = canonical;
      notify();
    },
    text(namespace, key, opts = {}) {
      return formatMessage(resolve(namespace, key, opts), opts.params, locale);
    },
    has(namespace, key, tag = locale) {
      return lookup(namespace, key, canonicalLocale(tag)) !== undefined;
    },
    format: (text, params) => formatMessage(text, params, locale),
    bundles: () => bundles,
    state,
    observe(listener) {
      const entry = (s: L10nState) => listener(s);
      listeners.add(entry);
      entry(state());
      return () => {
        listeners.delete(entry);
      };
    },
  };

  return {
    l10n,
    activate(context) {
      const stop = context.extensions.observe(L10N_POINT, (all) => {
        bundles = all.map(bundleOf).filter((b): b is BundleEntry => b !== undefined);
        reindex();
        notify();
      });
      return () => {
        stop();
        bundles = [];
        reindex();
        notify();
      };
    },
  };
}
