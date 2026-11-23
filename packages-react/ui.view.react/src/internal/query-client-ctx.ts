import { QueryClient } from "@tanstack/react-query";

const QUERY_CLIENT_KEY = "core-views:query-client";

/**
 * Boot-context-keyed accessor for the React Query `QueryClient`.
 * The boot script in `main.tsx` constructs the client and stores it
 * under `core-views:query-client`; `initCoreViews` reads it via
 * `getQueryClient` and wires it into `<AppRoot/>`'s
 * `<QueryClientProvider/>`.
 *
 * Lazy default: callers that don't pre-set the client (e.g. tests
 * that exercise `<App/>` in isolation) get a freshly-constructed
 * client with the same chat-mini defaults.
 */
export function getQueryClient(ctx: Record<string, unknown>): QueryClient {
  const existing = ctx[QUERY_CLIENT_KEY];
  if (existing instanceof QueryClient) return existing;
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  });
  ctx[QUERY_CLIENT_KEY] = client;
  return client;
}
