// The platform's client API: the one module a fragment's client half imports to reach the
// platform. The shell shares it through its import map, so every fragment gets the same instance,
// and installs its bindings at boot (`installClient`). React-free.

/** The state a page's URL carries: a path and a query (platform.core's `UrlState`). */
export interface UrlState {
  path: string;
  query: Record<string, string>;
}

/** What to pick (platform.core's `PickFilePayload`). */
export interface PickFileOptions {
  title?: string;
  /** MIME types (`text/markdown`) and extensions (`.md`). */
  accept?: string[];
  multiple?: boolean;
}

/** The picked files, as blobs, with their names (platform.core's `PickFileResult`). */
export interface PickedFiles {
  blobs: Blob[];
  names: string[];
}

/** A command as the client API lists it. */
export interface ClientCommand {
  /** The command's identity, `<fragment-id>/<command-id>`. */
  readonly id: string;
}

/** The command bus, as system.commands runs it. */
export interface ClientCommands {
  /** Call the command `id` with `input`; rejects with the bus's typed error. */
  call<T = unknown>(id: string, input?: unknown): Promise<T>;
  /** The live commands. */
  list(): readonly ClientCommand[];
  /** Follow the live commands: called at once, then on every change. Returns a disposer. */
  observe(listener: (commands: readonly ClientCommand[]) => void): () => void;
}

/** The system clipboard. Browsers allow it in a secure context, mostly after a user gesture. */
export interface ClipboardService {
  writeText(text: string): Promise<void>;
  readText(): Promise<string>;
}

/** The host's file picker; it needs a user gesture in a browser. */
export interface FilePickerService {
  /** Let the user pick files; an empty result when they cancel. */
  pickFile(options?: PickFileOptions): Promise<PickedFiles>;
}

/** The state the page's URL carries (in a browser, its hash: `#<path>?<query>`). */
export interface UrlStateService {
  read(): Promise<UrlState>;
  /** Write the state; `replace` keeps the history entry instead of adding one. */
  write(state: UrlState, options?: { replace?: boolean }): Promise<void>;
  /** Follow the state: called after each change (written, or navigated to). Returns a disposer. */
  observe(listener: (state: UrlState) => void): () => void;
}

/** The host services (system.host's `host-services` point): one per kind, whoever provides it. */
export interface HostServices {
  readonly clipboard: ClipboardService;
  readonly files: FilePickerService;
  readonly urlState: UrlStateService;
}

/** What the user answered: the action picked (none when dismissed), and a dialog's typed text. */
export interface ClientAnswer {
  readonly action?: string;
  readonly value?: string;
}

/** Values a dialog's or notification's declared texts are filled from (`{name}`). */
export type ClientParams = Readonly<Record<string, unknown>>;

/**
 * Raising a dialog or a notification declared on system.workbench's `dialogs` or
 * `notifications` point, by identity (`<fragment-id>/<id>`).
 */
export interface ClientRequests {
  /**
   * Show it, its texts filled from `params`; resolves with the user's answer (`{}` when
   * dismissed), rejects when nobody declares `id`.
   */
  show(id: string, params?: ClientParams): Promise<ClientAnswer>;
}

/** A setting's value: a string, a number or a boolean, as its schema allows. */
export type ClientSettingValue = string | number | boolean;

/** One fragment's settings values, by key. */
export type ClientSettingsValues = Readonly<Record<string, ClientSettingValue>>;

/**
 * A fragment's own settings (system.settings): the values of the settings its `settings` page
 * declares, kept in the user's profile on this device, each the schema's default until set.
 */
export interface ClientFragmentSettings {
  /** The values: each stored one valid against its schema, else the schema's default. */
  values(): ClientSettingsValues;
  /** One value; `undefined` for a key with no value and no default. */
  get(key: string): ClientSettingValue | undefined;
  /** Store a value; throws when the fragment's schema refuses it or declares no such key. */
  set(key: string, value: unknown): void;
  /** Forget the value of `key` (every key when none is given): the default applies. */
  reset(key?: string): void;
  /** Called at once, then after each change of these values. Returns a disposer. */
  observe(listener: (values: ClientSettingsValues) => void): () => void;
}

/** The settings of each fragment, by its id: a fragment asks for its own. */
export interface ClientSettings {
  of(fragment: string): ClientFragmentSettings;
}

/** Values a text's `{name}` placeholders are filled from. */
export type ClientMessageParams = Readonly<Record<string, unknown>>;

/** The interface language, and every locale a bundle is contributed in. */
export interface ClientL10nState {
  readonly locale: string;
  readonly locales: readonly string[];
}

/**
 * Localization, as system.l10n provides it: the interface language (switched live) and the
 * texts of each fragment's keys in it, from the bundles fragments declare on its `l10n` point.
 */
