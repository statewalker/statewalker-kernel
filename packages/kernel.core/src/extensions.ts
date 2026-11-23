import { Validator } from "@cfworker/json-schema";
import type { Slots } from "@statewalker/shared-slots";
import { ExtensionUnavailable } from "./errors.js";
import { isSystemId } from "./ids.js";
import {
  ASPECTS,
  type Aspect,
  type CommandReference,
  type EntrypointReference,
  type ExtensionPointDeclaration,
  type ExtensionReference,
  type InstalledFragment,
  type ModuleReference,
  type ReferenceKind,
} from "./manifest.js";
import { fragmentAspectSchemaV1 } from "./schema.js";
import {
  type ExtensionContribution,
  type ExtensionRefusal,
  extensionContributionsSlot,
  extensionRefusalsSlot,
  resolvedFragmentsSlot,
} from "./slots.js";
import { describeErrors } from "./validation.js";

/** One extension as the point's owner sees it. */
export interface Extension {
  /** `<contributor>#<n>` for a static extension, the slot key for a runtime one. */
  readonly id: string;
  /** The point's id. */
  readonly point: string;
  readonly contributor: string;
  readonly aspect: Aspect;
  /** The extension's data, valid against the point's schema. Read-only. */
  readonly data: unknown;
  /** The lazy reference to the contributor's code, when the extension carries one. */
  readonly reference?: LazyReference;
}

/**
 * A lazy reference, handed only to the point's owner. It is usable while the extension is
 * live (its contributor resolved, the contribution in place) and the owner's aspect is
 * active; otherwise, and for a resolution or call pending when that ends, it raises
 * `ExtensionUnavailable`.
 */
export interface LazyReference {
  readonly kind: ReferenceKind;
  /** The reference as declared. */
  readonly target: ExtensionReference;
  /**
   * Resolve the reference through the host's resolver of its kind. A function comes back
   * guarded: calling it once the extension is unavailable raises `ExtensionUnavailable`.
   */
  resolve<T = unknown>(): Promise<T>;
  /** Resolve the reference to a function and call it. */
  call<T = unknown>(...args: unknown[]): Promise<T>;
}

/** What a resolver learns about the reference it resolves. */
export interface ReferenceContext {
  readonly extension: Extension;
  readonly aspect: Aspect;
  /** The point's owner, the only fragment a reference is handed to. */
  readonly owner: InstalledFragment;
  /** The fragment whose code the reference names. */
  readonly contributor: InstalledFragment;
}

/**
 * The host's code that turns a reference into a value: imports the module export, binds
 * the entrypoint's service, looks up the command. The kernel loads no code itself.
 */
export type ReferenceResolver<R extends ExtensionReference> = (
  reference: R,
  context: ReferenceContext,
) => unknown;

export interface ReferenceResolvers {
  readonly module?: ReferenceResolver<ModuleReference>;
  readonly entrypoint?: ReferenceResolver<EntrypointReference>;
  readonly command?: ReferenceResolver<CommandReference>;
}

/** What changed in a point since the listener's last call. */
export interface ExtensionChange {
  readonly added: readonly Extension[];
  readonly removed: readonly Extension[];
}

export type ExtensionListener = (extensions: readonly Extension[], change: ExtensionChange) => void;

/** The extension points a fragment owns in one aspect, as handed to its activator. */
export interface OwnedExtensionPoints {
  /** The names of the points the fragment declares in this aspect. */
  readonly names: readonly string[];
  /** The live extensions of the point `name`, static ones first. */
  read(name: string): readonly Extension[];
  /**
   * Follow the point `name`: `listener` is called at once with the live extensions (all of
   * them `added`), then on every change. Returns a disposer.
   */
  observe(name: string, listener: ExtensionListener): () => void;
}

export interface ExtensionRegistryOptions {
  /** The host's resolver per reference kind; a kind without one is unavailable. */
  readonly resolvers?: ReferenceResolvers;
}

/** The kind of a reference: the key that tells the three shapes apart. */
export function referenceKind(reference: ExtensionReference): ReferenceKind {
  if ("module" in reference) return "module";
  if ("entrypoint" in reference) return "entrypoint";
  return "command";
}

/** The id of the point `name` opened by `owner`: its short name for a core fragment. */
export function extensionPointId(owner: string, name: string): string {
  return isSystemId(owner) ? name : `${owner}/${name}`;
}

