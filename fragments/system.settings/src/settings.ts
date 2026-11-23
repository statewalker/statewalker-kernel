import { Validator } from "@cfworker/json-schema";
import type { ActivationContext, Extension } from "@statewalker/kernel.core";
import { SETTINGS_POINT, SYSTEM_SETTINGS_ID } from "./archive.js";
import { SettingsError } from "./errors.js";

/** A setting's value: what the settings' schemas allow. */
export type SettingValue = string | number | boolean;

/** One fragment's settings values, by key. */
export type SettingsValues = Readonly<Record<string, SettingValue>>;

/** A setting's schema, as the `settings` point takes it (JSON Schema 2020-12). */
export interface SettingSchema {
  readonly type: "string" | "number" | "integer" | "boolean";
  readonly title?: string;
  readonly description?: string;
  readonly default?: SettingValue;
  readonly enum?: readonly (string | number)[];
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: string;
}

/** The data of an extension to `settings`. */
export interface SettingsPageData {
  readonly title?: string;
  readonly description?: string;
  readonly order?: number;
  readonly schema: {
    readonly type: "object";
    readonly properties: Readonly<Record<string, SettingSchema>>;
  };
}

/** One setting, as the settings view renders it. */
export interface SettingsField {
  readonly key: string;
  readonly type: SettingSchema["type"];
  /** The schema's `title`, else the key. */
  readonly title: string;
  readonly description?: string;
  /** The schema's default, when it is valid against the setting's schema. */
  readonly default?: SettingValue;
  readonly enum?: readonly (string | number)[];
  /** Each `enum` value's label, in order: `settings.<key>.enum.<value>`, else the value. */
  readonly enumTitles?: readonly string[];
  readonly schema: SettingSchema;
}

/** A fragment's settings page. */
export interface SettingsPage {
  /** The contributing fragment: its values' namespace. */
  readonly fragment: string;
  /** The page's title, else the fragment's id. */
  readonly title: string;
  readonly description?: string;
  readonly order: number;
  /** The settings, in the schema's order. */
  readonly fields: readonly SettingsField[];
}

/** What the settings view shows: every page, and each page's values. */
export interface SettingsState {
  readonly pages: readonly SettingsPage[];
  /** The values of each page's fragment, defaults applied. */
  readonly values: Readonly<Record<string, SettingsValues>>;
}

/**
 * One fragment's settings: what the client API gives a fragment for its own values. It reads
 * and writes only that fragment's namespace and only the keys its schema declares.
 */
export interface FragmentSettings {
  /** The values: each stored one valid against its schema, else the schema's default. */
  values(): SettingsValues;
  /** One value, as `values()` gives it; `undefined` for a key without value or default. */
  get(key: string): SettingValue | undefined;
  /** Store a value. Throws `SettingsError` (`unknown-fragment`, `unknown-setting`, `invalid-value`). */
  set(key: string, value: unknown): void;
  /** Forget the stored value of `key` (every key when none is given): the default applies. */
  reset(key?: string): void;
  /** Called at once, then after each change of these values. Returns a disposer. */
  observe(listener: (values: SettingsValues) => void): () => void;
}

/** The settings model: every enabled fragment's page, and the values in the user's profile. */
export interface Settings {
  /** The pages of the fragments resolved now, by order, then title. */
  pages(): readonly SettingsPage[];
  page(fragment: string): SettingsPage | undefined;
  /** The settings of the fragment `fragment`, scoped to its namespace. */
  of(fragment: string): FragmentSettings;
  /** A text of the settings view itself (system.settings' key `key`), in the interface language. */
  text(key: string, fallback: string): string;
  state(): SettingsState;
  /**
   * Called at once, then after every change (pages, values, or the interface language: labels and
   * `text` follow it). Returns a disposer.
   */
  observe(listener: (state: SettingsState) => void): () => void;
}

/** The part of the user's profile the values are kept in: system.profile's store. */
export interface SettingsStore {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  delete(key: string): void;
}

/** The version of the stored form, `{ version: 1, values: { <key>: <value> } }`. */
export const SETTINGS_VERSION = 1;

/** The profile key of a fragment's values: `settings/<fragment-id>`. */
export const settingsKey = (fragment: string) => `settings/${fragment}`;

/** The stored form of a fragment's values. */
export interface StoredSettings {
  readonly version: typeof SETTINGS_VERSION;
  readonly values: Readonly<Record<string, unknown>>;
}

/**
 * What the settings need of system.l10n (its `L10n` model fits): a fragment's key's text with the
 * contribution's inline text as the fallback, and a change subscription.
 */
export interface SettingsL10n {
  text(namespace: string, key: string, options?: { readonly fallback?: string }): string;
  /** Called at once, then after every change (the language, or the bundles). */
  observe(listener: () => void): () => void;
}