export interface ClientL10n {
  /** The interface language (`fr-CA`). */
  locale(): string;
  /** The default language first, then every locale a bundle is contributed in. */
  locales(): readonly string[];
  /** Switch the interface language; views following `observe` re-render, nothing reloads. */
  setLocale(locale: string): void;
  /**
   * The text of `key` in the fragment `namespace`: the interface language's bundles, then the
   * default language's, then `options.fallback`, then the key; `{name}` filled from
   * `options.params`, formatted for the language (`Intl`).
   */
  text(
    namespace: string,
    key: string,
    options?: { readonly params?: ClientMessageParams; readonly fallback?: string },
  ): string;
  /** `{name}` in `text` filled from `params`, formatted for the interface language. */
  format(text: string, params?: ClientMessageParams): string;
  /** Called at once, then after every change (the language, or the bundles). Returns a disposer. */
  observe(listener: (state: ClientL10nState) => void): () => void;
}

/**
 * The fragments' server halves, as the host runs them (statewalker-root#259, #436): each fragment's
 * at `<base>fragments/<id>/`, when the page's launch configuration runs server halves at all.
 */
export interface ClientServersHost {
  /** The app's base URL, ending with `/`. */
  readonly base: string;
  /** Whether fragment `id`'s server half runs (the launch configuration says so, and it has one). */
  available(id: string): boolean;
  /** Settles once requests can reach the server halves (in a browser: the router and the pool). */
  ready(): Promise<void>;
  /** Sends a request to a server half. */
  fetch(request: Request): Promise<Response>;
}

/** A fragment's own server half, as its client half reaches it. */
export interface ClientServer {
  /** Its base URL: `<app base>fragments/<id>/`. */
  readonly base: string;
  /** Whether it runs here; without it the client half keeps its state itself. */
  available(): boolean;
  /**
   * A request to `path`, relative to `base`. A path that leaves `base` (absolute, `/…`, `//…`,
   * `..`) is refused with a `ServerPathError`, sent nowhere.
   */
  fetch(path: string, init?: RequestInit): Promise<Response>;
}

/** The server halves, by fragment: a fragment asks for its own. */
export interface ClientServers {
  of(fragment: string): ClientServer;
}

/** What the host installs. */
export interface ClientApi {
  readonly commands: ClientCommands;
  /** system.host's services; a host without them refuses `host`'s calls (`not-installed`). */
  readonly host?: HostServices;
  /** The workbench's dialogs; a host without a workbench leaves it out. */
  readonly dialogs?: ClientRequests;
  /** system.l10n's model; a host without it refuses `l10n`'s calls (`not-installed`). */
  readonly l10n?: ClientL10n;
  /** The workbench's notifications; a host without a workbench leaves it out. */
  readonly notifications?: ClientRequests;
  /** system.settings' values; a host without it refuses `settings`' calls (`not-installed`). */
  readonly settings?: ClientSettings;
  /** The server halves; a host without them refuses `servers`' requests (`not-installed`). */
  readonly servers?: ClientServersHost;
}

/** Why the client API refused: no host installed it, or a second host tried to. */
export class ClientApiError extends Error {
  override readonly name = "ClientApiError";
  constructor(readonly kind: "not-installed" | "already-installed") {
    super(
      kind === "not-installed"
        ? "the platform's client API (or the part asked for) is not installed: the shell installs it at boot"
        : "the platform's client API is already installed: one host at a time",
    );
  }
}

let installed: ClientApi | undefined;

function current(): ClientApi {
  if (!installed) throw new ClientApiError("not-installed");
  return installed;
}

function requests(which: "dialogs" | "notifications"): ClientRequests {
  const found = current()[which];
  if (!found) throw new ClientApiError("not-installed");
  return found;
}

/**
 * Install the host's bindings (the shell does this once, at boot). Returns the uninstaller.
 * Throws a `ClientApiError` while another host's bindings are installed.
 */
export function installClient(api: ClientApi): () => void {
  if (installed) throw new ClientApiError("already-installed");
  installed = api;
  return () => {
    if (installed === api) installed = undefined;
  };
}

function currentHost(): HostServices {
  const services = current().host;
  if (!services) throw new ClientApiError("not-installed");
  return services;
}

/** The command bus. Every member throws (`call` rejects) a `ClientApiError` before the install. */
export const commands: ClientCommands = {
  async call<T>(id: string, input?: unknown): Promise<T> {
    return current().commands.call<T>(id, input);
  },
  list: () => current().commands.list(),
  observe: (listener) => current().commands.observe(listener),
};

/**
 * The host services: the clipboard, the file pickers and the URL state, as system.host provides
 * them (the host's defaults, or a fragment's replacement). Every member throws (the promises
 * reject) a `ClientApiError` before the install.
 */