interface Point {
  readonly id: string;
  readonly owner: InstalledFragment;
  readonly aspect: Aspect;
  readonly declaration: ExtensionPointDeclaration;
}

interface Entry {
  /** What the entry was made from: the entry is kept while the same source stays live. */
  readonly source: object;
  /** The extension's fields, without the owner's reference. */
  readonly extension: Omit<Extension, "reference">;
  readonly reference?: ExtensionReference;
  readonly owner: InstalledFragment;
  readonly contributor: InstalledFragment;
  /** Settles when the entry leaves the registry. */
  readonly gone: Signal;
}

/** A one-shot signal: `promise` resolves when `fire` is first called. */
interface Signal {
  readonly promise: Promise<void>;
  fired: boolean;
  fire(): void;
}

function signal(): Signal {
  let fire = () => {};
  const promise = new Promise<void>((resolve) => {
    fire = resolve;
  });
  const s: Signal = {
    promise,
    fired: false,
    fire() {
      s.fired = true;
      fire();
    },
  };
  return s;
}

const contributionValidator = new Validator(
  {
    type: "object",
    required: ["contributor", "point", "data"],
    additionalProperties: false,
    properties: {
      contributor: { type: "string", minLength: 1 },
      point: { $ref: "#/$defs/pointId" },
      data: true,
      reference: { $ref: "#/$defs/reference" },
    },
    $defs: fragmentAspectSchemaV1.$defs,
  } as never,
  "2020-12",
  false,
);

/**
 * The kernel's extension registry. It is computed from public state alone: the points of
 * resolved fragments, their static extensions, and the runtime contributions of resolved
 * fragments. An extension whose point is not open stays dormant; one that the point refuses
 * is published in `extensionRefusalsSlot` instead.
 */