export interface SystemSettingsOptions {
  /** Where the values are kept (system.profile's store); in memory by default. */
  readonly profile?: SettingsStore;
  /**
   * system.l10n's model: the pages' labels are read under keys derived from the contribution
   * (`settings.title`, `settings.<key>.title`, ...) in the contributor's namespace, the inline
   * texts as the default language's. Without it, the inline texts.
   */
  readonly l10n?: SettingsL10n;
}

/** The system.settings fragment's headless code. */
export interface SystemSettings {
  readonly settings: Settings;
  /** Activate the client aspect: follow the `settings` point. Returns the cleanup. */
  activate(context: ActivationContext): () => void;
  /**
   * Delete a fragment's stored values: the host's `removeData` (a removal "with data") calls it.
   * A plain removal or a disable keeps them.
   */
  removeData(fragment: string): void;
}

function memoryStore(): SettingsStore {
  const items = new Map<string, string>();
  return {
    get: (key) => {
      const text = items.get(key);
      return text === undefined ? undefined : JSON.parse(text);
    },
    set: (key, value) => {
      items.set(key, JSON.stringify(value));
    },
    delete: (key) => {
      items.delete(key);
    },
  };
}

/** A compiled page: its fields (inline labels) and a validator per setting. */
interface Compiled {
  readonly page: SettingsPage;
  readonly validators: ReadonlyMap<string, Validator>;
}

/** A text of a contribution: the key in the namespace, the inline text as the fallback. */
type TextOf = (namespace: string, key: string, fallback: string) => string;

/**
 * The page in the interface language: its title and description (`settings.title`,
 * `settings.description`), each setting's (`settings.<key>.title`, `.description`) and each
 * choice's (`settings.<key>.enum.<value>`), read in the contributor's namespace.
 */
function localize(page: SettingsPage, text: TextOf): SettingsPage {
  const ns = page.fragment;
  return {
    ...page,
    title: text(ns, "settings.title", page.title),
    ...(page.description === undefined
      ? {}
      : { description: text(ns, "settings.description", page.description) }),
    fields: page.fields.map((field) => ({
      ...field,
      title: text(ns, `settings.${field.key}.title`, field.title),
      ...(field.description === undefined
        ? {}
        : { description: text(ns, `settings.${field.key}.description`, field.description) }),
      ...(field.enum === undefined
        ? {}
        : {
            enumTitles: field.enum.map((value) =>
              text(ns, `settings.${field.key}.enum.${value}`, String(value)),
            ),
          }),
    })),
  };
}

function validatorOf(schema: SettingSchema): Validator | undefined {
  try {
    return new Validator(schema as never, "2020-12", false);
  } catch {
    return undefined; // a pattern JavaScript cannot compile: nothing validates, nothing is stored
  }
}

