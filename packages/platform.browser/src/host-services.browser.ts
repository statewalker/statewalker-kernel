import {
  CopyToClipboardCommand,
  type PickFilePayload,
  type PickFileResult,
  PickFileCommand,
  type UrlState,
} from "@statewalker/platform.core";
import { Commands } from "@statewalker/shared-commands";
import { buildHash, parseHash } from "./bind-url-state.js";
import { registerCopyToClipboardBrowser } from "./handlers/copy-to-clipboard.browser.js";
import { registerPickFileBrowser } from "./handlers/pick-file.browser.js";

/**
 * The browser's host services: what system.host answers with while no fragment contributes its
 * own (statewalker-root#258). The clipboard and the file picker run the `platform:*` handlers of
 * this package on a bus of their own; the URL state is the page's hash (`#<path>?<query>`).
 */
export interface BrowserHostServices {
  readonly clipboard: {
    /** `navigator.clipboard.writeText`: a secure context, and the user's permission or gesture. */
    writeText(text: string): Promise<void>;
    readText(): Promise<string>;
  };
  readonly files: {
    /** `showOpenFilePicker`, else an `<input type="file">`; needs a user gesture. */
    pickFile(options?: PickFilePayload): Promise<PickFileResult>;
  };
  readonly urlState: {
    read(): Promise<UrlState>;
    /** Write the hash; `replace` keeps the history entry. Writing the current state does nothing. */
    write(state: UrlState, options?: { replace?: boolean }): Promise<void>;
    /** Called after each change: written here, or navigated to (`hashchange`, `popstate`). */
    observe(listener: (state: UrlState) => void): () => void;
  };
  /** Unregister the handlers and stop following the URL. */
  close(): void;
}

export function createBrowserHostServices(): BrowserHostServices {
  const bus = Commands.create();
  const unregister = [registerCopyToClipboardBrowser(bus), registerPickFileBrowser(bus)];

  const listeners = new Set<(state: UrlState) => void>();
  let last = location.hash;
  function changed() {
    if (location.hash === last) return;
    last = location.hash;
    const state = parseHash(last);
    for (const listener of [...listeners]) {
      try {
        listener(state);
      } catch (error) {
        console.error("[platform.browser] a URL-state listener threw:", error);
      }
    }
  }
  window.addEventListener("hashchange", changed);
  window.addEventListener("popstate", changed);

  return {
    clipboard: {
      writeText: (text) => bus.call(CopyToClipboardCommand, { text }).promise,
      readText: () => navigator.clipboard.readText(),
    },
    files: {
      pickFile: (options = {}) => bus.call(PickFileCommand, options).promise,
    },
    urlState: {
      read: async () => parseHash(location.hash),
      async write(state, options) {
        const hash = buildHash(state);
        if (hash === (location.hash || "#")) return;
        if (options?.replace) history.replaceState(history.state, "", hash);
        else history.pushState(history.state, "", hash);
        changed();
      },
      observe(listener) {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
    },
    close() {
      for (const stop of unregister) stop();
      window.removeEventListener("hashchange", changed);
      window.removeEventListener("popstate", changed);
      listeners.clear();
    },
  };
}