export function createExtensionRegistry(
  slots: Slots,
  options: ExtensionRegistryOptions,
  onError: (owner: string, aspect: Aspect, error: unknown) => void,
) {
  let live = new Map<string, Entry>();
  const watchers = new Set<() => void>();
  const validators = new WeakMap<ExtensionPointDeclaration, Validator>();
  const refusals = new Map<string, { refusal: ExtensionRefusal; dispose: () => void }>();

  function validatorOf(declaration: ExtensionPointDeclaration): Validator {
    let validator = validators.get(declaration);
    if (!validator) {
      validator = new Validator(declaration.schema as never, "2020-12", false);
      validators.set(declaration, validator);
    }
    return validator;
  }

  function openPoints(resolved: readonly InstalledFragment[]): Map<string, Point> {
    const points = new Map<string, Point>();
    for (const owner of resolved) {
      for (const aspect of ASPECTS) {
        const declared = owner.aspects[aspect]?.extensionPoints ?? {};
        for (const [name, declaration] of Object.entries(declared)) {
          const id = extensionPointId(owner.id, name);
          points.set(id, { id, owner, aspect, declaration });
        }
      }
    }
    return points;
  }

  function compute() {
    const previous = live;
    const next = new Map<string, Entry>();
    const refused = new Map<string, ExtensionRefusal>();
    const resolved = [...slots.getSnapshot(resolvedFragmentsSlot).values()];
    const points = openPoints(resolved);

    const consider = (
      aspect: Aspect,
      id: string,
      contributor: InstalledFragment,
      source: { point: string; data: unknown; reference?: ExtensionReference },
    ) => {
      const point = points.get(source.point);
      if (!point) return; // dormant until the owner is resolved
      const key = `${aspect}\u0000${id}`;
      const refuse = (code: ExtensionRefusal["code"], message: string) =>
        refused.set(key, { id, contributor: contributor.id, point: source.point, code, message });
      if (point.aspect !== aspect) {
        refuse(
          "wrong-aspect",
          `"${id}" extends "${point.id}" in the ${aspect} aspect, but the point is opened in the ${point.aspect} aspect`,
        );
        return;
      }
      let result: ReturnType<Validator["validate"]>;
      try {
        result = validatorOf(point.declaration).validate(source.data);
      } catch (error) {
        refuse(
          "invalid-data",
          `"${id}" cannot be checked: the schema of "${point.id}" does not apply (${error instanceof Error ? error.message : String(error)})`,
        );
        return;
      }
      if (!result.valid) {
        refuse(
          "invalid-data",
          `"${id}" does not match the schema of "${point.id}": ${describeErrors(result.errors)}`,
        );
        return;
      }
      const kept = previous.get(key);
      if (kept && kept.source === source) {
        next.set(key, kept);
        return;
      }
      next.set(key, {
        source,
        extension: { id, point: point.id, contributor: contributor.id, aspect, data: source.data },
        reference: source.reference,
        owner: point.owner,
        contributor,
        gone: signal(),
      });
    };

    for (const contributor of resolved) {
      for (const aspect of ASPECTS) {
        const declared = contributor.aspects[aspect]?.extensions ?? [];
        declared.forEach((d, n) => {
          consider(aspect, `${contributor.id}#${n}`, contributor, d);
        });
      }
    }
    for (const aspect of ASPECTS) {
      for (const [id, c] of slots.getSnapshot(extensionContributionsSlot(aspect))) {
        const problem = contributionProblem(id, c);
        if (problem) {
          const contributor = typeof c?.contributor === "string" ? c.contributor : "";
          // Kept only while the fragment it names, or whose key it has, is resolved: a
          // removed or disabled fragment leaves no refusal behind.
          const keyOwner = id.includes("/") ? id.slice(0, id.indexOf("/")) : "";
          if (
            !slots.get(resolvedFragmentsSlot, contributor) &&
            !slots.get(resolvedFragmentsSlot, keyOwner)
          ) {
            continue;
          }
          const point = typeof c?.point === "string" ? c.point : "";
          refused.set(`${aspect}\u0000${id}`, {
            id,
            contributor,
            point,
            code: "invalid-contribution",
            message: `"${id}": ${problem}`,
          });
        } else {
          const fragment = slots.get(resolvedFragmentsSlot, c.contributor);
          if (fragment) consider(aspect, id, fragment, c);
        }
      }
    }
    return { next, refused };
  }

  function publishRefusals(refused: Map<string, ExtensionRefusal>) {
    for (const [key, held] of refusals) {
      const now = refused.get(key);
      if (!now || now.code !== held.refusal.code || now.message !== held.refusal.message) {
        held.dispose();
        refusals.delete(key);
      }
    }
    for (const [key, refusal] of refused) {
      if (refusals.has(key)) continue;
      const aspect = key.slice(0, key.indexOf("\u0000")) as Aspect;
      const dispose = slots.register(extensionRefusalsSlot(aspect), refusal.id, refusal);
      refusals.set(key, { refusal, dispose });
    }
  }

  // A refresh triggered while one runs (a listener contributing) is folded into it.
  let refreshing = false;
  let dirty = false;
  function refresh() {
    if (refreshing) {
      dirty = true;
      return;
    }
    refreshing = true;
    try {
      do {
        dirty = false;
        const { next, refused } = compute();
        const previous = live;
        live = next;
        for (const entry of previous.values()) if (!isLive(entry)) entry.gone.fire();
        publishRefusals(refused);
        for (const watcher of watchers) watcher();
      } while (dirty);
    } finally {
      refreshing = false;
    }
  }
  slots.observe(resolvedFragmentsSlot, refresh);
  for (const aspect of ASPECTS) slots.observe(extensionContributionsSlot(aspect), refresh);

  function isLive(entry: Entry): boolean {
    return live.get(`${entry.extension.aspect}\u0000${entry.extension.id}`) === entry;
  }

  /**
   * The points `owner` opens in `aspect`, for its activator, until `close` (the aspect's
   * deactivation): then reads are empty, listeners stop and references are unavailable.
   */
  function ownedBy(
    owner: InstalledFragment,
    aspect: Aspect,
  ): { points: OwnedExtensionPoints; close(): void } {
    const names = Object.keys(owner.aspects[aspect]?.extensionPoints ?? {});
    const closed = signal();
    const listeners = new Set<() => void>();
    const views = new WeakMap<Entry, Extension>();

    const viewOf = (entry: Entry): Extension => {
      let view = views.get(entry);
      if (!view) {
        const fields = entry.extension;
        view = Object.freeze({
          ...fields,
          ...(entry.reference && { reference: lazyReference(entry, () => view as Extension) }),
        });
        views.set(entry, view);
      }
      return view;
    };

    const lazyReference = (entry: Entry, self: () => Extension): LazyReference => {
      const target = entry.reference as ExtensionReference;
      const kind = referenceKind(target);
      const { id, contributor } = entry.extension;
      const unavailable = (reason: string) => new ExtensionUnavailable(id, contributor, reason);
      const check = () => {
        if (closed.fired) throw unavailable(`the owner's ${aspect} aspect was deactivated`);
        if (!isLive(entry)) throw unavailable("its contributor or contribution is gone");
      };
      // Rejecters of the resolutions and calls in flight, failed when the extension goes.
      const pending = new Set<(error: Error) => void>();
      void Promise.race([entry.gone.promise, closed.promise]).then(() => {
        const error = unavailable("it went while in use");
        for (const abort of pending) abort(error);
        pending.clear();
      });
      /** `value` unless the extension goes first; never waits past that. */
      const guard = <T>(value: T | PromiseLike<T>): Promise<T> =>
        new Promise<T>((resolve, reject) => {
          pending.add(reject);
          Promise.resolve(value).then(
            (v) => {
              pending.delete(reject);
              resolve(v);
            },
            (e: unknown) => {
              pending.delete(reject);
              reject(e);
            },
          );
        });
      const guardFunction = (fn: (...args: unknown[]) => unknown) =>
        function (this: unknown, ...args: unknown[]) {
          check();
          const result = fn.apply(this, args);
          return isThenable(result) ? guard(result) : result;
        };
      const resolve = async <T>(): Promise<T> => {
        check();
        const resolver = options.resolvers?.[kind] as ReferenceResolver<ExtensionReference>;
        if (!resolver) throw unavailable(`the host resolves no ${kind} references`);
        const context: ReferenceContext = {
          extension: self(),
          aspect,
          owner,
          contributor: entry.contributor,
        };
        const value = await guard(Promise.resolve().then(() => resolver(target, context)));
        check();
        return (typeof value === "function" ? guardFunction(value as never) : value) as T;
      };
      return Object.freeze({
        kind,
        target,
        resolve,
        async call<T>(...args: unknown[]): Promise<T> {
          const fn = await resolve<(...a: unknown[]) => unknown>();
          if (typeof fn !== "function") {
            throw new TypeError(`The ${kind} reference of "${id}" is not a function`);
          }
          return (await fn(...args)) as T;
        },
      });
    };

    const read = (name: string): readonly Extension[] => {
      // Only the owner's own points: a core owner's short ids would otherwise reach any point.
      if (closed.fired || !names.includes(name)) return [];
      const id = extensionPointId(owner.id, name);
      const result: Extension[] = [];
      for (const entry of live.values()) {
        if (entry.extension.point === id && entry.extension.aspect === aspect) {
          result.push(viewOf(entry));
        }
      }
      return result;
    };
    const points: OwnedExtensionPoints = {
      names,
      read,
      observe(name, listener) {
        let last = read(name);
        const watcher = () => {
          const current = read(name);
          const before = new Set(last);
          const now = new Set(current);
          const added = current.filter((e) => !before.has(e));
          const removed = last.filter((e) => !now.has(e));
          last = current;
          if (added.length === 0 && removed.length === 0) return;
          try {
            listener(current, { added, removed });
          } catch (error) {
            onError(owner.id, aspect, error);
          }
        };
        if (closed.fired) return () => {};
        watchers.add(watcher);
        listeners.add(watcher);
        listener(last, { added: last, removed: [] });
        return () => {
          watchers.delete(watcher);
          listeners.delete(watcher);
        };
      },
    };
    return {
      points,
      close() {
        closed.fire();
        for (const watcher of listeners) watchers.delete(watcher);
        listeners.clear();
      },
    };
  }

  return { ownedBy };
}

/** Why a runtime contribution is malformed, or `undefined`. */
function contributionProblem(key: string, c: ExtensionContribution): string | undefined {
  const result = contributionValidator.validate(c);
  if (!result.valid) return `not a valid contribution: ${describeErrors(result.errors)}`;
  if (!key.startsWith(`${c.contributor}/`)) {
    return `a contribution of "${c.contributor}" must be keyed "${c.contributor}/<name>"`;
  }
  return undefined;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}
