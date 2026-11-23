// The open views, kept in the URL state through system.host's `urlState` service: a reload, or a
// link carrying `#?views=<id>,<id>`, opens the views it names. React-free.
import type { UrlState, UrlStateService } from "@statewalker/client.core";
import type { Workbench } from "@statewalker/system.workbench";

/** The query parameter holding the open views' identities, comma-separated, in the order opened. */
export const VIEWS_PARAM = "views";

function viewsOf(state: UrlState): string[] | undefined {
  const views = state.query[VIEWS_PARAM];
  return views === undefined ? undefined : views.split(",").filter(Boolean);
}

/**
 * Open the views the URL state names (`defaults` when it names none), then keep the two in step:
 * opening or closing a view rewrites the URL state (replacing the history entry), and a
 * navigation to another URL state opens and closes views to match. A named view nobody
 * contributes is skipped. Returns the disposer.
 */
export async function bindLayoutToUrl(
  workbench: Workbench,
  urlState: UrlStateService,
  defaults: readonly string[],
): Promise<() => void> {
  function show(ids: readonly string[]) {
    for (const id of workbench.opened()) if (!ids.includes(id)) workbench.close(id);
    for (const id of ids) if (workbench.view(id)) workbench.open(id);
  }

  let current = await urlState.read();
  show(viewsOf(current) ?? defaults);
  const stopUrl = urlState.observe((state) => {
    current = state;
    const ids = viewsOf(state);
    if (ids) show(ids);
  });
  const stopWorkbench = workbench.observe(({ opened }) => {
    const views = opened.join(",");
    if (current.query[VIEWS_PARAM] === views) return;
    current = { path: current.path, query: { ...current.query, [VIEWS_PARAM]: views } };
    urlState.write(current, { replace: true }).catch((error: unknown) => {
      console.error("[shell] the open views were not written to the URL:", error);
    });
  });
  return () => {
    stopUrl();
    stopWorkbench();
  };
}