export const host: HostServices = {
  clipboard: {
    writeText: async (text) => currentHost().clipboard.writeText(text),
    readText: async () => currentHost().clipboard.readText(),
  },
  files: {
    pickFile: async (options) => currentHost().files.pickFile(options),
  },
  urlState: {
    read: async () => currentHost().urlState.read(),
    write: async (state, options) => currentHost().urlState.write(state, options),
    observe: (listener) => currentHost().urlState.observe(listener),
  },
};

/** The workbench's dialogs: `show` rejects a `ClientApiError` before the install. */
export const dialogs: ClientRequests = {
  async show(id, params) {
    return requests("dialogs").show(id, params);
  },
};

/** The workbench's notifications: `show` rejects a `ClientApiError` before the install. */
export const notifications: ClientRequests = {
  async show(id, params) {
    return requests("notifications").show(id, params);
  },
};

function currentSettings(fragment: string): ClientFragmentSettings {
  const found = current().settings;
  if (!found) throw new ClientApiError("not-installed");
  return found.of(fragment);
}

/**
 * Settings (system.settings): `settings.of("<this fragment's id>")` reads, writes and observes the
 * fragment's own values. Every member throws a `ClientApiError` before the install.
 */
export const settings: ClientSettings = {
  of: (fragment) => ({
    values: () => currentSettings(fragment).values(),
    get: (key) => currentSettings(fragment).get(key),
    set: (key, value) => currentSettings(fragment).set(key, value),
    reset: (key) => currentSettings(fragment).reset(key),
    observe: (listener) => currentSettings(fragment).observe(listener),
  }),
};

function currentL10n(): ClientL10n {
  const found = current().l10n;
  if (!found) throw new ClientApiError("not-installed");
  return found;
}

/** Localization (system.l10n). Every member throws a `ClientApiError` before the install. */
export const l10n: ClientL10n = {
  locale: () => currentL10n().locale(),
  locales: () => currentL10n().locales(),
  setLocale: (locale) => currentL10n().setLocale(locale),
  text: (namespace, key, options) => currentL10n().text(namespace, key, options),
  format: (text, params) => currentL10n().format(text, params),
  observe: (listener) => currentL10n().observe(listener),
};

/**
 * `t` for one fragment's keys: `translator("org.example.notes")("view.add", { n: 2 }, "Add {n}")`
 * is `l10n.text` in that namespace, the inline `fallback` the default language's text. A view
 * re-renders on `l10n.observe` to follow the language.
 */
export function translator(
  namespace: string,
): (key: string, params?: ClientMessageParams, fallback?: string) => string {
  return (key, params, fallback) =>
    l10n.text(namespace, key, {
      ...(params ? { params } : {}),
      ...(fallback !== undefined ? { fallback } : {}),
    });
}

/** A server path, or a fragment id, that would reach outside the fragment's own server half. */
export class ServerPathError extends Error {
  override readonly name = "ServerPathError";
  constructor(readonly path: string) {
    super(`"${path}" is not a path inside the fragment's own server half`);
  }
}

/** A fragment id: lowercase letters, digits, `.`, `_` and `-` (as the fragment hosts take it). */
const FRAGMENT_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;

function currentServers(): ClientServersHost {
  const found = current().servers;
  if (!found) throw new ClientApiError("not-installed");
  return found;
}

/** The URL `path` names under `base`, or a `ServerPathError` when it leaves `base`. */
function inside(base: string, path: string): URL {
  // Relative paths only: no scheme, no `/` or `\` first (an absolute or protocol-relative URL).
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || /^[/\\]/.test(path)) throw new ServerPathError(path);
  const url = new URL(path, base);
  // `..`, also escaped (`%2e%2e`): the resolved URL must stay under the base.
  const decoded = decodeURIComponent(url.pathname);
  if (
    url.origin !== new URL(base).origin ||
    !url.href.startsWith(base) ||
    /(^|\/)\.\.(\/|$)/.test(decoded)
  )
    throw new ServerPathError(path);
  return url;
}

/**
 * The server halves: `servers.of("<this fragment's id>")` is the fragment's own, its `fetch`
 * bound to it. Every request rejects a `ClientApiError` before the install.
 */
export const servers: ClientServers = {
  of(fragment) {
    if (!FRAGMENT_ID.test(fragment)) throw new ServerPathError(fragment);
    const baseOf = () => new URL(`fragments/${fragment}/`, currentServers().base).href;
    return {
      get base() {
        return baseOf();
      },
      available: () => {
        const found = current().servers;
        return found ? found.available(fragment) : false;
      },
      async fetch(path, init) {
        const host = currentServers();
        const url = inside(baseOf(), path);
        await host.ready();
        return host.fetch(new Request(url, init));
      },
    };
  },
};