function problemOf(validator: Validator | undefined, value: unknown): string | undefined {
  if (!validator) return "the setting's schema cannot be compiled";
  let result: ReturnType<Validator["validate"]>;
  try {
    result = validator.validate(value);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  if (result.valid) return undefined;
  return result.errors.map((e) => e.error).join("; ") || "schema violation";
}

function compile(extension: Extension): Compiled {
  const data = extension.data as SettingsPageData;
  const validators = new Map<string, Validator>();
  const fields: SettingsField[] = [];
  for (const [key, schema] of Object.entries(data.schema.properties)) {
    const validator = validatorOf(schema);
    if (validator) validators.set(key, validator);
    const valid = schema.default !== undefined && !problemOf(validator, schema.default);
    fields.push({
      key,
      type: schema.type,
      title: schema.title ?? key,
      ...(schema.description === undefined ? {} : { description: schema.description }),
      ...(valid ? { default: schema.default } : {}),
      ...(schema.enum === undefined
        ? {}
        : { enum: schema.enum, enumTitles: schema.enum.map((value) => String(value)) }),
      schema,
    });
  }
  return {
    page: {
      fragment: extension.contributor,
      title: data.title ?? extension.contributor,
      ...(data.description === undefined ? {} : { description: data.description }),
      order: data.order ?? 0,
      fields,
    },
    validators,
  };
}

function byOrder(a: SettingsPage, b: SettingsPage): number {
  return (
    a.order - b.order || a.title.localeCompare(b.title) || a.fragment.localeCompare(b.fragment)
  );
}

export function createSystemSettings(options: SystemSettingsOptions = {}): SystemSettings {
  const profile = options.profile ?? memoryStore();
  const { l10n } = options;
  const text: TextOf = (namespace, key, fallback) =>
    l10n ? l10n.text(namespace, key, { fallback }) : fallback;
  /** The pages by fragment: the first extension read per fragment. */
  let compiled = new Map<string, Compiled>();
  /** Observers, each with the JSON of what it saw last: told only of a change. */
  const watchers = new Set<{
    read: () => unknown;
    seen: string;
    call: (value: never) => void;
    /** Told of every language change too (the view's own texts follow it). */
    texts: boolean;
  }>();

  /** The stored values of a fragment, as stored (any keys), or none. */
  function stored(fragment: string): Record<string, unknown> {
    let read: unknown;
    try {
      read = profile.get(settingsKey(fragment));
    } catch (error) {
      console.error(`[system.settings] reading ${fragment}'s values failed:`, error);
      return {};
    }
    const form = read as Partial<StoredSettings> | undefined;
    if (
      !form ||
      typeof form !== "object" ||
      form.version !== SETTINGS_VERSION ||
      !form.values ||
      typeof form.values !== "object" ||
      Array.isArray(form.values)
    ) {
      return {};
    }
    return { ...form.values };
  }

  function valuesOf(fragment: string): SettingsValues {
    const page = compiled.get(fragment);
    if (!page) return {};
    const raw = stored(fragment);
    const values: Record<string, SettingValue> = {};
    for (const field of page.page.fields) {
      const value = raw[field.key];
      if (Object.hasOwn(raw, field.key) && !problemOf(page.validators.get(field.key), value)) {
        values[field.key] = value as SettingValue;
      } else if (field.default !== undefined) {
        values[field.key] = field.default;
      }
    }
    return values;
  }

  const pages = () => [...compiled.values()].map((c) => localize(c.page, text)).sort(byOrder);

  /** Write a fragment's stored values (none: the key is deleted). Profile errors are thrown. */
  function write(fragment: string, values: Record<string, unknown>) {
    if (Object.keys(values).length === 0) profile.delete(settingsKey(fragment));
    else profile.set(settingsKey(fragment), { version: SETTINGS_VERSION, values });
  }

  /** Call `listener` with `read()` at once, then whenever it changes. Returns a disposer. */
  function watch<T>(read: () => T, listener: (value: T) => void, texts = false): () => void {
    const value = read();
    const entry = {
      read,
      seen: JSON.stringify(value),
      call: listener as (value: never) => void,
      texts,
    };
    watchers.add(entry);
    listener(value);
    return () => {
      watchers.delete(entry);
    };
  }

  /** Tell each observer whose value changed; with `texts`, the model's observers in any case. */
  function notify(texts = false) {
    for (const entry of [...watchers]) {
      if (!watchers.has(entry)) continue;
      const value = entry.read();
      const seen = JSON.stringify(value);
      if (seen === entry.seen && !(texts && entry.texts)) continue;
      entry.seen = seen;
      try {
        entry.call(value as never);
      } catch (error) {
        console.error("[system.settings] a listener threw:", error);
      }
    }
  }

  function scoped(fragment: string): FragmentSettings {
    const values = () => valuesOf(fragment);
    return {
      values,
      get: (key) => {
        const all = values();
        return Object.hasOwn(all, key) ? all[key] : undefined;
      },
      set(key, value) {
        const page = compiled.get(fragment);
        if (!page) throw new SettingsError("unknown-fragment", fragment);
        if (!page.page.fields.some((f) => f.key === key)) {
          throw new SettingsError("unknown-setting", fragment, key);
        }
        const problem = problemOf(page.validators.get(key), value);
        if (problem) throw new SettingsError("invalid-value", fragment, key, problem);
        write(fragment, { ...stored(fragment), [key]: value });
        notify();
      },
      reset(key) {
        if (key === undefined) write(fragment, {});
        else {
          const next = stored(fragment);
          if (!Object.hasOwn(next, key)) return;
          delete next[key];
          write(fragment, next);
        }
        notify();
      },
      observe: (listener) => watch(values, listener),
    };
  }

  const settings: Settings = {
    pages,
    page: (fragment) => {
      const found = compiled.get(fragment);
      return found && localize(found.page, text);
    },
    text: (key, fallback) => text(SYSTEM_SETTINGS_ID, key, fallback),
    of: scoped,
    state: () => ({
      pages: pages(),
      values: Object.fromEntries(pages().map((p) => [p.fragment, valuesOf(p.fragment)])),
    }),
    observe: (listener) => watch(settings.state, listener, true),
  };

  return {
    settings,
    activate(context) {
      const stop = context.extensions.observe(SETTINGS_POINT, (all) => {
        const next = new Map<string, Compiled>();
        for (const extension of all) {
          if (!next.has(extension.contributor)) next.set(extension.contributor, compile(extension));
        }
        compiled = next;
        notify();
      });
      // The labels follow the interface language and the bundles.
      const stopL10n = l10n?.observe(() => notify(true));
      return () => {
        stop();
        stopL10n?.();
        compiled = new Map();
        notify();
      };
    },
    removeData(fragment) {
      profile.delete(settingsKey(fragment));
      notify();
    },
  };
}
