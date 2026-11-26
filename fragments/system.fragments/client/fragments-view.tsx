import type { FragmentFiles } from "@statewalker/kernel.core";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@statewalker/ui.view.shadcn";
import { type ComponentType, type ReactNode, useCallback, useEffect, useState } from "react";
import type { ConsentSummary, FragmentEntry, FragmentManager } from "../src/index.js";

/** A confirmation the user is asked for before a step that cascades or deletes. */
interface Confirmation {
  title: string;
  description: string;
  items: readonly string[];
  action: string;
  run: () => Promise<void>;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Archive files from an uploaded file: a JSON object of file names to their text, as the kernel
 * installs them (`fragment.jsonc`, its aspect files). Throws with the reason otherwise.
 */
export function readArchiveFile(text: string): FragmentFiles {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("the file is not an archive: it is not JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("the file is not an archive: a JSON object of file names to texts");
  const files: Record<string, string> = {};
  for (const [name, content] of Object.entries(value)) {
    if (typeof content !== "string")
      throw new Error(`the file is not an archive: "${name}" is not a text`);
    files[name] = content;
  }
  return files;
}

/**
 * The fragment manager's view: the installed fragments with their state (a failed one with its
 * error and a retry), enable and disable (the dependents listed before a cascade), removal with
 * or without data (confirmed), the catalog's fragments to install, and an archive from a file.
 * Every install goes through the consent dialog first; declining changes nothing.
 */
export function FragmentsView({ manager }: { manager: FragmentManager }) {
  const [entries, setEntries] = useState<FragmentEntry[]>(() => manager.list());
  const [available, setAvailable] = useState<
    { id: string; source: string; files: FragmentFiles }[]
  >([]);
  const [consent, setConsent] = useState<ConsentSummary | undefined>();
  const [confirm, setConfirm] = useState<Confirmation | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    setEntries(manager.list());
    manager.available().then(setAvailable, (e: unknown) => setError(message(e)));
  }, [manager]);
  useEffect(() => {
    refresh();
    return manager.observe(refresh);
  }, [manager, refresh]);

