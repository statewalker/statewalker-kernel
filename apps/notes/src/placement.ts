// Placement of the fragments' server halves (statewalker/statewalker-root#263; ADR
// 2026-11-21-route-table-and-discovery): the route table, in the user's profile on this device,
// says where each fragment's server half is served (`local`, the host the page came from, unless
// listed), and client halves keep calling `<base>fragments/{id}/…`: `route(request)` sends each
// request to the fragment's home. Moving a fragment to another host is an explicit Move:
//
//   check bindings and version (the host it goes to installs the same version, disabled), deactivate
//   it here, export its DO data with a hand-over (it cannot run here again), import it there,
//   activate it there, switch the route.
//
// The source keeps its data, inactive, until the user confirms deleting it (`confirm`); `rollback`
// reactivates the source on the data it kept, switches the route back and discards the copy. A route
// change without moving data (`setRoute`) is allowed only while the fragment has no data at its home.
// A move copies data without transforming it: both hosts run the same version of the fragment.
//
// Each host does its own part under `/_launch/` (scripts/placement.mjs); the page runs the steps.

declare global {
  interface Window {
    /** The fragments' placement: the route table and Move (statewalker/statewalker-root#263). */
    placement: Placement;
  }
}

/** Where a fragment's server half is served. */
export interface FragmentRoute {
  readonly host: "local" | `url:${string}` | `peer:${string}`;
}

/** A Move not yet confirmed: the source keeps its data, inactive. */
export interface PendingMove {
  readonly from: FragmentRoute["host"];
  readonly to: FragmentRoute["host"];
  readonly at: string;
}

/** The part of the profile placement uses. */
export interface PlacementProfile {
  get(key: string): unknown | Promise<unknown>;
  set(key: string, value: unknown): void | Promise<void>;
  delete(key: string): void | Promise<void>;
}

/** The profile key of the route table: `{ "<fragment-id>": { host } }`. */
export const ROUTES_KEY = "routes";
/** The profile key of a fragment's pending Move. */
export const moveKey = (id: string) => `moves/${id}`;

export interface Placement {
  /** The route table: unlisted fragments are local. */
  routes(): Readonly<Record<string, FragmentRoute>>;
  /** Where `id` is served. */
  routeOf(id: string): FragmentRoute["host"];
  /** `request` to `<base>fragments/{id}/…`, sent to the fragment's home; any other, as it is. */
  route(request: Request): Promise<Request>;
  /** A Move not yet confirmed or rolled back, or undefined. */
  pending(id: string): Promise<PendingMove | undefined>;
  /** Moves `id`'s server half with its data to the host at `to`. Rejects with the reason, changing nothing that stays. */
  move(id: string, to: `url:${string}`): Promise<void>;
  /** The Move is kept: the source's data, kept inactive, is deleted. */
  confirm(id: string): Promise<void>;
  /** The Move is undone: the source runs again on the data it kept; the copy is deleted. */
  rollback(id: string): Promise<void>;
  /** A route change without moving data: refused once the fragment has data at its home. */
  setRoute(id: string, host: FragmentRoute["host"]): Promise<void>;
}

/** Why a placement step was refused, and by which host. */
export class PlacementError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "PlacementError";
  }
}

