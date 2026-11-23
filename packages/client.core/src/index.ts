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