  const act = async (step: () => Promise<void>) => {
    setError(undefined);
    setBusy(true);
    try {
      await step();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const inspect = (files: FragmentFiles, source: string) =>
    act(async () => setConsent(await manager.inspect(files, { source })));

  const disable = (entry: FragmentEntry) => {
    if (entry.dependents.length === 0) {
      void act(() => manager.disable(entry.id));
      return;
    }
    setConfirm({
      title: `Disable ${entry.name ?? entry.id}?`,
      description: "These fragments require it; they stop until it is enabled again:",
      items: entry.dependents,
      action: "Disable all",
      run: () => manager.disable(entry.id, { cascade: true }),
    });
  };

  const remove = (entry: FragmentEntry, withData: boolean) =>
    setConfirm({
      title: `Remove ${entry.name ?? entry.id}${withData ? " with its data" : ""}?`,
      description: withData
        ? "Its data is deleted and cannot be brought back."
        : "Its data is kept: installing it again finds it.",
      items: entry.dependents,
      action: withData ? "Remove and delete its data" : "Remove",
      run: () =>
        manager.remove(entry.id, {
          withData,
          ...(entry.dependents.length ? { cascade: true } : {}),
        }),
    });

  return (
    <div data-testid="fragments-view" className="flex flex-col gap-4 overflow-auto p-4">
      {error && (
        <p data-testid="fragments-error" role="alert" className="m-0 text-sm text-destructive">
          {error}
        </p>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Installed</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {entries.length === 0 && (
            <p className="m-0 text-sm text-muted-foreground">No fragment is installed.</p>
          )}
          {entries.map((entry) => (
            <div
              key={entry.id}
              data-testid="fragment-entry"
              data-fragment={entry.id}
              data-state={entry.state}
              className="flex flex-col gap-1 border-b pb-3 last:border-b-0"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{entry.name ?? entry.id}</span>
                <span className="text-xs text-muted-foreground">
                  {entry.id} {entry.version}
                </span>
                <span data-testid="fragment-state" className="rounded border px-1 text-xs">
                  {entry.state}
                </span>
              </div>
              {entry.failures.map((f) => (
                <p
                  key={f.aspect}
                  data-testid="fragment-failure"
                  className="m-0 text-sm text-destructive"
                >
                  {f.aspect}: {f.message}
                </p>
              ))}
              <div className="flex flex-wrap gap-2">
                {entry.state === "failed" && (
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => act(() => manager.retry(entry.id))}
                  >
                    Retry
                  </Button>
                )}
                {entry.enabled ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => disable(entry)}
                  >
                    Disable
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => act(() => manager.enable(entry.id))}
                  >
                    Enable
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => remove(entry, false)}
                >
                  Remove
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => remove(entry, true)}
                >
                  Remove with data
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Available</CardTitle>
          <CardDescription>Fragments this app offers, and archives from a file.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {available.map((offer) => (
            <div
              key={offer.id}
              data-testid="fragment-available"
              data-fragment={offer.id}
              className="flex items-center gap-2"
            >
              <span className="font-medium">{offer.id}</span>
              <Button size="sm" disabled={busy} onClick={() => inspect(offer.files, offer.source)}>
                Install…
              </Button>
            </div>
          ))}
          <label className="flex flex-col gap-1 text-sm">
            Install from a file
            <input
              type="file"
              accept=".json,application/json"
              disabled={busy}
              onChange={(event) => {
                const input = event.currentTarget;
                const file = input.files?.[0];
                input.value = "";
                if (file)
                  void act(async () =>
                    setConsent(
                      await manager.inspect(readArchiveFile(await file.text()), {
                        source: file.name,
                      }),
                    ),
                  );
              }}
            />
          </label>
        </CardContent>
      </Card>
      {consent && (
        <ConsentDialog
          summary={consent}
          busy={busy}
          onDecline={() => setConsent(undefined)}
          onAccept={() =>
            act(async () => {
              await manager.install(consent);
              setConsent(undefined);
            })
          }
        />
      )}
      <AlertDialog open={!!confirm} onOpenChange={(open) => !open && setConfirm(undefined)}>
        {confirm && (
          <AlertDialogContent data-testid="fragments-confirm">
            <AlertDialogHeader>
              <AlertDialogTitle>{confirm.title}</AlertDialogTitle>
              <AlertDialogDescription>{confirm.description}</AlertDialogDescription>
            </AlertDialogHeader>
            {confirm.items.length > 0 && (
              <ul data-testid="fragments-confirm-dependents" className="m-0 pl-5 text-sm">
                {confirm.items.map((id) => (
                  <li key={id}>{id}</li>
                ))}
              </ul>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  const run = confirm.run;
                  setConfirm(undefined);
                  void act(run);
                }}
              >
                {confirm.action}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span data-testid={`consent-${label.toLowerCase().replaceAll(" ", "-")}`}>{children}</span>
    </div>
  );
}

const none = <span className="text-muted-foreground">none</span>;
const named = (items: readonly Record<string, unknown>[]) =>
  items.length ? items.map((i) => String(i.title ?? i.name ?? JSON.stringify(i))).join(", ") : none;

/** What one archive asks for: the items of the consent screen. */
function SummaryRows({ summary }: { summary: ConsentSummary }) {
  return (
    <>
      <Row label="Fragment">
        {summary.name ?? summary.id ?? "unreadable"} {summary.id} {summary.version}
      </Row>
      <Row label="Source">{summary.source}</Row>
      <Row label="Content hash">
        <code className="break-all text-xs">{summary.archive}</code>
      </Row>
      <Row label="Platform">
        {summary.platform
          ? `${summary.platform.range}${summary.platform.fits ? "" : " (not this platform)"}`
          : none}
      </Row>
      <Row label="Bindings">
        {summary.bindings.length
          ? summary.bindings.map((b) => `${b.name}${b.offered ? "" : " (not offered)"}`).join(", ")
          : none}
      </Row>
      <Row label="Requires">
        {summary.requires.length
          ? summary.requires
              .map(
                (r) =>
                  `${r.id} ${r.range}: ${r.state}${r.version ? ` ${r.version}` : ""}${
                    r.state === "installed" && r.enabled === false ? " (disabled)" : ""
                  }`,
              )
              .join("; ")
          : none}
      </Row>
      <Row label="Server half">{summary.server ? "yes" : "no"}</Row>
      <Row label="Agent plugins">{named(summary.agentPlugins)}</Row>
      <Row label="Secrets">{named(summary.secrets)}</Row>
      <Row label="Exposures">
        {summary.exposures.length
          ? summary.exposures.map((e) => `${e.command} (${e.exposures.join(", ")})`).join("; ")
          : none}
      </Row>
    </>
  );
}

/** The consent screen: everything the install brings, its refusals, accept or decline. */
function ConsentDialog({
  summary,
  busy,
  onAccept,
  onDecline,
}: {
  summary: ConsentSummary;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    // While an accepted install runs, the dialog stays: closing it would not stop the install.
    <Dialog open onOpenChange={(open) => !open && !busy && onDecline()}>
      <DialogContent
        data-testid="consent-dialog"
        className="max-h-[90vh] overflow-auto sm:max-w-2xl"
      >
        <DialogHeader>
          <DialogTitle>Install {summary.name ?? summary.id ?? summary.source}?</DialogTitle>
          <DialogDescription>
            What it brings and may do. Nothing is installed unless you accept.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <SummaryRows summary={summary} />
        </div>
        {summary.proposed.map((p) => (
          <div
            key={p.archive}
            data-testid="consent-proposed"
            data-fragment={p.id}
            className="flex flex-col gap-2 border-t pt-2"
          >
            <p className="m-0 text-sm font-medium">Also installed, as it requires: {p.id}</p>
            <SummaryRows summary={p} />
          </div>
        ))}
        {summary.refusals.length > 0 && (
          <ul className="m-0 pl-5 text-sm text-destructive">
            {summary.refusals.map((r) => (
              <li
                key={`${r.id}:${r.code}:${r.message}`}
                data-testid="consent-refusal"
                data-code={r.code}
              >
                {r.message}
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onDecline}>
            Decline
          </Button>
          <Button disabled={busy || !summary.installable} onClick={onAccept}>
            Install
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The fragment's client module, bound to the manager: what its view extension's reference
 * (`./index.js`, `FragmentsView`) resolves to in the host.
 */
export function fragmentsModule(manager: FragmentManager): Record<string, unknown> {
  const View: ComponentType = () => <FragmentsView manager={manager} />;
  return { FragmentsView: View };
}
