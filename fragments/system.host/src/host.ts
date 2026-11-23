import type { HostServices, UrlState, UrlStateService } from "@statewalker/client.core";
import type { ActivationContext, Extension } from "@statewalker/kernel.core";
import { HOST_SERVICES_POINT, type HostServiceKind } from "./archive.js";
import { HostServiceError } from "./errors.js";

export interface SystemHostOptions {
  /**
   * The host's own services (in a browser, platform.browser's `createBrowserHostServices()`),
   * used while no fragment contributes one of the kind. A kind with neither is `unavailable`.
   */
  readonly defaults?: Partial<HostServices>;
}

/** The system.host fragment's headless code: the services fragments reach, and its activator. */
export interface SystemHost {
  /**
   * The host services, each answered by the service in effect at the time of the call: the
   * first live contribution of its kind, else the host's default. What the shell installs as
   * `@statewalker/client.core`'s `host`.
   */
  readonly services: HostServices;
  /** The fragment whose service of `kind` is in effect, or `undefined` for the host's own. */
  provider(kind: HostServiceKind): string | undefined;
  /** Activate the client aspect: follow the `host-services` point. Returns the cleanup. */
  activate(context: ActivationContext): () => void;
}

/** The `HostServices` member of each kind. */
const MEMBER: Record<HostServiceKind, keyof HostServices> = {
  clipboard: "clipboard",
  files: "files",
  "url-state": "urlState",
};

type Source = Extension | "default";

export function createSystemHost(options: SystemHostOptions = {}): SystemHost {
  const defaults = options.defaults ?? {};
  /** The contribution in effect per kind: the first live extension of the kind read. */
  let chosen = new Map<HostServiceKind, Extension>();

  /** The service of `kind` in effect now, resolved, with its contributor (none for the host's). */
  async function serviceOf(kind: HostServiceKind): Promise<{ impl: unknown; fragment?: string }> {
    const extension = chosen.get(kind);
    if (extension?.reference) {
      return { impl: await extension.reference.resolve(), fragment: extension.contributor };
    }
    const impl = defaults[MEMBER[kind]];
    if (!impl) throw new HostServiceError("unavailable", kind);
    return { impl };
  }

  /** The method `method` of the service in effect, bound to it. */
  async function methodOf(kind: HostServiceKind, method: string) {
    const { impl, fragment } = await serviceOf(kind);
    const fn = (impl as Record<string, unknown> | undefined)?.[method];
    if (typeof fn !== "function") throw new HostServiceError("invalid-service", kind, fragment);
    return (...args: unknown[]) => fn.apply(impl, args);
  }

  async function invoke<T>(kind: HostServiceKind, method: string, ...args: unknown[]) {
    return (await methodOf(kind, method))(...args) as Promise<T>;
  }

  // URL-state observers follow the service in effect: one subscription to it while anyone
  // observes, moved when the provider changes.
  const urlListeners = new Set<(state: UrlState) => void>();
  let followed: { source: Source; stopped: boolean; stop?: () => void } | undefined;

  function stopFollowing() {
    if (!followed) return;
    followed.stopped = true;
    followed.stop?.();
    followed = undefined;
  }

  function refollow() {
    const source: Source = chosen.get("url-state") ?? "default";
    if (urlListeners.size === 0) return stopFollowing();
    if (followed?.source === source) return;
    stopFollowing();
    const entry: { source: Source; stopped: boolean; stop?: () => void } = {
      source,
      stopped: false,
    };
    followed = entry;
    methodOf("url-state", "observe")
      .then((observe) => {
        if (entry.stopped) return;
        entry.stop = observe((state: UrlState) => {
          for (const listener of [...urlListeners]) {
            try {
              listener(state);
            } catch (error) {
              console.error("[system.host] a URL-state listener threw:", error);
            }
          }
        }) as () => void;
      })
      .catch((error: unknown) => {
        if (entry.stopped) return;
        if (error instanceof HostServiceError && error.kind === "unavailable") return;
        console.error("[system.host] cannot follow the URL state:", error);
      });
  }

  /** The services in effect are the first live extension of each kind, in read order. */
  function sync(extensions: readonly Extension[]) {
    const next = new Map<HostServiceKind, Extension>();
    for (const extension of extensions) {
      const { service } = extension.data as { service: HostServiceKind };
      if (extension.reference && !next.has(service)) next.set(service, extension);
    }
    chosen = next;
    refollow();
  }

  const urlState: UrlStateService = {
    read: () => invoke<UrlState>("url-state", "read"),
    write: (state, writeOptions) => invoke<void>("url-state", "write", state, writeOptions),
    observe(listener) {
      urlListeners.add(listener);
      refollow();
      return () => {
        urlListeners.delete(listener);
        refollow();
      };
    },
  };

  const services: HostServices = {
    clipboard: {
      writeText: (text) => invoke<void>("clipboard", "writeText", text),
      readText: () => invoke<string>("clipboard", "readText"),
    },
    files: {
      pickFile: (pickOptions) => invoke("files", "pickFile", pickOptions),
    },
    urlState,
  };

  return {
    services,
    provider: (kind) => chosen.get(kind)?.contributor,
    activate(context) {
      const read = () => sync(context.extensions.read(HOST_SERVICES_POINT));
      const stop = context.extensions.observe(HOST_SERVICES_POINT, read);
      return () => {
        stop();
        sync([]);
      };
    },
  };
}