export function createPlacement(options: {
  /** The app's base URL, ending with `/`: the local host's. */
  readonly base: string;
  readonly profile: PlacementProfile;
  /** The installed version of a fragment, as the kernel has it. */
  readonly version: (id: string) => string | undefined;
  /** Sends a request to a host. Default: `fetch`. */
  readonly fetch?: (request: Request) => Promise<Response>;
  /** The routes read from the profile at start (it may answer asynchronously). */
  readonly routes?: Readonly<Record<string, FragmentRoute>>;
}): Placement {
  const send = options.fetch ?? ((r: Request) => fetch(r));
  let table: Record<string, FragmentRoute> = { ...(options.routes ?? {}) };
  const fragments = new URL("fragments/", options.base).href;

  const homeOf = (host: FragmentRoute["host"]): string => {
    if (host === "local") return options.base;
    if (host.startsWith("url:")) {
      const url = host.slice(4);
      return url.endsWith("/") ? url : `${url}/`;
    }
    throw new PlacementError(`${host}: peer homes are reached through HTTPeers, not yet here`);
  };

  /** A placement step on the host `host`: its JSON answer, or a PlacementError with its reason. */
  async function step(
    host: FragmentRoute["host"],
    path: string,
    body?: unknown,
  ): Promise<Record<string, unknown>> {
    const url = new URL(`_launch/${path}`, homeOf(host));
    const response = await send(
      new Request(url, {
        method: body === undefined ? "GET" : "POST",
        headers: body === undefined ? {} : { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
    if (!response.ok)
      throw new PlacementError(
        `${host === "local" ? "this host" : host}: ${(await response.text()) || response.statusText}`,
        response.status,
      );
    return (await response.json()) as Record<string, unknown>;
  }
  const at = (id: string, action: string) => `fragments/${encodeURIComponent(id)}/${action}`;

  async function saveRoute(id: string, host: FragmentRoute["host"]) {
    const next = { ...table };
    if (host === "local") delete next[id];
    else next[id] = { host };
    await options.profile.set(ROUTES_KEY, next);
    table = next;
  }

  const pending = async (id: string) =>
    (await options.profile.get(moveKey(id))) as PendingMove | undefined;

  return {
    routes: () => table,
    routeOf: (id) => table[id]?.host ?? "local",
    async route(request) {
      if (!request.url.startsWith(fragments)) return request;
      const rest = request.url.slice(fragments.length);
      const slash = rest.search(/[/?#]/);
      let id: string;
      try {
        id = decodeURIComponent(slash < 0 ? rest : rest.slice(0, slash));
      } catch {
        return request;
      }
      const host = table[id]?.host ?? "local";
      if (host === "local") return request;
      // Its body read whole: a body passed on as a stream is a streaming upload, which browsers
      // send only over HTTP/2.
      const body =
        request.method === "GET" || request.method === "HEAD"
          ? undefined
          : await request.arrayBuffer();
      return new Request(new URL(`fragments/${rest}`, homeOf(host)), {
        method: request.method,
        headers: request.headers,
        body,
        signal: request.signal,
        credentials: "omit",
        mode: "cors",
        redirect: request.redirect,
      });
    },
    pending,
    async move(id, to) {
      const from = table[id]?.host ?? "local";
      if (from === to) throw new PlacementError(`${id} is already served by ${to}`);
      if (await pending(id))
        throw new PlacementError(`${id} has a Move not confirmed yet: confirm it or roll it back`);
      const version = options.version(id);
      if (!version) throw new PlacementError(`${id} is not installed`);
      // Bindings and version: the host it goes to installs it, disabled, or says why it cannot.
      await step(to, at(id, "install"), { version });
      let exported = false;
      try {
        await step(from, at(id, "disable"), {});
        const { files } = await step(from, at(id, "data/export"), { handOver: true, to });
        exported = true;
        await step(to, at(id, "data/import"), { files });
        await step(to, at(id, "enable"), {});
        await options.profile.set(moveKey(id), {
          from,
          to,
          at: new Date().toISOString(),
        } satisfies PendingMove);
        await saveRoute(id, to);
      } catch (error) {
        // Nothing of the Move stays: the source runs again on its data, the copy goes.
        await step(from, at(id, exported ? "reactivate" : "enable"), {}).catch(() => {});
        await step(to, at(id, "data/delete"), {}).catch(() => {});
        await options.profile.delete(moveKey(id));
        throw error;
      }
    },
    async confirm(id) {
      const move = await pending(id);
      if (!move) throw new PlacementError(`${id} has no Move to confirm`);
      await step(move.from, at(id, "data/delete"), {});
      await options.profile.delete(moveKey(id));
    },
    async rollback(id) {
      const move = await pending(id);
      if (!move) throw new PlacementError(`${id} has no Move to roll back`);
      await step(move.to, at(id, "disable"), {});
      await step(move.from, at(id, "reactivate"), {});
      await saveRoute(id, move.from);
      await step(move.to, at(id, "data/delete"), {}).catch(() => {});
      await options.profile.delete(moveKey(id));
    },
    async setRoute(id, host) {
      if (await pending(id))
        throw new PlacementError(`${id} has a Move not confirmed yet: confirm it or roll it back`);
      const home = table[id]?.host ?? "local";
      if (home === host) return;
      const { hasData } = await step(home, at(id, "data"));
      if (hasData)
        throw new PlacementError(
          `${id} has data at ${home === "local" ? "this host" : home}: Move it with its data instead`,
        );
      await saveRoute(id, host);
    },
  };
}
