import { BaseClass } from "@statewalker/shared-baseclass";

const counters = new Map<string, number>();

function generateKey(className: string): string {
  const count = (counters.get(className) ?? 0) + 1;
  counters.set(className, count);
  return `${className}-${count}`;
}

/**
 * Reactive base for file-explorer panel-side models. Carries a stable
 * `key` (auto-generated per class so consumers can use it as a React
 * key when rendering panel-internal lists), bumps a `version` counter
 * on every notify (so React's `useSyncExternalStore` snapshot reads
 * are referentially stable), and inherits `notify()` / `onUpdate()`
 * from `BaseClass`.
 */
export class ViewModel extends BaseClass {
  readonly key: string;
  title = "";
  /** Monotonically-increasing notify counter, used by React hooks. */
  version = 0;

  constructor(options?: { key?: string }) {
    super();
    this.key = options?.key ?? generateKey(this.constructor.name);
  }

  override notify(): void {
    this.version++;
    super.notify();
  }

  setTitle(title: string): void {
    this.title = title;
    this.notify();
  }
}
