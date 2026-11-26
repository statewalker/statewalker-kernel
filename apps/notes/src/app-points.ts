// The extension points the app's fragments open in their client aspect, for the client API's
// `points` (statewalker/statewalker-root#261): the kernel hands a fragment's owned points to its
// activator; while the fragment's client aspect is active, its client code follows them here.
import type { ClientExtension, ClientPoints } from "@statewalker/client.core";
import type { Extension, OwnedExtensionPoints } from "@statewalker/kernel.core";

interface Watcher {
  readonly owner: string;
  readonly name: string;
  readonly listener: (extensions: readonly ClientExtension[]) => void;
  stop?: () => void;
}

const toClient = (extension: Extension): ClientExtension => ({
  id: extension.id,
  contributor: extension.contributor,
  data: extension.data,
  call: async <T>(...args: unknown[]) => {
    if (!extension.reference)
      throw new Error(`${extension.id} references no code: there is nothing to call`);
    return extension.reference.call<T>(...args);
  },
});

export interface AppPoints {
  /** What the client API's `points` reads. */
  readonly points: ClientPoints;
  /** The owner's client aspect became active with these points; returns the release. */
  attach(owner: string, owned: OwnedExtensionPoints): () => void;
}

export function createAppPoints(): AppPoints {
  const owned = new Map<string, OwnedExtensionPoints>();
  const watchers = new Set<Watcher>();

  const start = (watcher: Watcher) => {
    const points = owned.get(watcher.owner);
    if (!points?.names.includes(watcher.name)) {
      watcher.listener([]);
      return;
    }
    watcher.stop = points?.observe(watcher.name, (extensions) =>
      watcher.listener(extensions.map(toClient)),
    );
  };
  const stop = (watcher: Watcher) => {
    watcher.stop?.();
    watcher.stop = undefined;
  };

  return {
    points: {
      observe(owner, name, listener) {
        const watcher: Watcher = { owner, name, listener };
        watchers.add(watcher);
        start(watcher);
        return () => {
          watchers.delete(watcher);
          stop(watcher);
        };
      },
    },
    attach(owner, points) {
      owned.set(owner, points);
      for (const watcher of watchers) if (watcher.owner === owner) start(watcher);
      return () => {
        if (owned.get(owner) !== points) return;
        owned.delete(owner);
        for (const watcher of watchers)
          if (watcher.owner === owner) {
            stop(watcher);
            watcher.listener([]);
          }
      };
    },
  };
}
