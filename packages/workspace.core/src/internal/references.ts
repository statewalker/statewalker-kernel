/**
 * A weak-ref, dependency-tracked memoized value. Calling the reference returns
 * the current value, recomputing it when it has been garbage-collected or when
 * any declared dependency has been recomputed since the last read. Used by
 * adapters to expose derived payloads (text → json → …) as a GC-able, reactive
 * DAG; the value MUST be an object (WeakRef cannot hold primitives — box scalars
 * as `{ value }`).
 */
export interface Reference<T extends object> {
  (): T;
  readonly ref: WeakRef<T>;
  reset(): Reference<T>;
}

export function newReference<T extends object>(createFn: (...args: object[]) => T): Reference<T>;
export function newReference<T extends object>(
  dependecies: Reference<object>[],
  createFn: (...args: object[]) => T,
): Reference<T>;
export function newReference<T extends object>(
  dependecies: Reference<object>[] | ((...args: object[]) => T),
  createFn?: (...args: object[]) => T,
): Reference<T> {
  const [create, deps] = getDependenciesAndCreateFn(dependecies, createFn);

  if (typeof create !== "function") {
    throw new Error("Creation function is not defined");
  }

  const refs: Array<WeakRef<object> | undefined> = new Array(deps.length);
  let _weakRef: WeakRef<T> | undefined;

  function weakRef(): WeakRef<T> {
    const value = _weakRef ? _weakRef.deref() : undefined;
    let updated = value === undefined;
    for (const [i, dep] of deps.entries()) {
      const ref = dep.ref;
      updated = updated || refs[i] !== ref;
      refs[i] = ref;
    }
    _weakRef = updated ? new WeakRef(create(...refs.map((r) => r!.deref()!))) : _weakRef!;
    return _weakRef;
  }

  function deref(): T {
    return weakRef().deref()!;
  }

  return Object.assign(
    Object.defineProperty(deref, "ref", {
      get: weakRef,
    }),
    {
      reset: () => {
        _weakRef = undefined;
        return deref as Reference<T>;
      },
    },
  ) as Reference<T>;
}

function getDependenciesAndCreateFn<T extends object>(
  deps: Reference<object>[] | ((...args: object[]) => T),
  createFn?: (...args: object[]) => T,
): [(...args: object[]) => T, Reference<object>[]] {
  if (typeof deps === "function") {
    return [deps, []];
  } else if (Array.isArray(deps) && typeof createFn === "function") {
    return [createFn, deps];
  } else {
    throw new Error("Invalid arguments: expected (createFn) or (deps, createFn)");
  }
}
