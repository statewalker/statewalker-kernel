import type { Extension } from "@statewalker/kernel.core";
import { SYSTEM_WORKBENCH_ID } from "./archive.js";
import { WorkbenchError, type WorkbenchErrorKind } from "./errors.js";
import type { TextOf } from "./l10n.js";

/** Values a declared dialog's or notification's texts are filled from: `{name}` → `params.name`. */
export type RequestParams = Readonly<Record<string, unknown>>;

/** A button of a dialog or a notification. */
export interface RequestAction {
  readonly id: string;
  readonly label: string;
  /** The dialog's default button (Enter). */
  readonly primary?: boolean;
}

/** What the user answered: the action picked (none when dismissed), and a dialog's input. */
export interface RequestAnswer {
  readonly action?: string;
  readonly value?: string;
}

/** A dialog waiting for its answer, as the client shows it. */
export interface DialogRequest {
  /** The request's number, to answer it with. */
  readonly request: number;
  /** The dialog's identity, `<fragment-id>/<dialog-id>`. */
  readonly id: string;
  /** The declaring fragment. */
  readonly fragment: string;
  readonly title: string;
  readonly message?: string;
  readonly input?: {
    readonly label: string;
    readonly placeholder?: string;
    readonly value?: string;
  };
  readonly actions: readonly RequestAction[];
}

/** How bad a notification is. */
export type NotificationSeverity = "info" | "success" | "warning" | "error";

/** A notification waiting for its answer (an action, or being dismissed). */
export interface NotificationRequest {
  readonly request: number;
  /** The notification's identity, `<fragment-id>/<notification-id>`. */
  readonly id: string;
  readonly fragment: string;
  readonly title: string;
  readonly message?: string;
  readonly severity: NotificationSeverity;
  readonly actions: readonly RequestAction[];
}

/** Raising and answering one kind of request (dialogs, or notifications). */
export interface Requests<R> {
  /**
   * Show the declared dialog or notification `id` (`<fragment-id>/<id>`), its texts filled from
   * `params`. Resolves with the user's answer (`{}` when dismissed, or when its fragment leaves);
   * rejects with a `WorkbenchError` when nobody declares `id`.
   */
  show(id: string, params?: RequestParams): Promise<RequestAnswer>;
  /** The requests waiting for an answer, oldest first. */
  pending(): readonly R[];
  /** Answer the request `request` (a number from `pending()`); a stale number is ignored. */
  answer(request: number, answer: RequestAnswer): void;
}

interface DeclaredData {
  readonly id: string;
  readonly title: string;
  readonly message?: string;
  readonly severity?: NotificationSeverity;
  readonly input?: DialogRequest["input"];
  readonly actions?: readonly RequestAction[];
}

/** `{name}` replaced by `params.name` (left as is when absent). */
export function fillText(text: string, params: RequestParams = {}): string {
  return text.replace(/\{([\w.-]+)\}/g, (whole, name: string) =>
    params[name] === undefined ? whole : String(params[name]),
  );
}

interface Pending<R> {
  value: R;
  readonly extension: Extension;
  readonly params: RequestParams;
  readonly resolve: (answer: RequestAnswer) => void;
}

/** The inline texts alone: `{name}` filled, no bundles. */
const inlineText: TextOf = (_namespace, _key, fallback, params) => fillText(fallback, params);

/**
 * A queue of requests of one kind, declared on a point (`declared()` is that point's live
 * extensions). `build` makes the request shown for a declaration. `changed` is called after
 * every change to the queue.
 */
export function createRequests<R extends { readonly request: number; readonly fragment: string }>(
  unknownKind: WorkbenchErrorKind,
  declared: () => readonly Extension[],
  build: (
    request: number,
    extension: Extension,
    data: DeclaredData,
    params: RequestParams,
    text?: TextOf,
  ) => R,
  changed: () => void,
  text: TextOf = inlineText,
): Requests<R> & { drop(live: (fragment: string) => boolean): void; retranslate(): void } {
  let queue: readonly Pending<R>[] = [];
  let next = 1;
  const settle = (match: (p: Pending<R>) => boolean, answer: (p: Pending<R>) => RequestAnswer) => {
    const settled = queue.filter(match);
    if (settled.length === 0) return;
    queue = queue.filter((p) => !match(p));
    for (const p of settled) p.resolve(answer(p));
    changed();
  };
  return {
    async show(id, params = {}) {
      const extension = declared().find(
        (e) => `${e.contributor}/${(e.data as DeclaredData).id}` === id,
      );
      if (!extension) throw new WorkbenchError(unknownKind, id);
      const value = build(next++, extension, extension.data as DeclaredData, params, text);
      return new Promise<RequestAnswer>((resolve) => {
        queue = [...queue, { value, extension, params, resolve }];
        changed();
      });
    },
    pending: () => queue.map((p) => p.value),
    answer(request, answer) {
      const { action, value } = answer;
      settle(
        (p) => p.value.request === request,
        () => ({
          ...(action !== undefined ? { action } : {}),
          ...(value !== undefined ? { value } : {}),
        }),
      );
    },
    /** Build the pending requests' texts again (the interface language changed). */
    retranslate() {
      if (queue.length === 0) return;
      for (const p of queue) {
        p.value = build(
          p.value.request,
          p.extension,
          p.extension.data as DeclaredData,
          p.params,
          text,
        );
      }
      queue = [...queue];
      changed();
    },
    /** Dismiss the requests of fragments that are no longer `live`. */
    drop(live) {
      settle(
        (p) => !live(p.value.fragment),
        () => ({}),
      );
    },
  };
}

/** A dialog request from its declaration. */
export function dialogRequest(
  request: number,
  extension: Extension,
  data: DeclaredData,
  params: RequestParams,
  text: TextOf = inlineText,
): DialogRequest {
  const ns = extension.contributor;
  const key = `dialogs.${data.id}`;
  const t = (k: string, fallback: string) => text(ns, `${key}.${k}`, fallback, params);
  const ok = text(SYSTEM_WORKBENCH_ID, "actions.ok", "OK");
  const input = data.input;
  return {
    request,
    id: `${ns}/${data.id}`,
    fragment: ns,
    title: t("title", data.title),
    ...(data.message !== undefined ? { message: t("message", data.message) } : {}),
    ...(input
      ? {
          input: {
            ...input,
            label: t("input.label", input.label),
            ...(input.placeholder !== undefined
              ? { placeholder: t("input.placeholder", input.placeholder) }
              : {}),
            ...(input.value !== undefined ? { value: t("input.value", input.value) } : {}),
          },
        }
      : {}),
    actions: (data.actions ?? [{ id: "ok", label: ok, primary: true }]).map((a) => ({
      ...a,
      label: t(`actions.${a.id}`, a.label),
    })),
  };
}

/** A notification request from its declaration. */
export function notificationRequest(
  request: number,
  extension: Extension,
  data: DeclaredData,
  params: RequestParams,
  text: TextOf = inlineText,
): NotificationRequest {
  const ns = extension.contributor;
  const t = (k: string, fallback: string) =>
    text(ns, `notifications.${data.id}.${k}`, fallback, params);
  return {
    request,
    id: `${ns}/${data.id}`,
    fragment: ns,
    title: t("title", data.title),
    ...(data.message !== undefined ? { message: t("message", data.message) } : {}),
    severity: data.severity ?? "info",
    actions: (data.actions ?? []).map((a) => ({ ...a, label: t(`actions.${a.id}`, a.label) })),
  };
}
